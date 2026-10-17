import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  parseMatchSnapshot,
  decideWorkoutMatches,
  confirmWorkoutMatch,
  projectWorkoutMatches,
  type MatchSnapshot,
  type MatchDecision,
} from "./workout-matching";

async function snapshot(userId: string, planId: string) {
  const { data, error } = await getSupabaseAdmin()
    .rpc("workout_match_snapshot", { p_user_id: userId, p_plan_id: planId })
    .abortSignal(AbortSignal.timeout(15_000));
  if (error) throw new Error("match_storage");
  return parseMatchSnapshot(data);
}
async function apply(
  userId: string,
  value: MatchSnapshot,
  decisions: MatchDecision[],
  confirmation: string | null = null,
) {
  const { data, error } = await getSupabaseAdmin()
    .rpc("apply_workout_matches", {
      p_user_id: userId,
      p_plan_id: value.planId,
      p_revision: value.revision,
      p_decisions: decisions,
      p_confirmation: confirmation,
    })
    .abortSignal(AbortSignal.timeout(15_000));
  if (error)
    throw new Error(
      error.message?.includes("match_changed")
        ? "match_changed"
        : error.message?.includes("match_conflict")
          ? "match_conflict"
          : "match_storage",
    );
  return parseMatchSnapshot(data);
}
export async function readWorkoutMatches(userId: string, planId: string) {
  const current = await snapshot(userId, planId);
  const valid = new Set(
    current.activities
      .filter(
        (a) =>
          a.verified &&
          a.distanceMeters !== null &&
          a.distanceMeters > 0 &&
          a.timerSeconds !== null &&
          a.timerSeconds > 0 &&
          Date.parse(a.startedAt) <= Date.now(),
      )
      .map((a) => a.id),
  );
  return projectWorkoutMatches({
    ...current,
    links: current.links.filter((l) => valid.has(l.activityId)),
  });
}

export async function reconcileWorkoutMatches(userId: string, planId: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await snapshot(userId, planId);
    try {
      return projectWorkoutMatches(
        await apply(userId, current, decideWorkoutMatches(current)),
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "match_changed" ||
        attempt === 1
      )
        throw error;
    }
  }
  throw new Error("match_changed");
}
export async function saveWorkoutMatch(
  userId: string,
  workoutId: string,
  revision: string,
  activityIds: string[],
) {
  const db = getSupabaseAdmin();
  const { data: workout, error } = await db
    .from("workouts")
    .select("plan_id,training_plans!inner(user_id,source_version)")
    .eq("id", workoutId)
    .eq("training_plans.user_id", userId)
    .eq("training_plans.source_version", 1)
    .abortSignal(AbortSignal.timeout(15_000))
    .maybeSingle();
  if (error) throw new Error("match_storage");
  if (!workout) throw new Error("match_activity");
  const current = await snapshot(userId, workout.plan_id);
  if (current.revision !== revision) throw new Error("match_changed");
  await apply(
    userId,
    current,
    confirmWorkoutMatch(current, workoutId, activityIds),
    workoutId,
  );
}

export async function reconcileRecentWorkoutMatches(userId: string) {
  const { runningPeriod, addCalendarDays } =
    await import("@/lib/garmin/running-summary");
  const period = runningPeriod(
    process.env.TRAINI_TIMEZONE ?? "America/Los_Angeles",
    "current",
  );
  const { data, error } = await getSupabaseAdmin()
    .from("training_plans")
    .select("id")
    .eq("user_id", userId)
    .eq("source_version", 1)
    .gte("starts_on", addCalendarDays(period.start, -56))
    .lte("starts_on", period.start)
    .order("starts_on", { ascending: false })
    .limit(10)
    .abortSignal(AbortSignal.timeout(15_000));
  if (error || !data || data.length > 9) throw new Error("match_storage");
  let failed = 0;
  // Bound database concurrency; imports may include eight historical weeks.
  for (let i = 0; i < data.length; i += 3) {
    const results = await Promise.allSettled(
      data.slice(i, i + 3).map((p) => reconcileWorkoutMatches(userId, p.id)),
    );
    failed += results.filter((r) => r.status === "rejected").length;
  }
  return { checked: data.length - failed, failed };
}
