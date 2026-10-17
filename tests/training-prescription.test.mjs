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
const contexts = load("lib/training/context.ts", {
  "@/lib/garmin/running-summary": running,
  "./goal": goal,
});
const plans = load("lib/training/weekly-plan.ts", {
  "@/lib/garmin/running-summary": running,
  "./goal": goal,
});
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const races = () => [
  {
    id: id(1),
    name: "January Half",
    distance: "HALF",
    date: "2027-01-17",
    targetTimeSeconds: 5400,
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
function profile() {
  return {
    race_name: "March Full",
    target_distance: "FULL",
    target_date: "2027-03-14",
    target_time_seconds: 12600,
    training_days: [1, 3, 4, 5, 7],
    long_run_day: 7,
    race_goals: races(),
    training_condition: null,
  };
}
function context(date = "2026-10-16") {
  const period = running.runningPeriod(
    "America/Los_Angeles",
    "previous",
    new Date(date + "T18:00:00Z"),
  );
  const rows = [0, 1, 2, 3].flatMap((w) =>
    [0, 2, 4, 6].map((d, i) => ({
      garmin_activity_id: String(1000 + w * 10 + i),
      started_at: `${running.addCalendarDays(period.start, -w * 7 + d)}T19:00:00Z`,
      updated_at: date + "T18:00:00Z",
      distance_meters: i === 3 ? 15000 : 7000,
      duration_seconds: (i === 3 ? 15 : 7) * 330,
      average_pace_seconds_per_km: 330,
      average_heart_rate: 140,
    })),
  );
  return contexts.buildTrainingContext(
    profile(),
    rows,
    "America/Los_Angeles",
    new Date(date + "T18:00:00Z"),
  );
}
test("multiple goals keep independent records and choose main race without discarding supporting race", () => {
  const g = goal.goalFromProfile(profile(), "2026-10-16").goal;
  assert.equal(g.races.length, 2);
  assert.equal(g.targetDistance, "FULL");
  assert.equal(g.targetTimeSeconds, 12600);
  assert.equal(g.races[0].targetTimeSeconds, 5400);
  assert.equal(goal.focusRace(g.races, "2027-03-15"), null);
});
test("legacy single goal remains editable and becomes one race without inventing another goal", () => {
  const p = profile();
  p.race_goals = [];
  const g = goal.goalFromProfile(p, "2026-10-16").goal;
  assert.equal(g.races.length, 1);
  assert.equal(g.races[0].name, "March Full");
});
test("race input rejects duplicate dates or IDs, extra fields, multiple primary goals and invalid records", () => {
  for (const edit of [
    (r) => (r[0].date = r[1].date),
    (r) => (r[0].id = r[1].id),
    (r) => (r[0].priority = "primary"),
    (r) => (r[0].targetTimeSeconds = -1),
    (r) => (r[0].distance = "ULTRA"),
    (r) => (r[0].extra = 1),
    (r) => (r[0].date = "2027-02-30"),
  ]) {
    const r = races();
    edit(r);
    assert.throws(() => goal.validateRaces(r, "2026-10-16"), /Invalid goal/);
  }
});
test("reported condition has strict values and cannot claim a future report", () => {
  assert.equal(goal.validateCondition(null, "2026-10-16"), null);
  for (const c of [
    { reportedOn: "2026-10-17", feeling: "normal" },
    { reportedOn: "2026-10-16", feeling: "diagnosed" },
    { reportedOn: "2026-10-16", feeling: "normal", hrv: 90 },
  ])
    assert.throws(
      () => goal.validateCondition(c, "2026-10-16"),
      /Invalid goal/,
    );
});
test("January half reserves race distance and tapers while March full remains the long-term goal", () => {
  const c = context("2027-01-11"),
    p = plans.planPolicy(c, "current");
  assert.equal(c.goal.targetDate, "2027-03-14");
  assert.ok(p.calendar.raceDates.includes("2027-01-17"));
  assert.ok(p.blockedDates.includes("2027-01-17"));
  assert.ok(p.easyOnlyDates.includes("2027-01-15"));
  assert.ok(p.maxWeekKm <= p.weeklyCeilingKm - 21.0975);
  assert.ok(p.dates.includes("2027-01-17"));
});
test("recovery from a previous race persists into next week and close races expose conflicts", () => {
  const calendar = goal.raceCalendar(races(), "2027-01-18", "2027-01-24");
  assert.ok(calendar.restDates.includes("2027-01-18"));
  assert.ok(calendar.easyOnlyDates.includes("2027-01-23"));
  const r = races();
  r[1].date = "2027-01-20";
  assert.equal(
    goal.raceCalendar(r, "2027-01-11", "2027-01-24").warnings.length,
    1,
  );
});
test("current-week accounting preserves calendar blocks and does not reserve an already recorded race twice", () => {
  const c = context("2027-01-17"),
    p = plans.planPolicy(c, "current");
  const summary = running.buildRunningSummary(
    [
      {
        garmin_activity_id: "991",
        started_at: "2027-01-17T19:00:00Z",
        updated_at: "2027-01-17T20:00:00Z",
        distance_meters: 21097.5,
        duration_seconds: 5400,
        average_pace_seconds_per_km: 256,
      },
    ],
    running.runningPeriod(c.timezone, "current", new Date(c.generatedAt)),
  );
  const result = plans.accountCurrentWeek(p, summary);
  assert.ok(result.blockedDates.includes("2027-01-17"));
  assert.ok(result.maxWeekKm >= 0);
  assert.ok(result.maxWeekKm <= p.weeklyCeilingKm - 21.0975);
});
