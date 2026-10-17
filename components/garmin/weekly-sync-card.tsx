"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Check, ChevronRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { CollectionJob, CollectionSnapshot } from "@/lib/garmin/collection";
import { IMPORT_FINISHED_EVENT } from "@/lib/garmin/collection";
import styles from "./weekly-sync-card.module.css";

const messages: Record<string, string> = {
  auth_required: "Garmin 인증이 만료되었어요. Mac에서 다시 연결한 뒤 가져와 주세요.",
  rate_limited: "Garmin 요청이 잠시 제한됐어요. 잠시 후 다시 시도해 주세요.",
  connection: "Garmin에 연결하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.",
  storage: "기록을 저장하지 못했어요. Mac의 저장 공간과 폴더 권한을 확인해 주세요.",
  timeout: "가져오기가 예상보다 오래 걸려 중단됐어요. 다시 시도해 주세요.",
  interrupted: "이전 가져오기가 중단됐어요. 저장된 기록은 유지되니 다시 시도해 주세요.",
  collector_failed: "기록을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.",
  partial_download: "일부 원본을 가져오지 못했어요. 저장 결과를 확인하고 다시 시도해 주세요.",
  partial_parse: "일부 FIT 파일을 분석하지 못했어요. 원본은 유지되니 다시 시도해 주세요.",
  partial_upload: "일부 기록을 저장하지 못했어요. 저장된 기록은 반영했으니 다시 시도해 주세요.",
  parse_failed: "FIT 분석이 중단됐어요. 원본은 유지되니 다시 가져와 주세요.",
  upload_failed: "기록 저장을 마치지 못했어요. Mac의 분석 결과는 유지되니 다시 시도해 주세요.",
  upload_connection: "기록 저장 서버에 연결하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.",
  upload_setup_required: "기록 저장 설정을 확인해 주세요. Mac의 서버 설정이 필요해요.",
};

const stages = [
  { key: "collecting", label: "수집" },
  { key: "parsing", label: "분석" },
  { key: "uploading", label: "저장" },
] as const;

function stageState(job: CollectionJob, index: number): string {
  const failed = [job.counts.failed, job.parsing?.failed ?? 0, job.upload?.failed ?? 0][index];
  const position = stages.findIndex(({ key }) => key === (job.status === "failed" ? job.failedStage : job.stage));
  if (failed || (job.status === "failed" && position === index)) return "failed";
  if (job.status === "running" && position === index) return "active";
  if (job.status === "succeeded" || job.status === "partial" || position > index) return "complete";
  return "pending";
}

async function requestSnapshot(method: "GET" | "POST", signal?: AbortSignal): Promise<CollectionSnapshot> {
  const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
  if (!session) throw new Error("로그인이 만료되었어요. 다시 로그인해 주세요.");
  const response = await fetch("/api/garmin/sync", {
    method, credentials: "same-origin",
    cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  });
  if (response.status === 409) {
    const snapshot = await requestSnapshot("GET", signal);
    if (snapshot.job?.status === "running") return snapshot;
    throw new Error("Mac에서 다른 가져오기가 실행 중이에요. 완료 후 다시 시도해 주세요.");
  }
  if (response.status === 401 || response.status === 403) throw new Error("관리자 로그인 상태를 확인해 주세요.");
  if (!response.ok) throw new Error("가져오기 요청을 확인하지 못했어요. 상태를 새로 확인해 주세요.");
  return response.json() as Promise<CollectionSnapshot>;
}

function periodLabel(start: string, end: string): string {
  const label = (value: string) => `${Number(value.slice(5, 7))}.${Number(value.slice(8, 10))}`;
  return `${label(start)} 월 – ${label(end)} 일`;
}

