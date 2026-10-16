"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { PlanWeek, StoredPlan } from "@/lib/training/weekly-plan";
export type PlanState = {
  period: { start: string; end: string; today: string; timezone: string };
  plan: StoredPlan | null;
  generating: boolean;
  generationError: string | null;
  inputsChanged: boolean;
};
const EVENT = "traini:plan-changed";
async function request<T>(
  path: string,
  signal: AbortSignal,
  body?: unknown,
): Promise<T> {
  const {
    data: { session },
  } = await getSupabaseBrowserClient().auth.getSession();
  if (!session) throw new Error("관리자 로그인 상태를 확인해 주세요.");
  const response = await fetch(`/api/training/${path}`, {
    method: body ? "POST" : "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.any([
      signal,
      AbortSignal.timeout(body ? 240_000 : 20_000),
    ]),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? "훈련계획 요청을 완료하지 못했어요.");
  return data;
}
export function useWeeklyPlan(week: PlanWeek) {
  const [data, setData] = useState<PlanState | null>(null),
    [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [completing, setCompleting] = useState(false);
  const action = useRef<AbortController | null>(null),
    read = useRef<AbortController | null>(null),
    inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    try {
      const result = await request<PlanState>(
        `plan?week=${week}`,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setData(result);
        setLoading(false);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setLoading(false);
        setError(
          err instanceof Error ? err.message : "계획을 불러오지 못했어요.",
        );
      }
    }
  }, [week]);
  const generating = Boolean(data?.generating);
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (mounted) void refresh();
    });
    const timer = setInterval(() => void refresh(), generating ? 2000 : 60_000);
    const listener = () => void refresh();
    window.addEventListener("focus", listener);
    window.addEventListener(EVENT, listener);
    return () => {
      mounted = false;
      clearInterval(timer);
      read.current?.abort();
      window.removeEventListener("focus", listener);
      window.removeEventListener(EVENT, listener);
    };
  }, [refresh, generating]);
  useEffect(
    () => () => {
      action.current?.abort();
    },
    [],
  );
  async function mutate(kind: "generate" | "complete", workoutId?: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    read.current?.abort();
    setError(null);
    if (kind === "generate") setBusy(true);
    else setCompleting(true);
    const controller = new AbortController();
    action.current = controller;
    try {
      if (kind === "generate") {
        const result = await request<PlanState>("generate", controller.signal, {
          week,
        });
        if (!controller.signal.aborted) setData(result);
      } else await request("complete", controller.signal, { workoutId });
    } catch (err) {
      if (!controller.signal.aborted)
        setError(
          err instanceof Error
            ? err.message
            : "결과를 확인하지 못했어요. 새로고침해 주세요.",
        );
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) {
        setBusy(false);
        setCompleting(false);
        void refresh();
        window.dispatchEvent(new Event(EVENT));
      }
    }
  }
  return {
    data,
    error,
    loading,
    busy,
    completing,
    refresh,
    generate: () => mutate("generate"),
    complete: (id: string) => mutate("complete", id),
  };
}
