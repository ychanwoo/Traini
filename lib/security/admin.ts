import { getSupabaseAdmin } from "@/lib/supabase/admin";

type AdminAccess = { userId: string; response?: never } | { userId?: never; response: Response };

export async function requireAdmin(request: Request): Promise<AdminAccess> {
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return { response: Response.json({ error: "로그인이 필요합니다." }, { status: 401 }) };
  const adminId = process.env.TRAINI_ADMIN_USER_ID;
  if (!adminId) return { response: Response.json({ error: "관리자 계정 설정이 필요합니다." }, { status: 503 }) };
  try {
    const { data: { user }, error } = await getSupabaseAdmin().auth.getUser(token);
    if (error || !user) return { response: Response.json({ error: "로그인이 만료되었습니다." }, { status: 401 }) };
    if (user.id !== adminId) return { response: Response.json({ error: "관리자 계정으로 로그인해 주세요." }, { status: 403 }) };
    return { userId: user.id };
  } catch {
    return { response: Response.json({ error: "로그인 확인에 실패했습니다. 잠시 후 다시 시도해 주세요." }, { status: 503 }) };
  }
}
