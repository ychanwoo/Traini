"use client";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ApiRequestError,
  ReadRequestGate,
  requestJson,
} from "@/lib/http/client-request";
import { IMPORT_FINISHED_EVENT } from "@/lib/garmin/collection";
import { GOAL_SAVED_EVENT } from "@/lib/training/client";
import { dateInZone } from "@/lib/garmin/running-summary";
import type { ProgressInsights } from "@/lib/training/progress";

function useProgressResource(enabled: boolean) {
  const [data, setData] = useState<ProgressInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<ProgressInsights | null>(null);
  const gate = useRef(new ReadRequestGate());
  const queued = useRef(false);
  const refresh = useCallback(async function refreshProgress(
    invalidate = false,
  ): Promise<void> {
    const c = gate.current.start();
    if (!c) {
      if (invalidate) queued.current = true;
      return;
    }
    // A new local date must not be shown under yesterday's "this week" label.
    if (
      latest.current &&
      latest.current.asOfDate !==
        dateInZone(new Date(), latest.current.timezone)
    ) {
      latest.current = null;
      setData(null);
    }
    setLoading(true);
    try {
      const body = await requestJson<ProgressInsights>(
        "/api/training/progress",
        { signal: c.signal, timeoutMs: 45000 },
      );
      if (
        !body ||
        typeof body.asOfDate !== "string" ||
        typeof body.timezone !== "string" ||
        !body.current ||
        !body.totals ||
        !Array.isArray(body.weeks) ||
        !Array.isArray(body.races)
      )
        throw new Error("진행 데이터 형식을 확인하지 못했어요.");
      if (!c.signal.aborted) {
        latest.current = body;
        setData(body);
        setError(null);
      }
    } catch (e) {
      if (!c.signal.aborted) {
        if (e instanceof ApiRequestError && [401, 403].includes(e.status)) {
          latest.current = null;
          setData(null);
        }
        setError(
          e instanceof Error ? e.message : "진행 데이터를 불러오지 못했어요.",
        );
      }
    } finally {
      gate.current.finish(c);
      if (!c.signal.aborted) {
        setLoading(false);
        if (queued.current) {
          queued.current = false;
          queueMicrotask(() => void refreshProgress());
        }
      }
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const reads = gate.current;
    let active = true;
    queueMicrotask(() => {
      if (active) void refresh();
    });
    const listener = (event?: Event) =>
      void refresh(!!event && event.type !== "focus");
    const events = [
      "focus",
      IMPORT_FINISHED_EVENT,
      GOAL_SAVED_EVENT,
      "traini:plan-changed",
    ];
    events.forEach((e) => window.addEventListener(e, listener));
    const timer = setInterval(listener, 60000);
    return () => {
      active = false;
      queued.current = false;
      reads.abort();
      clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, listener));
    };
  }, [enabled, refresh]);
  return { data, loading, error, refresh };
}
const ProgressContext = createContext<ReturnType<
  typeof useProgressResource
> | null>(null);
/** Scoped to a verified identity; no localStorage or cross-session module cache. */
export function ProgressProvider({ children }: { children: ReactNode }) {
  const state = useProgressResource(true);
  return (
    <ProgressContext.Provider value={state}>
      {children}
    </ProgressContext.Provider>
  );
}
export function useProgress() {
  const shared = useContext(ProgressContext);
  const local = useProgressResource(!shared);
  return shared ?? local;
}
