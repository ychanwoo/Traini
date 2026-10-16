/** Goal contract. ISO weekdays are Monday=1 through Sunday=7. No default goals. */
export const DISTANCES = {
  "5K": 5000,
  "10K": 10000,
  HALF: 21097.5,
  FULL: 42195,
} as const;
export type Distance = keyof typeof DISTANCES;
export type TrainingGoal = {
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
  if (issues.length) throw new GoalValidationError(issues);
  return goal;
}
export function goalFromProfile(
  profile: Record<string, unknown>,
  today: string,
) {
  return inspectGoal(
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
