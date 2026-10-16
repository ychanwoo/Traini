import { requireAdmin } from "@/lib/security/admin";
// The personal service uses the local collector, not the unapproved OAuth flow.
export async function GET(request: Request) {
  const access = await requireAdmin(request);
  if (access.response) return access.response;
  return Response.json({ error: "Garmin OAuth 연동은 종료되었습니다. 지난주 가져오기를 이용해 주세요." }, { status: 410, headers: { "Cache-Control": "private, no-store" } });
}
