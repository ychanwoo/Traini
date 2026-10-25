"use client";
import { CurrentRunningMetrics } from "@/components/garmin/current-running-metrics";
import { WeeklySyncCard } from "@/components/garmin/weekly-sync-card";
import { WeeklyRunningSummary } from "@/components/garmin/weekly-running-summary";
import { TodayPlan } from "./weekly-plan-view";
import { WeeklyCloseoutCard } from "./weekly-closeout-card";
import { WeeklyReviewCard } from "./weekly-review-card";
import { PlanManagement } from "./plan-management";
import styles from "./today-workflow.module.css";
const steps = [
  ["today-import", "기록 가져오기"],
  ["today-session", "훈련·결과 기록"],
  ["today-review", "마감·리뷰"],
  ["today-next", "다음 주 준비"],
] as const;
export function TodayWorkflow() {
  return <>
    <nav className={styles.guide} aria-label="오늘 탭 사용 순서">
      <ol className={styles.steps}>{steps.map(([id, title], i) => <li key={id}><a href={`#${id}`}><span>{String(i + 1).padStart(2, "0")}</span>{title}</a></li>)}</ol>
    </nav>
    <section id="today-import" className={styles.group} aria-label="기록 가져오기 단계">
      <h2 className={styles.step}><span className={styles.number}>1</span>러닝 후 기록 가져오기</h2>
      <WeeklySyncCard />
      <CurrentRunningMetrics hideImportLink />
      <details className="card mt-4 p-4"><summary className="text-xs font-medium">주간 기록 자세히</summary><WeeklyRunningSummary /></details>
    </section>
    <section id="today-session" className={styles.group} aria-label="오늘 훈련 단계">
      <h2 className={styles.step}><span className={styles.number}>2</span>오늘 훈련·결과 기록</h2>
      <TodayPlan concise />
      <PlanManagement week="current" />
    </section>
    <section id="today-review" className={styles.group} aria-label="주간 마감과 리뷰 단계">
      <h2 className={styles.step}><span className={styles.number}>3</span>한 주를 마쳤을 때</h2>
      <p className={styles.hint}>일요일은 마지막 훈련 후 마감 → 리뷰. 월요일부터는 지난주 리뷰를 바로 만들 수 있어요.</p>
      <WeeklyCloseoutCard />
      <WeeklyReviewCard compact />
    </section>
    <section id="today-next" className={styles.group} aria-label="다음 주 준비 단계">
      <h2 className={styles.step}><span className={styles.number}>4</span>다음 주 준비</h2>
      <PlanManagement week="next" />
    </section>
  </>;
}
