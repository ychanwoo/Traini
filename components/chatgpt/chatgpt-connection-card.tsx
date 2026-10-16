"use client";
import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ChatGPTStatus } from "@/lib/chatgpt/connection";
import styles from "./chatgpt-connection.module.css";

const errors: Record<string, string> = {
  timeout: "승인 시간이 만료됐어요. 다시 연결해 주세요.",
  denied: "연결 승인을 취소했어요. 원할 때 다시 연결할 수 있어요.",
  identity:
    "계정 확인에 실패했어요. 기존에 연결한 ChatGPT 계정으로 다시 시도해 주세요.",
  permission: "ChatGPT 구독 사용 권한이 필요해요. 다시 연결해서 승인해 주세요.",
  network: "연결 확인 중 네트워크 오류가 발생했어요. 다시 확인해 주세요.",
  models:
    "사용 가능한 모델을 찾지 못했어요. 구독 상태와 계정 권한을 확인해 주세요.",
};
async function request<T>(signal: AbortSignal, action?: string): Promise<T> {
  const {
    data: { session },
  } = await getSupabaseBrowserClient().auth.getSession();
  if (!session) throw new Error("관리자 로그인 상태를 확인해 주세요.");
  const response = await fetch("/api/chatgpt/connection", {
    method: action ? "POST" : "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      ...(action ? { "Content-Type": "application/json" } : {}),
    },
    body: action ? JSON.stringify({ action }) : undefined,
    signal: AbortSignal.any([signal, AbortSignal.timeout(40_000)]),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? "ChatGPT 연결 상태를 확인하지 못했어요.");
  return data;
}
export function ChatGPTConnectionCard() {
  const [status, setStatus] = useState<ChatGPTStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const actionController = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const result = await request<ChatGPTStatus>(controller.signal);
        if (controller.signal.aborted) return;
        setStatus(result);
        setError(null);
        if (result.pending) timer = setTimeout(() => void read(), 2000);
        else setAuthorizeUrl(null);
      } catch (err) {
        if (!controller.signal.aborted)
          setError(
            err instanceof Error
              ? err.message
              : "연결 상태를 확인하지 못했어요.",
          );
      }
    }
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [revision]);
  useEffect(() => () => actionController.current?.abort(), []);
  async function run(action: "connect" | "check" | "disconnect") {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    actionController.current = controller;
    try {
      if (action === "connect") {
        const result = await request<{ authorizeUrl: string }>(
          controller.signal,
          action,
        );
        const url = new URL(result.authorizeUrl);
        if (
          url.origin !== "https://auth.openai.com" ||
          url.pathname !== "/api/accounts/authorize"
        )
          throw new Error("승인 주소를 확인하지 못했어요.");
        if (controller.signal.aborted) return;
        setCopied(false);
        setAuthorizeUrl(url.toString());
        setRevision((n) => n + 1);
      } else {
        const result = await request<ChatGPTStatus>(controller.signal, action);
        if (!controller.signal.aborted) setStatus(result);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(
          err instanceof Error ? err.message : "연결 요청을 완료하지 못했어요.",
        );
      }
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const pending = status?.pending || Boolean(authorizeUrl);
  return (
    <section
      className={styles.card}
      aria-labelledby="chatgpt-connection-heading"
    >
      <div className={styles.heading}>
        <h2 id="chatgpt-connection-heading">ChatGPT 연결</h2>
        <span>
          {status?.connected ? "연결됨" : pending ? "승인 대기" : "연결 전"}
        </span>
      </div>
      <p className={styles.note}>
        사용 중인 ChatGPT 계정을 연결해 훈련계획 생성을 준비해요.
      </p>
      <div aria-live="polite">
        {status?.connected && (
          <p className={styles.account}>
            {status.email ?? "ChatGPT 계정"}
            <br />
            <small>
              {status.models.length
                ? `${status.models.length}개 모델 사용 가능 · 연결 확인 완료`
                : "계정 연결 완료 · 모델 확인 필요"}
            </small>
          </p>
        )}
        {pending && (
          <p className={styles.note}>
            10분 안에 OpenAI 화면에서 로그인과 권한 승인을 마쳐 주세요.
          </p>
        )}
        {(error || status?.error) && (
          <p className={styles.error} role="alert">
            {error ??
              errors[status!.error!] ??
              "연결 확인을 완료하지 못했어요. 다시 시도해 주세요."}
          </p>
        )}
      </div>
      <div className={styles.actions}>
        {authorizeUrl ? (
          <a
            className={styles.primary}
            href={authorizeUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Continue with ChatGPT
          </a>
        ) : (
          <button
            className={styles.primary}
            type="button"
            disabled={busy || !status}
            onClick={() => void run("connect")}
          >
            {busy
              ? "처리 중…"
              : pending
                ? "연결 이어하기"
                : status?.connected
                  ? "ChatGPT 다시 연결"
                  : "ChatGPT 연결 준비"}
          </button>
        )}
        {authorizeUrl && (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                .writeText(authorizeUrl)
                .then(() => setCopied(true))
                .catch(() => {
                  setError(
                    "링크를 복사하지 못했어요. Continue with ChatGPT 버튼을 길게 누르거나 우클릭해 링크 주소를 복사해 주세요.",
                  );
                });
            }}
          >
            {copied ? "복사 완료" : "승인 링크 복사"}
          </button>
        )}
        {status?.connected && !pending && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run("check")}
            >
              연결 확인
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run("disconnect")}
            >
              연결 해제
            </button>
          </>
        )}
        {(!status || error) && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setError(null);
              setRevision((n) => n + 1);
            }}
          >
            다시 확인
          </button>
        )}
      </div>
      {authorizeUrl && (
        <p className={styles.note} role="status">
          {copied
            ? "링크를 Safari 또는 Chrome 주소창에 붙여 넣어 주세요."
            : "내장 브라우저에서 로그인 오류가 나면 링크를 복사해 Safari 또는 Chrome에서 열어 주세요."}
        </p>
      )}
      <p className={styles.footnote}>
        처음 연결은 이 Mac의 localhost에서 진행해 주세요. 계정에 허용된 구독
        한도를 사용하며, 연결만으로 훈련계획을 생성하지는 않아요.
      </p>
    </section>
  );
}
