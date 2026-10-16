import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { promises as fs, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRemoteJWKSet, jwtVerify } from "jose";

export const AUTH_ORIGIN = "https://auth.openai.com";
export const RESOURCE = "https://api.openai.com/v1";
export const CALLBACK_PATH = "/auth/callback";
export const ATTEMPT_MS = 10 * 60_000;
const jwks = createRemoteJWKSet(
  new URL(`${AUTH_ORIGIN}/.well-known/jwks.json`),
);
const requiredScopes = ["resource.invoke", "chatgpt.tokens.use.direct"];
export class ConnectionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
export function privateDirectory() {
  return join(
    homedir(),
    "Library",
    "Application Support",
    "Traini",
    "auth",
    "chatgpt",
  );
}
export async function prepareDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.()
  )
    throw new ConnectionError("storage");
  await fs.chmod(directory, 0o700);
}
export async function readRecord(directory) {
  try {
    const handle = await fs.open(
      join(directory, "connection.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.uid !== process.getuid?.() ||
        stat.mode & 0o077
      )
        throw new ConnectionError("storage");
      const record = JSON.parse(await handle.readFile("utf8"));
      if (record.version !== 1 || typeof record.hostId !== "string")
        throw new ConnectionError("storage");
      return record;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new ConnectionError("storage");
  }
}
export async function writeRecord(directory, record) {
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, JSON.stringify(record), {
      mode: 0o600,
      flag: "wx",
    });
    await fs.rename(temporary, join(directory, "connection.json"));
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
export async function withLock(directory, action) {
  await prepareDirectory(directory);
  const path = join(directory, "operation.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    let handle;
    try {
      handle = await fs.open(path, "wx", 0o600);
    } catch (error) {
      if (error.code !== "EEXIST") throw new ConnectionError("storage");
      // Never steal a live process's lock. A crashed worker can be retried.
      let lock;
      try {
        lock = JSON.parse(await fs.readFile(path, "utf8"));
      } catch {
        throw new ConnectionError("busy");
      }
      if (!Number.isSafeInteger(lock.pid) || lock.pid < 1)
        throw new ConnectionError("busy");
      try {
        process.kill(lock.pid, 0);
        throw new ConnectionError("busy");
      } catch (check) {
        if (check.code !== "ESRCH") throw new ConnectionError("busy");
      }
      await fs.rm(path, { force: true });
      continue;
    }
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid }));
      return await action();
    } finally {
      await handle.close();
      await fs.rm(path, { force: true });
    }
  }
  throw new ConnectionError("busy");
}
export function assertOwner(record, ownerId) {
  if (record?.ownerId && record.ownerId !== ownerId)
    throw new ConnectionError("owner");
}
export function createAttempt(record, port) {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
  const clientId = record.registration?.clientId ?? "dynamic_agent_client";
  const url = new URL(`${AUTH_ORIGIN}/api/accounts/authorize`);
  url.search = new URLSearchParams({
    client_id: clientId,
    ...(clientId === "dynamic_agent_client"
      ? { agent_name_hint: "Traini" }
      : {}),
    ext_agent_host_id: record.hostId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope:
      "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    resource: RESOURCE,
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  }).toString();
  return {
    verifier,
    state,
    nonce,
    redirectUri,
    clientId,
    authorizeUrl: url.toString(),
  };
}
export function validState(received, expected) {
  if (
    typeof received !== "string" ||
    Buffer.byteLength(received) !== Buffer.byteLength(expected)
  )
    return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}
