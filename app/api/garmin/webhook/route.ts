import { requireAdmin } from "@/lib/security/admin";
// Old webhook payloads must never overwrite verified FIT activities.
export async function POST(request: Request) {
  const access = await requireAdmin(request);
  if (access.response) return access.response;
  return Response.json({ error: "Garmin 웹훅은 종료되었습니다. 로컬 FIT 수집기를 이용해 주세요." }, { status: 410, headers: { "Cache-Control": "private, no-store" } });
}
