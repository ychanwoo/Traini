/** Goal contract. ISO weekdays are Monday=1 through Sunday=7. No default goals. */
export const DISTANCES = {
  "5K": 5000,
  "10K": 10000,
  HALF: 21097.5,
  FULL: 42195,
} as const;
export type Distance = keyof typeof DISTANCES;
export type RaceGoal = {
  id: string;
  name: string;
  distance: Distance;
  date: string;
  targetTimeSeconds: number | null;
  priority: "primary" | "supporting";
};
export type TrainingCondition = {
  reportedOn: string;
  feeling: "good" | "normal" | "tired" | "unwell" | "pain";
};
export type TrainingGoal = {
  races?: RaceGoal[];
  condition?: TrainingCondition | null;
  raceName: string | null;
  targetDistance: Distance | null;
  targetDate: string | null;
  targetTimeSeconds: number | null;
  trainingDays: number[] | null;
  longRunDay: number | null;
};
export type GoalIssue = {
  field: keyof TrainingGoal;
  code: "missing" | "invalid" | "past_date" | "unavailable_day";
};
export class GoalValidationError extends Error {
  constructor(public readonly issues: GoalIssue[]) {
    super("Invalid goal");
  }
}
export const emptyGoal = (): TrainingGoal => ({
  raceName: null,
  targetDistance: null,
  targetDate: null,
  targetTimeSeconds: null,
  trainingDays: null,
  longRunDay: null,
});
export function validDate(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < "0001-01-01"
  )
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function calendarDistance(start: string, end: string) {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
      86400000,
  );
}
export function inspectGoal(
  raw: Record<string, unknown>,
  today: string,
): { goal: TrainingGoal; issues: GoalIssue[] } {
  const goal = emptyGoal();
  const issues: GoalIssue[] = [];
  const invalid = (field: keyof TrainingGoal) =>
    issues.push({ field, code: "invalid" });
  if (raw.raceName != null) {
    if (typeof raw.raceName !== "string" || raw.raceName.trim().length > 120)
      invalid("raceName");
    else goal.raceName = raw.raceName.trim() || null;
  }
  if (raw.targetDistance != null) {
    if (
      typeof raw.targetDistance !== "string" ||
      !Object.hasOwn(DISTANCES, raw.targetDistance)
    )
      invalid("targetDistance");
    else goal.targetDistance = raw.targetDistance as Distance;
  }
  if (raw.targetDate != null) {
    if (!validDate(raw.targetDate)) invalid("targetDate");
    else {
      goal.targetDate = raw.targetDate;
      if (raw.targetDate <= today)
        issues.push({ field: "targetDate", code: "past_date" });
    }
  }
  if (raw.targetTimeSeconds != null) {
    if (
      typeof raw.targetTimeSeconds !== "number" ||
      !Number.isSafeInteger(raw.targetTimeSeconds) ||
      raw.targetTimeSeconds <= 0 ||
      raw.targetTimeSeconds > 359999
    )
      invalid("targetTimeSeconds");
    else goal.targetTimeSeconds = raw.targetTimeSeconds;
  }
  if (raw.trainingDays != null) {
    if (
      !Array.isArray(raw.trainingDays) ||
      raw.trainingDays.length > 7 ||
      raw.trainingDays.some(
        (day) => !Number.isInteger(day) || day < 1 || day > 7,
      ) ||
      new Set(raw.trainingDays).size !== raw.trainingDays.length
    )
      invalid("trainingDays");
    else
      goal.trainingDays = raw.trainingDays.length
        ? [...raw.trainingDays].sort((a, b) => a - b)
        : null;
  }
  if (raw.longRunDay != null) {
    if (
      typeof raw.longRunDay !== "number" ||
      !Number.isInteger(raw.longRunDay) ||
      raw.longRunDay < 1 ||
      raw.longRunDay > 7
    )
      invalid("longRunDay");
    else {
      goal.longRunDay = raw.longRunDay;
      if (!goal.trainingDays?.includes(raw.longRunDay))
        issues.push({ field: "longRunDay", code: "unavailable_day" });
    }
  }
  return { goal, issues };
}
export function validateGoalInput(value: unknown, today: string): TrainingGoal {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new GoalValidationError([
      { field: "targetDistance", code: "invalid" },
    ]);
  const raw = value as Record<string, unknown>;
  const keys = Object.keys(emptyGoal());
  const extended =
    Object.hasOwn(raw, "races") || Object.hasOwn(raw, "condition");
  if (extended) keys.push("races", "condition");
  if (
    keys.some((key) => raw[key] === undefined) ||
    Object.keys(raw).length !== keys.length ||
    Object.keys(raw).some((key) => !keys.includes(key))
  ) {
    throw new GoalValidationError([
      { field: "targetDistance", code: "invalid" },
    ]);
  }
  const { goal, issues } = inspectGoal(raw, today);
  const blocking = extended
    ? issues.filter((i) => ["trainingDays", "longRunDay"].includes(i.field))
    : issues;
  if (blocking.length) throw new GoalValidationError(blocking);
  if (extended) {
    goal.races = validateRaces(raw.races, today);
    goal.condition = validateCondition(raw.condition, today);
    const focus = focusRace(goal.races, today);
    if (focus)
      Object.assign(goal, {
        raceName: focus.name || null,
        targetDistance: focus.distance,
        targetDate: focus.date,
        targetTimeSeconds: focus.targetTimeSeconds,
      });
    else
      Object.assign(goal, {
        raceName: null,
        targetDistance: null,
        targetDate: null,
        targetTimeSeconds: null,
      });
  }
  return goal;
}
export function goalFromProfile(
  profile: Record<string, unknown>,
  today: string,
) {
  const inspected = inspectGoal(
    {
      raceName: profile.race_name,
      targetDistance: profile.target_distance,
      targetDate: profile.target_date,
      targetTimeSeconds: profile.target_time_seconds,
      trainingDays: profile.training_days,
      longRunDay: profile.long_run_day,
    },
    today,
  );
  if (Object.hasOwn(profile, "race_goals")) {
    const races = validateRaces(profile.race_goals, today, true);
    const legacy = inspected.goal;
    const seeded = races.length
      ? races
      : legacy.targetDistance && legacy.targetDate
        ? [
            {
              id: "00000000-0000-4000-8000-000000000001",
              name: legacy.raceName ?? "",
              distance: legacy.targetDistance,
              date: legacy.targetDate,
              targetTimeSeconds: legacy.targetTimeSeconds,
              priority: "primary" as const,
            },
          ]
        : [];
    const focus = focusRace(seeded, today);
    inspected.goal.races = seeded;
    inspected.goal.condition = profile.training_condition
      ? validateCondition(profile.training_condition, "9999-12-31")
      : null;
    if (focus) {
      Object.assign(inspected.goal, {
        raceName: focus.name || null,
        targetDistance: focus.distance,
        targetDate: focus.date,
        targetTimeSeconds: focus.targetTimeSeconds,
      });
      inspected.issues = inspected.issues.filter(
        (i) =>
          ![
            "raceName",
            "targetDistance",
            "targetDate",
            "targetTimeSeconds",
          ].includes(i.field),
      );
    }
  }
  return inspected;
}
export function goalIssues(
  goal: TrainingGoal,
  existing: GoalIssue[],
): GoalIssue[] {
  const issues = [...existing];
  for (const field of [
    "targetDistance",
    "targetDate",
    "trainingDays",
    "longRunDay",
  ] as const) {
    if (goal[field] === null && !issues.some((issue) => issue.field === field))
      issues.push({ field, code: "missing" });
  }
  return issues;
}
export function timeText(seconds: number | null): string {
  if (seconds === null) return "";
  return [
    Math.floor(seconds / 3600),
    Math.floor((seconds % 3600) / 60),
    seconds % 60,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
export function formatTimeInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 6);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)]
    .filter(Boolean)
    .join(":");
}
export function parseTimeText(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^\d{2}:[0-5]\d:[0-5]\d$/.test(value))
    throw new GoalValidationError([
      { field: "targetTimeSeconds", code: "invalid" },
    ]);
  const [h, m, s] = value.split(":").map(Number);
  const seconds = h * 3600 + m * 60 + s;
  if (!seconds)
    throw new GoalValidationError([
      { field: "targetTimeSeconds", code: "invalid" },
    ]);
  return seconds;
}

