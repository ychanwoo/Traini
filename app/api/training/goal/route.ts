import { requireAdmin } from "@/lib/security/admin";
import { dateInZone } from "@/lib/garmin/running-summary";
import { GoalValidationError, validateGoalInput } from "@/lib/training/goal";
import { readTrainingGoal, saveTrainingGoal } from "@/lib/training/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Authorization",
};
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
    let expectedRevision: string | undefined;
    if (
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      Object.hasOwn(body, "expectedRevision")
    ) {
      const raw = body as Record<string, unknown>;
      if (
        typeof raw.expectedRevision !== "string" ||
        !/^[a-f0-9]{32}$/.test(raw.expectedRevision)
      )
        return Response.json(
          { error: "저장 버전을 확인해 주세요." },
          { status: 400, headers },
        );
      expectedRevision = raw.expectedRevision;
      body = Object.fromEntries(
        Object.entries(raw).filter(([key]) => key !== "expectedRevision"),
      );
    }
    if (
      body &&
      typeof body === "object" &&
      Object.hasOwn(body, "races") &&
      !expectedRevision
    )
      return Response.json(
        { error: "목표를 다시 불러온 뒤 저장해 주세요." },
        { status: 409, headers },
      );
    const goal = validateGoalInput(body, today);
    const revision = await saveTrainingGoal(
      access.userId,
      goal,
      expectedRevision,
    );
    return Response.json({ goal, revision }, { headers });
  } catch (error) {
    if (
      error instanceof Error &&
      ["goal_conflict", "past_race"].includes(error.message)
    )
      return Response.json(
        {
          error:
            error.message === "goal_conflict"
              ? "다른 화면에서 목표가 변경됐어요. 입력을 확인한 뒤 새로고침해 주세요."
              : "새 대회는 오늘 이후 날짜로 등록해 주세요.",
        },
        { status: error.message === "goal_conflict" ? 409 : 400, headers },
      );
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
