import { requireAdmin } from "@/lib/security/admin";
import { readPlan } from "@/lib/training/plan-storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
export async function GET(request: Request) {
  const access = await requireAdmin(request);
  if (access.response) {
    for (const [k, v] of Object.entries(headers))
      access.response.headers.set(k, v);
    return access.response;
  }
  const week = new URL(request.url).searchParams.get("week") ?? "current";
  if (week !== "current" && week !== "next")
    return Response.json(
      { error: "주간 범위를 확인해 주세요." },
      { status: 400, headers },
    );
  try {
    return Response.json(await readPlan(access.userId, week), { headers });
  } catch {
    return Response.json(
      { error: "훈련계획을 불러오지 못했어요. 다시 확인해 주세요." },
      { status: 503, headers },
    );
  }
}
