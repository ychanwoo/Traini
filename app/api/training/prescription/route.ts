import { requireAdmin } from "@/lib/security/admin";
import { readPrescriptionPreview } from "@/lib/training/prescription-storage";
import { PlanError } from "@/lib/training/weekly-plan";
import { planErrorMessage } from "@/lib/training/plan-errors";
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
  try {
    const params = new URL(request.url).searchParams,
      week = params.get("week") ?? "current";
    if (
      [...params.keys()].some((k) => k !== "week") ||
      params.getAll("week").length > 1 ||
      !["current", "next"].includes(week)
    )
      return Response.json(
        { error: "이번 주 또는 다음 주를 선택해 주세요." },
        { status: 400, headers },
      );
    return Response.json(
      await readPrescriptionPreview(access.userId, week as "current" | "next"),
      { headers },
    );
  } catch (error) {
    const code = error instanceof PlanError ? error.code : "storage";
    return Response.json(
      { error: planErrorMessage(code), code },
      {
        status: ["inputs", "history", "period"].includes(code)
          ? 422
          : code === "input_changed"
            ? 409
            : 503,
        headers,
      },
    );
  }
}
