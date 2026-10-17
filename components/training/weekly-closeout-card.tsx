"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestJson, ReadRequestGate } from "@/lib/http/client-request";
import { IMPORT_FINISHED_EVENT } from "@/lib/garmin/collection";
import type { CloseoutState } from "@/lib/training/week-closeout";
import styles from "./training.module.css";
export function WeeklyCloseoutCard() {
  const [data, setData] = useState<CloseoutState | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previous = useRef<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const read = useRef(new ReadRequestGate());
  const action = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    const c = read.current.start();
    if (!c) return;
    try {
      const next = await requestJson<CloseoutState>("/api/training/closeout", {
        signal: c.signal,
      });
      if (!c.signal.aborted) {
        if (previous.current !== `${next.startsOn}:${next.revision}`)
          setConfirmed(false);
        previous.current = `${next.startsOn}:${next.revision}`;
        setData(next);
        setReadError(null);
      }
    } catch (e) {
      if (!c.signal.aborted)
        setReadError(
          e instanceof Error ? e.message : "마감 상태를 확인하지 못했어요.",
        );
    } finally {
      read.current.finish(c);
    }
  }, []);
  useEffect(() => {
    const reads = read.current;
    let active = true;
    queueMicrotask(() => {
      if (active) void refresh();
    });
    const listener = () => void refresh();
    const events = ["focus", "traini:plan-changed", IMPORT_FINISHED_EVENT];
    events.forEach((e) => window.addEventListener(e, listener));
    const timer = setInterval(listener, 60000);
    return () => {
      active = false;
      reads.abort();
      action.current?.abort();
      clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, listener));
    };
  }, [refresh]);
  async function close() {
    if (!data || !confirmed || inFlight.current) return;
    inFlight.current = true;
    read.current.abort();
    setBusy(true);
    setError(null);
    const c = new AbortController();
    action.current = c;
    try {
      const next = await requestJson<CloseoutState>("/api/training/closeout", {
        method: "POST",
        body: {
          startsOn: data.startsOn,
          revision: data.revision,
          confirmed: true,
        },
        signal: c.signal,
      });
      if (!c.signal.aborted) {
        setData(next);
        setConfirmed(false);
        window.dispatchEvent(new Event("traini:plan-changed"));
      }
    } catch (e) {
      if (!c.signal.aborted)
        setError(
          e instanceof Error ? e.message : "저장 여부를 먼저 확인해 주세요.",
        );
    } finally {
      inFlight.current = false;
      if (!c.signal.aborted) {
        setBusy(false);
        void refresh();
      }
    }
  }
  return (
    <section className={styles.card} aria-label="주간 마감" aria-busy={busy}>
      <div className={styles.heading}>
        <h2>주간 마감</h2>
      </div>
      {(error ?? readError) && (
        <p role="alert" className={styles.error}>
          {error ?? readError}
        </p>
      )}
      {!data ? (
        <>
          <p className={styles.note}>마감할 주를 확인하고 있어요.</p>
          {(error ?? readError) && (
            <button
              className={styles.planAction}
              onClick={() => void refresh()}
            >
              다시 확인
            </button>
          )}
        </>
      ) : (
        <>
          <p className={styles.note}>
            {data.startsOn} – {data.endsOn} · {data.timezone}
          </p>
          <p className={styles.help}>
            다음 계획 주간 · {data.nextStartsOn}부터 7일
          </p>
          <p className={styles.note}>
            {data.early
              ? "이번 주 훈련을 마쳤다면 기록을 가져온 뒤 마감해 주세요."
              : "완료된 지난주 기록을 확인해 주세요. 지난주 리뷰는 마감 확인 없이도 생성할 수 있어요."}
          </p>
          <p className={styles.help}>
            확인된 러닝 {data.activityCount}회 ·{" "}
            {data.unconfirmed === null
              ? "저장된 계획 없음"
              : `수행 미확인 훈련 ${data.unconfirmed}개`}
            {data.incompleteActivities
              ? ` · 거리·시간 누락 기록 ${data.incompleteActivities}개`
              : ""}
          </p>
          <Link className={styles.link} href="/garmin-connect">
            Garmin 기록 가져오기·확인
          </Link>
          {data.closeout?.fresh ? (
            <p className={styles.note}>
              이 주의 기록으로 마감을 확인했어요. 리뷰와 계획 생성은 각각 직접
              실행해 주세요.
            </p>
          ) : (
            <>
              {data.closeout && (
                <p className={styles.error}>
                  마감 이후 기록·목표·피드백이 바뀌었어요. 내용을 확인하고
                  마감을 갱신해 주세요.
                </p>
              )}
              <label className={styles.help}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />{" "}
                이 주의 훈련을 마쳤고 현재 기록을 확인했어요.
              </label>
              <button
                type="button"
                className={styles.planAction}
                disabled={!confirmed || busy}
                onClick={() => void close()}
              >
                {busy
                  ? "마감 확인 중…"
                  : data.closeout
                    ? "주간 마감 갱신"
                    : "주간 마감 확인"}
              </button>
            </>
          )}
          <p className={styles.help}>
            미확인 훈련은 미확인으로 남겨요. 마감은 완료·휴식·회복을 확정하지
            않고, 빠진 훈련을 다음 주에 몰아서 보충하지 않아요. AI 호출과 기존
            일정 변경은 없어요.
          </p>
        </>
      )}
    </section>
  );
}
