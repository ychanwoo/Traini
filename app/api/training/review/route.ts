import { requireAdmin } from "@/lib/security/admin";
import { readMutation, RequestInputError } from "@/lib/security/json-request";
import { readCoachingReview } from "@/lib/training/coaching-storage";
import { generateReview } from "@/lib/training/review-service";
import { ReviewError } from "@/lib/training/weekly-review";
import { reviewErrorMessage } from "@/lib/training/review-errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Authorization",
};
async function handle(request: Request, mutate: boolean) {
  const access = await requireAdmin(request);
  if (access.response) {
    for (const [k, v] of Object.entries(headers))
      access.response.headers.set(k, v);
    return access.response;
  }
  try {
    let start: string | undefined;
    if (mutate) {
      const body = await readMutation(request);
      if (
        Object.keys(body).some((k) => k !== "startsOn") ||
        (body.startsOn !== undefined && typeof body.startsOn !== "string")
      )
        throw new RequestInputError(400, "대상 주를 확인해 주세요.");
      start = body.startsOn as string | undefined;
    } else {
      const params = new URL(request.url).searchParams;
      if (
        [...params.keys()].some((k) => k !== "start") ||
        params.getAll("start").length > 1
      )
        throw new RequestInputError(400, "대상 주를 확인해 주세요.");
      start = params.get("start") ?? undefined;
    }
    if (mutate) await generateReview(access.userId, start);
    return Response.json(await readCoachingReview(access.userId, start), {
      headers,
    });
  } catch (error) {
    if (error instanceof RequestInputError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers },
      );
    const code = error instanceof ReviewError ? error.code : "review_storage";
    return Response.json(
      { error: reviewErrorMessage(code), code },
      {
        status:
          code === "review_period"
            ? 400
            : code === "review_history"
              ? 422
              : code === "busy" || code === "review_changed" || code === "closeout_changed"
                ? 409
                : code === "limited"
                  ? 429
                  : 503,
        headers,
      },
    );
  }
}
export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
