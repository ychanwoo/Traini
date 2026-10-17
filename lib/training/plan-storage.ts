import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  PlanWeek,
  StoredPlan,
  StoredWorkout,
  PlanContent,
} from "./weekly-plan";
import { planPeriod, PlanError } from "./weekly-plan";
import { reconcileWorkoutMatches } from "./matching-storage";
const timeout = () => AbortSignal.timeout(15_000);
export async function revision(userId: string) {
  const { data, error } = await getSupabaseAdmin()
    .rpc("training_input_revision", { p_user_id: userId })
    .abortSignal(timeout());
  if (error || typeof data !== "string") throw new PlanError("storage");
  return data;
}
export async function readPlan(
  userId: string,
  week: PlanWeek,
  now = new Date(),
) {
  const timezone = process.env.TRAINI_TIMEZONE ?? "America/Los_Angeles";
  const period = planPeriod(timezone, week, now);
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("training_plans")
    .select(
      "id,starts_on,ends_on,summary,target_distance_km,created_at,model,input_revision,workouts(id,scheduled_on,kind,status,title,purpose,distance_km,pace_seconds_per_km,effort,steps)",
    )
    .eq("user_id", userId)
    .eq("starts_on", period.start)
    .eq("source_version", 1)
    .abortSignal(timeout())
    .maybeSingle();
  if (error) throw new PlanError("storage");
  let plan: StoredPlan | null = null;
  if (data) {
    // Reconcile lazily after import / generation. Failed matching must not hide a
    // usable plan or turn an already saved completion into an unchecked state.
    let matches: Awaited<ReturnType<typeof reconcileWorkoutMatches>> | null =
      null;
    try {
      matches = await reconcileWorkoutMatches(userId, data.id);
    } catch {
      /* Separate status in UI; retry on refresh. */
    }
    const workouts: StoredWorkout[] = data.workouts
      .map((w) => ({
        id: w.id,
        date: w.scheduled_on,
        kind: w.kind as StoredWorkout["kind"],
        completed: matches?.has(w.id)
          ? !!matches.get(w.id)?.source
          : w.status === "completed",
        matching: matches?.get(w.id) ?? {
          state: "unavailable",
          reason: "unavailable",
          revision: "",
          source: null,
          method: null,
          actualDistanceKm: null,
          actualTimerSeconds: null,
          activities: [],
        },
        title: w.title,
        purpose: w.purpose,
        distanceKm: Number(w.distance_km),
        paceSecondsPerKm: w.pace_seconds_per_km,
        effort: w.effort as StoredWorkout["effort"],
        steps: w.steps ?? [],
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    plan = {
      id: data.id,
      startsOn: data.starts_on,
      endsOn: data.ends_on,
      summary: data.summary,
      targetDistanceKm: Number(data.target_distance_km),
      createdAt: data.created_at,
      model: data.model,
      workouts,
    };
  }
  const { data: job, error: jobError } = await db
    .from("training_generation_requests")
    .select("state,lease_expires_at,failure_code,started_at")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(1)
    .abortSignal(timeout())
    .maybeSingle();
  if (jobError) throw new PlanError("storage");
  const generating =
    job?.state === "running" && Date.parse(job.lease_expires_at) > Date.now();
  return {
    period,
    plan,
    generating,
    generationError:
      job?.state === "failed"
        ? job.failure_code
        : job?.state === "running" && !generating
          ? "interrupted"
          : null,
    inputsChanged: data
      ? data.input_revision !== (await revision(userId))
      : false,
  };
}
export async function reserveGeneration(
  userId: string,
  start: string,
  inputRevision: string,
) {
  const { data, error } = await getSupabaseAdmin()
    .rpc("begin_training_generation", {
      p_user_id: userId,
      p_starts_on: start,
      p_revision: inputRevision,
    })
    .abortSignal(timeout());
  if (error || !data || typeof data.state !== "string")
    throw new PlanError("storage");
  return data as {
    state: "started" | "existing" | "busy" | "limited";
    requestId?: string;
  };
}
export async function savePlan(
  requestId: string,
  content: PlanContent,
  model: string,
  timezone: string,
  usage: unknown,
) {
  const { data, error } = await getSupabaseAdmin()
    .rpc("finish_training_generation", {
      p_request_id: requestId,
      p_content: content,
      p_model: model,
      p_timezone: timezone,
      p_usage: usage,
    })
    .abortSignal(timeout());
  if (error || typeof data !== "string")
    throw new PlanError(
      error?.message?.includes("input_changed") ? "input_changed" : "storage",
    );
}
export async function failGeneration(
  requestId: string,
  code: string,
  usage: unknown,
) {
  const { error } = await getSupabaseAdmin()
    .rpc("fail_training_generation", {
      p_request_id: requestId,
      p_code: code,
      p_usage: usage,
    })
    .abortSignal(timeout());
  if (error) throw new PlanError("storage");
}
export async function completeWorkout(userId: string, workoutId: string) {
  const { data, error } = await getSupabaseAdmin()
    .rpc("complete_training_workout", {
      p_user_id: userId,
      p_workout_id: workoutId,
    })
    .abortSignal(timeout());
  if (error) throw new PlanError("storage");
  if (data !== true) throw new PlanError("workout");
}
