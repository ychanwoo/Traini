import {
  addCalendarDays,
  buildRunningSummary,
  type RunningSummary,
} from "@/lib/garmin/running-summary";
import { DISTANCES, raceCalendar, raceEvidence } from "./goal";
import { buildReviewMetrics, type ReviewSnapshot } from "./weekly-review";
import type { TrainingContext } from "./context";
import type { StoredPlan } from "./weekly-plan";

const round = (n: number) => Math.round(n * 1000000) / 1000000;
function statistics(summary: RunningSummary) {
  const count = summary.totals.activityCount;
  const distances = summary.activities.flatMap((a) =>
    a.distanceMeters === null ? [] : [a.distanceMeters],
  );
  return {
    start: summary.period.start,
    end: summary.period.end,
    activityCount: count,
    distanceMeters: count ? summary.totals.distanceMeters : null,
    timerSeconds: count ? summary.totals.timerSeconds : null,
    paceSecondsPerKm: summary.totals.paceSecondsPerKm,
    longestRunMeters: distances.length ? Math.max(...distances) : null,
    coverage: summary.coverage,
    status: !count
      ? ("no_recorded_activities" as const)
      : summary.coverage.distanceCount < count ||
          summary.coverage.timerCount < count
        ? ("partial_metrics" as const)
        : ("recorded_activities" as const),
  };
}
export function buildProgressInsights(
  context: TrainingContext,
  current: RunningSummary,
  snapshots: ReviewSnapshot[],
  plan: StoredPlan | null,
  inputsChanged: boolean,
) {
  if (
    snapshots.length !== 8 ||
    current.period.timezone !== context.timezone ||
    current.period.today !== context.asOfDate ||
    current.period.start !== addCalendarDays(context.history.end, 1)
  )
    throw new Error("progress_snapshot");
  const summaries = snapshots.map((s, i) => {
    if (
      s.startsOn !== addCalendarDays(context.history.start, i * 7) ||
      s.timezone !== context.timezone
    )
      throw new Error("progress_snapshot");
    return buildRunningSummary(
      s.source.activities
        .filter((a) => a.verified)
        .map((a) => ({
          garmin_activity_id: a.garminId,
          started_at: a.startedAt,
          updated_at: a.startedAt,
          distance_meters: a.distanceMeters,
          duration_seconds: a.timerSeconds,
          average_pace_seconds_per_km: a.paceSecondsPerKm,
        })),
      {
        selection: "previous",
        start: s.startsOn,
        end: s.endsOn,
        today: context.asOfDate,
        timezone: context.timezone,
      },
    );
  });
  // Only paired distance+timer values contribute to pace; stored per-run pace is never averaged.
  const activities = summaries.flatMap((s) => s.activities);
  if (new Set(activities.map((a) => a.id)).size !== activities.length)
    throw new Error("progress_duplicate");
  const observed = summaries.filter((s) => s.totals.activityCount > 0);
  const complete = observed.filter(
    (s) => s.coverage.distanceCount === s.totals.activityCount,
  );
  const paired = activities.filter(
    (a) =>
      a.distanceMeters !== null &&
      a.distanceMeters > 0 &&
      a.timerSeconds !== null &&
      a.timerSeconds > 0,
  );
  const knownDistance = activities.filter((a) => a.distanceMeters !== null);
  const currentFiltered = buildRunningSummary(
    current.activities
      .filter((a) => Date.parse(a.startedAt) <= Date.parse(context.generatedAt))
      .map((a) => ({
        garmin_activity_id: a.id,
        started_at: a.startedAt,
        updated_at: current.lastUpdatedAt ?? a.startedAt,
        distance_meters: a.distanceMeters,
        duration_seconds: a.timerSeconds,
        average_pace_seconds_per_km: a.paceSecondsPerKm,
      })),
    current.period,
  );
  const weeks = summaries.map((summary, i) => {
    const m = buildReviewMetrics(snapshots[i], context);
    return {
      ...statistics(summary),
      performance: {
        hasPlan: m.hasPlan,
        plannedKm: m.plannedKm,
        plannedSessions: m.plannedSessions,
        garminCompleted: m.garminCompleted,
        manualCompleted: m.manualCompleted,
        unconfirmed: m.unconfirmed,
        explicitlySkipped: m.explicitlySkipped,
        matchedActualKm: round(
          m.sessions.reduce((sum, s) => sum + (s.actualKm ?? 0), 0),
        ),
        unassignedRuns: m.unassignedRuns,
      },
    };
  });
  const comparable = summaries.slice(-2);
  const a = comparable[0],
    b = comparable[1];
  const comparison =
    a.totals.activityCount > 0 &&
    b.totals.activityCount > 0 &&
    a.coverage.distanceCount === a.totals.activityCount &&
    b.coverage.distanceCount === b.totals.activityCount &&
    a.totals.distanceMeters !== null &&
    a.totals.distanceMeters > 0 &&
    b.totals.distanceMeters !== null
      ? {
          previousStart: a.period.start,
          latestStart: b.period.start,
          distanceChangePercent: round(
            (b.totals.distanceMeters / a.totals.distanceMeters - 1) * 100,
          ),
        }
      : null;
  const events = raceCalendar(
    context.goal.races ?? [],
    context.asOfDate,
    context.asOfDate,
    raceEvidence(context, current),
  );
  const races = events.events.map((r) => {
    return {
      ...r,
      daysUntil: r.daysUntil,
      phase: r.phase,
      targetPaceSecondsPerKm:
        r.targetTimeSeconds === null
          ? null
          : Math.round((r.targetTimeSeconds / DISTANCES[r.distance]) * 1000),
      taperStart: addCalendarDays(r.date, -r.taperDays),
      taperEnd: addCalendarDays(r.date, -1),
      recoveryStart: addCalendarDays(r.date, 1),
      recoveryEnd: addCalendarDays(r.date, r.recoveryDays),
    };
  });
  const workouts = plan?.workouts.filter((w) => w.kind !== "rest") ?? [];
  const due = workouts.filter((w) => w.date <= context.asOfDate);
  const performance = plan
    ? {
        hasPlan: true,
        startsOn: plan.startsOn,
        endsOn: plan.endsOn,
        inputsChanged,
        plannedKm: round(workouts.reduce((sum, w) => sum + w.distanceKm, 0)),
        plannedSessions: workouts.length,
        dueSessions: due.length,
        upcomingSessions: workouts.length - due.length,
        garminCompleted: due.filter((w) => w.matching?.source === "garmin")
          .length,
        manualCompleted: due.filter((w) => w.matching?.source === "manual")
          .length,
        unconfirmed: due.filter(
          (w) =>
            w.matching &&
            !w.matching.source &&
            w.matching.state !== "unavailable",
        ).length,
        unavailable: due.filter(
          (w) => w.matching?.state === "unavailable" || !w.matching,
        ).length,
      }
    : null;
  return {
    version: 1 as const,
    generatedAt: context.generatedAt,
    asOfDate: context.asOfDate,
    timezone: context.timezone,
    period: { start: context.history.start, end: context.history.end },
    totals: {
      activityCount: activities.length,
      weeksWithActivities: observed.length,
      completeDistanceWeeks: complete.length,
      recordedDistanceMeters: knownDistance.length
        ? round(knownDistance.reduce((sum, a) => sum + a.distanceMeters!, 0))
        : null,
      averageRecordedWeekMeters: complete.length
        ? round(
            complete.reduce((sum, s) => sum + s.totals.distanceMeters!, 0) /
              complete.length,
          )
        : null,
      paceSecondsPerKm: paired.length
        ? round(
            (paired.reduce((sum, a) => sum + a.timerSeconds!, 0) /
              paired.reduce((sum, a) => sum + a.distanceMeters!, 0)) *
              1000,
          )
        : null,
      paceActivityCount: paired.length,
      missingDistanceCount: activities.length - knownDistance.length,
      missingTimerCount: activities.filter((a) => a.timerSeconds === null)
        .length,
      longestRunMeters: knownDistance.length
        ? Math.max(...knownDistance.map((a) => a.distanceMeters!))
        : null,
      excludedUnverifiedActivities: snapshots.reduce(
        (sum, s) => sum + s.source.activities.filter((a) => !a.verified).length,
        0,
      ),
    },
    weeks,
    current: { ...statistics(currentFiltered), performance },
    races,
    raceWarnings: events.warnings,
    racePolicy: { version: events.version, load: events.load },
    comparison,
    limitations: [
      "no_recovery_sleep_hrv_assessment",
      "no_race_time_prediction",
      "absence_is_unknown",
      "recorded_week_average_not_training_target",
    ],
  };
}
export type ProgressInsights = ReturnType<typeof buildProgressInsights>;
