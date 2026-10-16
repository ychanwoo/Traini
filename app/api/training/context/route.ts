import { requireAdmin } from "@/lib/security/admin";
import { readTrainingContext } from "@/lib/training/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
export async function GET(request: Request) {
  const access = await requireAdmin(request);
  if (access.response) {
    for (const [key, value] of Object.entries(headers))
      access.response.headers.set(key, value);
    return access.response;
  }
  try {
    return Response.json(await readTrainingContext(access.userId), { headers });
  } catch {
    return Response.json(
      {
        error:
          "훈련 입력 데이터를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.",
      },
      { status: 503, headers },
    );
  }
}
