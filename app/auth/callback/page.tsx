"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ensureProfile } from "@/lib/supabase/profile";
import { AdminSessionError, verifyAdminSession } from "@/lib/supabase/admin-session";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [authError, setAuthError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const finishLogin = async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: { session }, error } = await supabase.auth.getSession();
        if (!active) return;
        if (error || !session) { router.replace("/login?error=oauth"); return; }
        await verifyAdminSession(session);
        if (!active) return;
        await ensureProfile(session.user);
        if (active) router.replace("/today");
      } catch (error) {
        if (!active) return;
        if (error instanceof AdminSessionError && (error.status === 401 || error.status === 403)) {
          await getSupabaseBrowserClient().auth.signOut({ scope: "local" });
          if (active) router.replace("/login?error=admin");
        } else {
          setAuthError("로그인 확인에 실패했습니다. 설정과 연결 상태를 확인한 뒤 다시 시도해 주세요.");
        }
      }
    };
    void finishLogin();
    return () => { active = false; };
  }, [router]);
  if (authError) return <main className="app-frame auth-state"><p role="alert">{authError}</p><button className="primary-button" onClick={() => router.replace("/login")}>로그인으로 돌아가기</button></main>;
  return <main className="auth-loading" role="status" aria-label="관리자 로그인 처리 중" />;
}
