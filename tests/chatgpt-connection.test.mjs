import assert from "node:assert/strict";
import { test } from "node:test";
import { promises as fs, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { generateKeyPair, SignJWT } from "jose";
import {
  createAttempt,
  callbackCode,
  validState,
  exchangeCode,
  loadModels,
  newRecord,
  publicStatus,
  writeRecord,
  readRecord,
  prepareDirectory,
  withLock,
  checkConnection,
  disconnect,
  AUTH_ORIGIN,
  pendingAuthorization,
} from "../scripts/lib/chatgpt-connection.mjs";
const owner = "11111111-1111-4111-8111-111111111111";
const record = () => newRecord(owner);
const attempt = () => createAttempt(record(), 54321);
const { privateKey, publicKey } = await generateKeyPair("RS256");
const json = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
async function token(pending, overrides = {}, claims = {}) {
  const id = await new SignJWT({
    nonce: pending.nonce,
    email: "runner@example.com",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(AUTH_ORIGIN)
    .setAudience("oaiapp_traini")
    .setSubject("runner")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return {
    access_token: "ACCESS_SECRET",
    refresh_token: "REFRESH_SECRET",
    id_token: id,
    token_type: "Bearer",
    expires_in: 3600,
    scope: "resource.invoke chatgpt.tokens.use.direct offline_access",
    ...overrides,
  };
}
async function temp(action) {
  const directory = await fs.mkdtemp(join(tmpdir(), "traini-chatgpt-test-"));
  try {
    await prepareDirectory(directory);
    await action(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
test("authorization uses official endpoint, fixed loopback path, fresh PKCE/state/nonce and stable host", () => {
  const r = record(),
    a = createAttempt(r, 54321),
    b = createAttempt(r, 54322);
  const url = new URL(a.authorizeUrl);
  assert.equal(url.origin, AUTH_ORIGIN);
  assert.equal(url.pathname, "/api/accounts/authorize");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "http://127.0.0.1:54321/auth/callback",
  );
  assert.equal(url.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(url.searchParams.get("agent_name_hint"), "Traini");
  assert.equal(url.searchParams.get("ext_agent_host_id"), r.hostId);
  assert.match(r.hostId, /^urn:uuid:/);
  assert.equal(
    url.searchParams.get("code_challenge"),
    createHash("sha256").update(a.verifier).digest("base64url"),
  );
  for (const key of ["state", "nonce", "verifier"])
    assert.notEqual(a[key], b[key]);
  assert.ok(!a.authorizeUrl.includes(a.verifier));
});
test("reauthorization retains the issued client registration and does not register another app", () => {
  const r = record();
  r.registration = { clientId: "oaiapp_traini", subject: "runner" };
  const a = createAttempt(r, 12345),
    url = new URL(a.authorizeUrl);
  assert.equal(url.searchParams.get("client_id"), "oaiapp_traini");
  assert.equal(url.searchParams.has("agent_name_hint"), false);
  assert.equal(url.searchParams.has("id_token_hint"), false);
  assert.equal(
    callbackCode(new URLSearchParams({ code: "x", state: a.state }), a)
      .clientId,
    "oaiapp_traini",
  );
  assert.throws(
    () =>
      callbackCode(
        new URLSearchParams({ code: "x", state: a.state, client_id: "other" }),
        a,
      ),
    /identity/,
  );
});
test("callback rejects wrong state, duplicate fields, missing code/client and denial before exchange", () => {
  const a = attempt();
  assert.equal(validState("é".repeat(a.state.length), a.state), false);
  assert.equal(validState(null, a.state), false);
  assert.throws(
    () =>
      callbackCode(
        new URLSearchParams({ state: "wrong", error: "access_denied" }),
        a,
      ),
    /state/,
  );
  assert.throws(
    () =>
      callbackCode(
        new URLSearchParams({ state: a.state, error: "access_denied" }),
        a,
      ),
    /denied/,
  );
  assert.throws(
    () => callbackCode(new URLSearchParams({ state: a.state, code: "x" }), a),
    /identity/,
  );
  assert.throws(
    () =>
      callbackCode(
        new URLSearchParams({
          state: a.state,
          client_id: "dynamic_agent_client",
          code: "x",
        }),
        a,
      ),
    /identity/,
  );
  const params = new URLSearchParams({
    state: a.state,
    code: "x",
    client_id: "oaiapp_traini",
  });
  params.append("code", "other");
  assert.throws(() => callbackCode(params, a), /callback/);
});
test("exchange verifies a real signature, issuer, audience, expiry, nonce and identity, then retains tokens", async () => {
  const a = attempt();
  let form;
  const result = await exchangeCode(
    a,
    { clientId: "oaiapp_traini", code: "code" },
    null,
    async (url, init) => {
      assert.equal(url, `${AUTH_ORIGIN}/api/accounts/oauth/token`);
      form = init.body;
      return json(await token(a));
    },
    publicKey,
  );
  assert.equal(form.get("redirect_uri"), a.redirectUri);
  assert.equal(form.get("code_verifier"), a.verifier);
  assert.equal(form.get("client_secret"), null);
  assert.equal(result.registration.subject, "runner");
  assert.equal(result.credentials.refreshToken, "REFRESH_SECRET");
  assert.ok(result.credentials.expiresAt > Date.now());
});
test("unverified, expired, incorrect audience/issuer and wrong nonce ID tokens are rejected", async () => {
  const a = attempt();
  const base = () =>
    new SignJWT({ nonce: a.nonce })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(AUTH_ORIGIN)
      .setAudience("oaiapp_traini")
      .setSubject("runner")
      .setIssuedAt()
      .setExpirationTime("1h");
  const { privateKey: wrongKey } = await generateKeyPair("RS256");
  for (const id of [
    await base().sign(wrongKey),
    await base().setExpirationTime(1).sign(privateKey),
    await base().setAudience("attacker").sign(privateKey),
    await base().setIssuer("https://attacker.test").sign(privateKey),
    (await token(a, {}, { nonce: "wrong" })).id_token,
  ])
    await assert.rejects(
      exchangeCode(
        a,
        { clientId: "oaiapp_traini", code: "x" },
        null,
        async () => json(await token(a, { id_token: id })),
        publicKey,
      ),
      /identity/,
    );
});
test("returning identity mismatch cannot replace existing account", async () => {
  const a = attempt();
  await assert.rejects(
    exchangeCode(
      a,
      { clientId: "oaiapp_traini", code: "x" },
      { clientId: "oaiapp_traini", subject: "different-runner" },
      async () => json(await token(a)),
      publicKey,
    ),
    /identity/,
  );
});
test("valid identity alone is insufficient without granted plan permission or renewable credentials", async () => {
  const a = attempt();
  for (const fields of [
    { scope: "openid resource.invoke" },
    { scope: "chatgpt.tokens.use.direct" },
    { expires_in: -1 },
    { refresh_token: null },
    { access_token: "" },
    { token_type: "Basic" },
  ])
    await assert.rejects(
      exchangeCode(
        a,
        { clientId: "oaiapp_traini", code: "x" },
        null,
        async () => json(await token(a, fields)),
        publicKey,
      ),
      /permission|provider/,
    );
});
test("catalog uses OAuth, filters visible models, preserves provider ordering and rejects API-key shaped catalogs", async () => {
  const models = await loadModels("secret", async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/models");
    assert.equal(init.headers.Authorization, "Bearer secret");
    return json({
      models: [
        { slug: "b", display_name: "B", visibility: "list" },
        { slug: "hidden", display_name: "Hidden", visibility: "hidden" },
        { slug: "a", display_name: "A", visibility: "list" },
      ],
    });
  });
  assert.deepEqual(models, [
    { id: "b", name: "B" },
    { id: "a", name: "A" },
  ]);
  await assert.rejects(
    loadModels("secret", async () => json({ data: [] })),
    /provider/,
  );
  await assert.rejects(
    loadModels("secret", async () => json({ models: [] })),
    /models/,
  );
});
test("provider failures expose sanitized codes rather than token/error payloads", async () => {
  await assert.rejects(
    loadModels("secret", async () => {
      throw new Error("SECRET");
    }),
    /^Error: network$/,
  );
  for (const [http, code] of [
    [401, "reconnect"],
    [429, "limited"],
    [500, "provider"],
  ])
    await assert.rejects(
      loadModels(
        "secret",
        async () => new Response("SECRET", { status: http }),
      ),
      new RegExp(`^Error: ${code}$`),
    );
});
test("public status excludes tokens, host IDs, client IDs and OAuth secrets and enforces owner", () => {
  const r = {
    ...record(),
    credentials: {
      accessToken: "SECRET",
      refreshToken: "SECRET",
      idToken: "SECRET",
    },
    registration: {
      clientId: "PRIVATE_CLIENT",
      subject: "PRIVATE_SUBJECT",
      email: "runner@example.com",
    },
    attempt: { state: "pending", expiresAt: Date.now() - 1 },
  };
  const status = publicStatus(r, owner);
  assert.equal(status.error, "timeout");
  assert.equal(status.pending, false);
  assert.doesNotMatch(JSON.stringify(status), /SECRET|PRIVATE|urn:uuid/);
  assert.throws(() => publicStatus(r, "attacker"), /owner/);
});
test("credentials are atomically saved with owner-only permissions and stable host registration", async () =>
  temp(async (directory) => {
    const r = record();
    await writeRecord(directory, r);
    assert.deepEqual(await readRecord(directory), r);
    assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
    assert.equal(
      (await fs.stat(join(directory, "connection.json"))).mode & 0o777,
      0o600,
    );
    await writeRecord(directory, { ...r, checkedAt: "updated" });
    assert.equal((await readRecord(directory)).hostId, r.hostId);
    assert.deepEqual(await fs.readdir(directory), ["connection.json"]);
  }));
test("unsafe file permissions, corrupt data and symlink credential files fail closed", async () =>
  temp(async (directory) => {
    const path = join(directory, "connection.json");
    await writeRecord(directory, record());
    await fs.chmod(path, 0o644);
    await assert.rejects(readRecord(directory), /storage/);
    await fs.chmod(path, 0o600);
    await fs.writeFile(path, "invalid json");
    await assert.rejects(readRecord(directory), /storage/);
    await fs.rm(path);
    await fs.symlink(join(directory, "missing"), path);
    await assert.rejects(readRecord(directory), /storage/);
  }));
test("operation lock prevents concurrent connect/refresh/revoke and is released on failures", async () =>
  temp(async (directory) => {
    await withLock(directory, async () => {
      await assert.rejects(
        withLock(directory, async () => {}),
        /busy/,
      );
    });
    await assert.rejects(
      withLock(directory, async () => {
        throw new Error("expected");
      }),
      /expected/,
    );
    await withLock(directory, async () => {});
    assert.deepEqual(await fs.readdir(directory), []);
  }));
test("failed model check retains rotated refresh tokens, then supports revoke while retaining registration", async () =>
  temp(async (directory) => {
    const originalFetch = globalThis.fetch;
    const r = {
      ...record(),
      registration: { clientId: "oaiapp_traini", subject: "runner" },
      credentials: {
        accessToken: "old",
        refreshToken: "old-refresh",
        idToken: "id",
        expiresAt: 0,
      },
    };
    await writeRecord(directory, r);
    try {
      globalThis.fetch = async (url, init) => {
        if (url.endsWith("/token")) {
          assert.equal(init.body.get("refresh_token"), "old-refresh");
          assert.equal(init.body.has("scope"), false);
          return json({
            access_token: "new",
            refresh_token: "new-refresh",
            expires_in: 3600,
            scope: "resource.invoke chatgpt.tokens.use.direct",
            token_type: "Bearer",
          });
        }
        return new Response("", { status: 500 });
      };
      await assert.rejects(checkConnection(directory, owner), /provider/);
      assert.equal(
        (await readRecord(directory)).credentials.refreshToken,
        "new-refresh",
      );
      globalThis.fetch = async () => new Response("", { status: 500 });
      await assert.rejects(disconnect(directory, owner), /revoke/);
      assert.ok((await readRecord(directory)).credentials);
      globalThis.fetch = async (url, init) => {
        assert.ok(url.endsWith("/revoke"));
        assert.equal(init.body.get("token"), "new-refresh");
        return new Response("", { status: 200 });
      };
      const status = await disconnect(directory, owner);
      assert.equal(status.connected, false);
      const after = await readRecord(directory);
      assert.equal(after.registration.clientId, r.registration.clientId);
      assert.equal(after.hostId, r.hostId);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }));
function route({ denied = false } = {}) {
  let calls = 0;
  const backend = {
    localConnectionAvailable: () => true,
    connectionStatus: async () => {
      calls++;
      return { connected: false };
    },
    startConnection: async () => {
      calls++;
      return "url";
    },
    verifyConnection: async () => {
      calls++;
      return {};
    },
    removeConnection: async () => {
      calls++;
      return {};
    },
  };
  const context = {
    exports: {},
    Response,
    URL,
    Error,
    SyntaxError,
    require: (id) => {
      if (id === "@/lib/security/admin")
        return {
          requireAdmin: async () =>
            denied
              ? { response: Response.json({}, { status: 401 }) }
              : { userId: owner },
        };
      if (id === "@/lib/chatgpt/connection") return backend;
      throw new Error(id);
    },
  };
  const compiled = ts.transpileModule(
    readFileSync(
      new URL("../app/api/chatgpt/connection/route.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2017,
      },
    },
  );
  vm.runInNewContext(compiled.outputText, context);
  return { ...context.exports, calls: () => calls };
}
const req = (origin = "http://localhost:3017", extra = {}) =>
  new Request(`${origin}/api/chatgpt/connection`, {
    method: "POST",
    headers: {
      host: new URL(origin).host,
      origin,
      "Content-Type": "application/json",
      ...extra,
    },
    body: JSON.stringify({ action: "connect" }),
  });
test("API requires verified administrator before touching local credentials", async () => {
  const api = route({ denied: true });
  assert.equal((await api.POST(req())).status, 401);
  assert.equal((await api.GET(req())).status, 401);
  assert.equal(api.calls(), 0);
});
test("API rejects remote host, mismatched host, cross-origin and missing origin before starting OAuth", async () => {
  const api = route();
  for (const request of [
    req("https://example.com"),
    req(undefined, { host: "evil.test" }),
    req(undefined, { origin: "https://evil.test" }),
    req(undefined, { origin: "" }),
    req(undefined, { "sec-fetch-site": "cross-site" }),
  ])
    assert.equal((await api.POST(request)).status, 403);
  assert.equal(api.calls(), 0);
  assert.equal((await api.POST(req())).status, 200);
  assert.equal(api.calls(), 1);
});

test("real worker binds only loopback, ignores forged state, handles denial and preserves registration", async () => {
  const { spawn } = await import("node:child_process");
  const home = await fs.mkdtemp(join(tmpdir(), "traini-oauth-worker-"));
  const directory = join(
    home,
    "Library",
    "Application Support",
    "Traini",
    "auth",
    "chatgpt",
  );
  const worker = spawn(
    process.execPath,
    [new URL("../scripts/connect-chatgpt.mjs", import.meta.url).pathname],
    {
      env: { HOME: home, PATH: process.env.PATH, TRAINI_OAUTH_OWNER: owner },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  try {
    const authorizeUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("worker startup timeout")),
        10_000,
      );
      let output = "";
      worker.once("error", reject);
      worker.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.includes("\n")) {
          clearTimeout(timer);
          resolve(JSON.parse(output.split("\n")[0]).authorizeUrl);
        }
      });
    });
    const auth = new URL(authorizeUrl);
    const callback = new URL(auth.searchParams.get("redirect_uri"));
    assert.equal(callback.hostname, "127.0.0.1");
    const saved = await readRecord(directory);
    assert.equal(saved.attempt.state, "pending");
    callback.search = new URLSearchParams({
      state: "forged",
      error: "access_denied",
    });
    assert.equal((await fetch(callback)).status, 400);
    assert.equal((await readRecord(directory)).attempt.state, "pending");
    callback.search = new URLSearchParams({
      state: auth.searchParams.get("state"),
      error: "access_denied",
    });
    const response = await fetch(callback);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(await response.text(), /Traini/);
    await new Promise((resolve) => {
      if (worker.exitCode !== null) resolve();
      else worker.once("exit", resolve);
    });
    const after = await readRecord(directory);
    assert.equal(after.attempt.error, "denied");
    assert.equal(after.hostId, saved.hostId);
    assert.equal(after.credentials, null);
    assert.equal(
      (await fs.readdir(directory)).includes("operation.lock"),
      false,
    );
  } finally {
    worker.kill();
    await fs.rm(home, { recursive: true, force: true });
  }
});

// An expired/revoked renewable grant needs sign-in, rather than repeated checks.
test("invalid_grant requests reauthorization without exposing the provider payload", async () => {
  await assert.rejects(
    loadModels(
      "secret",
      async () =>
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "SECRET",
          }),
          { status: 400 },
        ),
    ),
    /^Error: reconnect$/,
  );
});

