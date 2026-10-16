import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import ts from "typescript";

function load(file, modules = {}, extra = {}) {
  const context = { exports: {}, Response, URL, Date, Intl, setTimeout, clearTimeout, process,
    require: (id) => { if (!(id in modules)) throw new Error(`Unexpected import ${id}`); return modules[id]; }, ...extra };
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, context);
  return context.exports;
}
const schema = load("lib/garmin/collection.ts");

test("retired OAuth and webhook routes reject requests without accessing credentials or the database", async () => {
  for (const [route, method] of [["connect", "GET"], ["callback", "GET"], ["webhook", "POST"]]) {
    const api = load(`app/api/garmin/${route}/route.ts`);
    const response = await api[method](new Request("https://traini.test/api/garmin/" + route, { method }));
    assert.equal(response.status, 410);
  }
});

const job = {
  id: "8e654a26-c58a-482f-96d4-8a78660f9b24", pid: 123,
  status: "running", stage: "collecting", startedAt: new Date().toISOString(),
  finishedAt: null, errorCode: null,
  period: { start: "2026-10-05", end: "2026-10-11", timezone: "America/Los_Angeles", secret: "hidden" },
  counts: { found: 6, downloaded: 0, skipped: 6, failed: 0 }, token: "hidden",
};

test("period uses the configured timezone at a Monday boundary", () => {
  const now = new Date("2026-10-12T00:30:00Z");
  assert.equal(schema.previousWeek("America/Los_Angeles", now).start, "2026-09-28");
  assert.equal(schema.previousWeek("Asia/Seoul", now).start, "2026-10-05");
});
test("public job projection excludes extra fields and invalid counts", () => {
  const parsed = schema.parseJob(job);
  assert.ok(parsed);
  assert.equal(parsed.pid, undefined);
  assert.doesNotMatch(JSON.stringify(parsed), /hidden|token|secret/);
  assert.equal(schema.parseJob({ ...job, counts: { ...job.counts, failed: -1 } }), null);
  assert.equal(schema.parseJob({ ...job, errorCode: "private-exception-details" }), null);
});

function collector({ enabled = true, currentJob = null, alive = true, handshake = "started" } = {}) {
  let spawned;
  const fakeProcess = { env: { TRAINI_LOCAL_COLLECTOR_ENABLED: String(enabled), TRAINI_COLLECTOR_PYTHON: "/project/collector/.venv/bin/python", SUPABASE_SERVICE_ROLE_KEY: "must-not-inherit" },
    platform: "darwin", cwd: () => "/project", kill: () => { if (!alive) throw new Error("not found"); } };
  const api = load("lib/garmin/local-collector.ts", {
    "./collection": schema,
    "node:fs/promises": {
      access: async () => {},
      lstat: async () => {
        if (!currentJob) throw Object.assign(new Error(), { code: "ENOENT" });
        return { isSymbolicLink: () => false, isFile: () => true, size: 1000 };
      },
      readFile: async () => JSON.stringify(currentJob),
    },
    "node:fs": { constants: { X_OK: 1 } },
    "node:os": { homedir: () => "/private-home" },
    "node:path": { join: (...parts) => parts.join("/"), isAbsolute: (value) => value.startsWith("/") },
    "node:child_process": { spawn: (file, args, options) => {
      spawned = { file, args, options };
      const child = new EventEmitter();
      child.stdout = new PassThrough(); child.kill = () => {}; child.unref = () => {};
      setTimeout(() => child.stdout.write(JSON.stringify({ kind: handshake }) + "\n"), 0);
      return child;
    } },
  }, { process: fakeProcess });
  return { api, spawned: () => spawned };
}
test("local collection requires explicit enablement", async () => {
  const { api, spawned } = collector({ enabled: false });
  assert.equal((await api.collectionSnapshot()).available, false);
  await assert.rejects(api.startCollection(), (error) => error.code === "local_only");
  assert.equal(spawned(), undefined);
});
test("running job prevents another subprocess", async () => {
  const { api, spawned } = collector({ currentJob: job });
  await assert.rejects(api.startCollection(), (error) => error.code === "busy");
  assert.equal(spawned(), undefined);
});
test("dead worker is reported as interrupted", async () => {
  const { api } = collector({ currentJob: job, alive: false });
  const snapshot = await api.collectionSnapshot();
  assert.equal(snapshot.job.status, "failed");
  assert.equal(snapshot.job.errorCode, "interrupted");
});
test("worker invocation uses fixed arguments and excludes service credentials", async () => {
  const { api, spawned } = collector();
  await api.startCollection();
  const command = spawned();
  assert.equal(command.file, "/project/collector/.venv/bin/python");
  assert.deepEqual(Array.from(command.args), ["-m", "traini_collector.web", "--timezone", "America/Los_Angeles"]);
  assert.equal(command.options.shell, undefined);
  assert.equal(command.options.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
});
test("worker OS lock busy response is propagated", async () => {
  const { api } = collector({ handshake: "busy" });
  await assert.rejects(api.startCollection(), (error) => error.code === "busy");
});

test("route rejects unauthenticated and cross-origin requests before starting work", async () => {
  let started = 0;
  let allowed = false;
  const route = load("app/api/garmin/sync/route.ts", {
    "@/lib/security/admin": { requireAdmin: async () => allowed ? { userId: "owner" } : { response: Response.json({}, { status: 401 }) } },
    "@/lib/garmin/local-collector": { CollectionStartError: Error, collectionSnapshot: async () => ({}), startCollection: async () => { started++; } },
  });
  assert.equal((await route.POST(new Request("http://localhost/api/garmin/sync", { method: "POST" }))).status, 401);
  assert.equal((await route.GET(new Request("http://localhost/api/garmin/sync"))).status, 401);
  allowed = true;
  assert.equal((await route.POST(new Request("http://localhost/api/garmin/sync", { method: "POST", headers: { origin: "http://other-site" } }))).status, 403);
  assert.equal(started, 0);
  assert.equal((await route.POST(new Request("http://localhost/api/garmin/sync", { method: "POST", headers: { origin: "http://localhost" } }))).status, 202);
  assert.equal(started, 1);
  assert.equal((await route.POST(new Request("http://0.0.0.0:3017/api/garmin/sync", {
    method: "POST", headers: { origin: "http://localhost:3017", host: "localhost:3017" },
  }))).status, 202);
  assert.equal(started, 2);
});
