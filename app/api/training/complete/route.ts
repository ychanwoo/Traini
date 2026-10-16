import { requireAdmin } from "@/lib/security/admin";
import { readMutation, RequestInputError } from "@/lib/security/json-request";
import { completeWorkout } from "@/lib/training/plan-storage";
import { planErrorMessage } from "@/lib/training/plan-errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
export async function POST(request: Request) {
  const access = await requireAdmin(request);
  if (access.response) {
    for (const [k, v] of Object.entries(headers))
      access.response.headers.set(k, v);
    return access.response;
  }
  try {
    const body = await readMutation(request);
    if (
      Object.keys(body).length !== 1 ||
      typeof body.workoutId !== "string" ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.workoutId)
    )
      throw new RequestInputError(400, "훈련 정보를 확인해 주세요.");
    await completeWorkout(access.userId, body.workoutId);
    return Response.json({ completed: true }, { headers });
  } catch (error) {
    if (error instanceof RequestInputError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers },
      );
    const code = error instanceof Error ? error.message : "storage";
    return Response.json(
      { error: planErrorMessage(code) },
      { status: code === "workout" ? 409 : 503, headers },
    );
  }
}
