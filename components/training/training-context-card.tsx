"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { IMPORT_FINISHED_EVENT } from "@/lib/garmin/collection";
import { distanceLabel, durationLabel } from "@/lib/garmin/running-summary";
import type { TrainingContext } from "@/lib/training/context";
import { GOAL_SAVED_EVENT, trainingRequest } from "@/lib/training/client";
import type { GoalIssue } from "@/lib/training/goal";
import styles from "./training.module.css";
export function issueLabel(issue: GoalIssue): string {
  const names = {
    raceName: "대회명",
    targetDistance: "목표 거리",
    targetDate: "목표 날짜",
    targetTimeSeconds: "목표 기록",
    trainingDays: "훈련 가능 요일",
    longRunDay: "장거리 훈련 요일",
  };
  return `${names[issue.field]}${issue.code === "missing" ? "을 설정해 주세요." : issue.code === "past_date" ? "는 오늘 이후로 설정해 주세요." : issue.code === "unavailable_day" ? "은 훈련 가능한 요일에서 선택해 주세요." : "을 확인해 주세요."}`;
}
export function TrainingContextCard({
  settings = false,
}: {
  settings?: boolean;
}) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; data: TrainingContext }
  >({ status: "loading" });
  const refresh = useCallback(() => {
    setState({ status: "loading" });
    setRevision((n) => n + 1);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void trainingRequest<TrainingContext>("context", controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ status: "ready", data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    const events = [IMPORT_FINISHED_EVENT, GOAL_SAVED_EVENT, "focus"];
    events.forEach((event) => window.addEventListener(event, refresh));
    const timer = window.setInterval(refresh, 300_000);
    return () => {
      events.forEach((event) => window.removeEventListener(event, refresh));
      window.clearInterval(timer);
    };
  }, [refresh]);
  const data = state.status === "ready" ? state.data : null;
  return (
    <section
      className={styles.card}
      aria-label="훈련 입력 데이터"
      aria-busy={state.status === "loading"}
    >
      <header className={styles.heading}>
        <h2>훈련 준비 데이터</h2>
        <button
          type="button"
          onClick={refresh}
          disabled={state.status === "loading"}
          aria-label="훈련 입력 데이터 새로고침"
        >
          <RefreshCw aria-hidden="true" />
        </button>
      </header>
      <div aria-live="polite">
        {state.status === "loading" && (
          <p className={styles.note}>
            목표와 저장된 러닝 기록을 확인하고 있어요.
          </p>
        )}
        {state.status === "error" && (
          <p className={styles.error} role="alert">
            훈련 입력 데이터를 불러오지 못했어요.{" "}
            <button type="button" onClick={refresh}>
              다시 확인
            </button>
          </p>
        )}
        {data && (
          <>
            <p className={styles.note}>
              {data.history.start} – {data.history.end}
              <br />
              완료된 최근 8주 · {data.timezone.replaceAll("_", " ")}
            </p>
            <dl className={styles.metrics}>
              <div>
                <dt>기록이 있는 주</dt>
                <dd>
                  {data.history.weeksWithActivities}
                  <small> / 8주</small>
                </dd>
              </div>
              <div>
                <dt>저장된 러닝</dt>
                <dd>
                  {data.history.activityCount}
                  <small>회</small>
                </dd>
              </div>
            </dl>
            {data.inputs.issues.length > 0 && (
              <ul className={styles.issues}>
                {data.inputs.issues.map((issue) => (
                  <li key={`${issue.field}-${issue.code}`}>
                    {issueLabel(issue)}
                  </li>
                ))}
              </ul>
            )}
            <p className={styles.note}>
              {data.history.activityCount === 0
                ? "저장된 러닝 기록이 없어요. Garmin에서 지난주 기록을 먼저 가져와 주세요."
                : data.history.weeksWithActivities < 8
                  ? `${data.history.weeksWithActivities}주에 저장된 기록이 있어요. 나머지 주의 실제 훈련 여부는 알 수 없어요.`
                  : "8주 모두에 저장된 기록이 있어요."}
            </p>
            {data.history.coverage.distanceCount <
              data.history.activityCount && (
              <p className={styles.note}>
                일부 기록에 거리가 없어요. 없는 값을 0으로 계산하지 않아요.
              </p>
            )}
            {data.history.coverage.timerCount < data.history.activityCount && (
              <p className={styles.note}>일부 기록에 타이머 시간이 없어요.</p>
            )}
            {data.history.coverage.heartRateCount <
              data.history.activityCount && (
              <p className={styles.note}>
                심박 정보가 있는 기록은 {data.history.coverage.heartRateCount}/
                {data.history.activityCount}개예요.
              </p>
            )}
            <details className={styles.details}>
              <summary>주간 기록 확인</summary>
              <ul>
                {data.history.weeks.map((week) => (
                  <li key={week.start}>
                    <span>
                      {week.start.slice(5)} – {week.end.slice(5)}
                    </span>
                    <b>
                      {week.activityCount
                        ? `${week.activityCount}회 · ${distanceLabel(week.distanceMeters)} km`
                        : "저장된 기록 없음"}
                    </b>
                    {week.activityCount > 0 && (
                      <small>
                        최장 {distanceLabel(week.longestRunMeters)} km · 타이머{" "}
                        {durationLabel(week.timerSeconds)}
                      </small>
                    )}
                  </li>
                ))}
              </ul>
            </details>
            <p className={styles.note}>
              {data.inputs.readyForPlanInput
                ? "목표와 러닝 기록을 훈련 입력 데이터로 정리했어요."
                : "부족한 입력을 확인한 뒤 훈련 입력 데이터를 완성할 수 있어요."}{" "}
              훈련계획은 아직 생성하지 않아요.
            </p>
            {!settings && (
              <Link className={styles.link} href="/my/goals">
                목표와 훈련 요일 설정
              </Link>
            )}
          </>
        )}
      </div>
    </section>
  );
}
