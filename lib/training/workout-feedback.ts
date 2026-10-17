import type { TrainingCondition } from "./goal";

export type WorkoutAssessment = {
  rpe: number | null;
  fatigue: "low" | "moderate" | "high" | null;
  pain: "none" | "discomfort" | "pain" | null;
  memo: string | null;
};
export type WorkoutFeedback = {
  version: number;
  reportedAt: string | null;
  assessment: WorkoutAssessment | null;
  skipReason: string | null;
};
export type FeedbackInput = {
  workoutId: string;
  requestId: string;
  revision: string;
  version: number;
  outcome: "completed" | "skipped" | "unconfirmed";
  assessment: WorkoutAssessment | null;
  skipReason: string | null;
};
export class FeedbackError extends Error {}
const uuid = (v: unknown) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const text = (v: unknown, max: number) =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  v.length <= max &&
  !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(v);
export function validAssessment(v: unknown): v is WorkoutAssessment | null {
  return (
    v === null ||
    (object(v) &&
      exact(v, ["rpe", "fatigue", "pain", "memo"]) &&
      (v.rpe === null ||
        (Number.isInteger(v.rpe) &&
          Number(v.rpe) >= 1 &&
          Number(v.rpe) <= 10)) &&
      (v.fatigue === null ||
        (typeof v.fatigue === "string" &&
          ["low", "moderate", "high"].includes(v.fatigue))) &&
      (v.pain === null ||
        (typeof v.pain === "string" &&
          ["none", "discomfort", "pain"].includes(v.pain))) &&
      (v.memo === null || text(v.memo, 200)))
  );
}
export function parseFeedbackInput(v: unknown): FeedbackInput {
  if (
    !object(v) ||
    !exact(v, [
      "workoutId",
      "requestId",
      "revision",
      "version",
      "outcome",
      "assessment",
      "skipReason",
    ]) ||
    !uuid(v.workoutId) ||
    !uuid(v.requestId) ||
    typeof v.revision !== "string" ||
    !/^[0-9a-f]{32}$/.test(v.revision) ||
    !Number.isSafeInteger(v.version) ||
    Number(v.version) < 0 ||
    typeof v.outcome !== "string" ||
    !["completed", "skipped", "unconfirmed"].includes(v.outcome) ||
    !validAssessment(v.assessment) ||
    (v.skipReason !== null && !text(v.skipReason, 120)) ||
    (v.outcome === "skipped"
      ? v.skipReason === null || v.assessment?.rpe != null
      : v.skipReason !== null) ||
    (v.outcome === "unconfirmed" && v.assessment !== null)
  )
    throw new FeedbackError("feedback_input");
  return v as FeedbackInput;
}
export type FeedbackEvidence = WorkoutFeedback & {
  workoutId: string;
  date: string;
  outcome: string;
  plannedDistanceKm: number;
};
/** Only adverse reports tighten the existing condition gate. Missing reports never grant recovery clearance. */
export function feedbackCondition(
  condition: TrainingCondition | null | undefined,
  reports: FeedbackEvidence[],
  today: string,
): TrainingCondition | null {
  const eligible = reports
    .filter((r) => r.date <= today)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (b.reportedAt ?? "").localeCompare(a.reportedAt ?? ""),
    );
  const pain = eligible.find((r) => r.assessment?.pain != null);
  if (
    pain &&
    ["pain", "discomfort"].includes(pain.assessment!.pain!) &&
    (!condition || condition.reportedOn <= pain.date)
  )
    return { reportedOn: pain.date, feeling: "pain" };
  if (condition && ["pain", "unwell"].includes(condition.feeling))
    return condition;
  const recent = eligible.find(
    (r) => r.assessment?.fatigue != null || r.assessment?.rpe != null,
  );
  if (
    recent &&
    (!condition || condition.reportedOn <= recent.date) &&
    (recent.assessment?.fatigue === "high" ||
      (recent.assessment?.rpe ?? 0) >= 9)
  )
    return { reportedOn: recent.date, feeling: "tired" };
  return condition ?? null;
}
export const feedbackErrorMessage: Record<string, string> = {
  feedback_input: "피드백 입력 범위를 확인해 주세요.",
  feedback_changed: "훈련 상태가 변경됐어요. 새로고침한 뒤 다시 확인해 주세요.",
  feedback_linked: "Garmin 기록 연결을 먼저 해제한 뒤 상태를 변경해 주세요.",
  feedback_workout: "오늘까지의 러닝 훈련에만 기록할 수 있어요.",
  feedback_storage:
    "피드백을 저장하지 못했어요. 새로고침해 저장 여부를 확인해 주세요.",
};
