import {
  addCalendarDays,
  buildRunningSummary,
  runningPeriod,
  type RunningRow,
} from "@/lib/garmin/running-summary";
import {
  calendarDistance,
  DISTANCES,
  goalFromProfile,
  goalIssues,
} from "./goal";
export type ContextRow = RunningRow & { average_heart_rate: unknown };
export function historyPeriod(timezone: string, now: Date) {
  const last = runningPeriod(timezone, "previous", now);
  return { ...last, start: addCalendarDays(last.start, -49) };
}
function heartRate(value: unknown): number | null {
  if (value === null) return null;
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+(\.\d+)?$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n) || n < 1 || n > 254)
    throw new Error("Invalid heart rate");
  return n;
}
export function buildTrainingContext(
  profile: Record<string, unknown>,
  rows: ContextRow[],
  timezone: string,
  now = new Date(),
) {
  const period = historyPeriod(timezone, now);
  const { goal, issues: storedIssues } = goalFromProfile(profile, period.today);
  const issues = goalIssues(goal, storedIssues);
  // Validate once across the complete window, including duplicate IDs spanning weeks.
  const summary = buildRunningSummary(rows, period);
  const heartRates = new Map<string, number | null>();
  const dates = new Map(
    summary.activities.map((activity) => [activity.id, activity.trainingDate]),
  );
  const grouped: ContextRow[][] = Array.from({ length: 8 }, () => []);
  for (const row of rows) {
    const day = dates.get(row.garmin_activity_id);
    if (day) {
      heartRates.set(row.garmin_activity_id, heartRate(row.average_heart_rate));
      grouped[Math.floor(calendarDistance(period.start, day) / 7)].push(row);
    }
  }
  const weeks = Array.from({ length: 8 }, (_, index) => {
    const start = addCalendarDays(period.start, index * 7);
    const weekly = buildRunningSummary(grouped[index], {
      ...period,
      start,
      end: addCalendarDays(start, 6),
    });
    const distances = weekly.activities.flatMap((a) =>
      a.distanceMeters === null ? [] : [a.distanceMeters],
    );
    const count = weekly.totals.activityCount;
    return {
      start,
      end: addCalendarDays(start, 6),
      recordStatus: count
        ? ("recorded_activities" as const)
        : ("no_recorded_activities" as const),
      activityCount: count,
      runningDays: weekly.days.filter((day) => day.activityCount > 0).length,
      distanceMeters: count ? weekly.totals.distanceMeters : null,
      timerSeconds: count ? weekly.totals.timerSeconds : null,
      paceSecondsPerKm: weekly.totals.paceSecondsPerKm,
      longestRunMeters: distances.length ? Math.max(...distances) : null,
      coverage: {
        ...weekly.coverage,
        heartRateCount: weekly.activities.filter(
          (a) => heartRates.get(a.id) != null,
        ).length,
      },
    };
  });
  const observed = weeks.filter((week) => week.activityCount > 0);
  const limitations = [
    "activity_absence_is_unknown",
    "recovery_data_unavailable",
  ];
  if (observed.length < 8) limitations.push("limited_history");
  if (!summary.activities.length) limitations.push("no_running_history");
  if (summary.coverage.distanceCount < summary.activities.length)
    limitations.push("missing_distance");
  if (summary.coverage.timerCount < summary.activities.length)
    limitations.push("missing_timer");
  const heartRateCount = [...heartRates.values()].filter(
    (value) => value !== null,
  ).length;
  if (heartRateCount < summary.activities.length)
    limitations.push("missing_heart_rate");
  const readyForPlanInput =
    issues.length === 0 && summary.coverage.paceCount > 0;
  return {
    schemaVersion: 1 as const,
    generatedAt: now.toISOString(),
    timezone,
    asOfDate: period.today,
    units: {
      distance: "meters",
      duration: "seconds",
      pace: "seconds_per_kilometer",
      heartRate: "beats_per_minute",
      weekdays: "ISO_Monday_1_Sunday_7",
    },
    goal: {
      ...goal,
      targetDistanceMeters: goal.targetDistance
        ? DISTANCES[goal.targetDistance]
        : null,
      daysUntilTarget: goal.targetDate
        ? calendarDistance(period.today, goal.targetDate)
        : null,
    },
    planningPeriod: { startsOn: period.today, endsOn: goal.targetDate },
    inputs: {
      readyForPlanInput,
      issues,
      limitations,
      assessment: "input_completeness_only",
    },
    history: {
      source: "garmin_fit",
      start: period.start,
      end: period.end,
      requestedWeeks: 8,
      weeksWithActivities: observed.length,
      activityCount: summary.totals.activityCount,
      coverage: { ...summary.coverage, heartRateCount },
      lastUpdatedAt: summary.lastUpdatedAt,
      weeks,
    },
  };
}
export type TrainingContext = ReturnType<typeof buildTrainingContext>;
