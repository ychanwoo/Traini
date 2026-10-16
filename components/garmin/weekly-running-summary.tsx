"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { dateInZone, distanceLabel, durationLabel, paceLabel, periodLabel, timezoneLabel,
  type RunningSummary, type WeekSelection } from "@/lib/garmin/running-summary";
import styles from "./weekly-running-summary.module.css";
import { IMPORT_FINISHED_EVENT } from "@/lib/garmin/collection";

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: RunningSummary };
const weekdays = ["월", "화", "수", "목", "금", "토", "일"];
class SummaryRequestError extends Error {}

async function loadSummary(week: WeekSelection, signal: AbortSignal): Promise<RunningSummary> {
  const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
  if (!session) throw new SummaryRequestError("로그인이 만료되었어요. 다시 로그인해 주세요.");
  const response = await fetch(`/api/garmin/weekly-summary?week=${week}`, {
    headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  if (response.status === 401 || response.status === 403) throw new SummaryRequestError("관리자 로그인 상태를 확인해 주세요.");
  if (!response.ok) throw new SummaryRequestError("주간 기록을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.");
  return response.json() as Promise<RunningSummary>;
}

export function WeeklyRunningSummary({ detailed = false, initialWeek = "current" }: {
  detailed?: boolean; initialWeek?: WeekSelection;
}) {
  const [week, setWeek] = useState<WeekSelection>(initialWeek);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<State>({ status: "loading" });
  const refresh = useCallback(() => {
    setState({ status: "loading" });
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    window.addEventListener(IMPORT_FINISHED_EVENT, refresh);
    return () => window.removeEventListener(IMPORT_FINISHED_EVENT, refresh);
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    void loadSummary(week, controller.signal).then((data) => {
      if (!controller.signal.aborted) setState({ status: "ready", data });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ status: "error",
        message: error instanceof SummaryRequestError ? error.message : "연결이 지연되거나 끊겼어요. 다시 확인해 주세요." });
    });
    return () => controller.abort();
  }, [week, revision]);

  useEffect(() => {
    // Catch manual uploads while away and calendar rollover without a stale
    // request overwriting a different week's result.
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(() => {
      if (state.status === "ready" && dateInZone(new Date(), state.data.period.timezone) !== state.data.period.today) refresh();
    }, 60_000);
    return () => { window.removeEventListener("focus", refresh); window.clearInterval(timer); };
  }, [state, refresh]);

  const selectWeek = (next: WeekSelection) => {
    if (next === week) return;
    setState({ status: "loading" });
    setWeek(next);
  };
  const summary = state.status === "ready" ? state.data : null;
  const count = summary?.totals.activityCount ?? 0;

  return <section className={styles.card} aria-label="주간 러닝 요약" aria-busy={state.status === "loading"}>
    <header className={styles.header}>
      <h2>주간 러닝</h2>
      <div className={styles.actions}>
        <div className={styles.switch} role="group" aria-label="조회할 주간">
          <button type="button" aria-pressed={week === "current"} onClick={() => selectWeek("current")}>이번 주</button>
          <button type="button" aria-pressed={week === "previous"} onClick={() => selectWeek("previous")}>지난주</button>
        </div>
        <button type="button" className={styles.refresh} aria-label="주간 기록 새로고침" disabled={state.status === "loading"} onClick={refresh}>
          <RefreshCw aria-hidden="true" />
        </button>
      </div>
    </header>
    <div aria-live="polite" aria-atomic="true">
      {state.status === "loading" && <p className={styles.message} role="status">저장된 러닝 기록을 확인하고 있어요.</p>}
      {state.status === "error" && <div className={styles.error}><p role="alert">{state.message}</p><button type="button" onClick={refresh}>다시 확인</button></div>}
      {summary && <p className="sr-only">{week === "current" ? "이번 주" : "지난주"} 러닝 {count}개를 불러왔어요.</p>}
    </div>
    {summary && <>
      <p className={styles.period}>{periodLabel(summary.period)}<span>{timezoneLabel(summary.period.timezone)}</span></p>
      <ol className={styles.days} aria-label="요일별 러닝 횟수">
        {summary.days.map((day, index) => <li key={day.date} className={day.date === summary.period.today ? styles.today : undefined}
          aria-label={`${day.date} ${weekdays[index]}요일, 러닝 ${day.activityCount}회`}
          aria-current={day.date === summary.period.today ? "date" : undefined}>
          <span>{weekdays[index]}</span><b>{Number(day.date.slice(8, 10))}</b>
          <small className={day.activityCount ? styles.ran : undefined}>{day.activityCount ? `${day.activityCount}회` : "—"}</small>
        </li>)}
      </ol>
      <dl className={styles.metrics} aria-label="주간 합계">
        <div><dt>총 거리</dt><dd>{distanceLabel(summary.totals.distanceMeters)}<small>km</small></dd></div>
        <div><dt>러닝 횟수</dt><dd>{count}<small>회</small></dd></div>
        <div><dt>타이머 시간</dt><dd className={styles.duration}>{durationLabel(summary.totals.timerSeconds)}</dd></div>
        <div><dt>평균 페이스</dt><dd>{paceLabel(summary.totals.paceSecondsPerKm)}<small>/km</small></dd></div>
      </dl>
      {count === 0 ? <div className={styles.empty}><p>{week === "current" ? "이번 주에 저장된 러닝 기록이 없어요." : "지난주에 저장된 러닝 기록이 없어요."}</p>
        <span>지난주 가져오기를 마치면 저장된 기록이 여기에 표시돼요.</span></div>
        : <div className={styles.notes}>
          {summary.coverage.distanceCount < count && <p>{summary.coverage.distanceCount
            ? `거리는 값이 있는 ${summary.coverage.distanceCount}/${count}개 기록의 합계예요.` : "거리 정보가 없어 총 거리를 계산하지 않았어요."}</p>}
          {summary.coverage.timerCount < count && <p>{summary.coverage.timerCount
            ? `타이머 시간은 값이 있는 ${summary.coverage.timerCount}/${count}개 기록의 합계예요.` : "타이머 시간 정보가 없어 합계를 계산하지 않았어요."}</p>}
          {summary.coverage.paceCount < count && <p>{summary.coverage.paceCount
            ? `평균 페이스는 거리와 타이머 시간이 있는 ${summary.coverage.paceCount}/${count}개 기록 기준이에요.`
            : "거리와 타이머 시간이 있는 기록이 없어 평균 페이스를 계산하지 않았어요."}</p>}
          <p>정지 시간을 뺀 이동 시간과 타이머 시간은 달라요.</p>
        </div>}
      {detailed && count > 0 && <div className={styles.activitySection}>
        <h3>저장된 활동 <span>{count}개</span></h3>
        <ul className={styles.activities}>
          {summary.activities.map((activity) => {
            const date = new Intl.DateTimeFormat("ko-KR", { timeZone: summary.period.timezone,
              month: "numeric", day: "numeric", weekday: "short" }).format(new Date(activity.startedAt));
            const time = new Intl.DateTimeFormat("ko-KR", { timeZone: summary.period.timezone,
              hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(activity.startedAt));
            return <li key={activity.id}>
              <div className={styles.activityDate}><b>{date}</b><span>{time}</span></div>
              <div className={styles.activityMetric}><b>{distanceLabel(activity.distanceMeters)}<small>km</small></b><span>{durationLabel(activity.timerSeconds)}</span></div>
              <div className={styles.activityMetric}><b>{paceLabel(activity.paceSecondsPerKm)}</b><span>/km</span></div>
            </li>;
          })}
        </ul>
      </div>}
      <footer className={styles.footer}>
        <span>분석·업로드가 완료된 FIT 기록 기준</span>
        {detailed && summary.lastUpdatedAt && <span>마지막 저장 {new Intl.DateTimeFormat("ko-KR", {
          timeZone: summary.period.timezone, month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit",
        }).format(new Date(summary.lastUpdatedAt))}</span>}
        {!detailed && <Link href="/garmin-connect">활동 보기</Link>}
      </footer>
    </>}
  </section>;
}
