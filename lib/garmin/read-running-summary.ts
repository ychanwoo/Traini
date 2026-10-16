import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { buildRunningSummary, queryWindow, runningPeriod, type RunningRow, type WeekSelection } from "./running-summary";

const PAGE_SIZE = 500;
const MAX_ROWS = 10_000;
const columns = "garmin_activity_id,started_at,updated_at,distance_meters,duration_seconds,average_pace_seconds_per_km";

export async function readRunningSummary(userId: string, selection: WeekSelection, now = new Date()) {
  const timezone = process.env.TRAINI_TIMEZONE ?? "America/Los_Angeles";
  const period = runningPeriod(timezone, selection, now);
  const window = queryWindow(period);
  const rows: RunningRow[] = [];
  const supabase = getSupabaseAdmin();
  const signal = AbortSignal.timeout(15_000);
  let expected: number | null = null;
  for (let offset = 0; ; offset = rows.length) {
    const { data, error, count } = await supabase.from("activities").select(columns, { count: "exact" })
      .eq("user_id", userId).eq("source", "garmin_fit").eq("activity_type", "running")
      .gte("started_at", window.start).lt("started_at", window.endExclusive)
      .order("started_at", { ascending: true }).order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1).abortSignal(signal);
    if (error || !Array.isArray(data) || count === null || !Number.isSafeInteger(count) || count < 0) {
      throw new Error("Running summary query failed");
    }
    if (count > MAX_ROWS) throw new Error("Running summary limit exceeded");
    if (expected !== null && expected !== count) throw new Error("Running activities changed during pagination");
    expected = count;
    rows.push(...data as RunningRow[]);
    if (rows.length === expected) break;
    if (rows.length > expected || data.length === 0) throw new Error("Incomplete running summary");
  }
  return buildRunningSummary(rows, period);
}
