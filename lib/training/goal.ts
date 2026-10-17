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

/** Calendar envelopes, not medical recovery predictions. Race participation is user registered. */
export function raceCalendar(races: RaceGoal[], start: string, end: string) {
  const events = [...races]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({
      ...r,
      recoveryDays:
        r.distance === "FULL"
          ? 14
          : r.distance === "HALF"
            ? 7
            : r.distance === "10K"
              ? 3
              : 2,
      taperDays:
        r.priority === "primary" ? (r.distance === "FULL" ? 14 : 7) : 3,
    }));
  const dates = Array.from(
    { length: Math.max(0, calendarDistance(start, end) + 1) },
    (_, i) =>
      new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000)
        .toISOString()
        .slice(0, 10),
  );
  const raceDates = events
    .filter((r) => r.date >= start && r.date <= end)
    .map((r) => r.date);
  const restDates = dates.filter((d) =>
    events.some((r) => {
      const after = calendarDistance(r.date, d);
      return (
        after === 0 ||
        (after > 0 &&
          after <= (r.distance === "FULL" ? 3 : r.distance === "HALF" ? 2 : 1))
      );
    }),
  );
  const easyOnlyDates = dates.filter((d) =>
    events.some((r) => {
      const after = calendarDistance(r.date, d);
      return after >= -r.taperDays && after <= r.recoveryDays;
    }),
  );
  let loadFactor = 1;
  for (const r of events) {
    const before = calendarDistance(start, r.date),
      after = calendarDistance(r.date, start);
    if (
      before >= 0 &&
      before <= r.taperDays + 6 &&
      r.date <=
        new Date(Date.parse(`${end}T00:00:00Z`) + r.taperDays * 86400000)
          .toISOString()
          .slice(0, 10)
    )
      loadFactor = Math.min(
        loadFactor,
        r.priority === "primary" ? (before <= 7 ? 0.5 : 0.75) : 0.85,
      );
    if (after >= 0 && after <= r.recoveryDays)
      loadFactor = Math.min(loadFactor, r.distance === "FULL" ? 0.6 : 0.8);
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
  return {
    events,
    raceDates,
    restDates,
    easyOnlyDates,
    loadFactor,
    reservations,
    warnings,
  };
}
