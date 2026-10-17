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
const OWNER = "11111111-1111-4111-8111-111111111111";
const schema = load("lib/garmin/collection.ts", {"./running-summary": load("lib/garmin/running-summary.ts")});

test("retired OAuth and webhook routes remain retired after administrator authorization", async () => {
  for (const [route, method] of [["connect", "GET"], ["callback", "GET"], ["webhook", "POST"]]) {
    const api = load(`app/api/garmin/${route}/route.ts`, { "@/lib/security/json-request": load("lib/security/json-request.ts"),
    "@/lib/security/admin": { requireAdmin: async () => ({ userId: OWNER }) } });
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

function collector({ enabled = true, currentJob = null, alive = true, handshake = "started", configuration = true, timezone = "America/Los_Angeles" } = {}) {
  let spawned;
  const fakeProcess = { env: { TRAINI_LOCAL_COLLECTOR_ENABLED: String(enabled), TRAINI_COLLECTOR_PYTHON: "/project/collector/.venv/bin/python", SUPABASE_SERVICE_ROLE_KEY: configuration ? "server-only-key" : undefined,
      NEXT_PUBLIC_SUPABASE_URL: "https://kmmutfcgshellvjgpick.supabase.co", TRAINI_ADMIN_USER_ID: OWNER,
      TRAINI_TIMEZONE: timezone, WEATHER_API_KEY: "must-not-inherit" },
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
  await assert.rejects(api.startCollection(OWNER), (error) => error.code === "local_only");
  assert.equal(spawned(), undefined);
});
test("running job prevents another subprocess", async () => {
  const { api, spawned } = collector({ currentJob: job });
  await assert.rejects(api.startCollection(OWNER), (error) => error.code === "busy");
  assert.equal(spawned(), undefined);
});
test("dead worker is reported as interrupted", async () => {
  const { api } = collector({ currentJob: job, alive: false });
  const snapshot = await api.collectionSnapshot();
  assert.equal(snapshot.job.status, "failed");
  assert.equal(snapshot.job.errorCode, "interrupted");
});
test("worker invocation uses fixed arguments and only necessary server credentials", async () => {
  const { api, spawned } = collector();
  await api.startCollection(OWNER);
  const command = spawned();
  assert.equal(command.file, "/project/collector/.venv/bin/python");
  assert.deepEqual(Array.from(command.args), ["-m", "traini_collector.web", "--timezone", "America/Los_Angeles", "--start", schema.collectionPeriod("America/Los_Angeles").start, "--end", schema.collectionPeriod("America/Los_Angeles").end]);
  assert.equal(command.options.shell, undefined);
  assert.equal(command.options.env.SUPABASE_SERVICE_ROLE_KEY, "server-only-key");
  assert.equal(command.options.env.TRAINI_ADMIN_USER_ID, OWNER);
  assert.equal(command.options.env.WEATHER_API_KEY, undefined);
  assert.doesNotMatch(JSON.stringify(command.args), /server-only-key|must-not-inherit/);
  assert.doesNotMatch(JSON.stringify(await api.collectionSnapshot()), /server-only-key|must-not-inherit/);
});
test("worker OS lock busy response is propagated", async () => {
  const { api } = collector({ handshake: "busy" });
  await assert.rejects(api.startCollection(OWNER), (error) => error.code === "busy");
});

test("route rejects unauthenticated and cross-origin requests before starting work", async () => {
  let started = 0;
  let allowed = false;
  const route = load("app/api/garmin/sync/route.ts", {
    "@/lib/security/json-request": load("lib/security/json-request.ts"),
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


test("missing upload configuration and unverified owner never start a worker", async () => {
  const missing = collector({ configuration: false });
  assert.equal((await missing.api.collectionSnapshot()).notice, "upload_setup_required");
  await assert.rejects(missing.api.startCollection(OWNER), error => error.code === "upload_setup_required");
  assert.equal(missing.spawned(), undefined);
  const ready = collector();
  await assert.rejects(ready.api.startCollection("another-owner"), error => error.code === "upload_setup_required");
  assert.equal(ready.spawned(), undefined);
});

test("invalid timezone fails closed rather than importing a different week", async () => {
  const { api, spawned } = collector({ timezone: "invalid/zone" });
  assert.equal((await api.collectionSnapshot()).notice, "timezone_invalid");
  await assert.rejects(api.startCollection(OWNER), error => error.code === "timezone_invalid");
  assert.equal(spawned(), undefined);
});

const pipelineJob = {
  ...job, version: 2, stage: "uploading", uploadStarted: true, failedStage: null,
  parsing: { found: 6, processed: 6, skipped: 0, failed: 0, private: "hidden" },
  upload: { found: 6, eligible: 6, validated: 0, inserted: 2, updated: 1, unchanged: 3, failed: 0, excluded: 0, key: "hidden" },
};
test("versioned pipeline projects only stage counters and keeps legacy results distinct", () => {
  const parsed = schema.parseJob(pipelineJob);
  assert.equal(parsed.version, 2);
  assert.equal(parsed.stage, "uploading");
  assert.equal(parsed.upload.inserted, 2);
  assert.equal(parsed.uploadStarted, true);
  assert.doesNotMatch(JSON.stringify(parsed), /hidden|pid|private/);
  const legacy = schema.parseJob(job);
  assert.equal(legacy.version, 1);
  assert.equal(legacy.upload, null);
  assert.equal(legacy.uploadStarted, false);
  for (const change of [{ upload: null }, { uploadStarted: "true" }, { version: 3 },
    { failedStage: "private-details" }, { upload: { ...pipelineJob.upload, inserted: -1 } }]) {
    assert.equal(schema.parseJob({ ...pipelineJob, ...change }), null);
  }
});
test("interrupted upload retains acknowledged writes and triggers summary refresh eligibility", async () => {
  const { api } = collector({ currentJob: pipelineJob, alive: false });
  const { job: interrupted } = await api.collectionSnapshot();
  assert.equal(interrupted.status, "failed");
  assert.equal(interrupted.failedStage, "uploading");
  assert.equal(interrupted.upload.inserted, 2);
  assert.equal(interrupted.uploadStarted, true);
});
