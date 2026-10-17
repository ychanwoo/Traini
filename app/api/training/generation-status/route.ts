import { requireAdmin } from "@/lib/security/admin";
import { readGenerationStatus } from "@/lib/training/generation-status";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Authorization",
};
export async function GET(request: Request) {
  const access = await requireAdmin(request);
  if (access.response) return access.response;
  if ([...new URL(request.url).searchParams.keys()].length)
    return Response.json(
      { error: "생성 상태 조회에는 추가 입력을 받지 않아요." },
      { status: 400, headers },
    );
  try {
    return Response.json(await readGenerationStatus(access.userId), {
      headers,
    });
  } catch {
    return Response.json(
      { error: "생성 한도를 확인하지 못했어요. 잠시 후 다시 확인해 주세요." },
      { status: 503, headers },
    );
  }
}