test("Next wildcard bind URL accepts the actual loopback Host with matching Origin only", async () => {
  const api = route();
  for (const host of ["localhost:3017", "127.0.0.1:3017"]) {
    const response = await api.POST(
      new Request("http://0.0.0.0:3017/api/chatgpt/connection", {
        method: "POST",
        headers: {
          host,
          origin: `http://${host}`,
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ action: "connect" }),
      }),
    );
    assert.equal(response.status, 200);
  }
  for (const host of [
    "localhost:9999",
    "evil.test:3017",
    "localhost:3017@evil.test",
    "localhost:3017/path",
  ]) {
    const response = await api.POST(
      new Request("http://0.0.0.0:3017/api/chatgpt/connection", {
        method: "POST",
        headers: { host, origin: "http://localhost:3017" },
        body: JSON.stringify({ action: "connect" }),
      }),
    );
    assert.equal(response.status, 403);
  }
});

test("pending authorization resumes only a live, unexpired, same-owner official flow", () => {
  const r = record();
  const pending = createAttempt(r, 54321);
  r.attempt = {
    state: "pending",
    expiresAt: Date.now() + 60000,
    authorizeUrl: pending.authorizeUrl,
    pid: 123,
  };
  assert.equal(
    pendingAuthorization(r, owner, () => true),
    pending.authorizeUrl,
  );
  assert.equal(
    pendingAuthorization(r, owner, () => false),
    null,
  );
  assert.throws(() => pendingAuthorization(r, "attacker", () => true), /owner/);
  r.attempt.authorizeUrl = "https://attacker.test/login";
  assert.equal(
    pendingAuthorization(r, owner, () => true),
    null,
  );
  r.attempt.authorizeUrl = pending.authorizeUrl;
  r.attempt.expiresAt = 0;
  assert.equal(
    pendingAuthorization(r, owner, () => true),
    null,
  );
});
