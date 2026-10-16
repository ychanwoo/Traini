import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(file, modules = {}, extra = {}) {
  const context = { exports: {}, Response, URL, Date, Intl, AbortSignal, process,
    require: (id) => { if (!(id in modules)) throw new Error(`Unexpected import ${id}`); return modules[id]; }, ...extra };
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  return context.exports;
}
const summary = load("lib/garmin/running-summary.ts");
const now = new Date("2026-10-16T05:00:00Z");
const previous = () => summary.runningPeriod("America/Los_Angeles", "previous", now);
const row = (id, changes = {}) => ({ garmin_activity_id: String(id), started_at: "2026-10-12T06:00:00Z",
  updated_at: "2026-10-16T01:00:00Z", distance_meters: 5000, duration_seconds: 1800,
  average_pace_seconds_per_km: 360, ...changes });

const plain = (value) => JSON.parse(JSON.stringify(value));

test("current and previous periods use the configured calendar and never the host timezone", () => {
  const boundary = new Date("2026-10-12T00:30:00Z");
  assert.equal(summary.runningPeriod("America/Los_Angeles", "current", boundary).start, "2026-10-05");
  assert.equal(summary.runningPeriod("America/Los_Angeles", "previous", boundary).end, "2026-10-04");
  assert.equal(summary.runningPeriod("Asia/Seoul", "current", boundary).start, "2026-10-12");
  assert.equal(previous().start, "2026-10-05");
});
test("calendar weeks cover leap dates, year changes, and both DST transitions", () => {
  const cases = [
    ["2027-01-01T12:00:00Z", "2026-12-28", "2027-01-03"],
    ["2028-02-29T12:00:00Z", "2028-02-28", "2028-03-05"],
    ["2026-03-08T12:00:00Z", "2026-03-02", "2026-03-08"],
    ["2026-11-01T12:00:00Z", "2026-10-26", "2026-11-01"],
  ];
  for (const [instant, start, end] of cases) {
    const period = summary.runningPeriod("America/Los_Angeles", "current", new Date(instant));
    assert.equal(period.start, start); assert.equal(period.end, end);
  }
});
test("exact local Monday start and next Monday end are correctly bounded", () => {
  const rows = [row(1, { started_at: "2026-10-05T06:59:59Z" }), row(2, { started_at: "2026-10-05T07:00:00Z" }),
    row(3, { started_at: "2026-10-12T06:59:59Z" }), row(4, { started_at: "2026-10-12T07:00:00Z" })];
  const result = summary.buildRunningSummary(rows, previous());
  assert.deepEqual(plain(result.activities.map((a) => a.id)), ["3", "2"]);
  assert.equal(result.days[0].activityCount, 1); assert.equal(result.days[6].activityCount, 1);
});
test("DST changes use the start instant and preserve the Sunday training date", () => {
  const period = summary.runningPeriod("America/Los_Angeles", "current", new Date("2026-11-01T20:00:00Z"));
  const result = summary.buildRunningSummary([row(1, { started_at: "2026-11-01T08:30:00Z" }),
    row(2, { started_at: "2026-11-01T09:30:00Z" }), row(3, { started_at: "2026-11-02T07:59:59Z" }),
    row(4, { started_at: "2026-11-02T08:00:00Z" })], period);
  assert.equal(result.totals.activityCount, 3);
  assert.equal(result.days[6].activityCount, 3);
});
test("classification is recalculated when the configured timezone changes", () => {
  const result = summary.buildRunningSummary([row(1, { training_date: "2026-10-12", training_timezone: "Asia/Seoul" })], previous());
  assert.equal(result.activities[0].trainingDate, "2026-10-11");
});
test("pace uses paired total duration over distance rather than averaging activities", () => {
  const result = summary.buildRunningSummary([row(1, { distance_meters: 1000, duration_seconds: 240 }),
    row(2, { distance_meters: 9000, duration_seconds: 3600 })], previous());
  assert.equal(result.totals.distanceMeters, 10000);
  assert.equal(result.totals.timerSeconds, 3840);
  assert.equal(result.totals.paceSecondsPerKm, 384);
  assert.equal(result.coverage.paceCount, 2);
});
test("missing values never pair metrics belonging to different activities", () => {
  const result = summary.buildRunningSummary([row(1, { distance_meters: 1000, duration_seconds: null }),
    row(2, { distance_meters: null, duration_seconds: 3600 }), row(3)], previous());
  assert.equal(result.totals.distanceMeters, 6000);
  assert.equal(result.totals.timerSeconds, 5400);
  assert.equal(result.totals.paceSecondsPerKm, 360);
  assert.deepEqual(plain(result.coverage), { distanceCount: 2, timerCount: 2, paceCount: 1 });
});
test("an empty week differs from a week whose metrics are all missing", () => {
  const empty = summary.buildRunningSummary([], previous());
  assert.equal(empty.totals.distanceMeters, 0); assert.equal(empty.totals.timerSeconds, 0);
  assert.equal(empty.totals.paceSecondsPerKm, null); assert.equal(empty.days.length, 7);
  const missing = summary.buildRunningSummary([row(1, { distance_meters: null, duration_seconds: null, average_pace_seconds_per_km: null })], previous());
  assert.equal(missing.totals.activityCount, 1); assert.equal(missing.totals.distanceMeters, null);
  assert.equal(missing.totals.timerSeconds, null); assert.equal(missing.totals.paceSecondsPerKm, null);
});
test("zero distance and timer stay valid totals but are excluded from pace", () => {
  const result = summary.buildRunningSummary([row(1, { distance_meters: 0, duration_seconds: 0, average_pace_seconds_per_km: null })], previous());
  assert.equal(result.totals.distanceMeters, 0); assert.equal(result.totals.timerSeconds, 0);
  assert.equal(result.totals.paceSecondsPerKm, null); assert.equal(result.coverage.paceCount, 0);
});
test("malformed records, duplicates, and invalid numeric values fail without fake totals", () => {
  for (const value of [-1, NaN, Infinity, true, "", "not-a-number", undefined]) {
    assert.throws(() => summary.buildRunningSummary([row(1, { distance_meters: value })], previous()));
  }
  assert.throws(() => summary.buildRunningSummary([row(1), row(1)], previous()));
  assert.throws(() => summary.buildRunningSummary([row(1, { started_at: "bad" })], previous()));
  assert.throws(() => summary.buildRunningSummary([row(1, { garmin_activity_id: 1 })], previous()));
  const numeric = summary.buildRunningSummary([row(1, { distance_meters: "5000.25", duration_seconds: "1800.125" })], previous());
  assert.equal(numeric.totals.distanceMeters, 5000.25);
});
test("public summary contains only projected activity data", () => {
  const result = summary.buildRunningSummary([row(1, { user_id: "private-owner", source_file: "private-file", raw_payload: "private-raw", source_sha256: "private-hash" })], previous());
  assert.doesNotMatch(JSON.stringify(result), /private-/);
  assert.equal(result.lastUpdatedAt, "2026-10-16T01:00:00Z");
});
test("display formatting carries seconds correctly and keeps missing values distinct", () => {
  assert.equal(summary.paceLabel(299.8), "5′00″");
  assert.equal(summary.durationLabel(3599.8), "1시간 0분");
  assert.equal(summary.durationLabel(59.8), "1분 0초");
  assert.equal(summary.distanceLabel(0), "0"); assert.equal(summary.distanceLabel(null), "—");
  assert.equal(summary.paceLabel(null), "—");
  assert.match(summary.periodLabel(summary.runningPeriod("UTC", "current", new Date("2027-01-01"))), /2026.*2027/);
});

