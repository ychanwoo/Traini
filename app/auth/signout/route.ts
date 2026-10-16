import { getSupabaseServerClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/security/admin";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!sameOrigin(request)) return Response.json({ error: "요청 출처를 확인해 주세요." }, { status: 403, headers });
  try {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) return Response.json({ error: "로그아웃을 완료하지 못했습니다. 다시 시도해 주세요." }, { status: 503, headers });
    return Response.json({ signedOut: true }, { headers });
  } catch {
    return Response.json({ error: "로그아웃을 완료하지 못했습니다. 다시 시도해 주세요." }, { status: 503, headers });
  }
}
