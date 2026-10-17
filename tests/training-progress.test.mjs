import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(file, modules = {}) {
  const context = {
    exports: {},
    Response,
    Request,
    URL,
    Buffer,
    AbortSignal,
    Date,
    Intl,
    Error,
    process,
    require: (id) => {
      if (!(id in modules)) throw new Error(`Unexpected import ${id}`);
      return modules[id];
    },
  };
  const compiled = ts.transpileModule(
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
    {
      reportDiagnostics: true,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2017,
      },
    },
  );
  assert.equal(
    compiled.diagnostics?.filter(
      (d) => d.category === ts.DiagnosticCategory.Error,
    ).length ?? 0,
    0,
  );
  vm.runInNewContext(compiled.outputText, context);
  return context.exports;
}
const running = load("lib/garmin/running-summary.ts"),
  goal = load("lib/training/goal.ts");
const matching = load("lib/training/workout-matching.ts", {
  "@/lib/garmin/running-summary": running,
});
const review = load("lib/training/weekly-review.ts", {
  "@/lib/garmin/running-summary": running,
  "./goal": goal,
  "./workout-matching": matching,
});
const progress = load("lib/training/progress.ts", {
  "@/lib/garmin/running-summary": running,
  "./goal": goal,
  "./weekly-review": review,
});
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture(today = "2026-10-16", timezone = "America/Los_Angeles") {
  const period = running.runningPeriod(
    timezone,
    "current",
    new Date(today + "T18:00:00Z"),
  );
  const start = running.addCalendarDays(period.start, -56);
  const context = {
    generatedAt: today + "T18:00:00Z",
    asOfDate: today,
    timezone,
    history: {
      start,
      end: running.addCalendarDays(period.start, -1),
      weeks: [],
    },
    goal: { races: [] },
  };
  const snapshots = Array.from({ length: 8 }, (_, i) => {
    const startsOn = running.addCalendarDays(start, i * 7);
    return {
      startsOn,
      endsOn: running.addCalendarDays(startsOn, 6),
      timezone,
      source: {
        planId: null,
        timezone,
        today,
        workouts: [],
        links: [],
        activities: [],
      },
    };
  });
  return {
    context,
    snapshots,
    current: running.buildRunningSummary([], period),
    plan: null,
  };
}
function activity(n, date, distance = 10000, timer = 3000) {
  return {
    id: id(n),
    garminId: String(n),
    startedAt: date + "T19:00:00Z",
    distanceMeters: distance,
    timerSeconds: timer,
    paceSecondsPerKm: 999,
    verified: true,
    revision: "a".repeat(32),
    evidence: null,
  };
}
function build(f) {
  return progress.buildProgressInsights(
    f.context,
    f.current,
    f.snapshots,
    f.plan,
    false,
  );
}
function fill(f, index, values) {
  f.snapshots[index].source.activities = values.map(([d, t], n) =>
    activity(index * 10 + n + 1, f.snapshots[index].startsOn, d, t),
  );
}
test("empty history stays unknown and produces no fake readiness, recovery or predictions", () => {
  const p = build(fixture());
  assert.equal(p.totals.activityCount, 0);
  for (const key of [
    "recordedDistanceMeters",
    "averageRecordedWeekMeters",
    "paceSecondsPerKm",
    "longestRunMeters",
  ])
    assert.equal(p.totals[key], null);
  assert.ok(
    p.weeks.every(
      (w) => w.distanceMeters === null && w.performance.plannedKm === null,
    ),
  );
  assert.equal(p.comparison, null);
  assert.equal(p.current.performance, null);
  assert.equal(p.current.distanceMeters, null);
  assert.equal(p.races.length, 0);
});
test("pace uses paired total timer / total distance and never stored or arithmetic-average paces", () => {
  const f = fixture();
  fill(f, 7, [
    [1000, 200],
    [9000, 3600],
    [5000, null],
    [null, 1000],
  ]);
  const p = build(f);
  assert.equal(p.totals.paceSecondsPerKm, 380);
  assert.equal(p.weeks[7].paceSecondsPerKm, 380);
  assert.equal(p.totals.missingDistanceCount, 1);
  assert.equal(p.totals.missingTimerCount, 1);
  assert.equal(p.weeks[7].distanceMeters, 15000);
  assert.equal(p.weeks[7].status, "partial_metrics");
  assert.equal(p.totals.averageRecordedWeekMeters, null);
});
test("week averages exclude absent and partial-distance weeks without inventing training rest", () => {
  const f = fixture();
  fill(f, 0, [[10000, 3000]]);
  fill(f, 1, [[20000, 6000]]);
  fill(f, 2, [
    [4000, 1200],
    [null, 900],
  ]);
  const p = build(f);
  assert.equal(p.totals.averageRecordedWeekMeters, 15000);
  assert.equal(p.totals.completeDistanceWeeks, 2);
  assert.equal(p.totals.weeksWithActivities, 3);
  assert.equal(p.totals.longestRunMeters, 20000);
  assert.equal(p.comparison, null);
});
test("zero-distance activity is recorded but cannot contribute a zero pace or manufacture percentage changes", () => {
  const f = fixture();
  fill(f, 6, [[0, 100]]);
  fill(f, 7, [[1000, 300]]);
  const p = build(f);
  assert.equal(p.weeks[6].paceSecondsPerKm, null);
  assert.equal(p.comparison, null);
  assert.equal(p.totals.paceSecondsPerKm, 300);
});
test("unverified imports are excluded and duplicate IDs fail closed", () => {
  const f = fixture();
  fill(f, 0, [[1000, 300]]);
  f.snapshots[0].source.activities[0].verified = false;
  let p = build(f);
  assert.equal(p.totals.activityCount, 0);
  assert.equal(p.totals.excludedUnverifiedActivities, 1);
  f.snapshots[0].source.activities[0].verified = true;
  f.snapshots[0].source.activities.push(f.snapshots[0].source.activities[0]);
  assert.throws(() => build(f), /Duplicate/);
});
test("exact Monday-Sunday boundaries including DST are enforced", () => {
  const f = fixture("2026-11-09");
  fill(f, 7, [[1000, 300]]);
  f.snapshots[7].source.activities.push({
    ...activity(199, "2026-11-02"),
    startedAt: "2026-11-02T07:30:00Z",
  });
  const p = build(f);
  assert.equal(p.weeks[7].activityCount, 1);
  assert.equal(p.weeks[7].start, "2026-11-02");
  f.snapshots[0].startsOn = "2026-09-16";
  assert.throws(() => build(f), /progress_snapshot/);
});
test("distance comparison needs both latest consecutive complete recorded weeks", () => {
  const f = fixture();
  fill(f, 6, [[10000, 3000]]);
  fill(f, 7, [[12000, 3600]]);
  assert.equal(build(f).comparison.distanceChangePercent, 20);
  f.snapshots[7].source.activities.push(
    activity(999, f.snapshots[7].startsOn, null, 1000),
  );
  assert.equal(build(f).comparison, null);
});
test("multiple race targets share calendar rules, local D-day, taper and recovery without synthetic completion", () => {
  const f = fixture("2027-01-17");
  f.context.goal.races = [
    {
      id: id(1),
      name: "January Half",
      distance: "HALF",
      date: "2027-01-17",
      targetTimeSeconds: 5700,
      priority: "supporting",
    },
    {
      id: id(2),
      name: "March Full",
      distance: "FULL",
      date: "2027-03-14",
      targetTimeSeconds: 12600,
      priority: "primary",
    },
  ];
  let p = build(f);
  assert.equal(p.races[0].phase, "race_day");
  assert.equal(p.races[1].phase, "preparation");
  assert.equal(p.races[0].targetPaceSecondsPerKm, 270);
  assert.equal(p.races[1].targetPaceSecondsPerKm, 299);
  assert.ok(!("completionPercent" in p.races[0]));
  const g = fixture("2027-01-19");
  g.context.goal.races = f.context.goal.races;
  p = build(g);
  assert.equal(p.races[0].phase, "recovery");
  const h = fixture("2027-03-01");
  h.context.goal.races = f.context.goal.races;
  assert.equal(build(h).races[1].phase, "taper");
});
test("manual completion, Garmin confirmation, unknown and upcoming workouts remain separate", () => {
  const f = fixture();
  const w = (n, date, source, state = "matched") => ({
    id: id(n),
    date,
    kind: "easy",
    distanceKm: 7,
    completed: !!source,
    matching: state === null ? undefined : { source, state },
  });
  f.plan = {
    startsOn: f.current.period.start,
    endsOn: f.current.period.end,
    workouts: [
      w(1, "2026-10-12", "garmin"),
      w(2, "2026-10-14", "manual"),
      w(3, "2026-10-16", null, "unmatched"),
      w(4, "2026-10-16", null, null),
      w(5, "2026-10-18", null, "unmatched"),
    ],
  };
  const p = build(f).current.performance;
  assert.equal(p.plannedKm, 35);
  assert.equal(p.garminCompleted, 1);
  assert.equal(p.manualCompleted, 1);
  assert.equal(p.unconfirmed, 1);
  assert.equal(p.unavailable, 1);
  assert.equal(p.upcomingSessions, 1);
  assert.equal(p.dueSessions, 4);
});
test("future-dated activity cannot increase current actual distance", () => {
  const f = fixture();
  f.current = running.buildRunningSummary(
    [activity(1, "2026-10-18"), activity(2, "2026-10-16")].map((a) => ({
      garmin_activity_id: a.garminId,
      started_at: a.startedAt,
      updated_at: a.startedAt,
      distance_meters: a.distanceMeters,
      duration_seconds: a.timerSeconds,
      average_pace_seconds_per_km: null,
    })),
    f.current.period,
  );
  assert.equal(build(f).current.activityCount, 0);
});
test("historical manual completion does not invent actual distance or Garmin completion", () => {
  const f = fixture();
  f.snapshots[7].source.planId = id(99);
  f.snapshots[7].source.workouts = [
    {
      id: id(77),
      date: f.snapshots[7].startsOn,
      kind: "recovery",
      distanceKm: 7,
      status: "completed",
      manualCompletedAt: "2026-10-14T00:00:00Z",
      steps: [],
    },
  ];
  const p = build(f).weeks[7];
  assert.equal(p.performance.manualCompleted, 1);
  assert.equal(p.performance.garminCompleted, 0);
  assert.equal(p.performance.matchedActualKm, 0);
  assert.equal(p.distanceMeters, null);
});
test("progress API requires owner auth, rejects query extras and bounds errors", async () => {
  let access = { response: new Response(null, { status: 401 }) },
    count = 0,
    fail = null;
  class ProgressError extends Error {}
  const api = load("app/api/training/progress/route.ts", {
    "@/lib/security/admin": { requireAdmin: async () => access },
    "@/lib/training/progress-storage": {
      ProgressError,
      readProgressInsights: async (id) => {
        count++;
        if (fail) throw fail;
        return { owner: id };
      },
    },
  });
  let r = await api.GET(
    new Request("https://traini.test/api/training/progress"),
  );
  assert.equal(r.status, 401);
  assert.equal(count, 0);
  access = { userId: "owner" };
  r = await api.GET(
    new Request("https://traini.test/api/training/progress?userId=foreign"),
  );
  assert.equal(r.status, 400);
  assert.equal(count, 0);
  r = await api.GET(new Request("https://traini.test/api/training/progress"));
  assert.equal((await r.json()).owner, "owner");
  assert.equal(r.headers.get("Cache-Control"), "private, no-store");
  fail = new ProgressError("progress_changed");
  r = await api.GET(new Request("https://traini.test/api/training/progress"));
  assert.equal(r.status, 409);
  fail = new Error("private DB details");
  r = await api.GET(new Request("https://traini.test/api/training/progress"));
  assert.equal(r.status, 503);
  assert.ok(!(await r.text()).includes("private DB"));
});
function progressReader(f, changes = false) {
  let calls = 0,
    reads = 0;
  const options = [];
  const service = load("lib/training/progress-storage.ts", {
    "server-only": {},
    "./storage": {
      readTrainingContext: async () => {
        reads++;
        return f.context;
      },
    },
    "@/lib/garmin/read-running-summary": {
      readRunningSummary: async (...args) => {
        options.push(args[3]);
        return f.current;
      },
    },
    "./plan-storage": {
      revision: async () => (changes ? String(calls++) : "same"),
      readPlan: async (...args) => {
        assert.equal(args[3].reconcile, false);
        return { plan: null, inputsChanged: false };
      },
    },
    "./review-storage": {
      reviewSnapshot: async (_uid, start) =>
        f.snapshots.find((s) => s.startsOn === start),
    },
    "@/lib/garmin/running-summary": running,
    "./progress": progress,
  });
  return { ...service, options, reads: () => reads };
}
test("progress service uses verified imports and read-only matching without starting generation", async () => {
  const r = progressReader(fixture());
  await r.readProgressInsights("owner");
  assert.equal(r.reads(), 1);
  assert.equal(r.options[0].verifiedOnly, true);
});
test("concurrent input changes get two bounded attempts and never return mixed data", async () => {
  const r = progressReader(fixture(), true);
  await assert.rejects(r.readProgressInsights("owner"), /progress_changed/);
  assert.equal(r.reads(), 2);
});
