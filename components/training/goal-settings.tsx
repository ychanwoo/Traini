"use client";
import { useEffect, useRef, useState } from "react";
import { ChatGPTConnectionCard } from "@/components/chatgpt/chatgpt-connection-card";
import { Info } from "lucide-react";
import {
  GoalValidationError,
  parseTimeText,
  timeText,
  focusRace,
  type RaceGoal,
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
import { PrescriptionCard } from "./prescription-card";
import { RaceGoalsEditor } from "./race-goals-editor";
import styles from "./training.module.css";
type SavedGoal = {
  goal: TrainingGoal;
  issues: GoalIssue[];
  today: string;
  timezone: string;
  revision: string;
};
const weekdays = ["월", "화", "수", "목", "금", "토", "일"];
export function GoalSettings({ onboarding = false }: { onboarding?: boolean }) {
  const [loaded, setLoaded] = useState<SavedGoal | null>(null);
  const [goal, setGoal] = useState<TrainingGoal | null>(null);
  const [raceTimes, setRaceTimes] = useState<Record<string, string>>({});
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
        setRaceTimes(
          Object.fromEntries(
            (data.goal.races ?? []).map((r) => [
              r.id,
              timeText(r.targetTimeSeconds),
            ]),
          ),
        );
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
        {
          ...goal,
          races: (goal.races ?? []).map((r) => ({
            ...r,
            targetTimeSeconds: parseTimeText(
              raceTimes[r.id] ?? timeText(r.targetTimeSeconds),
            ),
          })),
        },
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
      const result = await trainingRequest<{
        goal: TrainingGoal;
        revision: string;
      }>("goal", controller.signal, {
        ...input,
        expectedRevision: loaded.revision,
      });
      if (controller.signal.aborted) return;
      setGoal(result.goal);
      setRaceTimes(
        Object.fromEntries(
          (result.goal.races ?? []).map((r) => [
            r.id,
            timeText(r.targetTimeSeconds),
          ]),
        ),
      );
      setLoaded({ ...loaded, goal: result.goal, revision: result.revision });
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
          <RaceGoalsEditor
            races={goal?.races ?? []}
            times={raceTimes}
            today={loaded?.today ?? ""}
            onChange={(races: RaceGoal[]) => {
              const focus = focusRace(races, loaded!.today);
              setGoal((previous) =>
                previous
                  ? {
                      ...previous,
                      races,
                      raceName: focus?.name ?? null,
                      targetDistance: focus?.distance ?? null,
                      targetDate: focus?.date ?? null,
                      targetTimeSeconds: focus?.targetTimeSeconds ?? null,
                    }
                  : previous,
              );
              setSaved(false);
              setMessage(null);
              setIssues([]);
            }}
            onTime={(id, value) => {
              setRaceTimes((old) => ({ ...old, [id]: value }));
              setSaved(false);
              setMessage(null);
              setIssues([]);
            }}
          />
          <label className={`settings-field ${styles.select}`}>
            최근 컨디션 (직접 입력)
            <select
              aria-label="최근 컨디션"
              value={goal?.condition?.feeling ?? ""}
              onChange={(e) =>
                edit(
                  "condition",
                  e.target.value
                    ? {
                        reportedOn: loaded!.today,
                        feeling: e.target.value as
                          "good" | "normal" | "tired" | "unwell" | "pain",
                      }
                    : null,
                )
              }
            >
              <option value="">미입력 · 상태를 추정하지 않음</option>
              <option value="good">좋음</option>
              <option value="normal">보통</option>
              <option value="tired">피로함</option>
              <option value="unwell">몸 상태가 좋지 않음</option>
              <option value="pain">통증 있음</option>
            </select>
            <small className={styles.help}>
              {goal?.condition ? `${goal.condition.reportedOn} 입력 · ` : ""}
              최근 3일 이내 피로 입력을 반영해요. 좋은 컨디션만으로 훈련량을
              늘리지 않아요. 통증·몸 상태 이상 입력은 직접 변경할 때까지 러닝
              배치를 보류해요.
            </small>
          </label>
          {goal?.condition && goal.condition.reportedOn !== loaded?.today && (
            <button
              type="button"
              className={styles.planAction}
              onClick={() =>
                edit("condition", {
                  ...goal.condition!,
                  reportedOn: loaded!.today,
                })
              }
            >
              같은 컨디션으로 오늘 다시 기록
            </button>
          )}
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
            선호 장거리 훈련 요일
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
              여러 대회의 준비·대회일·회복 구간과 실제 러닝 기록을 함께
              반영해요. 목표 기록 달성을 보장하거나 미입력 컨디션을 추정하지
              않아요.
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
      {!onboarding && <ChatGPTConnectionCard />}
      <PrescriptionCard />
      <TrainingContextCard settings />
    </div>
  );
}
