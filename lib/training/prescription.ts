import {
  calendarDistance,
  DISTANCES,
  raceCalendar,
  raceEvidence,
} from "./goal";
import type { TrainingContext } from "./context";
import type { PlanPolicy, PlanContent } from "./weekly-plan";
import type { ReviewMetrics } from "./weekly-review";
import type { RunningSummary } from "@/lib/garmin/running-summary";
type Bound = { kind: string; minPace: number; maxDistanceKm: number };
export type PrescriptionRules = {
  version: 1;
  bounds: Bound[];
  dayLimits: {
    date: string;
    maxDistanceKm: number;
    easyOnly: boolean;
    minPace: number;
  }[];
  allowedLongRunDates: string[];
  intervals: {
    meters: number;
    observedRepetitions: number;
    maxRepetitions: number;
    observedPace: number;
    minPace: number;
    minRecoveryMeters: number;
    minRecoveryPace: number | null;
    maxRecoveryMeters: number;
  }[];
  tempoMaxWorkKm: number | null;
  tempoPaceKnown: boolean;
  noProgression: boolean;
  maxQualityRepetitions: number;
};
const median = (values: number[]) => {
  const a = [...values].sort((x, y) => x - y);
  return a.length
    ? a.length % 2
      ? a[Math.floor(a.length / 2)]
      : (a[a.length / 2 - 1] + a[a.length / 2]) / 2
    : null;
};
const positive = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;
/** Keep complete historical weeks separate from the partial current week. */
export function measuredSessions(context: TrainingContext) {
  return [...(context.history.sessions ?? []), ...(context.currentWeek?.sessions ?? [])
    .filter((s) => s.trainingDate > context.history.end)];
}

/** Classify measured structure, never whole-activity average pace or physiology. */
export function analyzeSession(session: TrainingContext["history"]["sessions"][number]) {
  const e = session.evidence;
  const unknown = { date: session.trainingDate, classification: "uncertain" as const,
    reason: "incomplete_or_ambiguous_laps", work: [] as {distanceMeters:number;timerSeconds:number;paceSecondsPerKm:number}[],
    recovery: [] as {distanceMeters:number;timerSeconds:number;paceSecondsPerKm:number}[], qualityKm: 0 };
  if (!e?.lapsComplete || !e.laps.length) return unknown;
  const reference = median(e.laps.filter(l => ["warmup", "cooldown", "rest", "recovery"].includes(l.intensity ?? "") &&
    positive(l.distanceMeters) && l.distanceMeters >= 100 && positive(l.paceSecondsPerKm)).map(l => l.paceSecondsPerKm!));
  if (reference === null) return unknown;
  const blocks: {kind:string;distanceMeters:number;timerSeconds:number;paceSecondsPerKm:number}[] = [];
  for (const lap of e.laps) {
    if (!positive(lap.distanceMeters) || !positive(lap.timerSeconds) || !positive(lap.paceSecondsPerKm) ||
      Math.abs(lap.timerSeconds / lap.distanceMeters * 1000 - lap.paceSecondsPerKm) > 1) return unknown;
    const kind = lap.intensity === "active" && lap.paceSecondsPerKm < reference * .92 ? "work"
      : ["rest", "recovery"].includes(lap.intensity ?? "") ? "recovery" : "other";
    const last = blocks.at(-1);
    if (last && last.kind === kind && kind !== "other") {
      last.distanceMeters += lap.distanceMeters;
      last.timerSeconds += lap.timerSeconds;
      last.paceSecondsPerKm = last.timerSeconds / last.distanceMeters * 1000;
    } else blocks.push({kind, distanceMeters:lap.distanceMeters,timerSeconds:lap.timerSeconds,paceSecondsPerKm:lap.timerSeconds / lap.distanceMeters * 1000});
  }
  const work = blocks.filter(b => b.kind === "work");
  const first = blocks.findIndex(b => b.kind === "work"), last = blocks.findLastIndex(b => b.kind === "work");
  const between = blocks.slice(first, last + 1);
  const recovery = between.filter(b => b.kind === "recovery");
  const classification = work.length === 1 && work[0].distanceMeters >= 1500 && work[0].timerSeconds >= 360 ? "sustained"
    : work.length >= 2 && recovery.length === work.length - 1 && between.every((b,i) => b.kind === (i % 2 ? "recovery" : "work")) ? "interval"
    : "uncertain";
  return {date:session.trainingDate, classification, reason:classification === "uncertain" ? "ambiguous_work_structure" : "measured_lap_structure",
    work, recovery, qualityKm: work.reduce((sum,b) => sum + b.distanceMeters,0) / 1000};
}

