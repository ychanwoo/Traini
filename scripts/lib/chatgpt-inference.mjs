import {
  ConnectionError,
  privateDirectory,
  withLock,
  readRecord,
  assertOwner,
  checkConnection,
  RESOURCE,
} from "./chatgpt-connection.mjs";

// Stream parsing is independent of credential storage so failures can be tested offline.
export async function consumeResponse(response, onUsage = () => {}) {
  if (!response.ok)
    throw new ConnectionError(
      response.status === 429
        ? "limited"
        : response.status === 401
          ? "reconnect"
          : response.status === 403
            ? "permission"
            : "provider",
    );
  const contentType = response.headers.get("content-type");
  if (
    (contentType && !contentType.includes("text/event-stream")) ||
    !response.body
  )
    throw new ConnectionError("stream_type");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    size = 0,
    completed = null,
    output = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new ConnectionError("output_limit");
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (!data || data === "[DONE]") continue;
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          throw new ConnectionError("stream_json");
        }
        if (event.type === "error" || event.type === "response.failed") {
          const code = event.response?.error?.code ?? event.code;
          throw new ConnectionError(
            [
              "subscription_sharing_usage_limit_exceeded",
              "subscription_sharing_usage_unavailable",
              "rate_limit_exceeded",
            ].includes(code)
              ? "limited"
              : "provider",
          );
        }
        if (
          ["response.refusal.delta", "response.refusal.done"].includes(
            event.type,
          )
        )
          throw new ConnectionError("refusal");
        if (event.type === "response.incomplete")
          throw new ConnectionError("incomplete");
        if (event.type === "response.output_text.delta") {
          if (typeof event.delta !== "string")
            throw new ConnectionError("stream_delta");
          output += event.delta;
          if (output.length > 30_000) throw new ConnectionError("output_limit");
        }
        if (event.type === "response.completed") {
          if (completed || event.response?.status !== "completed")
            throw new ConnectionError("stream_terminal");
          completed = event.response;
          const usage = completed.usage;
          if (usage)
            onUsage({
              inputTokens: Number.isSafeInteger(usage.input_tokens)
                ? usage.input_tokens
                : null,
              outputTokens: Number.isSafeInteger(usage.output_tokens)
                ? usage.output_tokens
                : null,
            });
        }
      }
    }
    if (!completed) throw new ConnectionError("incomplete");
    if (buffer.trim()) throw new ConnectionError("stream_tail");
    // Use the final response's text, not partial deltas or a refused/incomplete response.
    const messages =
      completed.output?.filter(
        (item) => item.type === "message" && item.role === "assistant",
      ) ?? [];
    const parts = messages.flatMap((item) => item.content ?? []);
    if (parts.some((part) => part.type === "refusal"))
      throw new ConnectionError("refusal");
    const finalText = parts
      .filter((part) => part.type === "output_text")
      .map((part) => part.text)
      .join("");
    // Some subscription transports omit output from the completed envelope.
    // Deltas become usable only after a verified completed terminal event.
    const text = finalText || output;
    if (
      !text ||
      text.length > 30_000 ||
      (finalText && output && output !== finalText)
    )
      throw new ConnectionError("stream_text");
    try {
      return JSON.parse(text);
    } catch {
      throw new ConnectionError("invalid_output");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function generateWithSubscription(ownerId, prompt, onUsage) {
  if (process.platform !== "darwin" || process.env.VERCEL)
    throw new ConnectionError("local_runtime");
  const directory = privateDirectory();
  await checkConnection(directory, ownerId);
  // Serialize against sign-out/reconnect and rotating refreshes during inference.
  return withLock(directory, async () => {
    const record = await readRecord(directory);
    assertOwner(record, ownerId);
    if (
      !record?.credentials ||
      record.credentials.expiresAt <= Date.now() + 5000
    )
      throw new ConnectionError("reconnect");
    const preferred = process.env.TRAINI_CHATGPT_MODEL ?? "gpt-6.1-sol";
    const model = record.models.find((m) => m.id === preferred);
    if (!model) throw new ConnectionError("model");
    let response;
    try {
      response = await fetch(`${RESOURCE}/responses`, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${record.credentials.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model.id,
          ...prompt,
          store: false,
          stream: true,
        }),
        signal: AbortSignal.timeout(150_000),
      });
    } catch {
      throw new ConnectionError("network");
    }
    // No automatic retries and no paid API-key fallback.
    try {
      const content = await consumeResponse(response, (usage) =>
        onUsage?.({ ...usage, model: model.id }),
      );
      return { content, model: model.id };
    } catch (error) {
      if (error instanceof ConnectionError) throw error;
      throw new ConnectionError("network");
    }
  });
}
