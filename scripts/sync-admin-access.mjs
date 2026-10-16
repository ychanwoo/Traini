import { createClient } from "@supabase/supabase-js";

// Explicit setup command: synchronize the private server allowlist with DB RLS.
try {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const id = process.env.TRAINI_ADMIN_USER_ID;
  if (!url || new URL(url).hostname !== "kmmutfcgshellvjgpick.supabase.co" || !key || !/^[0-9a-f-]{36}$/i.test(id ?? ""))
    throw new Error("Traini Supabase 설정과 관리자 UUID를 확인해 주세요.");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.auth.admin.getUserById(id);
  if (error || !data.user?.app_metadata.providers?.includes("google")) throw new Error("등록된 Google 관리자 계정을 확인하지 못했습니다.");
  const { error: saveError } = await db.from("traini_admin_config").upsert({ singleton: true, user_id: id }, { onConflict: "singleton" });
  if (saveError) throw new Error("관리자 DB 정책 설정에 실패했습니다. 마이그레이션 적용 여부를 확인해 주세요.");
  console.log("서버 관리자와 Supabase 접근 정책을 동기화했습니다.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "관리자 정책 설정에 실패했습니다.");
  process.exitCode = 1;
}
