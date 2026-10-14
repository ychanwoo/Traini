"use client";

import type { Session } from "@supabase/supabase-js";

export class AdminSessionError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export async function verifyAdminSession(session: Session): Promise<void> {
  const response = await fetch("/api/admin/session", {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: "로그인이 만료되었습니다. 다시 로그인해 주세요.",
      403: "등록된 관리자 Google 계정으로 로그인해 주세요.",
      503: "관리자 설정 또는 인증 연결을 확인해 주세요.",
    };
    throw new AdminSessionError(response.status, messages[response.status] ?? "로그인 확인에 실패했습니다.");
  }
}
