import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type AdminAccess = { userId: string; response?: never } | { userId?: never; response: Response };
const failure = (status: number, error: string): AdminAccess => ({ response: Response.json({ error }, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" } }) });

export function sameOrigin(request: Request): boolean {
  const url = new URL(request.url);
  return request.headers.get("origin") === `${url.protocol}//${request.headers.get("host") ?? url.host}`
    && request.headers.get("sec-fetch-site") !== "cross-site";
}

export async function requireAdmin(request: Request): Promise<AdminAccess> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer (\S+)$/i)?.[1];
  if (authorization && !token) return failure(401, "로그인이 필요합니다.");
  const adminId = process.env.TRAINI_ADMIN_USER_ID;
  if (!adminId) return failure(503, "관리자 계정 설정이 필요합니다.");
  // Cookie-authenticated mutations require a matching browser origin. Explicit
  // bearer clients remain supported; browser components use cookies only.
  if (!token && !["GET", "HEAD", "OPTIONS"].includes(request.method) && !sameOrigin(request))
    return failure(403, "요청 출처를 확인해 주세요.");
  try {
    const client = token ? getSupabaseAdmin() : await getSupabaseServerClient();
    const { data: { user }, error } = await client.auth.getUser(token);
    if (error || !user) {
      if (error && (error.status === 0 || (error.status ?? 0) >= 500 || error.name === "AuthRetryableFetchError"))
        return failure(503, "로그인 연결을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return failure(401, "로그인이 만료되었습니다.");
    }
    if (user.id !== adminId) return failure(403, "관리자 계정으로 로그인해 주세요.");
    return { userId: user.id };
  } catch {
    return failure(503, "로그인 확인에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  }
}
