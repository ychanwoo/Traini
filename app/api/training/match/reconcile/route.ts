import { requireAdmin } from "@/lib/security/admin";
import { readMutation, RequestInputError } from "@/lib/security/json-request";
import { reconcileRecentWorkoutMatches } from "@/lib/training/matching-storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Authorization",
};
export async function POST(request: Request) {
  const access = await requireAdmin(request);
  if (access.response) return access.response;
  try {
    const body = await readMutation(request);
    if (Object.keys(body).length)
      throw new RequestInputError(400, "요청 내용을 확인해 주세요.");
    const result = await reconcileRecentWorkoutMatches(access.userId);
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof RequestInputError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers },
      );
    return Response.json(
      {
        error:
          "Garmin 기록 연결을 확인하지 못했어요. 가져온 기록은 유지되니 다시 확인해 주세요.",
      },
      { status: 503, headers },
    );
  }
}
