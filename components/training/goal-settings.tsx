"use client";
import { useEffect, useRef, useState } from "react";
import { Info, Route } from "lucide-react";
import { addCalendarDays } from "@/lib/garmin/running-summary";
import {
  DISTANCES,
  GoalValidationError,
  formatTimeInput,
  parseTimeText,
  timeText,
  validateGoalInput,
  type GoalIssue,
  type TrainingGoal,
} from "@/lib/training/goal";
import {
  GOAL_SAVED_EVENT,
  TrainingRequestError,
  trainingRequest,
} from "@/lib/training/client";
import { TrainingContextCard, issueLabel } from "./training-context-card";
import styles from "./training.module.css";
type SavedGoal = {
  goal: TrainingGoal;
  issues: GoalIssue[];
  today: string;
  timezone: string;
};
const weekdays = ["월", "화", "수", "목", "금", "토", "일"];
export function GoalSettings({ onboarding = false }: { onboarding?: boolean }) {
  const [loaded, setLoaded] = useState<SavedGoal | null>(null);
  const [goal, setGoal] = useState<TrainingGoal | null>(null);
  const [time, setTime] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [issues, setIssues] = useState<GoalIssue[]>([]);
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false);
  const writeController = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void trainingRequest<SavedGoal>("goal", controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setLoaded(data);
        setGoal(data.goal);
        setTime(timeText(data.goal.targetTimeSeconds));
        setIssues(data.issues);
        setMessage(null);
        setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setMessage("저장된 목표를 불러오지 못했어요. 다시 확인해 주세요.");
        }
      });
    return () => {
      controller.abort();
      writeController.current?.abort();
    };
  }, [revision]);
  function edit<K extends keyof TrainingGoal>(key: K, value: TrainingGoal[K]) {
    setGoal((previous) =>
      previous ? { ...previous, [key]: value } : previous,
    );
    setSaved(false);
    setMessage(null);
    setIssues([]);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!goal || !loaded || inFlight.current) return;
    setSaved(false);
    setMessage(null);
    let input: TrainingGoal;
    try {
      input = validateGoalInput(
        { ...goal, targetTimeSeconds: parseTimeText(time) },
        loaded.today,
      );
    } catch (error) {
      if (error instanceof GoalValidationError) setIssues(error.issues);
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setIssues([]);
    const controller = new AbortController();
    writeController.current = controller;
    try {
      const result = await trainingRequest<{ goal: TrainingGoal }>(
        "goal",
        controller.signal,
        input,
      );
      if (controller.signal.aborted) return;
      setGoal(result.goal);
      setTime(timeText(result.goal.targetTimeSeconds));
      setSaved(true);
      window.dispatchEvent(new Event(GOAL_SAVED_EVENT));
    } catch (error) {
      if (!controller.signal.aborted) {
        setMessage(
          error instanceof TrainingRequestError
            ? error.message
            : "저장 결과를 확인하지 못했어요. 입력값은 유지했으니 다시 확인해 주세요.",
        );
        if (error instanceof TrainingRequestError) setIssues(error.issues);
      }
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setSaving(false);
    }
  }
  const unavailable = loading || !goal || saving;
  return (
    <div className="page app-frame settings-page">
      <section className="settings-title">
        <p className="eyebrow">GOAL & RACE</p>
        <h1>{onboarding ? "나의 훈련 목표" : "내 목표 및 대회"}</h1>
        <p>목표 기간과 달릴 수 있는 요일을 알려주세요.</p>
      </section>
      {loading && (
        <p className={styles.note} role="status">
          저장된 목표를 확인하고 있어요.
        </p>
      )}
      {!loading && !loaded && (
        <p className={styles.error} role="alert">
          {message}{" "}
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setRevision((n) => n + 1);
            }}
          >
            다시 확인
          </button>
        </p>
      )}
      <form onSubmit={(event) => void save(event)} noValidate>
        <fieldset disabled={unavailable} className={styles.fields}>
          <label className="goal-race-card">
            <span>
              <Route aria-hidden="true" />
            </span>
            <div>
              <input
                aria-label="대회명"
                value={goal?.raceName ?? ""}
                maxLength={120}
                placeholder="대회명 (선택)"
                onChange={(e) => edit("raceName", e.target.value || null)}
              />
              <small>{goal?.targetDate ?? "목표 날짜를 설정해 주세요"}</small>
            </div>
          </label>
          <label className="settings-field">
            목표 날짜
            <input
              type="date"
              value={goal?.targetDate ?? ""}
              min={loaded ? addCalendarDays(loaded.today, 1) : undefined}
              onChange={(e) => edit("targetDate", e.target.value || null)}
            />
          </label>
          <div className="goal-segments" role="group" aria-label="목표 거리">
            {Object.keys(DISTANCES).map((distance) => (
              <button
                type="button"
                key={distance}
                aria-pressed={goal?.targetDistance === distance}
                className={goal?.targetDistance === distance ? "active" : ""}
                onClick={() =>
                  edit(
                    "targetDistance",
                    distance as TrainingGoal["targetDistance"],
                  )
                }
              >
                {distance}
              </button>
            ))}
          </div>
          <label className="settings-field">
            목표 기록 (선택)
            <input
              aria-label="목표 기록"
              className="mono"
              value={time}
              inputMode="numeric"
              placeholder="HH:MM:SS"
              maxLength={8}
              onChange={(e) => {
                setTime(formatTimeInput(e.target.value));
                setSaved(false);
                setMessage(null);
                setIssues([]);
              }}
            />
            <small className={styles.help}>
              완주가 목표라면 비워두세요. 시간:분:초로 입력해 주세요.
            </small>
          </label>
          <fieldset className={styles.availability}>
            <legend>훈련 가능 요일</legend>
            <div className={styles.days}>
              {weekdays.map((day, index) => {
                const n = index + 1;
                const checked = goal?.trainingDays?.includes(n) ?? false;
                return (
                  <button
                    type="button"
                    key={day}
                    aria-pressed={checked}
                    aria-label={`${day}요일 훈련 가능`}
                    onClick={() => {
                      const next = checked
                        ? goal!.trainingDays!.filter((d) => d !== n)
                        : [...(goal?.trainingDays ?? []), n].sort(
                            (a, b) => a - b,
                          );
                      setGoal((previous) =>
                        previous
                          ? {
                              ...previous,
                              trainingDays: next.length ? next : null,
                              longRunDay:
                                previous.longRunDay === n && checked
                                  ? null
                                  : previous.longRunDay,
                            }
                          : previous,
                      );
                      setSaved(false);
                      setMessage(null);
                      setIssues([]);
                    }}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <label className={`settings-field ${styles.select}`}>
            장거리 훈련 요일
            <select
              aria-label="장거리 훈련 요일"
              value={goal?.longRunDay ?? ""}
              onChange={(e) =>
                edit(
                  "longRunDay",
                  e.target.value ? Number(e.target.value) : null,
                )
              }
            >
              <option value="">선택해 주세요</option>
              {(goal?.trainingDays ?? []).map((day) => (
                <option key={day} value={day}>
                  {weekdays[day - 1]}요일
                </option>
              ))}
            </select>
          </label>
          <section className="goal-hint">
            <Info aria-hidden="true" />
            <p>
              입력한 목표와 실제 러닝 기록을 훈련계획의 기준으로 사용해요. 예상
              기록이나 훈련 강도는 아직 산출하지 않아요.
            </p>
          </section>
        </fieldset>
        <div aria-live="polite">
          {issues.length > 0 && (
            <ul className={styles.error} role="alert">
              {issues.map((issue) => (
                <li key={`${issue.field}-${issue.code}`}>
                  {issueLabel(issue)}
                </li>
              ))}
            </ul>
          )}
          {message && loaded && (
            <p className={styles.error} role="alert">
              {message}
            </p>
          )}
          {saved && (
            <p className={styles.note} role="status">
              목표를 저장했어요. 훈련 입력 데이터에 반영했어요.
            </p>
          )}
        </div>
        <button
          type="submit"
          className="primary-button mt-7"
          disabled={unavailable}
        >
          {saving ? "저장 중…" : "목표 저장하기"}
        </button>
      </form>
      <TrainingContextCard settings />
    </div>
  );
}
