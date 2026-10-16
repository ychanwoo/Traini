"use client";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { GoalIssue } from "./goal";
export const GOAL_SAVED_EVENT = "traini:goal-saved";
export class TrainingRequestError extends Error {
  constructor(
    message: string,
    public readonly issues: GoalIssue[] = [],
  ) {
    super(message);
  }
}
export async function trainingRequest<T>(
  path: "goal" | "context",
  signal: AbortSignal,
  body?: unknown,
): Promise<T> {
  const {
    data: { session },
  } = await getSupabaseBrowserClient().auth.getSession();
  if (!session)
    throw new TrainingRequestError(
      "로그인이 만료됐어요. 다시 로그인해 주세요.",
    );
  const response = await fetch(`/api/training/${path}`, {
    method: body === undefined ? "GET" : "PUT",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  const data = await response.json();
  if (!response.ok)
    throw new TrainingRequestError(
      response.status === 401 || response.status === 403
        ? "관리자 로그인 상태를 확인해 주세요."
        : (data.error ?? "요청을 처리하지 못했어요."),
      data.issues ?? [],
    );
  return data as T;
}
