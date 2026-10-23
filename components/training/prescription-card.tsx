"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { IMPORT_FINISHED_EVENT } from "@/lib/garmin/collection";
import { GOAL_SAVED_EVENT } from "@/lib/training/client";
import type { readPrescriptionPreview } from "@/lib/training/prescription-storage";
import type { PlanWeek } from "@/lib/training/weekly-plan";
import { coachingCopy } from "@/lib/training/coaching-copy";
import styles from "./training.module.css";
type Preview = Awaited<ReturnType<typeof readPrescriptionPreview>>;
const pace = (n: number) =>
  `${Math.floor(n / 60)}′${String(n % 60).padStart(2, "0")}″/km`;
const labels: Record<string, string> = {
  recovery: "회복런",
  easy: "이지런",
  long: "롱런",
  threshold: "템포런",
  interval: "인터벌",
  good: "좋음",
  normal: "보통",
  tired: "피로함",
  unwell: "몸 상태 이상",
  pain: "통증",
};
export function PrescriptionCard({ week = "next", compact = false }: { week?: PlanWeek; compact?: boolean }) {
  const [data, setData] = useState<Preview | null>(null),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(true);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setLoading(true);
    try {
      const r = await fetch(`/api/training/prescription?week=${week}`, {
        cache: "no-store",
        signal: AbortSignal.any([c.signal, AbortSignal.timeout(45000)]),
      });
      const body = await r.json();
      if (!r.ok)
        throw new Error(body.error ?? "처방 기준을 확인하지 못했어요.");
      if (!c.signal.aborted) {
        setData(body);
        setError(null);
      }
    } catch (e) {
      if (!c.signal.aborted) {
        setData(null);
        setError(
          e instanceof Error ? e.message : "처방 기준을 확인하지 못했어요.",
        );
      }
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  }, [week]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void refresh();
    });
    const events = [
      GOAL_SAVED_EVENT,
      IMPORT_FINISHED_EVENT,
      "focus",
      "traini:plan-changed",
    ];
    const listener = () => void refresh();
    events.forEach((e) => window.addEventListener(e, listener));
    return () => {
      active = false;
      controller.current?.abort();
      events.forEach((e) => window.removeEventListener(e, listener));
    };
  }, [refresh]);
  return (
    <section
      className={styles.card}
      aria-label="훈련 처방 기준"
      aria-busy={loading}
    >
      <div className={styles.heading}>
        <h2>훈련 처방 기준</h2>
      </div>
      {!compact && <p className={styles.help}>목표·러닝 기록·입력한 컨디션으로 정한 훈련 범위예요. 조회만으로 저장된 계획이 바뀌지는 않아요.</p>}
      <div aria-live="polite">
        {loading && !data && (
          <p className={styles.note}>기록과 대회 일정을 확인하고 있어요.</p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {!loading && error && (
          <button className={styles.planAction} onClick={() => void refresh()}>
            다시 확인
          </button>
        )}
        {data && (
          <>
            <p className={styles.note}>
              {data.period.start} – {data.period.end} · {data.period.timezone}
            </p>
            <p className={styles.note}>
              {week === "current" ? "이번 주 남은 러닝" : "다음 주 러닝"} 최대{" "}
              {data.limits.maxWeekKm.toFixed(1)}km · 고강도 훈련 최대{" "}
              {data.limits.maxHardSessions}회
            </p>
            {!compact && <p className={styles.help}>상한은 목표가 아니에요. 가능한 날짜와 회복 간격에 맞춰 배치해요.</p>}
            <p className={styles.note}>
              {data.guidance.condition
                ? `${data.guidance.condition.reportedOn} 직접 입력 · ${labels[data.guidance.condition.feeling]}${!data.guidance.condition.fresh ? " · 최근 입력 재확인 필요" : ""}`
                : coachingCopy.unknownCondition}
            </p>
            {!compact && data.guidance.condition && (
              <p className={styles.help}>{coachingCopy.reportedCondition}</p>
            )}
            {data.guidance.warnings.map((w) => (
              <p className={styles.error} key={w}>
                {w}
              </p>
            ))}
            <details className={styles.details}>
              <summary>대회별 목표와 훈련 기준</summary>
            <p className={styles.help}>
              지난주 계획 수행 · Garmin 확인 {data.guidance.confirmedSessions}개
              · 직접 완료 표시 {data.guidance.manualSessions}개
              {data.guidance.unconfirmedSessions === null
                ? " · 비교할 계획 없음"
                : ` · 수행 미확인 ${data.guidance.unconfirmedSessions}개`}
            </p>

              {data.guidance.goals.map((r) => (
                <p key={r.id}>
                  {r.date} · {r.name || r.distance} ·{" "}
                  {r.priority === "primary" ? "주목표" : "준비 대회"}
                  {r.targetPaceSecondsPerKm !== null
                    ? ` · 목표 ${pace(r.targetPaceSecondsPerKm)}`
                    : " · 완주 목표"}
                </p>
              ))}
              <p>목표 페이스는 현재 수행 능력으로 간주하지 않아요.</p>
              <p>
                대회 준비 → 테이퍼 → 대회 → 회복·복귀 확인. 테이퍼는 훈련량을
                줄이되 허용된 짧은 자극까지 모두 막지는 않아요. 회복 확인
                기준일은 자동 복귀일이 아니에요.
              </p>
              {data.guidance.rules.bounds.map((b) => (
                <p key={b.kind}>
                  {labels[b.kind]} · 거리 상한{" "}
                  {Math.min(b.maxDistanceKm, data.limits.maxRunKm).toFixed(1)}km
                  ·{" "}
                  {b.kind === "threshold" && !data.guidance.rules.tempoPaceKnown
                    ? "지속주 구간의 페이스 근거가 부족해 체감 강도로 안내"
                    : `${pace(b.minPace)}보다 빠르게 배치하지 않아요`}
                </p>
              ))}
              {data.guidance.rules.intervals.map((o) => (
                <p key={o.meters}>
                  {o.meters}m · 기록에서 확인한 반복 {o.observedRepetitions}회 ·
                  배치 가능한 최대 {o.maxRepetitions}회 · 회복{" "}
                  {o.minRecoveryMeters}–{o.maxRecoveryMeters}m · 속도와 반복 수
                  동시 증가 금지
                </p>
              ))}
              {data.guidance.principles.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </details>
          </>
        )}
      </div>
    </section>
  );
}