/** Evidence-derived envelopes; the model chooses session types/order inside them. */
export function refinePrescription(
  context: TrainingContext,
  original: PlanPolicy,
  execution: ReviewMetrics | null = null,
  current: RunningSummary | null = null,
) {
  const policy = {
    ...original,
    blockedDates: [...original.blockedDates],
    noLongRunDates: [...(original.noLongRunDates ?? [])],
    easyOnlyDates: [...original.easyOnlyDates],
  };
  // Current-week observations enrich the calendar without changing its dated condition.
  const calendar = raceCalendar(
    context.goal.races ?? [],
    policy.start,
    policy.end,
    raceEvidence(context, current),
  );
  policy.calendar = calendar;
  policy.easyOnlyDates = [
    ...new Set([...policy.easyOnlyDates, ...calendar.easyOnlyDates]),
  ];
  policy.noLongRunDates = calendar.noLongRunDates;
  const sessions = measuredSessions(context);
  const analyses = sessions.map(analyzeSession);
  const structured = analyses.filter(s => s.classification !== "uncertain");
  const qualityDates = new Set(analyses.filter(s => s.work.length > 0).map(s => s.date));
  const easy = sessions.filter(s => !qualityDates.has(s.trainingDate) &&
    !s.evidence?.laps.some(l => l.intensity === "active") &&
    positive(s.paceSecondsPerKm) && positive(s.distanceMeters));
  const easyPace =
    median(easy.map((s) => s.paceSecondsPerKm!)) ??
    Math.ceil(policy.minEasyPace / 0.98);
  const easyKm =
    median(
      easy
        .filter((s) => s.distanceMeters! < 12000)
        .map((s) => s.distanceMeters! / 1000),
    ) ?? Math.min(8, policy.maxRunKm);
  const longPace =
    median(
      easy
        .filter((s) => s.distanceMeters! >= 12000)
        .map((s) => s.paceSecondsPerKm!),
    ) ?? easyPace;
  const tempoPaces = structured.filter(s => s.classification === "sustained").flatMap((s) =>
    s.work
      .filter((l) => l.distanceMeters! >= 1500)
      .map((l) => l.paceSecondsPerKm!),
  );
  const tempoPace = median(tempoPaces);
  const tempoWork = structured.filter(s => s.classification === "sustained").flatMap((s) =>
    s.work
      .filter((l) => l.distanceMeters! >= 1500)
      .map((l) => l.distanceMeters! / 1000),
  );
  if (structured.length)
    policy.minHardPace = Math.max(
      120,
      Math.floor(
        Math.min(
          ...structured.flatMap((s) => s.work.map((l) => l.paceSecondsPerKm!)),
        ) * 0.98,
      ),
    );
  const intervals = [400, 800].flatMap((meters) => {
    const evidence = structured.filter(s => s.classification === "interval")
      .flatMap((s) => {
        const work = s.work.filter(
          (l) => Math.abs(l.distanceMeters! - meters) <= meters * 0.1,
        );
        return work.length >= 2 && work.length === s.work.length ? [{ ...s, work }] : [];
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    const latest = evidence.at(-1);
    if (!latest) return [];
    const observedPace = Math.round(
      median(latest.work.map((l) => l.paceSecondsPerKm!))!,
    );
    const recovery =
      median(latest.recovery.map((l) => l.distanceMeters!)) ?? meters * 0.5;
    const recoveryPace = median(
      latest.recovery.map((l) => l.paceSecondsPerKm).filter(positive),
    );
    return [
      {
        meters,
        observedRepetitions: latest.work.length,
        maxRepetitions: Math.min(20, latest.work.length + 1),
        observedPace,
        minPace: Math.max(policy.minHardPace, Math.floor(observedPace * 0.98)),
        minRecoveryPace:
          recoveryPace === null
            ? null
            : Math.max(policy.minEasyPace, Math.floor(recoveryPace * 0.95)),
        minRecoveryMeters: Math.max(
          100,
          Math.floor((recovery * 0.75) / 50) * 50,
        ),
        maxRecoveryMeters: Math.min(
          3000,
          Math.ceil((recovery * 1.5) / 50) * 50,
        ),
      },
    ];
  });
  // Remaining-week limits include already performed quality work, excluding
  // race dates whose quality slot is already reserved by planPolicy.
  const observedQuality = structured.filter(s => s.date >= policy.start && s.date <= policy.end &&
    s.date <= policy.today && !calendar.raceDates.includes(s.date));
  policy.maxHardSessions = Math.max(0, policy.maxHardSessions - observedQuality.length);
  policy.maxQualityKm = Math.max(0, Math.floor((policy.maxQualityKm -
    observedQuality.reduce((sum,s) => sum + s.qualityKm,0)) * 10 + 1e-7) / 10);
  const confirmed =
    execution?.sessions.filter((s) => s.completion === "garmin") ?? [];
  const below = confirmed.filter(
    (s) =>
      s.actualKm !== null && s.plannedKm > 0 && s.actualKm < s.plannedKm * 0.8,
  ).length;
  const executionHold = below >= 2;
  const noProgression = executionHold || policy.calendar.loadFactor < 1;
  // Race effort already consumes a slot in planPolicy; do not deduct twice.
  policy.maxHardSessions = Math.min(
    policy.maxHardSessions,
    calendar.maxQualitySessions,
  );
  if (noProgression) {
    policy.weeklyCeilingKm = Math.min(
      policy.weeklyCeilingKm,
      policy.referenceWeekKm +
        policy.calendar.reservations.reduce((sum, r) => sum + r.distanceKm, 0),
    );
    policy.maxWeekKm = Math.min(policy.maxWeekKm, policy.weeklyCeilingKm);
    policy.minWeekKm = Math.min(policy.minWeekKm, policy.maxWeekKm);
  }
  const skipped = (context.workoutFeedback ?? []).filter(
    (r) =>
      r.outcome === "skipped" &&
      r.date >= policy.start &&
      r.date >= policy.today &&
      r.date <= policy.end,
  );
  if (skipped.length) {
    policy.blockedDates = [
      ...new Set([...policy.blockedDates, ...skipped.map((r) => r.date)]),
    ];
    policy.maxWeekKm = Math.max(
      0,
      policy.maxWeekKm - skipped.reduce((n, r) => n + r.plannedDistanceKm, 0),
    );
    policy.minWeekKm = 0;
  }
  const condition = context.goal.condition;
  const age = condition
    ? calendarDistance(condition.reportedOn, policy.today)
    : null;
  const fresh = condition && age !== null && age >= 0 && age <= 2;
  const unresolved =
    condition &&
    age !== null &&
    age >= 0 &&
    ["pain", "unwell"].includes(condition.feeling);
  const dayLimits: PrescriptionRules["dayLimits"] = [];
  for (const date of policy.dates) {
    if (unresolved) {
      policy.blockedDates.push(date);
      dayLimits.push({ date, maxDistanceKm: 0, easyOnly: true, minPace: 0 });
    } else if (
      fresh &&
      condition.feeling === "tired" &&
      calendarDistance(condition.reportedOn, date) <= 2
    ) {
      policy.easyOnlyDates.push(date);
      dayLimits.push({
        date,
        maxDistanceKm: Math.min(policy.maxRunKm, Math.max(0.5, easyKm * 0.75)),
        easyOnly: true,
        minPace: Math.ceil(easyPace * 1.04),
      });
    }
  }
  const observedDemanding = [
    ...structured.map((s) => s.date),
    ...easy
      .filter(
        (s) => s.distanceMeters! >= Math.max(12000, policy.maxRunKm * 800),
      )
      .map((s) => s.trainingDate),
    ...(current?.activities
      .filter(
        (s) =>
          s.distanceMeters !== null &&
          s.distanceMeters >= Math.max(12000, policy.maxRunKm * 800),
      )
      .map((s) => s.trainingDate) ?? []),
  ];
  for (const date of policy.dates)
    if (
      observedDemanding.some((d) => d < date && calendarDistance(d, date) < 2)
    )
      policy.easyOnlyDates.push(date);
  for (const date of policy.dates) {
    if (policy.noLongRunDates.includes(date)) {
      const existing = dayLimits.find((l) => l.date === date);
      const limit = {
        date,
        maxDistanceKm: Math.min(policy.maxRunKm, Math.max(0.5, easyKm * 1.5)),
        easyOnly: policy.easyOnlyDates.includes(date),
        minPace: policy.minHardPace,
      };
      if (existing) {
        existing.maxDistanceKm = Math.min(
          existing.maxDistanceKm,
          limit.maxDistanceKm,
        );
        existing.easyOnly ||= limit.easyOnly;
      } else dayLimits.push(limit);
    }
  }
  policy.blockedDates = [...new Set(policy.blockedDates)];
  policy.easyOnlyDates = [...new Set(policy.easyOnlyDates)];
  const eligible = policy.dates.filter(
    (d) =>
      policy.trainingDays.includes(
        ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1,
      ) && !policy.blockedDates.includes(d),
  );
  const capacity = eligible.reduce(
    (sum, d) =>
      sum +
      Math.min(
        policy.maxRunKm,
        dayLimits.find((l) => l.date === d)?.maxDistanceKm ?? policy.maxRunKm,
      ),
    0,
  );
  policy.maxWeekKm = Math.max(
    0,
    Math.floor(Math.min(policy.maxWeekKm, capacity) * 10) / 10,
  );
  policy.maxRunKm = Math.min(policy.maxRunKm, policy.maxWeekKm);
  policy.minWeekKm = unresolved
    ? 0
    : Math.min(
        policy.minWeekKm,
        Math.max(0, policy.maxWeekKm - eligible.length * 0.1),
      );
  if (policy.maxWeekKm < 0.5 || policy.allowAllRest) policy.minWeekKm = 0;
  if (!eligible.some((d) => !policy.easyOnlyDates.includes(d)))
    policy.maxHardSessions = 0;
  const allowedLongRunDates = eligible.filter(
    (d) =>
      !policy.easyOnlyDates.includes(d) && !policy.noLongRunDates.includes(d),
  );
  const bounds: Bound[] = [
    {
      kind: "recovery",
      minPace: Math.max(policy.minEasyPace, Math.ceil(easyPace * 1.04)),
      maxDistanceKm: Math.min(policy.maxRunKm, Math.max(0.5, easyKm)),
    },
    {
      kind: "easy",
      minPace: Math.max(policy.minEasyPace, Math.floor(easyPace * 0.98)),
      maxDistanceKm: policy.maxRunKm,
    },
    {
      kind: "long",
      minPace: Math.max(policy.minEasyPace, Math.floor(longPace * 0.98)),
      maxDistanceKm: policy.maxRunKm,
    },
    {
      kind: "threshold",
      minPace:
        tempoPace === null
          ? policy.minHardPace
          : Math.max(policy.minHardPace, Math.floor(tempoPace * 0.98)),
      maxDistanceKm: policy.maxRunKm,
    },
    {
      kind: "interval",
      minPace: policy.minHardPace,
      maxDistanceKm: policy.maxRunKm,
    },
  ];
  const rules: PrescriptionRules = {
    version: 1,
    bounds,
    dayLimits,
    allowedLongRunDates,
    intervals: intervals.map((o) =>
      calendar.loadFactor < 1
        ? {
            ...o,
            maxRepetitions: Math.max(
              2,
              Math.min(
                8,
                o.observedRepetitions,
                Math.floor(
                  o.observedRepetitions * Math.max(0.4, calendar.qualityFactor),
                ),
              ),
            ),
            minPace: Math.max(o.minPace, o.observedPace),
          }
        : noProgression
          ? {
              ...o,
              maxRepetitions: Math.min(o.maxRepetitions, o.observedRepetitions),
              minPace: Math.max(o.minPace, o.observedPace),
            }
          : o,
    ),
    tempoPaceKnown: tempoPace !== null,
    tempoMaxWorkKm: tempoWork.length
      ? Math.max(...tempoWork) *
        (calendar.loadFactor < 1 ? calendar.qualityFactor : 1.1)
      : null,
    noProgression,
    maxQualityRepetitions: calendar.loadFactor < 1 ? 8 : 20,
  };
  return {
    policy: { ...policy, prescription: rules },
    guidance: {
      version: 1,
      source: "rules_and_recorded_evidence" as const,
      generatedAt: context.generatedAt,
      condition: condition
        ? { ...condition, fresh: !!fresh, requiresRecheck: !!unresolved }
        : null,
      confirmedSessions: confirmed.length,
      manualSessions: execution?.manualCompleted ?? 0,
      unconfirmedSessions: execution?.unconfirmed ?? null,
      noProgression,
      rules,
      raceCalendar: calendar,
      goals: (context.goal.races ?? []).map((r) => ({
        ...r,
        targetPaceSecondsPerKm:
          r.targetTimeSeconds === null
            ? null
            : Math.round((r.targetTimeSeconds / DISTANCES[r.distance]) * 1000),
      })),
      warnings: [
        ...policy.calendar.warnings,
        ...(unresolved
          ? [
              "통증·몸 상태 이상 입력이 해제되지 않았어요. 컨디션을 다시 확인하기 전에는 새 러닝을 배치하지 않아요.",
            ]
          : []),
        ...(executionHold
          ? [
              "Garmin으로 확인된 여러 세션의 수행 거리가 계획보다 짧아 부하 증가를 보류해요. 피로나 실패로 단정하지 않아요.",
            ]
          : []),
      ],
      principles: [
        "훈련 종류나 순서를 고정하지 않고 목표·대회 간격·수행 기록에 맞춰 선택해요.",
        "목표 기록은 지향점이며 현재 능력의 증거로 사용하지 않아요.",
        "미입력 컨디션과 미확인 활동은 정상·휴식·실패로 추정하지 않아요.",
      ],
    },
  };
}
export function validatePrescription(
  content: PlanContent,
  rules: PrescriptionRules,
  onInvalid?: (reason: string) => void,
): boolean {
  const invalid = (reason: string) => {
    onInvalid?.(reason);
    return false;
  };
  for (const workout of content.workouts) {
    if (workout.kind === "rest") continue;
    const bound = rules.bounds.find((b) => b.kind === workout.kind);
    if (!bound || workout.distanceKm > bound.maxDistanceKm + 1e-7) return invalid("kind_distance");
    if (
      workout.paceSecondsPerKm !== null &&
      workout.paceSecondsPerKm < bound.minPace
    )
      return invalid("kind_pace");
    const day = rules.dayLimits.find((d) => d.date === workout.date);
    if (
      day &&
      (workout.distanceKm > day.maxDistanceKm + 1e-7 ||
        (day.easyOnly && !["easy", "recovery"].includes(workout.kind)) ||
        (workout.paceSecondsPerKm !== null &&
          workout.paceSecondsPerKm < day.minPace))
    )
      return invalid("day_limit");
    if (
      workout.kind === "long" &&
      !rules.allowedLongRunDates.includes(workout.date)
    )
      return invalid("long_date");
    if (
      workout.kind === "threshold" &&
      !rules.tempoPaceKnown &&
      workout.paceSecondsPerKm !== null
    )
      return invalid("tempo_pace");
    let tempo = 0;
    for (const step of workout.steps) {
      if (
        ["steady", "repeats"].includes(step.kind) &&
        step.paceSecondsPerKm !== null &&
        step.paceSecondsPerKm < Math.max(bound.minPace, day?.minPace ?? 0)
      )
        return invalid("work_pace");
      if (
        workout.kind === "threshold" &&
        step.kind === "steady" &&
        !rules.tempoPaceKnown &&
        step.paceSecondsPerKm !== null
      )
        return invalid("tempo_pace");
      if (workout.kind === "threshold" && step.kind === "steady")
        tempo += step.distanceMeters / 1000;
      if (
        step.kind === "repeats" &&
        step.repetitions > rules.maxQualityRepetitions
      )
        return invalid("repeat_limit");
      if (
        workout.kind === "interval" &&
        step.kind === "repeats" &&
        !rules.intervals.length &&
        (step.paceSecondsPerKm !== null ||
          step.recoveryPaceSecondsPerKm != null ||
          step.repetitions > 8 ||
          step.distanceMeters < 200 ||
          step.distanceMeters > 1000 ||
          step.recoveryMeters < step.distanceMeters * 0.5 ||
          step.recoveryMeters > step.distanceMeters * 1.5)
      )
        return invalid("interval_evidence");
      if (
        workout.kind === "interval" &&
        step.kind === "repeats" &&
        rules.intervals.length
      ) {
        const option = rules.intervals.find(
          (o) => o.meters === step.distanceMeters,
        );
        if (
          !option ||
          step.repetitions > option.maxRepetitions ||
          step.recoveryMeters < option.minRecoveryMeters ||
          step.recoveryMeters > option.maxRecoveryMeters ||
          (step.paceSecondsPerKm !== null &&
            step.paceSecondsPerKm < option.minPace)
        )
          return invalid("interval_bounds");
        if (
          step.recoveryPaceSecondsPerKm != null &&
          (option.minRecoveryPace === null ||
            step.recoveryPaceSecondsPerKm < option.minRecoveryPace)
        )
          return invalid("recovery_pace");
        if (
          (rules.noProgression &&
            step.repetitions > option.observedRepetitions) ||
          (step.repetitions > option.observedRepetitions &&
            (step.paceSecondsPerKm === null ||
              step.paceSecondsPerKm < option.observedPace))
        )
          return invalid("interval_progression");
      }
    }
    if (rules.tempoMaxWorkKm !== null && tempo > rules.tempoMaxWorkKm + 1e-7)
      return invalid("tempo_distance");
  }
  return true;
}
