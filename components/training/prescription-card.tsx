"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { IMPORT_FINISHED_EVENT } from "@/lib/garmin/collection";
import { GOAL_SAVED_EVENT } from "@/lib/training/client";
import type { readPrescriptionPreview } from "@/lib/training/prescription-storage";
import type { PlanWeek } from "@/lib/training/weekly-plan";
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
export function PrescriptionCard({ week = "next" }: { week?: PlanWeek }) {
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
      <p className={styles.help}>
        목표·수행 기록으로 계산한 기준이에요. 이 조회는 AI를 호출하거나 저장된
        계획을 바꾸지 않아요.
      </p>
      <div aria-live="polite">
        {loading && (
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
        {!loading && data && (
          <>
            <p className={styles.note}>
              {data.period.start} – {data.period.end} · {data.period.timezone}
            </p>
            <p className={styles.note}>
              추가 훈련 상한 {data.limits.maxWeekKm.toFixed(1)}km · 고강도 최대{" "}
              {data.limits.maxHardSessions}회
            </p>
            <p className={styles.help}>
              상한은 채워야 할 목표가 아니에요. 훈련 종류·배치와 장거리 요일은
              가능한 날짜와 회복 간격에 맞춰 선택해요.
            </p>
            <p className={styles.note}>
              {data.guidance.condition
                ? `${data.guidance.condition.reportedOn} 직접 입력 · ${labels[data.guidance.condition.feeling]}${!data.guidance.condition.fresh ? " · 최근 입력 재확인 필요" : ""}`
                : "컨디션 미입력 · 상태를 추정하지 않아요."}
            </p>
            {data.guidance.warnings.map((w) => (
              <p className={styles.error} key={w}>
                {w}
              </p>
            ))}
            <p className={styles.help}>
              지난주 Garmin 수행 확인 {data.guidance.confirmedSessions}개 · 수동
              완료 {data.guidance.manualSessions}개 · 미확인{" "}
              {data.guidance.unconfirmedSessions ?? "계획 없음"}
            </p>
            <details className={styles.details}>
              <summary>대회별 목표와 훈련 기준</summary>
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
              {data.guidance.rules.bounds.map((b) => (
                <p key={b.kind}>
                  {labels[b.kind]} · 거리 상한{" "}
                  {Math.min(b.maxDistanceKm, data.limits.maxRunKm).toFixed(1)}km
                  ·{" "}
                  {b.kind === "threshold" && !data.guidance.rules.tempoPaceKnown
                    ? "지속 구간 근거가 없어 강도 중심"
                    : `${pace(b.minPace)}보다 빠른 처방 제한`}
                </p>
              ))}
              {data.guidance.rules.intervals.map((o) => (
                <p key={o.meters}>
                  {o.meters}m · 관측 {o.observedRepetitions}회 · 최대{" "}
                  {o.maxRepetitions}회 · 회복 {o.minRecoveryMeters}–
                  {o.maxRecoveryMeters}m · 속도와 반복 수 동시 증가 금지
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
