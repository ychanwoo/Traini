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
  X,
} from "lucide-react";
import { addCalendarDays } from "@/lib/garmin/running-summary";
import type { WorkoutStep, PlanWeek } from "@/lib/training/weekly-plan";
import { isoWeekday } from "@/lib/training/weekly-plan";
import { useWeeklyPlan } from "./use-weekly-plan";
import { WorkoutMatchDetails } from "./workout-match-details";
import { WorkoutFeedbackForm } from "./workout-feedback-form";
import { TrainingCompleteButton } from "./training-complete-button";
import { TrainingWeatherCard } from "./training-weather-card";
import { PrescriptionCard } from "./prescription-card";
import { CoachingDetail } from "./coaching-detail";
import { coachingText, coachingCopy } from "@/lib/training/coaching-copy";
import { coachingSentences } from "@/lib/training/coaching-presentation";
import flow from "./today-workflow.module.css";
import styles from "./training.module.css";
const formatRaceTime = (seconds: number) =>
  `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
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
            {s.kind === "repeats" && (
              <span>
                {" "}
                · 회복{" "}
                {s.recoveryPaceSecondsPerKm != null
                  ? formatPlanPace(s.recoveryPaceSecondsPerKm)
                  : "편한 조깅·강도 기준"}
              </span>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
function PlanFeedback({
  state,
  readOnly = false,
}: {
  state: ReturnType<typeof useWeeklyPlan>;
  readOnly?: boolean;
}) {
  const { data, error, loading } = state;
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
      {data?.plan?.review && <details className={styles.details}><summary>계획에 사용한 리뷰</summary><p className={styles.note}>{data.plan.review.startsOn} {coachingCopy.appliedReview}</p></details>}
      {!readOnly && data?.inputsChanged && (
        <p className={styles.note}>
          입력이 바뀌어 계획 재검토가 필요해요. 업데이트 전에는 이전 처방을 그대로 수행하지 마세요. 완료한 훈련은 유지돼요.
        </p>
      )}
    </div>
  );
}
export function TodayPlan({ concise = false }: { concise?: boolean }) {
  const state = useWeeklyPlan("current");
  const today = state.data?.period.today;
  const workout = state.data?.plan?.workouts.find((w) => w.date === today);
  const race = state.data?.races?.find((r) => r.date === today);
  return (
    <>
      <section className="card mt-4 p-6">
        <p className="eyebrow">TODAY’S SESSION</p>
        <h2 className="mt-2 text-base font-semibold leading-6 break-keep">
          {race
            ? `대회 · ${race.name || race.distance}`
            : (workout?.title.replace(/\s+\d+(?:\.\d+)?\s*km\s*$/i, "") ??
              (state.loading
                ? "훈련 확인 중"
                : state.data
                  ? "오늘의 계획이 없어요"
                  : "훈련을 불러오지 못했어요"))}
        </h2>
        <PlanFeedback state={state} readOnly={concise} />
        <Link className={styles.link} href="/my/goals#current-condition">오늘 컨디션 확인·수정</Link>
        {race && (
          <p className={styles.note}>
            {race.distance} ·{" "}
            {race.targetTimeSeconds
              ? formatRaceTime(race.targetTimeSeconds)
              : "완주 목표"}{" "}
            · 등록된 대회 일정이에요.
          </p>
        )}
        {workout && !race && (
          <>
            <div className="mt-7 grid grid-cols-2 items-end gap-3">
              <div>
                <p className="eyebrow">DISTANCE</p>
                <p className="mono mt-1 text-3xl font-semibold">
                  {workout.distanceKm.toFixed(1)}
                  <span className="ml-2 font-sans text-sm font-medium">km</span>
                </p>
              </div>
              <div>
                <p className={styles.note}>
                  {workout.kind === "rest"
                    ? "러닝 없음"
                    : formatPlanPace(workout.paceSecondsPerKm)}
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
            {!concise && <CoachingDetail text={workout.purpose} label="훈련 목적·실행 기준 전체" />}
            {!concise && <SessionSteps steps={workout.steps} />}
            {workout.kind !== "rest" && (
              <TrainingWeatherCard
                key={workout.id}
                workout={workout}
                timezone={state.data!.period.timezone}
              />
            )}
            {workout.kind !== "rest" && workout.status !== "skipped" && (
              <TrainingCompleteButton
                completed={workout.completed}
                pending={
                  state.completing || state.busy || state.data?.generating
                }
                onComplete={() => void state.complete(workout.id)}
              />
            )}
            {!concise && <WorkoutMatchDetails
              key={`${workout.id}:${workout.matching?.revision}`}
              workout={workout}
              timezone={state.data!.period.timezone}
              pending={
                state.completing || state.busy || !!state.data?.generating
              }
              onSave={(revision, ids) =>
                void state.match(workout.id, revision, ids)
              }
            />}
            {!concise && <WorkoutFeedbackForm
              key={`${workout.id}:${workout.feedback?.version}:${workout.completed}:${workout.status}`}
              workout={workout} today={today!}
              pending={state.completing || state.busy || !!state.data?.generating}
              onSave={state.feedback}
            />}
            {workout.completed && (
              <p className={styles.note}>
                {workout.matching?.state === "unavailable"
                  ? "저장된 완료 상태예요. Garmin 연결 상태는 다시 확인해 주세요."
                  : workout.matching?.source === "garmin"
                    ? "Garmin 기록으로 완료를 확인했어요."
                    : "직접 완료로 표시했어요."}
              </p>
            )}
          </>
        )}
        {!concise && <PrescriptionCard week="current" compact />}
        {state.data?.plan && (
          <details className={styles.details}>
            <summary>이번 주 계획 근거</summary>
            {concise ? <>
              <dl className={flow.reasonMetrics}>
                <div><dt>주간 계획 거리</dt><dd>{state.data.plan.targetDistanceKm.toFixed(1)} km</dd></div>
                <div><dt>러닝 · 휴식</dt><dd>{state.data.plan.workouts.filter(w=>w.kind!=="rest").length}일 · {state.data.plan.workouts.filter(w=>w.kind==="rest").length}일</dd></div>
              </dl>
              <ul className={flow.reasonList}>{coachingSentences(coachingText(state.data.plan.summary)).map((text,i)=><li key={i}>{text}</li>)}</ul>
            </> : <p>{coachingText(state.data.plan.summary)}</p>}
          </details>
        )}
      </section>
      {!concise && <PastWorkoutFeedback />}
    </>
  );
}
function PastWorkoutFeedback() {
  const [open, setOpen] = useState(false);
  return (
    <details className={styles.details} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>지난 훈련 기록·수정</summary>
      {open && <PastWorkoutFeedbackFields />}
    </details>
  );
}
function PastWorkoutFeedbackFields() {
  const [week, setWeek] = useState<"current" | "previous">("current");
  const [selected, setSelected] = useState("");
  const state = useWeeklyPlan(week);
  const data = state.data;
  const workouts = data?.plan?.workouts.filter(w => w.date < data.period.today && w.kind !== "rest") ?? [];
  const workout = workouts.find(w => w.id === selected) ?? workouts[0];
  return (
    <section aria-label="지난 훈련 기록">
      <label className={styles.note}>기록할 주
        <select value={week} onChange={event => { setWeek(event.target.value as "current" | "previous"); setSelected(""); }}>
          <option value="current">이번 주</option><option value="previous">지난주</option>
        </select>
      </label>
      <PlanFeedback state={state} readOnly />
      {workout && data ? <>
        <label className={styles.note}>기록할 훈련
          <select value={workout.id} onChange={event => setSelected(event.target.value)}>
            {workouts.map(w => <option key={w.id} value={w.id}>{w.date.slice(5)} · {w.title}</option>)}
          </select>
        </label>
        <article>
          <p className={styles.note}>{workout.completed ? workout.matching?.source === "garmin" ? "완료 · Garmin 확인" : "완료 · 직접 표시" : workout.status === "skipped" ? "× 직접 건너뜀" : "수행 미확인"}</p>
          <WorkoutFeedbackForm key={`${workout.id}:${workout.feedback?.version}:${workout.completed}:${workout.status}`} workout={workout} today={data.period.today} pending={state.completing || state.busy || !!data.generating} onSave={state.feedback} />
          <WorkoutMatchDetails key={`${workout.id}:${workout.matching?.revision}`} workout={workout} timezone={data.period.timezone} pending={state.completing || state.busy || !!data.generating} onSave={(revision, ids) => void state.match(workout.id, revision, ids)} />
        </article>
      </> : <p className={styles.note}>{state.loading ? "지난 훈련을 확인하고 있어요." : "기록할 지난 훈련이 없어요."}</p>}
    </section>
  );
}
function ScheduleWeek({
  week,
  setWeek,
}: {
  week: PlanWeek | "previous";
  setWeek: (v: PlanWeek | "previous") => void;
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
          aria-label={week === "next" ? "이번 주 보기" : "지난주 보기"}
          disabled={week === "previous"}
          onClick={() => setWeek(week === "next" ? "current" : "previous")}
        >
          <ChevronLeft />
        </button>
        <p>
          {data
            ? `${data.period.start.slice(5).replace("-", ".")} – ${data.period.end.slice(5).replace("-", ".")}`
            : week === "current"
              ? "이번 주"
              : week === "previous"
                ? "지난주"
                : "다음 주"}
        </p>
        <button
          aria-label={week === "previous" ? "이번 주 보기" : "다음 주 보기"}
          disabled={week === "next"}
          onClick={() => setWeek(week === "previous" ? "current" : "next")}
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
            ? "완료한 계획 거리 · 목표 페이스 기준"
            : state.loading
              ? "저장된 계획을 확인하고 있어요."
              : data
                ? "이 주에 저장된 계획이 없어요."
                : "저장된 계획을 확인하지 못했어요."}
        </p>
      </section>
      <PlanFeedback state={state} readOnly={week === "previous"} />
      {data && (
        <section className="schedule-list" aria-label="주간 훈련 일정">
          {Array.from({ length: 7 }, (_, i) => {
            const date = addCalendarDays(data.period.start, i),
              w = plan?.workouts.find((w) => w.date === date),
              today = date === data.period.today;
            const race = data.races?.find((r) => r.date === date);
            const Glyph =
              w?.status === "skipped"
                ? X
                : w?.kind === "rest"
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
                    {race
                      ? `대회 · ${race.name || race.distance}`
                      : w
                        ? w.kind === "rest" ? "휴식" : w.title.replace(/\s+\d+(?:\.\d+)?\s*km\s*$/i, "")
                        : date < data.period.today
                          ? "이전 날짜 · 계획 없음"
                          : "계획 없음"}
                  </p>
                  <small
                    className={w?.completed ? "complete" : today ? "focus" : ""}
                  >
                    {race
                      ? `${race.distance} · ${race.targetTimeSeconds ? formatRaceTime(race.targetTimeSeconds) : "완주 목표"}`
                      : w
                        ? w.kind === "rest"
                          ? "러닝 없음"
                          : `${w.status === "skipped" ? "× 건너뜀 · " : w.completed ? "완료 · " : ""}${w.distanceKm.toFixed(1)} km · ${formatPlanPace(w.paceSecondsPerKm)}`
                        : "—"}
                  </small>
                </div>
                <span className="schedule-icon">
                  <Glyph aria-hidden="true" />
                </span>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
export function WeeklySchedule() {
  const [week, setWeek] = useState<PlanWeek | "previous">("current");
  return <ScheduleWeek key={week} week={week} setWeek={setWeek} />;
}