function reader(pages, env = {}) {
  const calls = [];
  let index = 0;
  const database = { from: (table) => {
    calls.push(["from", table]);
    const query = {};
    for (const method of ["select", "eq", "gte", "lt", "order", "range"]) query[method] = (...args) => {
      calls.push([method, ...args]); return query;
    };
    query.abortSignal = () => Promise.resolve(pages[index++]);
    return query;
  } };
  const api = load("lib/garmin/read-running-summary.ts", {
    "@/lib/supabase/admin": { getSupabaseAdmin: () => database }, "./running-summary": summary,
  }, { process: { env } });
  return { ...api, calls };
}
test("reader filters the verified owner, FIT source, sport and bounded UTC window", async () => {
  const api = reader([{ data: [row(1)], count: 1, error: null }]);
  const result = await api.readRunningSummary("verified-owner", "previous", now);
  assert.equal(result.totals.activityCount, 1);
  for (const filter of [["eq", "user_id", "verified-owner"], ["eq", "source", "garmin_fit"], ["eq", "activity_type", "running"]]) {
    assert.ok(api.calls.some((call) => JSON.stringify(call) === JSON.stringify(filter)));
  }
  assert.ok(api.calls.some((call) => call[0] === "gte" && call[2] === "2026-10-03T00:00:00Z"));
  const columns = api.calls.find((call) => call[0] === "select")[1];
  assert.doesNotMatch(columns, /raw_payload|sha256|user_id|source_file/);
});
test("pagination handles a server page cap below the requested size", async () => {
  const api = reader([{ data: [row(1)], count: 3 }, { data: [row(2)], count: 3 }, { data: [row(3)], count: 3 }]);
  const result = await api.readRunningSummary("owner", "previous", now);
  assert.equal(result.totals.activityCount, 3);
  assert.deepEqual(api.calls.filter((call) => call[0] === "range").map((call) => call[1]), [0, 1, 2]);
});
test("query errors, missing rows, changing counts, limits, and invalid timezones fail closed", async () => {
  const cases = [[{ data: null, count: null, error: { message: "private-db-error" } }],
    [{ data: [], count: 1 }], [{ data: [row(1)], count: 2 }, { data: [row(2)], count: 3 }],
    [{ data: [], count: 10001 }], [{ data: [], count: null }]];
  for (const pages of cases) await assert.rejects(reader(pages).readRunningSummary("owner", "previous", now));
  await assert.rejects(reader([], { TRAINI_TIMEZONE: "invalid/timezone" }).readRunningSummary("owner", "previous", now));
});

