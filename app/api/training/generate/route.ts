import { requireAdmin } from "@/lib/security/admin";
import { readMutation, RequestInputError } from "@/lib/security/json-request";
import { PlanError } from "@/lib/training/weekly-plan";
import { generatePlan } from "@/lib/training/plan-service";
import { planErrorMessage } from "@/lib/training/plan-errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
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
      !["current", "next"].includes(body.week as string)
    )
      throw new RequestInputError(400, "이번 주 또는 다음 주를 선택해 주세요.");
    return Response.json(
      await generatePlan(access.userId, body.week as "current" | "next"),
      { headers },
    );
  } catch (error) {
    if (error instanceof RequestInputError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers },
      );
    const code = error instanceof PlanError ? error.code : "generation";
    return Response.json(
      { error: planErrorMessage(code), code },
      {
        status:
          code === "busy" || code === "closeout_changed"
            ? 409
            : code === "limited"
              ? 429
              : ["inputs", "period", "history"].includes(code)
                ? 422
                : 503,
        headers,
      },
    );
  }
}
