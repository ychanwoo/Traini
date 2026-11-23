import { addCalendarDays, runningPeriod } from "@/lib/garmin/running-summary";

// Resolve the saved Monday again on arrival, including across a Sunday/Monday rollover.
export function scheduleWeek(start: string | undefined, timezone: string, now = new Date()) {
  if (!start) return "current";
  const current = runningPeriod(timezone, "current", now).start;
  if (start === addCalendarDays(current, 7)) return "next";
  if (start === addCalendarDays(current, -7)) return "previous";
  return "current";
}