export function callbackCode(params, attempt) {
  for (const key of ["state", "code", "client_id", "error"])
    if (params.getAll(key).length > 1) throw new ConnectionError("callback");
  if (!validState(params.get("state"), attempt.state))
    throw new ConnectionError("state");
  if (params.has("error"))
    throw new ConnectionError(
      params.get("error") === "access_denied" ? "denied" : "authorization",
    );
  const clientId =
    params.get("client_id") ??
    (attempt.clientId !== "dynamic_agent_client" ? attempt.clientId : null);
  if (
    !clientId ||
    clientId === "dynamic_agent_client" ||
    clientId.length > 256 ||
    (attempt.clientId !== "dynamic_agent_client" &&
      clientId !== attempt.clientId)
  )
    throw new ConnectionError("identity");
  const code = params.get("code");
  if (!code || code.length > 8192) throw new ConnectionError("callback");
  return { code, clientId };
}
async function requestJson(url, init, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(url, {
      ...init,
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
  } catch {
    throw new ConnectionError("network");
  }
  if (!response.ok) {
    if (response.status === 400) {
      const data = await response.json().catch(() => null);
      if (data?.error === "invalid_grant")
        throw new ConnectionError("reconnect");
    }
    throw new ConnectionError(
      response.status === 401
        ? "reconnect"
        : response.status === 429
          ? "limited"
          : "provider",
    );
  }
  try {
    return await response.json();
  } catch {
    throw new ConnectionError("provider");
  }
}
function credentialsFromResponse(data, previousRefreshToken) {
  const scopes =
    typeof data.scope === "string"
      ? data.scope.split(/\s+/).filter(Boolean)
      : [];
  if (!requiredScopes.every((scope) => scopes.includes(scope)))
    throw new ConnectionError("permission");
  if (
    data.token_type?.toLowerCase() !== "bearer" ||
    typeof data.access_token !== "string" ||
    !data.access_token ||
    typeof (data.refresh_token ?? previousRefreshToken) !== "string" ||
    !(data.refresh_token ?? previousRefreshToken) ||
    !Number.isFinite(data.expires_in) ||
    data.expires_in <= 0 ||
    data.expires_in > 86400
  )
    throw new ConnectionError("provider");
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? previousRefreshToken,
    scopes,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}
export async function exchangeCode(
  attempt,
  result,
  registration,
  fetcher = fetch,
  verificationKey = jwks,
) {
  const data = await requestJson(
    `${AUTH_ORIGIN}/api/accounts/oauth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: result.clientId,
        code: result.code,
        code_verifier: attempt.verifier,
        redirect_uri: attempt.redirectUri,
        resource: RESOURCE,
      }),
    },
    fetcher,
  );
  let payload;
  try {
    ({ payload } = await jwtVerify(data.id_token, verificationKey, {
      issuer: AUTH_ORIGIN,
      audience: result.clientId,
      algorithms: ["RS256"],
      requiredClaims: ["sub", "exp", "iat", "nonce"],
    }));
  } catch {
    throw new ConnectionError("identity");
  }
  if (
    !payload.sub ||
    payload.nonce !== attempt.nonce ||
    (registration &&
      (registration.subject !== payload.sub ||
        registration.clientId !== result.clientId))
  )
    throw new ConnectionError("identity");
  const credentials = credentialsFromResponse(data);
  return {
    registration: {
      clientId: result.clientId,
      subject: payload.sub,
      email: typeof payload.email === "string" ? payload.email : null,
    },
    credentials: { ...credentials, idToken: data.id_token },
  };
}
export async function loadModels(accessToken, fetcher = fetch) {
  const data = await requestJson(
    `${RESOURCE}/models`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    fetcher,
  );
  if (!Array.isArray(data.models)) throw new ConnectionError("provider");
  const models = data.models
    .filter(
      (model) =>
        model.visibility === "list" &&
        typeof model.slug === "string" &&
        typeof model.display_name === "string",
    )
    .map((model) => ({ id: model.slug, name: model.display_name }));
  if (!models.length) throw new ConnectionError("models");
  return models;
}
export function publicStatus(record, ownerId) {
  assertOwner(record, ownerId);
  const pending =
    record?.attempt?.state === "pending" &&
    record.attempt.expiresAt > Date.now();
  return {
    connected: Boolean(record?.credentials),
    pending: Boolean(pending),
    email: record?.registration?.email ?? null,
    models: record?.models ?? [],
    checkedAt: record?.checkedAt ?? null,
    error: pending
      ? null
      : record?.attempt?.state === "pending"
        ? "timeout"
        : (record?.attempt?.error ?? null),
  };
}
export async function checkConnection(directory, ownerId) {
  return withLock(directory, async () => {
    const record = await readRecord(directory);
    assertOwner(record, ownerId);
    if (!record?.credentials) throw new ConnectionError("reconnect");
    if (record.credentials.expiresAt <= Date.now() + 30_000) {
      const data = await requestJson(
        `${AUTH_ORIGIN}/api/accounts/oauth/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: record.registration.clientId,
            refresh_token: record.credentials.refreshToken,
            resource: RESOURCE,
          }),
        },
      );
      // Persist rotating credentials before a separate model request can fail.
      record.credentials = {
        ...credentialsFromResponse(data, record.credentials.refreshToken),
        idToken: record.credentials.idToken,
      };
      await writeRecord(directory, record);
    }
    record.models = await loadModels(record.credentials.accessToken);
    record.checkedAt = new Date().toISOString();
    record.attempt = null;
    await writeRecord(directory, record);
    return publicStatus(record, ownerId);
  });
}
export async function disconnect(directory, ownerId) {
  return withLock(directory, async () => {
    const record = await readRecord(directory);
    assertOwner(record, ownerId);
    if (!record?.credentials) return publicStatus(record, ownerId);
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, 300));
      try {
        response = await fetch(`${AUTH_ORIGIN}/api/accounts/oauth/revoke`, {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          redirect: "error",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: record.credentials.refreshToken,
            token_type_hint: "refresh_token",
            client_id: record.registration.clientId,
          }),
        });
      } catch {
        response = undefined;
      }
      if (response?.ok || (response && response.status < 500)) break;
    }
    if (!response?.ok) throw new ConnectionError("revoke");
    record.credentials = null;
    record.models = [];
    record.checkedAt = null;
    record.attempt = null;
    await writeRecord(directory, record);
    return publicStatus(record, ownerId);
  });
}
export function newRecord(ownerId) {
  return {
    version: 1,
    hostId: `urn:uuid:${randomUUID()}`,
    ownerId,
    registration: null,
    credentials: null,
    models: [],
    checkedAt: null,
    attempt: null,
  };
}

// Only returned by an explicit administrator connect action, never by status polling.
export function pendingAuthorization(
  record,
  ownerId,
  isAlive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
) {
  assertOwner(record, ownerId);
  const attempt = record?.attempt;
  if (
    attempt?.state !== "pending" ||
    attempt.expiresAt <= Date.now() ||
    !Number.isSafeInteger(attempt.pid) ||
    attempt.pid < 1 ||
    !isAlive(attempt.pid) ||
    typeof attempt.authorizeUrl !== "string"
  )
    return null;
  let url;
  try {
    url = new URL(attempt.authorizeUrl);
  } catch {
    return null;
  }
  if (
    url.origin !== AUTH_ORIGIN ||
    url.pathname !== "/api/accounts/authorize" ||
    url.username ||
    url.password ||
    url.hash
  )
    return null;
  return url.toString();
}