function timeLabel(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: timezone, month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function isCurrentJob(job: CollectionJob | null | undefined, snapshot: CollectionSnapshot | null): boolean {
  return Boolean(job && snapshot && job.period.start === snapshot.period.start && job.period.end === snapshot.period.end && job.period.timezone === snapshot.period.timezone);
}

export function WeeklySyncCard({ detailed = false }: { detailed?: boolean }) {
  const [snapshot, setSnapshot] = useState<CollectionSnapshot | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const notified = useRef<string | null>(null);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const next = await requestSnapshot("GET", signal);
    if (mounted.current) { setSnapshot(next); setError(null); }
    return next;
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void refresh(controller.signal).catch(() => {
      if (!controller.signal.aborted) setError("기록 상태를 불러오지 못했어요. 다시 확인해 주세요.");
    }).finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => { mounted.current = false; controller.abort(); };
  }, [refresh]);

  const [matchingState, setMatchingState] = useState<
    "checking" | "done" | "error" | null
  >(null);
  const reconcileMatches = useCallback(async (signal?: AbortSignal) => {
    if (mounted.current) setMatchingState("checking");
    try {
      const response = await fetch("/api/training/match/reconcile", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
          : AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (result.failed !== 0) throw new Error();
      if (mounted.current && !signal?.aborted) {
        setMatchingState("done");
        window.dispatchEvent(new Event("traini:plan-changed"));
      }
    } catch {
      if (mounted.current && !signal?.aborted) setMatchingState("error");
    }
  }, []);
  const running = snapshot?.job?.status === "running";
  const latestJob = snapshot?.job;
  const importedJobId =
    latestJob && latestJob.status !== "running" && latestJob.uploadStarted
      ? latestJob.id
      : null;
  useEffect(() => {
    if (!importedJobId || notified.current === importedJobId) return;
    notified.current = importedJobId;
    window.dispatchEvent(new Event(IMPORT_FINISHED_EVENT));
    const controller = new AbortController();
    void reconcileMatches(controller.signal);
    return () => {
      controller.abort();
      notified.current = null;
    };
  }, [importedJobId, reconcileMatches]);

  useEffect(() => {
    const onFocus = () => { if (inFlight.current) return; void refresh().catch(() => {}); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try { await refresh(controller.signal); }
      catch { if (!cancelled) setError("연결이 잠시 끊겼어요. 가져오기 상태를 다시 확인하고 있어요."); }
      if (!cancelled) timer = setTimeout(() => void poll(), 2_000);
    };
    timer = setTimeout(() => void poll(), 1_500);
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [running, refresh]);

  const start = async () => {
    if (inFlight.current || running) return;
    inFlight.current = true;
    setRequesting(true);
    setError(null);
    try {
      const next = await requestSnapshot("POST");
      if (mounted.current) setSnapshot(next);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "다시 시도해 주세요.";
      // The request may have reached the worker even when the response was lost.
      try {
        const next = await requestSnapshot("GET");
        if (mounted.current) { setSnapshot(next); setError(next.job?.status === "running" ? null : message); }
      } catch { if (mounted.current) setError(message); }
    } finally {
      inFlight.current = false;
      if (mounted.current) setRequesting(false);
    }
  };

  const current = isCurrentJob(snapshot?.job, snapshot) ? snapshot?.job : null;
  const job = snapshot?.job;
  const counts = current?.counts;
  const upload = current?.upload;
  const failureCount = (counts?.failed ?? 0) + (current?.parsing?.failed ?? 0) + (upload?.failed ?? 0);
  const busy = running || requesting;
  const succeeded = current?.version === 2 && current.status === "succeeded";
  const jobMessage = job?.errorCode ? messages[job.errorCode] : null;
  const notice = snapshot?.notice === "local_only" ? "Mac에서 실행 중인 Traini에서 가져올 수 있어요."
    : snapshot?.notice === "setup_required" ? "Mac에 Garmin 수집기를 먼저 설치해 주세요."
    : snapshot?.notice === "upload_setup_required" ? messages.upload_setup_required
    : snapshot?.notice === "timezone_invalid" ? "훈련 시간대 설정이 유효하지 않아요. Mac의 서버 설정을 확인해 주세요."
    : snapshot?.notice === "status_unavailable" ? "이전 결과를 읽지 못했어요. 다시 가져와 확인할 수 있어요." : null;
  const timezoneLabel = snapshot?.period.timezone === "America/Los_Angeles" ? "태평양 시간 기준" : snapshot?.period.timezone.replaceAll("_", " ").split("/").pop();

  return <section className={styles.card} aria-label="Garmin 주간 기록 가져오기">
    <div className={styles.heading}>
      <div><h2>지난주 러닝</h2><p>{snapshot ? periodLabel(snapshot.period.start, snapshot.period.end) : "월요일부터 일요일까지"}<span>{timezoneLabel}</span></p></div>
      <span className={`${styles.badge} ${busy ? styles.pending : succeeded ? styles.complete : ""}`}>
        {busy ? <RefreshCw className={styles.spinning} aria-hidden="true" /> : succeeded ? <Check aria-hidden="true" /> : <span className={styles.dot} />}
        {busy ? "가져오는 중" : succeeded ? "가져옴" : "Garmin"}
      </span>
    </div>
    {current?.version === 2 && <ol className={styles.stages} aria-label="가져오기 진행 단계">
      {stages.map(({ key, label }, index) => {
        const state = stageState(current, index);
        return <li key={key} data-state={state} aria-current={state === "active" ? "step" : undefined}>
          <span>{state === "complete" ? <Check aria-hidden="true" /> : index + 1}</span>{label}
          <small>{state === "active" ? "진행 중" : state === "complete" ? "완료" : state === "failed" ? "확인 필요" : "대기"}</small>
        </li>;
      })}
    </ol>}
    {counts && (current?.version === 1 || current?.uploadStarted) && <dl className={styles.counts} aria-label={upload ? "지난주 기록 저장 결과" : "이전 원본 다운로드 결과"}>
      <div><dt>{upload ? "저장·갱신" : "원본 다운로드"}</dt><dd>{upload ? upload.inserted + upload.updated : counts.downloaded}<small>개</small></dd></div>
      <div><dt>기존 기록</dt><dd>{upload ? upload.unchanged : counts.skipped}<small>개</small></dd></div>
      <div><dt>실패</dt><dd className={failureCount ? styles.failed : undefined}>{failureCount}<small>개</small></dd></div>
    </dl>}
    <div aria-live="polite" aria-atomic="true" className={styles.status}>
      {busy ? <p>{job?.stage === "authenticating" ? "Garmin 연결을 확인하고 있어요."
        : job?.stage === "parsing" ? `FIT 파일을 분석하고 있어요. ${(job.parsing?.processed ?? 0) + (job.parsing?.skipped ?? 0)}/${job.parsing?.found ?? 0}개 확인`
        : job?.stage === "uploading" ? "분석된 기록을 저장하고 있어요. 완료 후 주간 요약을 갱신해요."
        : "지난주 러닝 기록을 확인하고 있어요."}</p>
        : error ? <p role="alert" className={styles.failed}>{error}</p>
        : notice ? <p>{notice}</p>
        : jobMessage ? <p className={styles.failed}>{jobMessage}</p>
        : succeeded ? <p>{counts?.found === 0 ? "지난주에 기록된 러닝이 없어요." : `러닝 ${upload ? upload.inserted + upload.updated + upload.unchanged : 0}개를 저장·확인했어요. 주간 요약에 반영돼요.`}</p>
        : current?.version === 1 ? <p>이전 원본 다운로드 결과예요. 다시 가져오면 분석과 저장까지 진행해요.</p>
        : <p>러닝 기록을 가져와 분석하고 주간 요약에 반영해요.</p>}
    </div>
      {matchingState && (
        <div className={styles.status} aria-live="polite">
          <p role={matchingState === "error" ? "alert" : undefined}>
            {matchingState === "checking"
              ? "저장된 러닝과 최근 훈련계획을 연결하고 있어요."
              : matchingState === "done"
                ? "훈련계획과 Garmin 기록의 연결을 확인했어요."
                : "훈련 연결 확인이 지연됐어요. 가져오기 결과는 유지돼요."}
          </p>
          {matchingState === "error" && (
            <button type="button" onClick={() => void reconcileMatches()}>
              훈련 연결 다시 확인
            </button>
          )}
        </div>
      )}
    <button type="button" className={styles.button} disabled={checking || busy || !snapshot?.available} onClick={() => void start()} aria-busy={Boolean(busy)}>
      {busy ? <RefreshCw className={styles.spinning} aria-hidden="true" /> : <ArrowDownToLine aria-hidden="true" />}
      {checking ? "상태 확인 중" : busy ? "지난주 기록 가져오는 중" : "지난주 가져오기"}
    </button>
    <div className={styles.footer}>
      <span>{job?.finishedAt ? `마지막 실행 ${timeLabel(job.finishedAt, job.period.timezone)}` : "이미 받은 기록은 중복 저장하지 않아요."}</span>
      {!detailed && <Link href="/garmin-connect">관리<ChevronRight aria-hidden="true" /></Link>}
      {error && !running && <button type="button" onClick={() => { void refresh().catch(() => setError("연결을 확인하고 다시 시도해 주세요.")); }}>상태 새로고침</button>}
    </div>
    {job?.errorCode === "auth_required" && <details className={styles.reconnect}><summary>Garmin 다시 연결하기</summary><p>Mac의 Traini 프로젝트 터미널에서 아래 명령을 실행한 뒤 다시 가져와 주세요. 비밀번호는 이 화면에서 입력하지 않아요.</p><code>collector/.venv/bin/traini-collect --login</code></details>}
  </section>;
}
