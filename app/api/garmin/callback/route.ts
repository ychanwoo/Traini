import { requireAdmin } from "@/lib/security/admin";
export async function GET(request: Request) {
  const access = await requireAdmin(request);
  if (access.response) return access.response;
  return Response.json({ error: "Garmin OAuth 콜백은 더 이상 사용하지 않습니다." }, { status: 410, headers: { "Cache-Control": "private, no-store" } });
}
