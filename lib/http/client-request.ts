/** Bounded browser requests. Mutations are sent once; uncertainty is resolved by a separate read. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status = 0,
  ) {
    super(message);
  }
}
export async function requestJson<T>(
  url: string,
  options: {
    signal?: AbortSignal;
    method?: "GET" | "POST" | "PUT";
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const signal = options.signal
    ? AbortSignal.any([
        options.signal,
        AbortSignal.timeout(options.timeoutMs ?? 25_000),
      ])
    : AbortSignal.timeout(options.timeoutMs ?? 25_000);
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers:
        options.body === undefined
          ? {}
          : { "Content-Type": "application/json" },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (response.status === 401 || response.status === 403)
      throw new ApiRequestError(
        "관리자 로그인 상태를 확인해 주세요. 다시 로그인한 뒤 저장 여부를 먼저 확인해 주세요.",
        response.status,
      );
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new ApiRequestError(
        "서버 응답을 확인하지 못했어요. 새로고침해 저장 여부를 먼저 확인해 주세요.",
        response.status,
      );
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new ApiRequestError(
        "서버 응답 형식을 확인하지 못했어요. 다시 확인해 주세요.",
        response.status,
      );
    if (!response.ok) {
      const error = (value as { error?: unknown }).error;
      throw new ApiRequestError(
        typeof error === "string" && error.length <= 400
          ? error
          : "요청을 완료하지 못했어요. 저장 여부를 먼저 확인해 주세요.",
        response.status,
      );
    }
    return value as T;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof ApiRequestError) throw error;
    throw new ApiRequestError(
      signal.aborted
        ? "응답 시간이 초과됐어요. 작업이 끝났을 수 있으니 저장 여부를 먼저 확인해 주세요."
        : "연결이 끊겼어요. 저장 여부를 먼저 확인한 뒤 다시 시도해 주세요.",
    );
  }
}

/** Slow polling reads are allowed to finish. Explicit mutations/navigation may cancel them. */
export class ReadRequestGate {
  private active: AbortController | null = null;
  start(): AbortController | null {
    if (this.active && !this.active.signal.aborted) return null;
    this.active = new AbortController();
    return this.active;
  }
  finish(controller: AbortController) {
    if (this.active === controller) this.active = null;
  }
  abort() {
    this.active?.abort();
  }
}
