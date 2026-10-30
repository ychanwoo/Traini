"use client";
import { useEffect, useState } from "react";
import { useWeeklyPlan } from "./use-weekly-plan";
import { todayWorkflow } from "@/lib/training/today-workflow";
import { CurrentRunningMetrics } from "@/components/garmin/current-running-metrics";
import { WeeklySyncCard } from "@/components/garmin/weekly-sync-card";
import { WeeklyRunningSummary } from "@/components/garmin/weekly-running-summary";
import { TodayPlan } from "./weekly-plan-view";
import { WeeklyCloseoutCard } from "./weekly-closeout-card";
import { WeeklyReviewCard } from "./weekly-review-card";
import { PlanManagement } from "./plan-management";
import styles from "./today-workflow.module.css";
export function TodayWorkflow() {
  const { data } = useWeeklyPlan("current");
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = window.setInterval(update, 30_000);
    queueMicrotask(update);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  const flow = data && now ? todayWorkflow(data.period.timezone, now) : null;
  const title = flow?.planWeek === "next" ? "다음 주 준비" : "이번 주 남은 훈련";
  const steps = [["today-import", "기록 가져오기"], ["today-session", "훈련·결과 기록"], ["today-review", "마감·리뷰"], ["today-next", flow ? title : "계획 준비"]];
  return <>
    <nav className={styles.guide} aria-label="오늘 탭 사용 순서">
      <ol className={styles.steps}>{steps.map(([id, title], i) => <li key={id}><a href={`#${id}`}><span>{String(i + 1).padStart(2, "0")}</span>{title}</a></li>)}</ol>
    </nav>
    <section id="today-import" className={styles.group} aria-label="기록 가져오기 단계">
      <h2 className={styles.step}><span className={styles.number}>1</span>러닝 후 기록 가져오기</h2>
      {flow ? <WeeklySyncCard key={flow.today} initialSelection={flow.importWeek} /> : <p className={styles.hint}>훈련 시간대와 대상 주간을 확인하고 있어요.</p>}
      {flow?.planWeek === "current" && <p className={styles.hint}>이번 주에도 달렸다면 이번 주 기록도 가져온 뒤 계획을 만들어 주세요.</p>}
      <CurrentRunningMetrics hideImportLink />
      <details className="card mt-4 p-4"><summary className="text-xs font-medium">주간 기록 자세히</summary><WeeklyRunningSummary /></details>
    </section>
    <section id="today-session" className={styles.group} aria-label="오늘 훈련 단계">
      <h2 className={styles.step}><span className={styles.number}>2</span>오늘 훈련·결과 기록</h2>
      <TodayPlan concise />
      {flow?.planWeek === "next" && <PlanManagement week="current" />}
    </section>
    <section id="today-review" className={styles.group} aria-label="주간 마감과 리뷰 단계">
      <h2 className={styles.step}><span className={styles.number}>3</span>한 주를 마쳤을 때</h2>
      <p className={styles.hint}>일요일은 마지막 훈련 후 마감 → 리뷰. 월요일부터는 지난주 리뷰를 바로 만들 수 있어요.</p>
      <WeeklyCloseoutCard key={`closeout:${flow?.today ?? "loading"}`} />
      <WeeklyReviewCard key={`review:${flow?.today ?? "loading"}`} compact />
    </section>
    <section id="today-next" className={styles.group} aria-label="훈련 계획 준비 단계">
      <h2 className={styles.step}><span className={styles.number}>4</span>{flow ? title : "계획 준비"}</h2>
      {flow && <PlanManagement key={`${flow.today}:${flow.planWeek}`} week={flow.planWeek} />}
    </section>
  </>;
}
