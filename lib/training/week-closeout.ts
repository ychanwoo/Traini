import { addCalendarDays, runningPeriod } from "@/lib/garmin/running-summary";
import { validDate } from "./goal";

/** Calendar dates, never browser-local midnight or elapsed 24-hour durations. */
export function closeoutPeriod(timezone: string, now = new Date()) {
  const current = runningPeriod(timezone, "current", now);
  const sunday = current.today === current.end;
  const start = sunday ? current.start : addCalendarDays(current.start, -7);
  return {
    today: current.today,
    startsOn: start,
    endsOn: addCalendarDays(start, 6),
    nextStartsOn: addCalendarDays(start, 7),
    timezone,
    early: sunday,
  };
}
export function assertCloseoutPeriod(
  start: string,
  timezone: string,
  now = new Date(),
) {
  const period = closeoutPeriod(timezone, now);
  if (!validDate(start) || start !== period.startsOn)
    throw new Error("closeout_period");
  return period;
}
export type CloseoutState = ReturnType<typeof closeoutPeriod> & {
  revision: string;
  unconfirmed: number | null;
  activityCount: number;
  incompleteActivities: number;
  closeout: { closedAt: string; revision: string; fresh: boolean } | null;
};
