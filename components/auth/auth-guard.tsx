"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ensureProfile } from "@/lib/supabase/profile";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let active = true;
    const redirectToLogin = () => router.replace(`/login?next=${encodeURIComponent(pathname)}`);

    const initialise = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!active) return;
      if (!user) { redirectToLogin(); return; }
      try { await ensureProfile(user); } catch { /* Profile retry is safe on the next authenticated request. */ }
      if (active) setReady(true);
    };
    void initialise();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) redirectToLogin();
      else if (active) setReady(true);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [pathname, router]);

  if (!ready) return <div className="auth-loading" aria-label="로그인 상태 확인 중" />;
  return <>{children}</>;
}
