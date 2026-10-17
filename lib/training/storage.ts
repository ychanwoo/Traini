import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { queryWindow } from "@/lib/garmin/running-summary";
import {
  buildTrainingContext,
  historyPeriod,
  type ContextRow,
} from "./context";
import type { TrainingGoal } from "./goal";
import { goalFromProfile } from "./goal";
import { dateInZone } from "@/lib/garmin/running-summary";
const profileColumns =
  "race_name,target_distance,target_date,target_time_seconds,training_days,long_run_day,training_baseline,race_goals,training_condition";
const activityColumns =
  "garmin_activity_id,started_at,updated_at,distance_meters,duration_seconds,average_pace_seconds_per_km,average_heart_rate,activity_training_details(evidence)";
export async function readTrainingGoal(userId: string, now = new Date()) {
  const timezone = process.env.TRAINI_TIMEZONE ?? "America/Los_Angeles";
  const today = dateInZone(now, timezone);
  const { data, error } = await getSupabaseAdmin()
    .rpc("training_goal_snapshot", { p_user_id: userId })
    .abortSignal(AbortSignal.timeout(15000));
  if (error || !data?.profile || typeof data.revision !== "string")
    throw new Error("Goal snapshot unavailable");
  return {
    ...goalFromProfile(data.profile, today),
    today,
    timezone,
    revision: data.revision,
  };
}
export async function readTrainingContext(userId: string, now = new Date()) {
  const timezone = process.env.TRAINI_TIMEZONE ?? "America/Los_Angeles";
  const period = historyPeriod(timezone, now);
  const window = queryWindow(period);
  const db = getSupabaseAdmin();
  const signal = AbortSignal.timeout(15_000);
  const profile = await db
    .from("profiles")
    .select(profileColumns)
    .eq("id", userId)
    .abortSignal(signal)
    .maybeSingle();
  if (profile.error || !profile.data) throw new Error("Profile unavailable");
  const rows: ContextRow[] = [];
  let expected: number | null = null;
  for (let offset = 0; ; offset = rows.length) {
    const { data, error, count } = await db
      .from("activities")
      .select(activityColumns, { count: "exact" })
      .eq("user_id", userId)
      .eq("source", "garmin_fit")
      .eq("activity_type", "running")
      .gte("started_at", window.start)
      .lt("started_at", window.endExclusive)
      .order("started_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + 499)
      .abortSignal(signal);
    if (
      error ||
      !Array.isArray(data) ||
      count === null ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > 10000 ||
      (expected !== null && expected !== count)
    )
      throw new Error("History unavailable");
    expected = count;
    rows.push(...(data as ContextRow[]));
    if (rows.length === expected) break;
    if (!data.length || rows.length > expected)
      throw new Error("Incomplete history");
  }
  return buildTrainingContext(profile.data, rows, timezone, now);
}
export async function saveTrainingGoal(
  userId: string,
  goal: TrainingGoal,
  expectedRevision?: string,
) {
  const { data, error } = await getSupabaseAdmin()
    .rpc("save_training_preferences", {
      p_user_id: userId,
      p_goal: {
        ...goal,
        timezone: process.env.TRAINI_TIMEZONE ?? "America/Los_Angeles",
      },
      p_expected_revision: expectedRevision ?? null,
    })
    .abortSignal(AbortSignal.timeout(15000));
  if (error || typeof data !== "string")
    throw new Error(
      error?.message.includes("goal_conflict")
        ? "goal_conflict"
        : error?.message.includes("past_race")
          ? "past_race"
          : "Goal save failed",
    );
  return data;
}
