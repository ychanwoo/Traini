"use client";
import Link from "next/link";
import { useWeeklyPlan } from "./use-weekly-plan";
import { planErrorMessage } from "@/lib/training/plan-errors";
import styles from "./training.module.css";
import flow from "./today-workflow.module.css";

/** Explicit generation controls; viewing a session never generates a plan. */
export function PlanManagement({ week }: { week: "current" | "next" }) {
  const state = useWeeklyPlan(week);
  const { data, loading, error, busy } = state;
  const label = week === "current" ? "이번 주" : "다음 주";
  const existing = !!data?.plan;
  const pending = busy || !!data?.generating;
  const action = existing
    ? `${label}${week === "current" ? " 남은 훈련" : " 계획"} 다시 조정`
    : `${label}${week === "current" ? " 남은 훈련 계획" : " 계획"} 만들기`;
  const hint = !data
    ? "대상 주간의 저장된 계획을 먼저 확인해요."
    : existing
    ? "통증·컨디션·목표·훈련일이 달라졌을 때만 조정해요."
    : week === "next"
      ? "한 주의 기록과 리뷰를 확인한 뒤 준비해요."
      : "오늘의 훈련이 아직 없다면 여기서 준비해요.";
  const actionHint = pending
    ? "완료되면 저장된 계획에 반영돼요. 화면을 다시 열어도 확인할 수 있어요."
    : existing
      ? "완료한 훈련은 유지하고 남은 일정만 재검토해요."
      : "목표·러닝 기록·현재 컨디션으로 계획을 만들어요.";
  const controls = (
    <>
      {existing && !data?.inputsChanged && !pending && (
        <p className={flow.hint}>
          새로 반영할 변경사항이 없어요. 저장된 계획을 따르면 돼요.
        </p>
      )}
      {data && (!existing || data.inputsChanged || pending) && (
        <>
          <button
            type="button"
            className={styles.planAction}
            disabled={pending || state.completing || loading}
            onClick={() => void state.generate()}
          >
            {pending ? "훈련계획 생성 중…" : action}
          </button>
          <p className={flow.hint}>{actionHint}</p>
        </>
      )}
      <Link className={styles.link} href="/my/goals">
        목표·컨디션 및 ChatGPT 연결 확인
      </Link>
    </>
  );
  return (
    <section
      className={flow.panel}
      aria-label={`${label} 계획 관리`}
      aria-busy={pending}
    >
      <h2 className={flow.title}>
        {!data ? `${label} 계획 확인` : existing ? `${label} 계획 조정` : `${label} 계획 만들기`}
        {existing && <span className={flow.badge}>선택</span>}
      </h2>
      {data && (
        <p className={flow.period}>
          {data.period.start} – {data.period.end}
        </p>
      )}
      <p className={flow.hint}>{hint}</p>
      <div aria-live="polite">
        {loading && !data && (
          <p className={flow.hint}>저장된 계획을 확인하고 있어요.</p>
        )}
        {error && <p className={styles.error} role="alert">{error}</p>}
        {!error && !pending && data?.generationError && (
          <p className={styles.error} role="alert">
            {planErrorMessage(data.generationError)}
          </p>
        )}
        {data?.inputsChanged && (
          <p className={styles.error}>
            입력이 바뀌었어요. 기존 처방을 수행하기 전에 현재 상태에 맞는지 확인해 주세요.
          </p>
        )}
      </div>
      {!data && !loading && (
        <button className={styles.planAction} onClick={() => void state.refresh()}>
          다시 확인
        </button>
      )}
      {data && (existing && !pending ? (
        <details className={flow.details}>
          <summary>{label} 계획 조정 열기</summary>
          {controls}
        </details>
      ) : controls)}
    </section>
  );
}
