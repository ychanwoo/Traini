"use client";
import Link from "next/link";
import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Footprints,
  Moon,
  TrendingUp,
  Route,
} from "lucide-react";
import { addCalendarDays } from "@/lib/garmin/running-summary";
import type { WorkoutStep, PlanWeek } from "@/lib/training/weekly-plan";
import { isoWeekday } from "@/lib/training/weekly-plan";
import { useWeeklyPlan } from "./use-weekly-plan";
import { TrainingCompleteButton } from "./training-complete-button";
import { planErrorMessage } from "@/lib/training/plan-errors";
import styles from "./training.module.css";
const days = ["월", "화", "수", "목", "금", "토", "일"];
export function formatPlanPace(seconds: number | null) {
  return seconds === null
    ? "강도 기준"
    : `${Math.floor(seconds / 60)}′${String(seconds % 60).padStart(2, "0")}″/km`;
}
function SessionSteps({ steps }: { steps: WorkoutStep[] }) {
  if (!steps?.length) return null;
  return (
    <details className={styles.sessionSteps}>
      <summary>훈련 구성</summary>
      <ol>
        {steps.map((s, i) => (
          <li key={i}>
            {
              {
                warmup: "워밍업",
                steady: "지속주",
                repeats: "인터벌",
                cooldown: "쿨다운",
              }[s.kind]
            }{" "}
            ·{" "}
            {s.distanceMeters >= 1000
              ? `${s.distanceMeters / 1000}km`
              : `${s.distanceMeters}m`}
            {s.repetitions > 1 ? ` × ${s.repetitions}회` : ""} ·{" "}
            {formatPlanPace(s.paceSecondsPerKm)}
            {s.kind === "repeats" && s.paceSecondsPerKm !== null
              ? ` (${Math.floor(Math.round((s.paceSecondsPerKm * s.distanceMeters) / 1000) / 60)}분 ${String(Math.round((s.paceSecondsPerKm * s.distanceMeters) / 1000) % 60).padStart(2, "0")}초/회)`
              : ""}
            {s.kind === "repeats"
              ? ` / 회복 ${s.recoveryMeters ? `${s.recoveryMeters}m` : `${s.recoverySeconds}초`}${s.recoveryAfterLast ? " (마지막 반복 후 포함)" : ""}`
              : ""}
          </li>
        ))}
      </ol>
    </details>
  );
}
function PlanFeedback({ state }: { state: ReturnType<typeof useWeeklyPlan> }) {
  const { data, error, busy, loading } = state;
  return (
    <div className={styles.planFeedback} aria-live="polite">
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p className={styles.note}>저장된 훈련계획을 확인하고 있어요.</p>
      )}
      {!loading && !data && (
        <button
          className={styles.planAction}
          onClick={() => void state.refresh()}
        >
          다시 확인
        </button>
      )}
      {data && (!data.plan || data.inputsChanged) && (
        <>
          <p className={styles.note}>
            {busy || data.generating
              ? "ChatGPT가 목표와 러닝 기록으로 계획을 만들고 있어요. 화면을 다시 열어도 결과를 확인할 수 있어요."
              : "목표와 최근 러닝 기록으로 이 주의 훈련계획을 만들어요."}
          </p>
          {!error && !busy && !data.generating && data.generationError && (
            <p className={styles.error}>
              {planErrorMessage(data.generationError)}
            </p>
          )}
          <button
            type="button"
            className={styles.planAction}
            disabled={busy || data.generating}
            onClick={() => void state.generate()}
          >
            {busy || data.generating
              ? "계획 생성 중…"
              : data.plan
                ? "최신 기록으로 계획 업데이트"
                : "주간 훈련계획 생성"}
          </button>
          <Link className={styles.link} href="/my/goals">
            목표·훈련 요일 및 ChatGPT 연결 확인
          </Link>
        </>
      )}
      {data?.inputsChanged && (
        <p className={styles.note}>
          목표나 러닝 기록이 바뀌었어요. 최신 데이터로 계획을 업데이트할 수
          있으며, 완료한 훈련은 유지돼요.
        </p>
      )}
    </div>
  );
}
export function TodayPlan({
  weather,
}: {
  weather: (pace: number | null) => React.ReactNode;
}) {
  const state = useWeeklyPlan("current");
  const today = state.data?.period.today;
  const workout = state.data?.plan?.workouts.find((w) => w.date === today);
  return (
    <>
      <section className="card mt-4 p-6">
        <p className="eyebrow">TODAY’S SESSION</p>
        <h2 className="mt-2 text-xl font-semibold">
          {workout?.title ??
            (state.loading ? "훈련 확인 중" : "오늘의 계획이 없어요")}
        </h2>
        <PlanFeedback state={state} />
        {workout && (
          <>
            <div className="mt-7 grid grid-cols-2 items-end gap-3">
              <div>
                <p className="eyebrow">DISTANCE</p>
                <p className="mono mt-1 text-4xl font-semibold">
                  {workout.distanceKm.toFixed(1)}
                  <span className="ml-2 font-sans text-sm font-medium">km</span>
                </p>
              </div>
              <div>
                <p className={styles.note}>
                  {formatPlanPace(workout.paceSecondsPerKm)}
                </p>
                <p className={styles.note}>
                  {workout.effort === "rest"
                    ? "휴식"
                    : workout.effort === "controlled"
                      ? "통제 가능한 강도"
                      : "대화 가능한 강도"}
                </p>
              </div>
            </div>
            <p className={styles.note}>{workout.purpose}</p>
            <SessionSteps steps={workout.steps} />
            {workout.kind !== "rest" && weather(workout.paceSecondsPerKm)}
            {workout.kind !== "rest" && (
              <TrainingCompleteButton
                completed={workout.completed}
                pending={
                  state.completing || state.busy || state.data?.generating
                }
                onComplete={() => void state.complete(workout.id)}
              />
            )}
            {workout.completed && (
              <p className={styles.note}>
                직접 완료로 표시했어요. Garmin 활동과의 자동 연결은 아직
                적용되지 않았어요.
              </p>
            )}
          </>
        )}
        {state.data?.plan && (
          <details className={styles.details}>
            <summary>이번 주 계획 근거</summary>
            <p>{state.data.plan.summary}</p>
          </details>
        )}
      </section>
    </>
  );
}
function ScheduleWeek({
  week,
  setWeek,
}: {
  week: PlanWeek;
  setWeek: (v: PlanWeek) => void;
}) {
  const state = useWeeklyPlan(week),
    data = state.data,
    plan = data?.plan;
  const completed =
    plan?.workouts
      .filter((w) => w.completed)
      .reduce((sum, w) => sum + w.distanceKm, 0) ?? 0;
  const ratio = plan?.targetDistanceKm
    ? Math.min(100, (completed / plan.targetDistanceKm) * 100)
    : 0;
  return (
    <main className="schedule-page">
      <header className="schedule-week">
        <button
          aria-label="이번 주 보기"
          disabled={week === "current"}
          onClick={() => setWeek("current")}
        >
          <ChevronLeft />
        </button>
        <p>
          {data
            ? `${data.period.start.slice(5).replace("-", ".")} – ${data.period.end.slice(5).replace("-", ".")}`
            : week === "current"
              ? "이번 주"
              : "다음 주"}
        </p>
        <button
          aria-label="다음 주 보기"
          disabled={week === "next"}
          onClick={() => setWeek("next")}
        >
          <ChevronRight />
        </button>
      </header>
      <section className="schedule-progress">
        <div>
          <p className="eyebrow">WEEKLY PLAN</p>
          <span className="mono">
            {completed.toFixed(1)}{" "}
            <i>/ {plan?.targetDistanceKm.toFixed(1) ?? "—"} km</i>
          </span>
        </div>
        <div className="schedule-progress-line">
          <b style={{ width: `${ratio}%` }} />
        </div>
        <p>
          {plan
            ? "직접 완료한 계획 거리예요. 실제 러닝 거리는 주간 요약에서 확인해 주세요."
            : "아직 저장된 계획이 없어요."}
        </p>
      </section>
      <PlanFeedback state={state} />
      {data && (
        <section className="schedule-list" aria-label="주간 훈련 일정">
          {Array.from({ length: 7 }, (_, i) => {
            const date = addCalendarDays(data.period.start, i),
              w = plan?.workouts.find((w) => w.date === date),
              today = date === data.period.today;
            const Glyph =
              w?.kind === "rest"
                ? Moon
                : w?.kind === "long"
                  ? Route
                  : w?.kind === "threshold" || w?.kind === "interval"
                    ? TrendingUp
                    : Footprints;
            return (
              <article
                key={date}
                className={`schedule-row ${today ? "today" : ""}`}
              >
                <div className="schedule-date">
                  <small>{days[isoWeekday(date) - 1]}</small>
                  <b>{date.slice(-2)}</b>
                </div>
                <div className="schedule-copy">
                  <p>
                    {w
                      ? w.title
                      : date < data.period.today
                        ? "이전 날짜 · 계획 없음"
                        : "계획 없음"}
                  </p>
                  <small
                    className={w?.completed ? "complete" : today ? "focus" : ""}
                  >
                    {w
                      ? w.completed
                        ? "완료 · 직접 표시"
                        : w.kind === "rest"
                          ? w.purpose
                          : `${w.distanceKm.toFixed(1)} km · ${formatPlanPace(w.paceSecondsPerKm)}`
                      : "—"}
                  </small>
                  {w && <SessionSteps steps={w.steps} />}
                </div>
                <span className="schedule-icon">
                  <Glyph aria-hidden="true" />
                </span>
              </article>
            );
          })}
        </section>
      )}
      {plan && (
        <section className={styles.card}>
          <div className={styles.heading}>
            <h2>이번 주 훈련 방향</h2>
          </div>
          <p className={styles.note}>{plan.summary}</p>
          <p className={styles.help}>ChatGPT · {plan.model}</p>
        </section>
      )}
    </main>
  );
}
export function WeeklySchedule() {
  const [week, setWeek] = useState<PlanWeek>("current");
  return <ScheduleWeek key={week} week={week} setWeek={setWeek} />;
}
