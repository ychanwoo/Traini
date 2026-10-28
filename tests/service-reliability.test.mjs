import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { consumeResponse } from "../scripts/lib/chatgpt-inference.mjs";
function load(file, modules = {}, extra = {}) {
  const c = {
    exports: {},
    Date,
    Intl,
    Response,
    Request,
    URL,
    Buffer,
    AbortSignal,
    AbortController,
    Error,
    process,
    require: (id) => {
      if (!(id in modules)) throw new Error("Unexpected " + id);
      return modules[id];
    },
    ...extra,
  };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../" + file, import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2023,
        },
      },
    ).outputText,
    c,
  );
  return c.exports;
}
test("slow polling reads are not repeatedly cancelled, while explicit cancellation permits a fresh read", () => {
  const { ReadRequestGate } = load("lib/http/client-request.ts");
  const gate = new ReadRequestGate();
  const a = gate.start();
  assert.ok(a);
  assert.equal(gate.start(), null);
  assert.equal(gate.start(), null);
  assert.equal(a.signal.aborted, false);
  gate.abort();
  assert.equal(a.signal.aborted, true);
  const b = gate.start();
  assert.ok(b);
  gate.finish(a);
  assert.equal(
    gate.start(),
    null,
    "late completion must not release a newer read",
  );
  gate.finish(b);
  assert.ok(gate.start());
});
test("browser mutation is sent exactly once on network failure and never exposes raw details", async () => {
  let calls = 0;
  const api = load(
    "lib/http/client-request.ts",
    {},
    {
      fetch: async () => {
        calls++;
        throw new Error("PRIVATE transport internals");
      },
    },
  );
  await assert.rejects(
    api.requestJson("/api/training/feedback", {
      method: "POST",
      body: { test: true },
    }),
    (e) => !/PRIVATE/.test(e.message) && /연결/.test(e.message),
  );
  assert.equal(calls, 1);
});
test("browser response handling normalizes expired auth, malformed HTML and partial JSON", async () => {
  for (const response of [
    new Response("<secret token>", { status: 401 }),
    new Response("<secret token>", { status: 503 }),
    Response.json([]),
  ]) {
    const api = load(
      "lib/http/client-request.ts",
      {},
      { fetch: async () => response },
    );
    await assert.rejects(
      api.requestJson("/api/training/plan"),
      (e) => !/secret|Unexpected token/.test(e.message),
    );
  }
  const api = load(
    "lib/http/client-request.ts",
    {},
    {
      fetch: async () =>
        Response.json({ error: "최근 24시간 한도" }, { status: 429 }),
    },
  );
  await assert.rejects(
    api.requestJson("/api/training/generate", { method: "POST" }),
    (e) => e.status === 429 && e.message === "최근 24시간 한도",
  );
});
test("browser timeouts keep uncertainty explicit rather than claiming an operation rolled back", async () => {
  const api = load(
    "lib/http/client-request.ts",
    {},
    {
      fetch: async (_url, { signal }) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        signal.throwIfAborted();
      },
    },
  );
  await assert.rejects(
    api.requestJson("/api/training/generate", { method: "POST", timeoutMs: 1 }),
    /저장 여부를 먼저 확인/,
  );
});
class PlanError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
function planService({
  lost = false,
  unknown = false,
  readError = false,
  providerError = null,
} = {}) {
  let committed = false,
    calls = 0,
    failures = 0;
  const store = {
    revision: async () => "same",
    readPlan: async () => {
      if (committed && readError) throw new PlanError("storage");
      return { plan: committed ? { id: "saved" } : null, inputsChanged: false };
    },
    reserveGeneration: async () => ({ state: "started", requestId: "one" }),
    savePlan: async () => {
      committed = true;
      if (lost) throw new PlanError("storage");
    },
    failGeneration: async () => {
      failures++;
    },
    generationState: async () => {
      if (unknown) throw new Error("unreachable");
      return committed ? "completed" : "running";
    },
  };
  const handler = load("lib/training/plan-service.ts", {
    "server-only": {},
    "./plan-storage": store,
    "./storage": {
      readTrainingContext: async () => ({ timezone: "America/Los_Angeles" }),
    },
    "./review-storage": { readApplicableReview: async () => null },
    "./weekly-review": { applyReviewPolicy: (p) => p },
    "./prescription-storage": {
      readPrescriptionEvidence: async () => ({
        execution: null,
        current: null,
      }),
    },
    "./prescription": { refinePrescription: (_c, p) => ({ policy: p }) },
    "./weekly-plan": {
      PlanError,
      planPolicy: () => ({ start: "2026-10-19" }),
      accountCurrentWeek: (p) => p,
      finalizePlanPolicy: (p) => p,
      PLAN_VALIDATION_REASONS: [],
      validatePlan: (c) => c,
      trainingPrompt: () => ({}),
    },
    "@/scripts/lib/chatgpt-inference.mjs": {
      generateWithSubscription: async () => {
        calls++;
        if (providerError) throw new Error(providerError);
        return { content: { workouts: [] }, model: "fake" };
      },
    },
  });
  return {
    run: () => handler.generatePlan("owner", "next"),
    counts: () => ({ calls, failures }),
  };
}
test("a committed plan with a lost save response is read back without new inference", async () => {
  const s = planService({ lost: true });
  assert.equal((await s.run()).plan.id, "saved");
  assert.deepEqual(s.counts(), { calls: 1, failures: 0 });
});
test("post-commit read failure never marks a successful generation failed", async () => {
  const s = planService({ readError: true });
  await assert.rejects(s.run(), /storage/);
  assert.deepEqual(s.counts(), { calls: 1, failures: 0 });
});
test("uncertain plan commit retains its lease, while provider limits stop without retry", async () => {
  const uncertain = planService({ lost: true, unknown: true });
  await assert.rejects(uncertain.run(), /storage/);
  assert.deepEqual(uncertain.counts(), { calls: 1, failures: 0 });
  const limited = planService({ providerError: "limited" });
  await assert.rejects(limited.run(), /limited/);
  assert.deepEqual(limited.counts(), { calls: 1, failures: 1 });
});
test("provider permission denial stays actionable and never returns the provider body", async () => {
  await assert.rejects(
    consumeResponse(new Response("PRIVATE provider body", { status: 403 })),
    /^Error: permission$/,
  );
});
test("generation status API is admin-only, read-only, owner-scoped and private", async () => {
  let reads = 0;
  const handler = (allowed) =>
    load("app/api/training/generation-status/route.ts", {
      "@/lib/security/json-request": load("lib/security/json-request.ts"),
    "@/lib/security/admin": {
        requireAdmin: async () =>
          allowed
            ? { userId: "verified" }
            : { response: Response.json({ error: "denied" }, { status: 403 }) },
      },
      "@/lib/training/generation-status": {
        readGenerationStatus: async (uid) => {
          assert.equal(uid, "verified");
          reads++;
          return { quota: { remaining: 5 } };
        },
      },
    });
  const url = "http://localhost:3017/api/training/generation-status";
  assert.equal((await handler(false).GET(new Request(url))).status, 403);
  assert.equal(reads, 0);
  assert.equal(
    (await handler(true).GET(new Request(url + "?userId=other"))).status,
    400,
  );
  assert.equal(reads, 0);
  const response = await handler(true).GET(new Request(url));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(reads, 1);
});
test("Garmin status storage failure produces sanitized retryable JSON", async () => {
  const handler = load("app/api/garmin/sync/route.ts", {
    "@/lib/security/json-request": load("lib/security/json-request.ts"),
    "@/lib/security/admin": { requireAdmin: async () => ({ userId: "owner" }) },
    "@/lib/garmin/local-collector": {
      collectionSnapshot: async () => {
        throw new Error("private filesystem path");
      },
    },
  });
  const response = await handler.GET(
    new Request("http://localhost:3017/api/garmin/sync"),
  );
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private filesystem/);
});
