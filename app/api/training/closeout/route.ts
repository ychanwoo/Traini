import { validDate } from "@/lib/training/goal";
import { requireAdmin } from "@/lib/security/admin";
import { readMutation, RequestInputError } from "@/lib/security/json-request";
import { closeWeek, readCloseout } from "@/lib/training/closeout-storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Authorization",
};
async function handle(request: Request, mutate: boolean) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;
  try {
    if (!mutate)
      return Response.json(await readCloseout(admin.userId), { headers });
    const body = await readMutation(request);
    if (
      Object.keys(body).length !== 3 ||
      body.confirmed !== true ||
      typeof body.startsOn !== "string" ||
      !validDate(body.startsOn) ||
      typeof body.revision !== "string" ||
      !/^[0-9a-f]{32}$/.test(body.revision)
    )
      throw new RequestInputError(
        400,
        "주간 날짜와 마감 확인을 확인해 주세요.",
      );
    return Response.json(
      await closeWeek(admin.userId, body.startsOn, body.revision),
      { headers },
    );
  } catch (e) {
    if (e instanceof RequestInputError)
      return Response.json({ error: e.message }, { status: e.status, headers });
    const code = e instanceof Error ? e.message : "closeout_storage";
    return Response.json(
      {
        error:
          code === "closeout_changed"
            ? "기록이 바뀌었어요. 최신 상태를 확인한 뒤 다시 마감해 주세요."
            : code === "closeout_period"
              ? "마감 가능한 주가 바뀌었어요. 날짜를 다시 확인해 주세요."
              : "주간 마감 상태를 확인하지 못했어요. 저장 여부를 먼저 확인해 주세요.",
        code: ["closeout_changed", "closeout_period"].includes(code)
          ? code
          : "closeout_storage",
      },
      {
        status:
          code === "closeout_changed" || code === "closeout_period" ? 409 : 503,
        headers,
      },
    );
  }
}
export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
