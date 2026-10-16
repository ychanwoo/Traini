import { requireAdmin } from "@/lib/security/admin";
import {
  connectionStatus,
  localConnectionAvailable,
  startConnection,
  verifyConnection,
  removeConnection,
} from "@/lib/chatgpt/connection";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };

// The browser and OAuth callback must run on the same Mac. Do not expose dynamic
// registration as a remotely hosted endpoint before provider approval.
function isLoopbackRequest(request: Request, mutation = false) {
  // Next constructs request.url from its bind address (e.g. 0.0.0.0), while
  // Host retains the browser's actual localhost origin. Validate both explicitly.
  const internal = new URL(request.url);
  const host = request.headers.get("host");
  if (
    !host ||
    internal.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "0.0.0.0"].includes(internal.hostname)
  )
    return false;
  let browser: URL;
  try {
    browser = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (
    browser.host !== host ||
    browser.pathname !== "/" ||
    browser.search ||
    browser.hash ||
    browser.username ||
    browser.password ||
    browser.port !== internal.port ||
    !["localhost", "127.0.0.1"].includes(browser.hostname)
  )
    return false;
  if (mutation && request.headers.get("origin") !== browser.origin)
    return false;
  const site = request.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}

async function access(request: Request, mutation = false) {
  const admin = await requireAdmin(request);
  if (admin.response) {
    for (const [key, value] of Object.entries(headers))
      admin.response.headers.set(key, value);
    return admin;
  }
  if (!localConnectionAvailable() || !isLoopbackRequest(request, mutation))
    return {
      response: Response.json(
        {
          error:
            "ChatGPT 구독 연결은 Traini를 실행 중인 Mac의 localhost에서 진행해 주세요.",
        },
        { status: 403, headers },
      ),
    };
  return admin;
}
function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "connection";
  const messages: Record<string, string> = {
    busy: "다른 연결 작업이 진행 중이에요. 승인을 마치거나 잠시 후 다시 시도해 주세요.",
    reconnect: "ChatGPT를 다시 연결해 주세요.",
    permission: "ChatGPT 구독 사용 권한이 필요해요. 다시 연결해 승인해 주세요.",
    network:
      "OpenAI에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.",
    limited: "ChatGPT 사용 한도에 도달했어요. 잠시 후 다시 확인해 주세요.",
    models:
      "사용 가능한 모델을 찾지 못했어요. 구독 상태와 계정 권한을 확인해 주세요.",
    revoke:
      "OpenAI에서 연결 해제를 확인하지 못했어요. 연결은 유지했으니 다시 시도해 주세요.",
    storage:
      "로컬 연결 정보를 읽거나 저장하지 못했어요. 폴더 접근 권한을 확인해 주세요.",
    owner: "이 Mac의 연결은 다른 Traini 관리자에게 연결되어 있어요.",
  };
  return Response.json(
    {
      error:
        messages[code] ??
        "ChatGPT 연결을 확인하지 못했어요. 다시 시도해 주세요.",
    },
    { status: code === "busy" ? 409 : 503, headers },
  );
}
export async function GET(request: Request) {
  const admin = await access(request);
  if (admin.response) return admin.response;
  try {
    return Response.json(await connectionStatus(admin.userId), { headers });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  const admin = await access(request, true);
  if (admin.response) return admin.response;
  try {
    const input: unknown = await request.json();
    if (!input || typeof input !== "object" || !("action" in input))
      return Response.json(
        { error: "연결 작업을 선택해 주세요." },
        { status: 400, headers },
      );
    if (input.action === "connect")
      return Response.json(
        { authorizeUrl: await startConnection(admin.userId) },
        { headers },
      );
    if (input.action === "check")
      return Response.json(await verifyConnection(admin.userId), { headers });
    if (input.action === "disconnect")
      return Response.json(await removeConnection(admin.userId), { headers });
    return Response.json(
      { error: "지원하지 않는 작업이에요." },
      { status: 400, headers },
    );
  } catch (error) {
    if (error instanceof SyntaxError)
      return Response.json(
        { error: "요청 형식을 확인해 주세요." },
        { status: 400, headers },
      );
    return failure(error);
  }
}
