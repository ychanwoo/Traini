"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import Image from "next/image";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { AdminSessionError, verifyAdminSession } from "@/lib/supabase/admin-session";

function destination(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  const routes = ["/today", "/schedule", "/roadmap", "/my", "/goal-setting", "/running-analysis", "/garmin-connect"];
  return next && (routes.includes(next) || next.startsWith("/my/")) ? next : "/today";
}

export function AdminLogin() {
  const router = useRouter();
  const [busy, setBusy] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const initialise = async () => {
      try {
        const error = new URLSearchParams(window.location.search).get("error");
        if (error && active) setAuthError(error === "admin"
          ? "등록된 관리자 Google 계정으로 로그인해 주세요."
          : "Google 로그인을 완료하지 못했습니다. 다시 시도해 주세요.");
        const supabase = getSupabaseBrowserClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || !active) return;
        await verifyAdminSession(session);
        if (active) router.replace(destination());
      } catch (error) {
        if (!active) return;
        if (error instanceof AdminSessionError && (error.status === 401 || error.status === 403)) {
          await getSupabaseBrowserClient().auth.signOut({ scope: "local" });
        }
        if (active) setAuthError(error instanceof AdminSessionError
          ? error.message : "로그인 연결을 확인하지 못했습니다. 다시 시도해 주세요.");
      } finally {
        if (active) setBusy(false);
      }
    };
    void initialise();
    return () => { active = false; };
  }, [router]);

  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    setAuthError(null);
    try {
      const { error } = await getSupabaseBrowserClient().auth.signInWithOAuth({
        provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
    } catch {
      setAuthError("Google 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setBusy(false);
    }
  };

  return <div className="app-frame"><main className="admin-login">
    <div className="login-logo-window"><Image alt="Traini" src="/images/brand/traini-logo.png" width={88} height={48} unoptimized /></div>
    <section className="admin-login-intro">
      <span className="admin-login-label">PERSONAL TRAINING</span>
      <h1>나의 목표에 맞춘,<br />이번 주의 한 걸음</h1>
      <p>쌓아온 러닝 기록을 돌아보고<br />다음 훈련을 준비하는 나만의 공간.</p>
    </section>
    <div className="admin-login-image"><Image alt="러닝화" src="/images/login-running-shoes.jpg" width={238} height={238} unoptimized priority /></div>
    <div className="admin-login-actions">
      <p className="admin-login-access"><ShieldCheck aria-hidden="true" />관리자 전용 공간</p>
      <button className="auth-button auth-button-google" onClick={() => void signIn()} disabled={busy} aria-busy={busy}>
        <span className="auth-button-content"><Image src="/icons/google.svg" alt="" aria-hidden="true" width={18} height={18} unoptimized /><span>{busy ? "로그인 확인 중…" : "Google로 계속하기"}</span></span>
      </button>
      {authError && <p className="auth-error" role="alert">{authError}</p>}
      <p className="admin-login-note">등록된 Google 계정으로 로그인해 주세요.</p>
    </div>
  </main></div>;
}
