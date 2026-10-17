import { requireAdmin } from "@/lib/security/admin";
import { readMutation, RequestInputError } from "@/lib/security/json-request";
import { saveWorkoutMatch } from "@/lib/training/matching-storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Authorization",
};
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
export async function POST(request: Request) {
  const access = await requireAdmin(request);
  if (access.response) return access.response;
  try {
    const body = await readMutation(request);
    if (
      Object.keys(body).sort().join(",") !== "activityIds,revision,workoutId" ||
      !uuid(body.workoutId) ||
      typeof body.revision !== "string" ||
      !/^[a-f0-9]{32}$/.test(body.revision) ||
      !Array.isArray(body.activityIds) ||
      body.activityIds.length > 12 ||
      !body.activityIds.every(uuid) ||
      new Set(body.activityIds).size !== body.activityIds.length
    )
      throw new RequestInputError(400, "연결할 기록을 확인해 주세요.");
    await saveWorkoutMatch(
      access.userId,
      body.workoutId,
      body.revision,
      body.activityIds,
    );
    return Response.json({ saved: true }, { headers });
  } catch (error) {
    if (error instanceof RequestInputError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers },
      );
    const code = error instanceof Error ? error.message : "";
    const conflict = [
      "match_changed",
      "match_activity",
      "match_conflict",
    ].includes(code);
    return Response.json(
      {
        error: conflict
          ? "기록이나 훈련 상태가 바뀌었어요. 새로 확인한 뒤 다시 연결해 주세요."
          : "기록 연결을 저장하지 못했어요. 기존 상태를 확인한 뒤 다시 시도해 주세요.",
      },
      { status: conflict ? 409 : 503, headers },
    );
  }
}
