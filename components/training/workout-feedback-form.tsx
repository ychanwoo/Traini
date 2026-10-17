"use client";
import { useRef, useState } from "react";
import type { StoredWorkout } from "@/lib/training/weekly-plan";
import type {
  FeedbackInput,
  WorkoutAssessment,
} from "@/lib/training/workout-feedback";
import styles from "./workout-feedback.module.css";
export function WorkoutFeedbackForm({
  workout,
  today,
  pending,
  onSave,
}: {
  workout: StoredWorkout;
  today: string;
  pending: boolean;
  onSave: (input: FeedbackInput) => Promise<boolean>;
}) {
  const report = workout.feedback;
  const initial =
    workout.status === "skipped"
      ? "skipped"
      : workout.completed
        ? "completed"
        : "unconfirmed";
  const [outcome, setOutcome] = useState<FeedbackInput["outcome"]>(initial);
  const [rpe, setRpe] = useState(report?.assessment?.rpe?.toString() ?? "");
  const [fatigue, setFatigue] = useState<
    NonNullable<WorkoutAssessment["fatigue"]> | ""
  >(report?.assessment?.fatigue ?? "");
  const [pain, setPain] = useState<NonNullable<WorkoutAssessment["pain"]> | "">(
    report?.assessment?.pain ?? "",
  );
  const [memo, setMemo] = useState(report?.assessment?.memo ?? "");
  const [reason, setReason] = useState(report?.skipReason ?? "");
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  // Retry an uncertain request with the same id. Editing the payload creates a new operation.
  const retry = useRef<{ payload: string; requestId: string } | null>(null);
  if (workout.kind === "rest" || workout.date > today) return null;
  const linked =
    workout.matching?.activities.some((a) => a.linked) ||
    workout.matching?.source === "garmin";
  const unavailable =
    !workout.matching?.revision || workout.matching?.state === "unavailable";
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || pending) return;
    const assessment: WorkoutAssessment | null =
      outcome === "unconfirmed"
        ? null
        : {
            rpe: outcome === "completed" && rpe ? Number(rpe) : null,
            fatigue: fatigue || null,
            pain: pain || null,
            memo: memo.trim() || null,
          };
    const body = {
      workoutId: workout.id,
      revision: workout.matching!.revision,
      version: report?.version ?? 0,
      outcome,
      assessment,
      skipReason: outcome === "skipped" ? reason.trim() : null,
    };
    const payload = JSON.stringify(body);
    if (retry.current?.payload !== payload)
      retry.current = { payload, requestId: crypto.randomUUID() };
    inFlight.current = true;
    setMessage("");
    try {
      const saved = await onSave({
        ...body,
        requestId: retry.current!.requestId,
      });
      setMessage(
        saved ? "저장했어요." : "저장 여부를 확인해 주세요. 입력은 유지했어요.",
      );
    } finally {
      inFlight.current = false;
    }
  }
  return (
    <details className={styles.details}>
      <summary>
        {workout.status === "skipped"
          ? "× 직접 건너뜀 · 사유 및 수정"
          : report?.reportedAt
            ? "훈련 피드백 · 기록 및 수정"
            : "훈련 결과·피드백 기록"}
      </summary>
      {report?.skipReason && (
        <p className={styles.reason}>사유 · {report.skipReason}</p>
      )}
      <p className={styles.help}>
        미입력은 미확인으로 남겨요. 건너뛴 훈련을 다음 일정에 자동으로 보충하지
        않아요.
      </p>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={pending || unavailable} className={styles.fields}>
          <legend className="sr-only">{workout.date} 훈련 결과와 컨디션</legend>
          <label>
            훈련 결과
            <select
              value={outcome}
              onChange={(e) =>
                setOutcome(e.target.value as FeedbackInput["outcome"])
              }
            >
              <option value="unconfirmed" disabled={!!linked}>
                미확인 · 직접 완료/건너뜀 해제
              </option>
              <option value="completed">
                {linked ? "완료 · Garmin 확인 유지" : "완료 · 직접 표시"}
              </option>
              <option value="skipped" disabled={!!linked}>
                직접 건너뜀
              </option>
            </select>
          </label>
          {linked && (
            <p className={styles.help}>
              결과를 바꾸려면 Garmin 기록 연결을 먼저 해제하세요. 원본 러닝
              기록은 유지돼요.
            </p>
          )}
          {outcome === "skipped" && (
            <label>
              건너뛴 사유 <span>필수</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                maxLength={120}
                rows={2}
                placeholder="예: 피로가 남아 휴식했어요"
              />
            </label>
          )}
          {outcome !== "unconfirmed" && (
            <>
              {outcome === "completed" && (
                <label>
                  체감 강도 · RPE
                  <select value={rpe} onChange={(e) => setRpe(e.target.value)}>
                    <option value="">미입력</option>
                    {Array.from({ length: 10 }, (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {i + 1}
                        {i === 0
                          ? " · 매우 가벼움"
                          : i === 9
                            ? " · 최대 노력"
                            : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className={styles.pair}>
                <label>
                  피로
                  <select
                    value={fatigue}
                    onChange={(e) =>
                      setFatigue(e.target.value as typeof fatigue)
                    }
                  >
                    <option value="">미입력</option>
                    <option value="low">낮음</option>
                    <option value="moderate">보통</option>
                    <option value="high">높음</option>
                  </select>
                </label>
                <label>
                  통증·불편감
                  <select
                    value={pain}
                    onChange={(e) => setPain(e.target.value as typeof pain)}
                  >
                    <option value="">미입력</option>
                    <option value="none">없음</option>
                    <option value="discomfort">불편감 있음</option>
                    <option value="pain">통증 있음</option>
                  </select>
                </label>
              </div>
              <label>
                메모 <span>선택 · 200자</span>
                <textarea
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  maxLength={200}
                  rows={2}
                />
              </label>
              <p className={styles.help}>
                이 훈련 날짜의 상태를 기록해요. 현재 상태가 달라졌다면 목표
                설정에서 오늘의 컨디션도 갱신해 주세요. 통증 보고를 정정하려면
                해당 피드백도 수정해 주세요.
              </p>
            </>
          )}
          {outcome !== initial && (
            <p className={styles.help}>
              저장하면 직접 표시한 결과가 변경돼요.
              {outcome === "unconfirmed"
                ? " 이 훈련의 피드백과 건너뜀 사유도 지워져요."
                : ""}
            </p>
          )}
          <button
            type="submit"
            disabled={pending || (outcome === "skipped" && !reason.trim())}
          >
            {pending ? "저장 중…" : "결과·피드백 저장"}
          </button>
        </fieldset>
      </form>
      {unavailable && (
        <p className={styles.help}>
          훈련 상태를 확인한 뒤 저장할 수 있어요. 새로고침해 주세요.
        </p>
      )}
      {report?.reportedAt && (
        <p className={styles.help}>
          최근 저장 ·{" "}
          {new Intl.DateTimeFormat("ko-KR", {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(report.reportedAt))}
        </p>
      )}
      <p role="status" className={styles.help}>
        {message}
      </p>
    </details>
  );
}
