import { runningPeriod } from "@/lib/garmin/running-summary";

/** Workflow defaults follow the training timezone, independently of the device. */
export function todayWorkflow(timezone: string, now = new Date()) {
  const period = runningPeriod(timezone, "current", now);
  const sunday = period.today === period.end;
  return {
    today: period.today,
    importWeek: sunday ? "current" as const : "previous" as const,
    planWeek: sunday ? "next" as const : "current" as const,
  };
}
