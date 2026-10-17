import { requireAdmin } from "@/lib/security/admin";
import {
  readProgressInsights,
  ProgressError,
} from "@/lib/training/progress-storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Authorization",
};
export async function GET(request: Request) {
  const access = await requireAdmin(request);
  if (access.response) {
    for (const [k, v] of Object.entries(headers))
      access.response.headers.set(k, v);
    return access.response;
  }
  if (new URL(request.url).search)
    return Response.json(
      { error: "지원하지 않는 조회 조건이에요." },
      { status: 400, headers },
    );
  try {
    return Response.json(await readProgressInsights(access.userId), {
      headers,
    });
  } catch (error) {
    const changed =
      error instanceof ProgressError && error.message === "progress_changed";
    return Response.json(
      {
        error: changed
          ? "조회 중 기록이 변경됐어요. 다시 확인해 주세요."
          : "훈련 진행 데이터를 불러오지 못했어요. 다시 확인해 주세요.",
      },
      { status: changed ? 409 : 503, headers },
    );
  }
}
