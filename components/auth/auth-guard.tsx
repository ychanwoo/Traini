"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { ProgressProvider } from "@/components/training/use-progress";
import { ensureProfile } from "@/lib/supabase/profile";
import {
  AdminSessionError,
  verifyAdminSession,
} from "@/lib/supabase/admin-session";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const verifiedUser = useRef<string | null>(null);
  const [identity, setIdentity] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let revision = 0;
    const supabase = getSupabaseBrowserClient();
    const verify = async (session: Session | null) => {
      const current = ++revision;
      const sameUser = !!session && verifiedUser.current === session.user.id;
      if (!sameUser) {
        verifiedUser.current = null;
        setIdentity(null);
        setReady(false);
      }
      setAuthError(null);
      if (!session) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }
      try {
        await verifyAdminSession();
        if (!active || current !== revision) return;
        if (!sameUser) await ensureProfile(session.user);
        if (active && current === revision) {
          verifiedUser.current = session.user.id;
          setIdentity(session.user.id);
          setReady(true);
        }
      } catch (error) {
        if (!active || current !== revision) return;
        verifiedUser.current = null;
        setIdentity(null);
        setReady(false);
        if (
          error instanceof AdminSessionError &&
          (error.status === 401 || error.status === 403)
        ) {
          await supabase.auth.signOut({ scope: "local" });
          if (active) router.replace("/login?error=admin");
        } else {
          setAuthError(
            "로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
          );
        }
      }
    };
    void supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (active) void verify(session);
      })
      .catch(() => {
        if (active) setAuthError("로그인 상태를 확인하지 못했습니다.");
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      // Defer SDK calls until its auth callback releases the internal lock.
      queueMicrotask(() => {
        if (active) void verify(session);
      });
    });
    return () => {
      active = false;
      revision++;
      subscription.unsubscribe();
    };
  }, [pathname, router, attempt]);

  if (authError)
    return (
      <main className="app-frame auth-state">
        <p role="alert">{authError}</p>
        <button
          className="primary-button"
          onClick={() => setAttempt((value) => value + 1)}
        >
          다시 확인하기
        </button>
      </main>
    );
  if (!ready)
    return (
      <div
        className="auth-loading"
        role="status"
        aria-label="관리자 로그인 상태 확인 중"
      />
    );
  return <ProgressProvider key={identity}>{children}</ProgressProvider>;
}
