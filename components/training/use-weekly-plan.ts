"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { PlanWeek, StoredPlan } from "@/lib/training/weekly-plan";
export type PlanState = {
  period: { start: string; end: string; today: string; timezone: string };
  plan: StoredPlan | null;
  races?: import("@/lib/training/goal").RaceGoal[];
  generating: boolean;
  generationError: string | null;
  inputsChanged: boolean;
};
import { IMPORT_FINISHED_EVENT } from "@/lib/garmin/collection";
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
    credentials: "same-origin",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.any([
      signal,
      AbortSignal.timeout(path === "generate" ? 240_000 : 25_000),
    ]),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? "훈련계획 요청을 완료하지 못했어요.");
  return data;
}
export function useWeeklyPlan(week: PlanWeek | "previous") {
  const [data, setData] = useState<PlanState | null>(null),
    [error, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
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
        setReadError(null);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setLoading(false);
        setReadError(
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
    window.addEventListener(IMPORT_FINISHED_EVENT, listener);
    return () => {
      mounted = false;
      clearInterval(timer);
      read.current?.abort();
      window.removeEventListener("focus", listener);
      window.removeEventListener(EVENT, listener);
      window.removeEventListener(IMPORT_FINISHED_EVENT, listener);
    };
  }, [refresh, generating]);
  useEffect(
    () => () => {
      action.current?.abort();
    },
    [],
  );
  async function mutate(
    kind: "generate" | "complete" | "match" | "feedback",
    workoutId?: string,
    match?: { revision: string; activityIds: string[] },
    feedback?: import("@/lib/training/workout-feedback").FeedbackInput,
  ) {
    if (inFlight.current) return false;
    inFlight.current = true;
    read.current?.abort();
    setError(null);
    if (kind === "generate") setBusy(true);
    else setCompleting(true);
    const controller = new AbortController();
    action.current = controller;
    let saved = false;
    try {
      if (kind === "generate") {
        const result = await request<PlanState>("generate", controller.signal, {
          week,
        });
        if (!controller.signal.aborted) setData(result);
      } else if (kind === "feedback")
        await request("feedback", controller.signal, feedback);
      else if (kind === "match")
        await request("match", controller.signal, { workoutId, ...match });
      else await request("complete", controller.signal, { workoutId });
      saved = true;
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
    return saved;
  }
  return {
    data,
    error: error ?? readError,
    loading,
    busy,
    completing,
    refresh,
    feedback: (
      input: import("@/lib/training/workout-feedback").FeedbackInput,
    ) => mutate("feedback", input.workoutId, undefined, input),
    generate: () => mutate("generate"),
    complete: (id: string) => mutate("complete", id),
    match: (id: string, revision: string, activityIds: string[]) =>
      mutate("match", id, { revision, activityIds }),
  };
}