function route({ access = { userId: "verified-owner" }, failure = false } = {}) {
  let received;
  const api = load("app/api/garmin/weekly-summary/route.ts", {
    "@/lib/security/admin": { requireAdmin: async () => access },
    "@/lib/garmin/read-running-summary": { readRunningSummary: async (...args) => {
      received = args;
      if (failure) throw new Error("private database/schema details");
      return { ok: true };
    } },
  });
  return { ...api, received: () => received };
}
test("route never queries when authentication fails", async () => {
  for (const status of [401, 403, 503]) {
    const api = route({ access: { response: new Response(null, { status }) } });
    const result = await api.GET(new Request("https://traini.test/api/garmin/weekly-summary"));
    assert.equal(result.status, status); assert.equal(api.received(), undefined);
  }
});
test("caller-supplied owner or timezone cannot change query scope", async () => {
  const api = route();
  const result = await api.GET(new Request("https://traini.test/api/garmin/weekly-summary?week=previous&userId=attacker&timezone=UTC"));
  assert.equal(result.status, 200);
  assert.deepEqual(api.received(), ["verified-owner", "previous"]);
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.equal(result.headers.get("vary"), "Authorization");
});
test("invalid selections reject and database failures do not look like empty weeks", async () => {
  for (const week of ["", "custom", "2026-10-05"]) {
    const api = route();
    assert.equal((await api.GET(new Request(`https://traini.test/api/garmin/weekly-summary?week=${week}`))).status, 400);
    assert.equal(api.received(), undefined);
  }
  const result = await route({ failure: true }).GET(new Request("https://traini.test/api/garmin/weekly-summary"));
  assert.equal(result.status, 503);
  assert.doesNotMatch(await result.text(), /private|schema|database/);
});
