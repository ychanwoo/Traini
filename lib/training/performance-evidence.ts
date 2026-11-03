import type { TrainingContext } from "./context";
import { analyzeSession, validHeartRate } from "./session-evidence";

const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length
    ? (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2
    : null;
};
const positive = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;
const age = (date: string, end: string) =>
  (Date.parse(end + "T00:00:00Z") - Date.parse(date + "T00:00:00Z")) / 86400000;

/** Descriptive comparisons, not fitness tests: route, heat and sensor quality remain unknown. */
export function performanceEvidence(
  context: TrainingContext,
  through = context.asOfDate,
) {
  const sessions = [
    ...(context.history.sessions ?? []),
    ...(context.currentWeek?.sessions ?? []),
  ]
    .filter(
      (s) =>
        s.trainingDate <= through &&
        age(s.trainingDate, through) >= 0 &&
        age(s.trainingDate, through) <= 56,
    )
    .sort((a, b) =>
      (a.startedAt ?? a.trainingDate).localeCompare(
        b.startedAt ?? b.trainingDate,
      ),
    );
  // Multiple activities/feedback on a date cannot be safely assigned by date alone.
  const observations = sessions.flatMap((s) => {
    const analysis = analyzeSession(s);
    const structured = analysis.classification !== "uncertain";
    if (
      !structured &&
      (!s.evidence?.lapsComplete ||
        s.evidence.laps.some(
          (l) => l.intensity === "active" || l.intensity === "interval",
        ))
    )
      return [];
    if (
      !positive(s.distanceMeters) ||
      !positive(s.timerSeconds) ||
      !positive(s.paceSecondsPerKm)
    )
      return [];
    const work = structured ? analysis.work : [];
    const distance = structured
      ? work.reduce((n, l) => n + l.distanceMeters, 0)
      : s.distanceMeters;
    const duration = structured
      ? work.reduce((n, l) => n + l.timerSeconds, 0)
      : s.timerSeconds;
    if (!positive(distance) || !positive(duration)) return [];
    const hr = structured
      ? work.every((l) => validHeartRate(l.averageHeartRate))
        ? work.reduce((n, l) => n + l.averageHeartRate! * l.timerSeconds, 0) /
          duration
        : null
      : validHeartRate(s.averageHeartRate)
        ? s.averageHeartRate
        : null;
    const feedback = (context.workoutFeedback ?? []).filter(
      (f) => f.date === s.trainingDate && f.outcome === "completed",
    );
    const assessment =
      sessions.filter((x) => x.trainingDate === s.trainingDate).length === 1 &&
      feedback.length === 1
        ? feedback[0].assessment
        : null;
    const rpe = assessment?.rpe;
    return [
      {
        date: s.trainingDate,
        kind: structured
          ? analysis.classification
          : distance >= 12000
            ? "long"
            : "continuous",
        distanceMeters: distance,
        durationSeconds: duration,
        pace: (duration / distance) * 1000,
        averageHeartRate: hr,
        rpe: typeof rpe === "number" && rpe >= 1 && rpe <= 10 ? rpe : null,
        adverse:
          assessment?.pain === "pain" ||
          assessment?.pain === "discomfort" ||
          assessment?.fatigue === "high",
        repetitions: work.length,
        repeatMeters:
          analysis.classification === "interval"
            ? median(work.map((l) => l.distanceMeters))
            : null,
        recoveryMeters: median(analysis.recovery.map((l) => l.distanceMeters)),
        recoveryPace: median(analysis.recovery.map((l) => l.paceSecondsPerKm)),
        pausedRecovery:
          s.evidence?.warnings?.includes("paused_non_work_lap") ?? false,
      },
    ];
  });
  type Observation = (typeof observations)[number];
  const near = (a: number | null, b: number | null, tolerance: number) =>
    a !== null && b !== null && Math.abs(a - b) <= Math.min(a, b) * tolerance;
  const comparable = (a: Observation, b: Observation) =>
    a.kind === b.kind &&
    near(a.distanceMeters, b.distanceMeters, 0.1) &&
    (a.kind !== "interval" ||
      (a.repetitions === b.repetitions &&
        near(a.repeatMeters, b.repeatMeters, 0.05) &&
        near(a.recoveryMeters, b.recoveryMeters, 0.05) &&
        near(a.recoveryPace, b.recoveryPace, 0.1) &&
        !a.pausedRecovery &&
        !b.pausedRecovery));
  // One envelope per prescription kind/repeat length. Do not fall back to an
  // older successful structure after the runner changes the latest structure.
  const considered = new Set<string>();
  const trends = [...observations].reverse().flatMap((latest) => {
    const family = `${latest.kind}:${latest.repeatMeters === null ? "continuous" : Math.round(latest.repeatMeters / 50) * 50}`;
    if (considered.has(family) || age(latest.date, through) > 14) return [];
    considered.add(family);
    const group = observations.filter((o) => comparable(o, latest));
    const dates = new Set<string>();
    const selected = [...group]
      .reverse()
      .filter((o) => {
        if (dates.has(o.date)) return false;
        dates.add(o.date);
        return true;
      })
      .slice(0, 4)
      .reverse();
    if (selected.length < 4) return [];
    const older = selected.slice(0, 2),
      recent = selected.slice(2);
    const summary = (items: Observation[]) => ({
      pace: median(items.map((o) => o.pace))!,
      averageHeartRate: items.every((o) => o.averageHeartRate !== null)
        ? median(items.map((o) => o.averageHeartRate!))
        : null,
      rpe: items.every((o) => o.rpe !== null)
        ? median(items.map((o) => o.rpe!))
        : null,
    });
    const before = summary(older),
      after = summary(recent);
    const paceChangePercent = (after.pace / before.pace - 1) * 100;
    const hrChange =
      before.averageHeartRate !== null && after.averageHeartRate !== null
        ? after.averageHeartRate - before.averageHeartRate
        : null;
    const rpeChange =
      before.rpe !== null && after.rpe !== null ? after.rpe - before.rpe : null;
    const adverse = recent.some(
      (o) => o.adverse || (o.rpe !== null && o.rpe >= 9),
    );
    // Repeatable faster work at comparable reported effort AND HR; unknown conditions
    // still limit this to a small optional pace change, never a physiological claim.
    const improved =
      recent.every(
        (o) =>
          o.distanceMeters >=
          median(older.map((x) => x.distanceMeters))! * 0.98,
      ) &&
      paceChangePercent <= -2 &&
      paceChangePercent >= -8 &&
      hrChange !== null &&
      hrChange <= 2 &&
      rpeChange !== null &&
      rpeChange <= 0 &&
      recent.every(
        (o) =>
          o.pace <= before.pace * 0.98 &&
          o.averageHeartRate! <= before.averageHeartRate! + 2 &&
          o.rpe! <= before.rpe!,
      );
    const strain =
      adverse ||
      (hrChange !== null &&
        hrChange >= 5 &&
        rpeChange !== null &&
        rpeChange >= 1 &&
        paceChangePercent >= -1);
    const direction = strain
      ? ("hold" as const)
      : improved
        ? ("supported_progress" as const)
        : ("maintain" as const);
    return [
      {
        kind: latest.kind,
        repeatMeters:
          latest.repeatMeters === null
            ? null
            : Math.round(latest.repeatMeters / 50) * 50,
        dates: selected.map((o) => o.date),
        before,
        after,
        paceChangePercent,
        heartRateChange: hrChange,
        rpeChange,
        direction,
        referencePace: after.pace,
        recoveryMeters: latest.recoveryMeters,
        recoveryPace: latest.recoveryPace,
        reason: strain
          ? "higher_reported_or_measured_effort"
          : improved
            ? "repeated_faster_work_at_comparable_effort"
            : "no_supported_progression",
        explanation: strain
          ? "비슷한 구성에서 부담 신호가 있어 강도 증가는 보류해요. 피로나 부상으로 단정하지 않아요."
          : improved
            ? "비슷한 구성에서 심박·체감 강도를 높이지 않고 빨라진 기록이 반복됐어요. 거리와 반복을 함께 늘리지 않고 페이스만 소폭 검토해요."
            : "비교 기록은 있지만 향상을 확정할 근거가 충분하지 않아 최근 수행 수준을 참고해요.",
      },
    ];
  });
  const recentWeeklyEffort = (context.weeklyFeedback ?? []).some(
    (f) =>
      age(f.startsOn, through) >= 0 &&
      age(f.startsOn, through) <= 13 &&
      f.rpe !== null &&
      f.rpe >= 9,
  );
  return {
    version: 1,
    through,
    observations,
    trends,
    holdProgression:
      recentWeeklyEffort ||
      observations.some(
        (o) =>
          age(o.date, through) <= 7 &&
          (o.adverse || (o.rpe !== null && o.rpe >= 9)),
      ) ||
      trends.some((t) => t.direction === "hold"),
    limitations: [
      "route_weather_and_sensor_quality_not_controlled",
      "continuous_running_does_not_identify_easy_or_recovery_intent",
      "weekly_rpe_is_not_session_rpe",
      "no_threshold_or_race_prediction",
    ],
  };
}
