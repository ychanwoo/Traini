/** Calendar and aggregation rules shared by the read API and summary UI. */
export type WeekSelection = "current" | "previous";
export type RunningPeriod = {
  selection: WeekSelection; start: string; end: string; today: string; timezone: string;
};
export type RunningActivity = {
  id: string; startedAt: string; trainingDate: string;
  distanceMeters: number | null; timerSeconds: number | null; paceSecondsPerKm: number | null;
};
export type RunningSummary = {
  period: RunningPeriod;
  totals: { activityCount: number; distanceMeters: number | null; timerSeconds: number | null; paceSecondsPerKm: number | null };
  coverage: { distanceCount: number; timerCount: number; paceCount: number };
  days: { date: string; activityCount: number }[];
  activities: RunningActivity[];
  lastUpdatedAt: string | null;
};
export type RunningRow = {
  garmin_activity_id: string; started_at: string; updated_at: string;
  distance_meters: unknown; duration_seconds: unknown; average_pace_seconds_per_km: unknown;
};

export function dateInZone(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addCalendarDays(day: string, days: number): string {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function runningPeriod(timezone: string, selection: WeekSelection, now = new Date()): RunningPeriod {
  const today = dateInZone(now, timezone);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const start = addCalendarDays(today, -((weekday + 6) % 7) - (selection === "previous" ? 7 : 0));
  return { selection, start, end: addCalendarDays(start, 6), today, timezone };
}

export function queryWindow(period: RunningPeriod): { start: string; endExclusive: string } {
  // Fetch a small UTC envelope, then filter by the exact local start date.
  // This avoids guessing UTC offsets or assuming that DST weeks last 168 hours.
  return { start: `${addCalendarDays(period.start, -2)}T00:00:00Z`, endExclusive: `${addCalendarDays(period.end, 3)}T00:00:00Z` };
}

function optionalMetric(value: unknown): number | null {
  if (value === null) return null;
  const number = typeof value === "number" ? value
    : typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(number) || number < 0) throw new Error("Invalid running metric");
  return number;
}
const rounded = (value: number) => {
  if (!Number.isFinite(value)) throw new Error("Running metric overflow");
  return Number(value.toFixed(6));
};

export function buildRunningSummary(rows: RunningRow[], period: RunningPeriod): RunningSummary {
  const activities: RunningActivity[] = [];
  const seen = new Set<string>();
  let lastUpdatedAt: string | null = null;
  for (const row of rows) {
    if (typeof row.garmin_activity_id !== "string" || !/^[1-9]\d{0,19}$/.test(row.garmin_activity_id)
        || typeof row.started_at !== "string" || !Number.isFinite(Date.parse(row.started_at))
        || typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at))) throw new Error("Invalid running activity");
    const trainingDate = dateInZone(new Date(row.started_at), period.timezone);
    if (trainingDate < period.start || trainingDate > period.end) continue;
    if (seen.has(row.garmin_activity_id)) throw new Error("Duplicate running activity");
    seen.add(row.garmin_activity_id);
    const distanceMeters = optionalMetric(row.distance_meters);
    const timerSeconds = optionalMetric(row.duration_seconds);
    const storedPace = optionalMetric(row.average_pace_seconds_per_km);
    const pace = distanceMeters !== null && distanceMeters > 0 && timerSeconds !== null && timerSeconds > 0
      ? rounded(timerSeconds / distanceMeters * 1000) : storedPace && storedPace > 0 ? storedPace : null;
    activities.push({ id: row.garmin_activity_id, startedAt: row.started_at, trainingDate,
      distanceMeters, timerSeconds, paceSecondsPerKm: pace });
    if (!lastUpdatedAt || Date.parse(row.updated_at) > Date.parse(lastUpdatedAt)) lastUpdatedAt = row.updated_at;
  }
  activities.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || a.id.localeCompare(b.id));
  const distanceRows = activities.filter((row) => row.distanceMeters !== null);
  const timerRows = activities.filter((row) => row.timerSeconds !== null);
  // Both values must be present on the same activity. Never average pace values
  // directly or combine distance from one run with duration from another.
  const paceRows = activities.filter((row) => row.distanceMeters !== null && row.distanceMeters > 0
    && row.timerSeconds !== null && row.timerSeconds > 0);
  const distance = distanceRows.reduce((sum, row) => sum + row.distanceMeters!, 0);
  const timer = timerRows.reduce((sum, row) => sum + row.timerSeconds!, 0);
  const pairedDistance = paceRows.reduce((sum, row) => sum + row.distanceMeters!, 0);
  const pairedTimer = paceRows.reduce((sum, row) => sum + row.timerSeconds!, 0);
  return {
    period,
    totals: { activityCount: activities.length,
      distanceMeters: distanceRows.length || !activities.length ? rounded(distance) : null,
      timerSeconds: timerRows.length || !activities.length ? rounded(timer) : null,
      paceSecondsPerKm: paceRows.length ? rounded(pairedTimer / pairedDistance * 1000) : null },
    coverage: { distanceCount: distanceRows.length, timerCount: timerRows.length, paceCount: paceRows.length },
    days: Array.from({ length: 7 }, (_, index) => {
      const date = addCalendarDays(period.start, index);
      return { date, activityCount: activities.filter((row) => row.trainingDate === date).length };
    }),
    activities, lastUpdatedAt,
  };
}

export function distanceLabel(meters: number | null): string {
  return meters === null ? "—" : new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(meters / 1000);
}
export function durationLabel(seconds: number | null): string {
  if (seconds === null) return "—";
  const total = Math.round(seconds);
  if (total < 60) return `${total}초`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours ? `${hours}시간 ${minutes}분` : `${minutes}분 ${total % 60}초`;
}
export function paceLabel(seconds: number | null): string {
  if (seconds === null) return "—";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}′${String(total % 60).padStart(2, "0")}″`;
}
export function periodLabel(period: RunningPeriod): string {
  const day = (value: string) => `${Number(value.slice(5, 7))}.${Number(value.slice(8, 10))}`;
  return `${period.start.slice(0, 4)}. ${day(period.start)} 월 – ${period.start.slice(0, 4) !== period.end.slice(0, 4) ? `${period.end.slice(0, 4)}. ` : ""}${day(period.end)} 일`;
}
export function timezoneLabel(timezone: string): string {
  return timezone === "America/Los_Angeles" ? "태평양 시간 기준" : `${timezone.replaceAll("_", " ")} 기준`;
}
