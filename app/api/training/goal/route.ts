import { requireAdmin } from "@/lib/security/admin";
import { dateInZone } from "@/lib/garmin/running-summary";
import { GoalValidationError, validateGoalInput } from "@/lib/training/goal";
import { readTrainingGoal, saveTrainingGoal } from "@/lib/training/storage";
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
    return Response.json(await readTrainingGoal(access.userId), { headers });
  } catch {
    return Response.json(
      { error: "저장된 목표를 불러오지 못했어요. 다시 확인해 주세요." },
      { status: 503, headers },
    );
  }
}
export async function PUT(request: Request) {
  const access = await requireAdmin(request);
  if (access.response) {
    for (const [key, value] of Object.entries(headers))
      access.response.headers.set(key, value);
    return access.response;
  }
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (
    origin &&
    origin !== `${url.protocol}//${request.headers.get("host") ?? url.host}`
  )
    return Response.json(
      { error: "요청 출처를 확인해 주세요." },
      { status: 403, headers },
    );
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return Response.json(
      { error: "JSON 형식으로 전송해 주세요." },
      { status: 415, headers },
    );
  let body: unknown;
  try {
    // Bounded streaming read: a forged Content-Length cannot bypass this limit.
    const reader = request.body?.getReader();
    if (!reader) throw new Error();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) {
          await reader.cancel();
          return Response.json(
            { error: "입력 내용이 너무 길어요." },
            { status: 413, headers },
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return Response.json(
      { error: "입력 형식을 확인해 주세요." },
      { status: 400, headers },
    );
  }
  try {
    const today = dateInZone(
      new Date(),
      process.env.TRAINI_TIMEZONE ?? "America/Los_Angeles",
    );
    const goal = validateGoalInput(body, today);
    await saveTrainingGoal(access.userId, goal);
    return Response.json({ goal }, { headers });
  } catch (error) {
    if (error instanceof GoalValidationError)
      return Response.json(
        { error: "목표 입력값을 확인해 주세요.", issues: error.issues },
        { status: 400, headers },
      );
    return Response.json(
      {
        error:
          "목표를 저장하지 못했어요. 입력값을 유지했으니 다시 시도해 주세요.",
      },
      { status: 503, headers },
    );
  }
}
