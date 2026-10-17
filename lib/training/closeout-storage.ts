import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { runningPeriod } from "@/lib/garmin/running-summary";
import { reviewPeriod, ReviewError } from "./weekly-review";
import type { CloseoutState } from "./week-closeout";
const timeout = () => AbortSignal.timeout(15_000);

export async function reviewSelection(
  userId: string,
  timezone: string,
  start?: string | null,
  allowCurrent = true,
  now = new Date(),
) {
  const current = runningPeriod(timezone, "current", now);
  let closed: { closed_at: string; snapshot_revision: string } | null = null;
  if (allowCurrent && current.today === current.end) {
    const { data, error } = await getSupabaseAdmin()
      .from("training_week_closeouts")
      .select("closed_at,snapshot_revision")
      .eq("user_id", userId)
      .eq("starts_on", current.start)
      .eq("timezone", timezone)
      .abortSignal(timeout())
      .maybeSingle();
    if (error) throw new ReviewError("review_storage");
    closed = data;
  }
  const latest = reviewPeriod(timezone, undefined, now, !!closed);
  return {
    period: reviewPeriod(timezone, start, now, !!closed),
    latestStartsOn: latest.startsOn,
    closeout: closed,
  };
}
export async function readCloseout(userId: string): Promise<CloseoutState> {
  const timezone = process.env.TRAINI_TIMEZONE ?? "America/Los_Angeles";
  const { data, error } = await getSupabaseAdmin()
    .rpc("training_week_closeout_status", {
      p_user_id: userId,
      p_timezone: timezone,
    })
    .abortSignal(timeout());
  if (error || !data || !/^[0-9a-f]{32}$/.test(data.revision))
    throw new Error("closeout_storage");
  return data as CloseoutState;
}
export async function closeWeek(
  userId: string,
  startsOn: string,
  revision: string,
) {
  const { error } = await getSupabaseAdmin()
    .rpc("close_training_week", {
      p_user_id: userId,
      p_starts_on: startsOn,
      p_timezone: process.env.TRAINI_TIMEZONE ?? "America/Los_Angeles",
      p_revision: revision,
    })
    .abortSignal(timeout());
  if (error)
    throw new Error(
      error.message.includes("closeout_changed")
        ? "closeout_changed"
        : error.message.includes("closeout_period")
          ? "closeout_period"
          : "closeout_storage",
    );
  return readCloseout(userId);
}
