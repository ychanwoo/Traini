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
  validDate,
} from "./goal";
export type ContextRow = RunningRow & {
  average_heart_rate: unknown;
  activity_training_details?: unknown;
};
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
export type ReportedBaseline = {
  version: 1;
  source: "user_reported";
  reportedOn: string;
  weeklyDistanceKm: number;
  longRunKm: number;
  easyPaceSecondsPerKm: number;
  qualityPaceSecondsPerKm: number;
  weeklyQualityKm: number;
  weeklyQualitySessions: number;
  routine: unknown[];
};
function reportedBaseline(
  value: unknown,
  today: string,
): ReportedBaseline | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const b = value as ReportedBaseline;
  if (
    b.version !== 1 ||
    b.source !== "user_reported" ||
    typeof b.reportedOn !== "string" ||
    !validDate(b.reportedOn) ||
    b.reportedOn > today ||
    calendarDistance(b.reportedOn, today) > 56 ||
    !Array.isArray(b.routine) ||
    b.routine.length > 7
  )
    return null;
  for (const [n, low, high] of [
    [b.weeklyDistanceKm, 1, 200],
    [b.longRunKm, 1, 60],
    [b.easyPaceSecondsPerKm, 120, 1800],
    [b.qualityPaceSecondsPerKm, 100, 1800],
    [b.weeklyQualityKm, 0, 40],
    [b.weeklyQualitySessions, 0, 3],
  ])
    if (typeof n !== "number" || !Number.isFinite(n) || n < low || n > high)
      return null;
  return b;
}
type Lap = {
  distanceMeters: number | null;
  timerSeconds: number | null;
  paceSecondsPerKm: number | null;
  averageHeartRate: number | null;
  intensity: string | null;
};
function lapEvidence(raw: unknown) {
  if (Array.isArray(raw)) raw = raw[0];
  if (!raw || typeof raw !== "object" || !("evidence" in raw)) return null;
  const e = (raw as { evidence: Record<string, unknown> }).evidence;
  if (!e || e.version !== 1 || !Array.isArray(e.laps) || e.laps.length > 160)
    return null;
  const laps: Lap[] = [];
  for (const rawLap of e.laps) {
    if (!rawLap || typeof rawLap !== "object") return null;
    const l = rawLap as Lap;
    for (const [v, max] of [
      [l.distanceMeters, 100000],
      [l.timerSeconds, 86400],
      [l.paceSecondsPerKm, 3600],
      [l.averageHeartRate, 254],
    ] as const)
      if (
        v !== null &&
        (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max)
      )
        return null;
    if (
      l.intensity !== null &&
      ![
        "warmup",
        "cooldown",
        "active",
        "rest",
        "recovery",
        "interval",
      ].includes(l.intensity)
    )
      return null;
    laps.push({
      distanceMeters: l.distanceMeters,
      timerSeconds: l.timerSeconds,
      paceSecondsPerKm: l.paceSecondsPerKm,
      averageHeartRate: l.averageHeartRate,
      intensity: l.intensity,
    });
  }
  return {
    source: "fit_lap" as const,
    lapsComplete: e.lapsComplete === true,
    lapCount: e.lapCount,
    laps,
    aerobicTrainingEffect:
      typeof e.aerobicTrainingEffect === "number"
        ? e.aerobicTrainingEffect
        : null,
    anaerobicTrainingEffect:
      typeof e.anaerobicTrainingEffect === "number"
        ? e.anaerobicTrainingEffect
        : null,
  };
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
  const baseline = reportedBaseline(profile.training_baseline, period.today);
  const rowById = new Map(rows.map((r) => [r.garmin_activity_id, r]));
  const sessions = summary.activities.map((a) => ({
    ...a,
    id: undefined,
    averageHeartRate: heartRates.get(a.id) ?? null,
    evidence: lapEvidence(rowById.get(a.id)?.activity_training_details),
  }));
  return {
    reportedBaseline: baseline,
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
      readyForRecoveryInput:
        summary.coverage.paceCount > 0 &&
        issues.every(
          (i) => i.field === "targetDate" && i.code === "past_date",
        ) &&
        !!goal.races?.some(
          (r) =>
            r.date <= period.today &&
            calendarDistance(r.date, period.today) <= 56,
        ),
      issues,
      limitations,
      assessment: "input_completeness_only",
    },
    workoutFeedback: [] as import("./workout-feedback").FeedbackEvidence[],
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
      sessions,
    },
  };
}
export type TrainingContext = ReturnType<typeof buildTrainingContext>;
