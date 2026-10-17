import { readMutation, RequestInputError } from "@/lib/security/json-request";
import { requireAdmin } from "@/lib/security/admin";
import {
  CollectionStartError,
  collectionSnapshot,
  startCollection,
} from "@/lib/garmin/local-collector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", Vary: "Cookie, Authorization" };

export async function GET(request: Request) {
  const access = await requireAdmin(request);
  if (access.response) return access.response;
  try {
    const selection = new URL(request.url).searchParams.get("week") ?? "auto";
    if (!["auto", "current", "previous"].includes(selection))
      return Response.json(
        { error: "collection_period" },
        { status: 400, headers },
      );
    return Response.json(
      await collectionSnapshot(selection as "auto" | "current" | "previous"),
      { headers },
    );
  } catch {
    return Response.json(
      { error: "기록 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요." },
      { status: 503, headers },
    );
  }
}

export async function POST(request: Request) {
  const access = await requireAdmin(request);
  if (access.response) return access.response;
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  // Next may use its bind address (0.0.0.0) in request.url on a local server.
  const expectedOrigin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  if (origin && origin !== expectedOrigin) {
    return Response.json(
      { error: "origin_not_allowed" },
      { status: 403, headers },
    );
  }
  try {
    const body = request.headers
      .get("content-type")
      ?.includes("application/json")
      ? await readMutation(request)
      : {};
    if (
      Object.keys(body).some((key) => key !== "week") ||
      (body.week !== undefined &&
        !["auto", "current", "previous"].includes(body.week as string))
    )
      throw new RequestInputError(400, "가져올 주를 확인해 주세요.");
    const selection = (body.week ?? "auto") as "auto" | "current" | "previous";
    await startCollection(access.userId, selection);
    return Response.json(await collectionSnapshot(selection), {
      status: 202,
      headers,
    });
  } catch (error) {
    if (error instanceof RequestInputError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers },
      );
    const code =
      error instanceof CollectionStartError ? error.code : "start_failed";
    return Response.json(
      { error: code },
      { status: code === "busy" ? 409 : 503, headers },
    );
  }
}
