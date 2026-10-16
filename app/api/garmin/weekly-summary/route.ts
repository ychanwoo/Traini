import { requireAdmin } from "@/lib/security/admin";
import { readRunningSummary } from "@/lib/garmin/read-running-summary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };

export async function GET(request: Request) {
  const access = await requireAdmin(request);
  if (access.response) {
    for (const [name, value] of Object.entries(headers)) access.response.headers.set(name, value);
    return access.response;
  }
  const week = new URL(request.url).searchParams.get("week") ?? "current";
  if (week !== "current" && week !== "previous") {
    return Response.json({ error: "이번 주 또는 지난주를 선택해 주세요." }, { status: 400, headers });
  }
  try {
    return Response.json(await readRunningSummary(access.userId, week), { headers });
  } catch {
    // Database errors, schema details, and server configuration stay private.
    return Response.json({ error: "주간 기록을 불러오지 못했어요. 잠시 후 다시 확인해 주세요." }, { status: 503, headers });
  }
}
