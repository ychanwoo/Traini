import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadAdmin({ adminId = "owner", user = { id: "owner" }, error = null, throws = false } = {}) {
  let verifiedToken;
  let cookieRead = false;
  const context = {
    exports: {}, Response,
    process: { env: { TRAINI_ADMIN_USER_ID: adminId } },
    require: (id) => id.endsWith("/server") ? { getSupabaseServerClient: async () => { cookieRead = true; return { auth: { getUser: async () => ({ data: { user: null }, error: null }) } }; } } : ({ getSupabaseAdmin: () => ({ auth: { getUser: async (token) => {
      verifiedToken = token;
      if (throws) throw new Error("network failure");
      return { data: { user }, error };
    } } }) }),
  };
  const source = readFileSync(new URL("../lib/security/admin.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  vm.runInNewContext(compiled.outputText, context);
  return { requireAdmin: context.exports.requireAdmin, token: () => verifiedToken, cookieRead: () => cookieRead };
}

test("missing credentials return 401 and malformed bearer tokens are rejected", async () => {
  for (const authorization of [null, "owner", "Bearer", "Bearer token extra"]) {
    const admin = loadAdmin();
    const headers = authorization ? { authorization } : {};
    const result = await admin.requireAdmin(new Request("http://localhost", { headers }));
    assert.equal(result.response.status, 401);
    assert.equal(admin.token(), undefined);
  }
});

test("unconfigured admin fails closed", async () => {
  const admin = loadAdmin({ adminId: "" });
  const result = await admin.requireAdmin(new Request("http://localhost", { headers: { authorization: "Bearer valid" } }));
  assert.equal(result.response.status, 503);
  assert.equal(admin.token(), undefined);
});

test("only the server-verified allowlisted user is accepted", async () => {
  const admin = loadAdmin();
  const result = await admin.requireAdmin(new Request("http://localhost?userId=attacker", { headers: { authorization: "Bearer valid-token" } }));
  assert.equal(result.userId, "owner");
  assert.equal(result.response, undefined);
  assert.equal(admin.token(), "valid-token");
});

test("other authenticated users are denied", async () => {
  const { requireAdmin } = loadAdmin({ user: { id: "other" } });
  const result = await requireAdmin(new Request("http://localhost", { headers: { authorization: "Bearer valid" } }));
  assert.equal(result.response.status, 403);
});

test("expired and invalid tokens are rejected", async () => {
  for (const options of [{ user: null }, { error: new Error("invalid") }]) {
    const { requireAdmin } = loadAdmin(options);
    const result = await requireAdmin(new Request("http://localhost", { headers: { authorization: "Bearer expired" } }));
    assert.equal(result.response.status, 401);
  }
});

test("network failure does not expose provider error details", async () => {
  const { requireAdmin } = loadAdmin({ throws: true });
  const result = await requireAdmin(new Request("http://localhost", { headers: { authorization: "Bearer valid" } }));
  assert.equal(result.response.status, 503);
  assert.doesNotMatch(await result.response.text(), /network failure/);
});
