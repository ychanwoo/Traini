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
    return Response.json(await collectionSnapshot(), { headers });
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
    await startCollection(access.userId);
    return Response.json(await collectionSnapshot(), { status: 202, headers });
  } catch (error) {
    const code =
      error instanceof CollectionStartError ? error.code : "start_failed";
    return Response.json(
      { error: code },
      { status: code === "busy" ? 409 : 503, headers },
    );
  }
}
