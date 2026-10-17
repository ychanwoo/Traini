"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestJson, ReadRequestGate } from "@/lib/http/client-request";
import { addCalendarDays } from "@/lib/garmin/running-summary";
import type { ReviewState } from "@/lib/training/review-storage";
import { reviewErrorMessage } from "@/lib/training/review-errors";
import { IMPORT_FINISHED_EVENT } from "@/lib/garmin/collection";
import styles from "./training.module.css";
const fatigueLabels: Record<string, string> = {
  low: "낮음",
  moderate: "보통",
  high: "높음",
};
const painLabels: Record<string, string> = {
  none: "없음",
  discomfort: "불편감",
  pain: "통증",
};
const EVENT = "traini:plan-changed";
const limitationLabels: Record<string, string> = {
  activity_absence_unknown: "기록 없는 날의 수행 여부는 확인할 수 없어요.",
  recovery_unavailable:
    "수면·HRV는 없으며, 피드백 미입력을 정상 회복으로 판단하지 않아요.",
  no_plan: "저장된 계획이 없어 계획 대비 수행률은 계산하지 않았어요.",
  unconfirmed_sessions:
    "수동 완료와 미확인 세션은 Garmin 수행 확인과 구분했어요.",
  missing_metrics: "일부 활동에 거리나 시간이 없어 합계가 부분적일 수 있어요.",
  limited_history: "평소 훈련량을 비교할 이전 주 기록이 충분하지 않아요.",
  no_recorded_activities: "이 주에 확인된 러닝 기록이 없어요.",
};
export function WeeklyReviewCard() {
  const [start, setStart] = useState<string | undefined>(),
    [data, setData] = useState<ReviewState | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const read = useRef(new ReadRequestGate()),
    action = useRef<AbortController | null>(null),
    inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    const c = read.current.start();
    if (!c) return;
    try {
      const body = await requestJson<ReviewState>(
        `/api/training/review${start ? `?start=${start}` : ""}`,
        { signal: c.signal },
      );
      if (!c.signal.aborted) {
        setData(body);
        setReadError(null);
        setLoading(false);
      }
    } catch (e) {
      if (!c.signal.aborted) {
        setReadError(
          e instanceof Error ? e.message : "리뷰를 확인하지 못했어요.",
        );
        setLoading(false);
      }
    } finally {
      read.current.finish(c);
    }
  }, [start]);
  const generating = !!data?.generating;
  useEffect(() => {
    const reads = read.current;
    let active = true;
    queueMicrotask(() => {
      if (active) void refresh();
    });
    const timer = setInterval(() => void refresh(), generating ? 2000 : 60000);
    const listener = () => void refresh();
    window.addEventListener("focus", listener);
    window.addEventListener(EVENT, listener);
    window.addEventListener(IMPORT_FINISHED_EVENT, listener);
    return () => {
      active = false;
      clearInterval(timer);
      reads.abort();
      window.removeEventListener("focus", listener);
      window.removeEventListener(EVENT, listener);
      window.removeEventListener(IMPORT_FINISHED_EVENT, listener);
    };
  }, [refresh, generating]);
  useEffect(() => () => action.current?.abort(), []);
  async function generate() {
    if (inFlight.current || !data) return;
    inFlight.current = true;
    read.current.abort();
    setBusy(true);
    setError(null);
    const c = new AbortController();
    action.current = c;
    try {
      const body = await requestJson<ReviewState>("/api/training/review", {
        method: "POST",
        body: { startsOn: data.period.startsOn },
        signal: c.signal,
        timeoutMs: 240_000,
      });
      if (!c.signal.aborted) {
        setData(body);
        window.dispatchEvent(new Event(EVENT));
      }
    } catch (e) {
      if (!c.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "생성 결과를 확인하지 못했어요. 새로고침해 주세요.",
        );
    } finally {
      inFlight.current = false;
      if (!c.signal.aborted) {
        setBusy(false);
        void refresh();
        window.dispatchEvent(new Event(EVENT));
      }
    }
  }
  const displayError = error ?? readError;
  const metrics = data?.metrics,
    review = data?.review;
  const label = (s: string) =>
    `${s.slice(5).replace("-", ".")} – ${addCalendarDays(s, 6).slice(5).replace("-", ".")}`;
  return (
    <section
      className={styles.card}
      aria-label="주간 훈련 리뷰"
      aria-busy={busy || generating}
    >
      <div className={styles.heading}>
        <h2>주간 훈련 리뷰</h2>
      </div>
      {data && (
        <label className={styles.reviewWeek}>
          검토 주간
          <select
            aria-label="리뷰 주간 선택"
            value={data.period.startsOn}
            disabled={busy || generating}
            onChange={(e) => {
              setStart(e.target.value);
              setData(null);
              setLoading(true);
              setError(null);
              setReadError(null);
            }}
          >
            {Array.from({ length: 8 }, (_, i) =>
              addCalendarDays(data.latestStartsOn, -7 * i),
            ).map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </label>
      )}
      <div aria-live="polite">
        {loading && (
          <p className={styles.note}>
            완료된 주의 계획과 러닝 기록을 확인하고 있어요.
          </p>
        )}
        {displayError && (
          <p className={styles.error} role="alert">
            {displayError}
          </p>
        )}
        {!data && !loading && (
          <button className={styles.planAction} onClick={() => void refresh()}>
            다시 확인
          </button>
        )}
        {metrics && (
          <>
            <dl className={styles.metrics}>
              <div>
                <dt>계획 거리</dt>
                <dd>
                  {metrics.plannedKm === null
                    ? "—"
                    : metrics.plannedKm.toFixed(1)}{" "}
                  <small>km</small>
                </dd>
              </div>
              <div>
                <dt>
                  기록된 거리
                  {metrics.distanceKnown < metrics.activityCount
                    ? " · 부분 합계"
                    : ""}
                </dt>
                <dd>
                  {metrics.actualKm === null
                    ? "—"
                    : metrics.actualKm.toFixed(1)}{" "}
                  <small>km</small>
                </dd>
              </div>
            </dl>
            <p className={styles.note}>
              {metrics.activityCount}회 러닝 · Garmin 수행 확인{" "}
              {metrics.garminCompleted}개 · 수동 완료 {metrics.manualCompleted}
              개
              {metrics.unconfirmed !== null
                ? ` · 미확인 ${metrics.unconfirmed}개`
                : ""}
            </p>
            <p className={styles.help}>
              직접 건너뜀 {metrics.explicitlySkipped}개 · 피드백 입력{" "}
              {metrics.feedbackReports ?? 0}개
            </p>
            {metrics.sessions.some(
              (s) => s.feedback?.assessment || s.feedback?.skipReason,
            ) && (
              <details className={styles.details}>
                <summary>훈련 피드백·건너뜀 사유</summary>
                {metrics.sessions
                  .filter(
                    (s) => s.feedback?.assessment || s.feedback?.skipReason,
                  )
                  .map((s) => (
                    <div key={s.date}>
                      <p className={styles.note}>
                        {s.date} ·{" "}
                        {s.completion === "skipped"
                          ? "직접 건너뜀"
                          : s.completion === "garmin"
                            ? "Garmin 확인"
                            : s.completion === "manual"
                              ? "직접 완료"
                              : "미확인"}
                      </p>
                      {s.feedback?.skipReason && (
                        <p className={styles.help}>
                          사유 · {s.feedback.skipReason}
                        </p>
                      )}
                      <p className={styles.help}>
                        RPE {s.feedback?.assessment?.rpe ?? "미입력"} · 피로{" "}
                        {fatigueLabels[s.feedback?.assessment?.fatigue ?? ""] ??
                          "미입력"}{" "}
                        · 통증·불편감{" "}
                        {painLabels[s.feedback?.assessment?.pain ?? ""] ??
                          "미입력"}
                      </p>
                      {s.feedback?.assessment?.memo && (
                        <p className={styles.help}>
                          {s.feedback.assessment.memo}
                        </p>
                      )}
                    </div>
                  ))}
              </details>
            )}
            {(metrics.additionalRuns > 0 || metrics.unassignedRuns > 0) && (
              <p className={styles.help}>
                계획 휴식일 러닝 {metrics.additionalRuns}회 · 세션 미연결 러닝{" "}
                {metrics.unassignedRuns}회
              </p>
            )}
            {!metrics.hasPlan && (
              <p className={styles.note}>
                이 주의 저장된 계획이 없어 실제 기록을 중심으로 검토해요. 미연결
                기록이 모두 추가 훈련을 뜻하지는 않아요.
              </p>
            )}
          </>
        )}
        {review && (
          <div className={styles.reviewContent}>
            {!review.fresh && (
              <p className={styles.error}>
                기록 또는 목표가 바뀌었어요. 아래는 이전 입력으로 저장된
                리뷰이며, 새 계획에는 아직 반영되지 않아요.
              </p>
            )}
            {!review.fresh && (
              <p className={styles.help}>
                저장된 리뷰 당시 기록 거리:{" "}
                {review.metrics.actualKm === null
                  ? "미확인"
                  : `${review.metrics.actualKm.toFixed(1)}km`}
              </p>
            )}
            <p className={styles.note}>{review.content.summary}</p>
            <ul className={styles.reviewObservations}>
              {review.content.observations.map((o, i) => (
                <li key={i}>{o.text}</li>
              ))}
            </ul>
            <p className={styles.reviewDirection}>
              다음 계획 ·{" "}
              {review.content.nextWeek.direction === "reduce"
                ? "훈련량 조정"
                : review.content.nextWeek.direction === "progress"
                  ? "점진적 증가"
                  : "훈련량 유지"}{" "}
              {review.content.nextWeek.volumeChangePercent !== 0
                ? `(${review.content.nextWeek.volumeChangePercent > 0 ? "+" : ""}${review.content.nextWeek.volumeChangePercent}%)`
                : ""}
            </p>
            <p className={styles.note}>{review.content.nextWeek.rationale}</p>
            <details className={styles.details}>
              <summary>평가 범위와 제한</summary>
              {review.content.limitations.map((k) => (
                <p key={k}>{limitationLabels[k] ?? k}</p>
              ))}
            </details>
            {review.fresh && data?.period.startsOn !== data.latestStartsOn && (
              <p className={styles.note}>
                이전 주 리뷰예요. 현재 계획에는 가장 최근 완료된 주의 최신
                리뷰를 반영해요.
              </p>
            )}
            <p className={styles.help}>
              ChatGPT · {review.model} ·{" "}
              {new Date(review.createdAt).toLocaleDateString("ko-KR", {
                timeZone: data!.period.timezone,
              })}
            </p>
            {review.fresh && data?.period.startsOn === data.latestStartsOn && (
              <p className={styles.note}>
                최근 완료된 주의 리뷰는 일정의 ‘최신 기록으로 계획 업데이트’
                또는 다음 주 계획 생성에 반영돼요. 기존 계획은 자동으로 바뀌지
                않아요.
              </p>
            )}
          </div>
        )}
        {data &&
          !displayError &&
          !busy &&
          !generating &&
          data.generationError && (
            <p className={styles.error}>
              {reviewErrorMessage(data.generationError)}
            </p>
          )}
        {data && (!review || !review.fresh) && (
          <button
            type="button"
            className={styles.planAction}
            disabled={
              busy ||
              generating ||
              (!metrics?.hasPlan && !metrics?.activityCount)
            }
            onClick={() => void generate()}
          >
            {busy || generating
              ? "주간 리뷰 생성 중…"
              : review
                ? "최신 기록으로 리뷰 업데이트"
                : "주간 리뷰 생성"}
          </button>
        )}
        {(busy || generating) && (
          <p className={styles.note}>
            기록을 검토하고 있어요. 기존 리뷰와 훈련계획은 유지돼요.
          </p>
        )}
      </div>
    </section>
  );
}
