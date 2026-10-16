export class RequestInputError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function readMutation(
  request: Request,
): Promise<Record<string, unknown>> {
  const url = new URL(request.url),
    host = request.headers.get("host") ?? url.host;
  if (request.headers.get("origin") !== `${url.protocol}//${host}`)
    throw new RequestInputError(403, "요청 출처를 확인해 주세요.");
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new RequestInputError(415, "JSON 형식으로 전송해 주세요.");
  const reader = request.body?.getReader();
  if (!reader) throw new RequestInputError(400, "입력 형식을 확인해 주세요.");
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 2048) {
        await reader.cancel();
        throw new RequestInputError(413, "요청이 너무 길어요.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new RequestInputError(400, "입력 형식을 확인해 주세요.");
  }
}