export function validateRaces(
  value: unknown,
  today: string,
  allowPast = false,
): RaceGoal[] {
  const invalid = (): never => {
    throw new GoalValidationError([{ field: "races", code: "invalid" }]);
  };
  if (!Array.isArray(value) || value.length > 8) return invalid();
  const ids = new Set<string>(),
    dates = new Set<string>();
  const races: RaceGoal[] = value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
    const r = raw as RaceGoal;
    if (
      Object.keys(raw).sort().join(",") !==
        "date,distance,id,name,priority,targetTimeSeconds" ||
      typeof r.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        r.id,
      ) ||
      ids.has(r.id) ||
      typeof r.name !== "string" ||
      r.name.length > 120 ||
      /[\u0000-\u001f]/.test(r.name) ||
      !Object.hasOwn(DISTANCES, r.distance) ||
      !validDate(r.date) ||
      dates.has(r.date) ||
      !["primary", "supporting"].includes(r.priority) ||
      (r.targetTimeSeconds !== null &&
        (!Number.isSafeInteger(r.targetTimeSeconds) ||
          r.targetTimeSeconds <= 0 ||
          r.targetTimeSeconds > 359999))
    )
      return invalid();
    // Historical races remain editable for recovery/calendar context; new past races are rejected by the save RPC.
    if (!allowPast && r.date > addYears(today, 5)) return invalid();
    ids.add(r.id);
    dates.add(r.date);
    return { ...r, name: r.name.trim() };
  });
  if (
    races.length &&
    races.filter((r) => r.priority === "primary").length !== 1
  )
    return invalid();
  return races.sort((a, b) => a.date.localeCompare(b.date));
}
function addYears(date: string, years: number) {
  return `${Number(date.slice(0, 4)) + years}${date.slice(4)}`;
}
export function focusRace(races: RaceGoal[], today: string): RaceGoal | null {
  const upcoming = races
    .filter((r) => r.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  return upcoming.find((r) => r.priority === "primary") ?? upcoming[0] ?? null;
}
export function validateCondition(
  value: unknown,
  today: string,
): TrainingCondition | null {
  if (value === null) return null;
  const c = value as TrainingCondition;
  if (
    !c ||
    typeof c !== "object" ||
    Array.isArray(c) ||
    Object.keys(c).sort().join(",") !== "feeling,reportedOn" ||
    !validDate(c.reportedOn) ||
    c.reportedOn > today ||
    !["good", "normal", "tired", "unwell", "pain"].includes(c.feeling)
  )
    throw new GoalValidationError([{ field: "condition", code: "invalid" }]);
  return { ...c };
}

/** Shared, bounded planning rules. These are not recovery diagnoses. */
export type RaceEvidence = {
  asOfDate: string;
  condition?: TrainingCondition | null;
  weeks: {
    start: string;
    end: string;
    distanceMeters: number | null;
    activityCount: number;
    coverage: { distanceCount: number };
  }[];
  sessions: {
    trainingDate: string;
    distanceMeters: number | null;
    timerSeconds: number | null;
    paceSecondsPerKm: number | null;
  }[];
};
export function raceEvidence(
  context: {
    asOfDate: string;
    goal: { condition?: TrainingCondition | null };
    history: {
      weeks: RaceEvidence["weeks"];
      sessions: RaceEvidence["sessions"];
    };
  },
  current?: { activities: RaceEvidence["sessions"] } | null,
): RaceEvidence {
  return {
    asOfDate: context.asOfDate,
    condition: context.goal.condition,
    weeks: context.history.weeks,
    sessions: [
      ...(context.history.sessions ?? []),
      ...(current?.activities ?? []),
    ].filter((s) => s.trainingDate <= context.asOfDate),
  };
}
const shiftRaceDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
export function raceCalendar(
  races: RaceGoal[],
  start: string,
  end: string,
  evidence?: RaceEvidence,
) {
  const today = evidence?.asOfDate ?? start;
  const complete = (evidence?.weeks ?? [])
    .filter(
      (w) =>
        w.end < today &&
        w.activityCount > 0 &&
        w.distanceMeters !== null &&
        w.distanceMeters > 0 &&
        w.coverage.distanceCount === w.activityCount,
    )
    .slice(-4);
  const median = (values: number[]) => {
    const v = [...values].sort((a, b) => a - b);
    return v.length
      ? v.length % 2
        ? v[Math.floor(v.length / 2)]
        : (v[v.length / 2 - 1] + v[v.length / 2]) / 2
      : null;
  };
  const baseline = median(complete.map((w) => w.distanceMeters! / 1000));
  const prior = median(
    complete.slice(0, -1).map((w) => w.distanceMeters! / 1000),
  );
  const latest = complete.at(-1);
  const elevated =
    complete.length >= 3 &&
    prior !== null &&
    latest !== undefined &&
    latest.distanceMeters! / 1000 > prior * 1.15;
  const condition = evidence?.condition;
  const age = condition ? calendarDistance(condition.reportedOn, today) : null;
  const tired =
    condition?.feeling === "tired" && age !== null && age >= 0 && age <= 2;
  const symptoms =
    condition &&
    age !== null &&
    age >= 0 &&
    ["pain", "unwell"].includes(condition.feeling);
  const sessions = evidence?.sessions ?? [];
  const events = [...races]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => {
      const primary = r.priority === "primary";
      const base =
        r.distance === "FULL"
          ? primary
            ? 14
            : 10
          : r.distance === "HALF"
            ? primary
              ? 10
              : 7
            : r.distance === "10K"
              ? primary
                ? 7
                : 5
              : primary
                ? 7
                : 3;
      const taperDays = Math.min(
        21,
        base +
          (r.distance === "FULL" && (baseline ?? 0) >= 65 ? 7 : 0) +
          (elevated ? (r.distance === "FULL" ? 7 : 3) : 0) +
          (tired ? 3 : 0),
      );
      const baseRecoveryDays =
        r.distance === "FULL"
          ? 14
          : r.distance === "HALF"
            ? 7
            : r.distance === "10K"
              ? 3
              : 2;
      const recoveryDays =
        baseRecoveryDays +
        (elevated ? (r.distance === "FULL" ? 3 : 1) : 0) +
        (tired ? 2 : 0);
      const restDays =
        r.distance === "FULL" ? 3 : r.distance === "HALF" ? 2 : 1;
      const recoveryEnd = shiftRaceDate(r.date, recoveryDays),
        daysUntil = calendarDistance(today, r.date);
      const beforeRace = (evidence?.weeks ?? [])
        .filter(
          (w) =>
            w.end < r.date &&
            w.activityCount > 0 &&
            w.distanceMeters !== null &&
            w.coverage.distanceCount === w.activityCount,
        )
        .slice(-4);
      const preRaceBaseline = median(
        beforeRace.map((w) => w.distanceMeters! / 1000),
      );
      const checkIn =
        !!condition &&
        ["normal", "good"].includes(condition.feeling) &&
        condition.reportedOn >= recoveryEnd &&
        condition.reportedOn <= today &&
        age !== null &&
        age >= 0 &&
        age <= 2;
      const usualPace = median(
        sessions
          .filter(
            (s) =>
              s.trainingDate < r.date &&
              s.paceSecondsPerKm !== null &&
              s.paceSecondsPerKm > 0,
          )
          .map((s) => s.paceSecondsPerKm!),
      );
      const returning = sessions.filter(
        (s) =>
          s.trainingDate > r.date &&
          s.trainingDate >= shiftRaceDate(today, -14) &&
          s.trainingDate <= today &&
          s.distanceMeters !== null &&
          s.distanceMeters > 0 &&
          s.timerSeconds !== null &&
          s.timerSeconds > 0 &&
          s.paceSecondsPerKm !== null &&
          usualPace !== null &&
          s.paceSecondsPerKm >= usualPace * 0.98 &&
          s.distanceMeters <= Math.min(12000, (baseline ?? 40) * 250),
      );
      const returnDays = new Set(returning.map((s) => s.trainingDate)).size;
      const rebuildingWeeks = complete.filter(
        (w) =>
          condition &&
          w.start > recoveryEnd &&
          preRaceBaseline !== null &&
          w.distanceMeters! / 1000 >= preRaceBaseline * 0.7 &&
          w.distanceMeters! / 1000 <= preRaceBaseline * 1.1,
      ).length;
      const recoveryState =
        daysUntil >= 0
          ? "not_started"
          : today <= recoveryEnd
            ? "scheduled_window"
            : !checkIn || returnDays < 2 || symptoms
              ? "needs_check_in"
              : rebuildingWeeks >= 2
                ? "return_recorded"
                : "gradual_return";
      const phase =
        daysUntil === 0
          ? "race_day"
          : daysUntil > 0
            ? daysUntil <= taperDays
              ? "taper"
              : "preparation"
            : "recovery";
      return {
        ...r,
        taperDays,
        recoveryDays,
        restDays,
        taperStart: shiftRaceDate(r.date, -taperDays),
        taperEnd: shiftRaceDate(r.date, -1),
        recoveryStart: shiftRaceDate(r.date, 1),
        recoveryEnd,
        daysUntil,
        phase,
        recoveryState,
        returnDays,
        checkInOn: checkIn ? condition!.reportedOn : null,
        reasons: [
          ...(elevated ? ["recent_volume_increase"] : []),
          ...(r.distance === "FULL" && (baseline ?? 0) >= 65
            ? ["higher_recorded_volume"]
            : []),
          ...(tired ? ["reported_tired"] : []),
          ...(symptoms ? ["reported_symptoms"] : []),
          ...(!complete.length ? ["load_unknown"] : []),
        ],
        affectsCurrentPlan:
          daysUntil >= 0
            ? daysUntil <= taperDays
            : -daysUntil <= 56 && recoveryState !== "return_recorded",
        participation: sessions.some(
          (s) =>
            s.trainingDate === r.date &&
            s.distanceMeters !== null &&
            s.distanceMeters >= DISTANCES[r.distance] * 0.85 &&
            s.timerSeconds !== null &&
            s.timerSeconds > 0,
        )
          ? "race_day_effort_recorded"
          : "unconfirmed",
      };
    });
  const dates = Array.from(
    { length: Math.max(0, calendarDistance(start, end) + 1) },
    (_, i) => shiftRaceDate(start, i),
  );
  const raceDates = events
    .filter((r) => r.date >= start && r.date <= end)
    .map((r) => r.date);
  const restDates = dates.filter((d) =>
    events.some((r) => {
      const after = calendarDistance(r.date, d);
      return after === 0 || (after > 0 && after <= r.restDays);
    }),
  );
  const recoveryActive = (r: (typeof events)[number], d: string) =>
    d > r.date &&
    r.date >= shiftRaceDate(today, -56) &&
    (d <= r.recoveryEnd || r.recoveryState !== "return_recorded");
  // Taper retains bounded familiar intensity; only the final two days are easy-only.
  const easyOnlyDates = dates.filter((d) =>
    events.some((r) => {
      const before = calendarDistance(d, r.date);
      return (
        (before > 0 && before <= 2) ||
        (recoveryActive(r, d) &&
          (r.recoveryState !== "gradual_return" ||
            !condition ||
            calendarDistance(condition.reportedOn, d) > 2))
      );
    }),
  );
  const noLongRunDates = dates.filter((d) =>
    events.some(
      (r) => (d >= r.taperStart && d <= r.date) || recoveryActive(r, d),
    ),
  );
  let loadFactor = 1,
    maxQualitySessions = 2,
    qualityFactor = 1;
  for (const r of events) {
    if (start <= r.date && end >= r.taperStart) {
      const days = calendarDistance(start, r.date);
      loadFactor = Math.min(
        loadFactor,
        days <= 7
          ? r.distance === "FULL"
            ? r.priority === "primary"
              ? 0.4
              : 0.5
            : r.distance === "HALF"
              ? r.priority === "primary"
                ? 0.55
                : 0.7
              : 0.75
          : 0.8,
      );
      qualityFactor = Math.min(qualityFactor, days <= 7 ? 0.4 : 0.6);
      maxQualitySessions = Math.min(maxQualitySessions, 1);
    }
    if (dates.some((d) => recoveryActive(r, d))) {
      loadFactor = Math.min(
        loadFactor,
        r.recoveryState === "gradual_return"
          ? 0.85
          : r.distance === "FULL"
            ? 0.6
            : 0.75,
      );
      qualityFactor = Math.min(
        qualityFactor,
        r.recoveryState === "gradual_return" ? 0.4 : 0,
      );
      maxQualitySessions = Math.min(
        maxQualitySessions,
        r.recoveryState === "gradual_return" ? 1 : 0,
      );
    }
  }
  const reservations = events
    .filter((r) => r.date >= start && r.date <= end)
    .map((r) => ({ date: r.date, distanceKm: DISTANCES[r.distance] / 1000 }));
  const warnings = events.flatMap((r, i) => {
    const next = events[i + 1];
    return next && calendarDistance(r.date, next.date) <= r.recoveryDays
      ? [
          `${r.name || r.distance}와 ${next.name || next.distance}의 간격이 짧아 회복과 목표 우선순위를 다시 확인해야 해요.`,
        ]
      : [];
  });
  for (const r of events)
    if (
      r.daysUntil < 0 &&
      r.affectsCurrentPlan &&
      r.recoveryState === "needs_check_in"
    )
      warnings.push(
        `${r.name || r.distance}: 날짜 경과만으로 회복 완료로 보지 않아요. 회복 확인 기간 이후의 컨디션 입력과 복귀 러닝 기록이 필요해요.`,
      );
  return {
    version: 2,
    events,
    raceDates,
    restDates,
    easyOnlyDates,
    noLongRunDates,
    loadFactor,
    maxQualitySessions,
    qualityFactor,
    reservations,
    warnings,
    load: {
      baselineWeekKm: baseline,
      elevated,
      recordedWeeks: complete.length,
    },
  };
}
