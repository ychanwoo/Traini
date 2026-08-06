"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ensureProfile } from "@/lib/supabase/profile";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function AuthCallbackPage() {
  const router = useRouter();
  useEffect(() => {
    const finishLogin = async () => {
      const { data: { user } } = await getSupabaseBrowserClient().auth.getUser();
      if (!user) { router.replace("/login?error=oauth"); return; }
      try { await ensureProfile(user); } finally { router.replace("/garmin-connect"); }
    };
    void finishLogin();
  }, [router]);
  return <main className="auth-loading" aria-label="로그인 처리 중" />;
}
