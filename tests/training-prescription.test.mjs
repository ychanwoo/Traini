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
const prescriptions = load("lib/training/prescription.ts", { "./goal": goal });
const plans = load("lib/training/weekly-plan.ts", {
  "@/lib/garmin/running-summary": running,
  "./goal": goal,
  "./prescription": prescriptions,
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
const refined = (
  c = context(),
  week = "current",
  execution = null,
  current = null,
) =>
  prescriptions.refinePrescription(
    c,
    plans.planPolicy(c, week),
    execution,
    current,
  );
const step = (
  kind,
  meters,
  pace = 330,
  repetitions = 1,
  recoveryMeters = 0,
) => ({
  kind,
  distanceMeters: meters,
  paceSecondsPerKm: pace,
  repetitions,
  recoveryMeters,
  recoverySeconds: null,
  recoveryAfterLast: false,
});
function withQuality() {
  const c = context();
  const original = c.history.sessions[0];
  const lap = (distanceMeters, paceSecondsPerKm, intensity) => ({
    distanceMeters,
    timerSeconds: (distanceMeters / 1000) * paceSecondsPerKm,
    paceSecondsPerKm,
    averageHeartRate: null,
    intensity,
  });
  for (const [meters, reps, date] of [
    [400, 10, "2026-10-07"],
    [800, 5, "2026-10-09"],
  ])
    c.history.sessions.push({
      ...original,
      trainingDate: date,
      distanceMeters: meters * reps + 4000,
      evidence: {
        version: 1,
        lapsComplete: true,
        laps: [
          lap(2000, 340, "warmup"),
          ...Array.from({ length: reps }, () => [
            lap(meters, meters === 400 ? 230 : 237, "active"),
            lap(meters / 2, 390, "recovery"),
          ]).flat(),
          lap(2000, 340, "cooldown"),
        ],
      },
    });
  return c;
}
test("fatigue is dated and only restricts relevant days without assuming next week condition", () => {
  const c = context();
  c.goal.condition = { reportedOn: "2026-10-16", feeling: "tired" };
  const r = refined(c);
  assert.ok(r.policy.easyOnlyDates.includes("2026-10-16"));
  assert.ok(
    r.guidance.rules.dayLimits.some(
      (d) => d.date === "2026-10-16" && d.maxDistanceKm < 7,
    ),
  );
  assert.equal(refined(c, "next").guidance.rules.dayLimits.length, 0);
});
test("unresolved pain requires recheck and produces a valid all-rest envelope", () => {
  const c = context();
  c.goal.condition = { reportedOn: "2026-10-01", feeling: "pain" };
  const r = refined(c);
  assert.equal(r.policy.maxWeekKm, 0);
  assert.equal(r.policy.minWeekKm, 0);
  const content = {
    summary: "컨디션을 다시 확인해 주세요.",
    workouts: r.policy.dates.map((date) => ({
      date,
      kind: "rest",
      title: "휴식",
      purpose: "재확인",
      distanceKm: 0,
      paceSecondsPerKm: null,
      effort: "rest",
      steps: [],
    })),
  };
  plans.validatePlan(content, r.policy);
  assert.equal(r.guidance.condition.fresh, false);
  assert.equal(r.guidance.condition.requiresRecheck, true);
});
test("unknown and good condition do not invent recovery metrics or raise original load caps", () => {
  const c = context(),
    a = refined(c);
  c.goal.condition = { reportedOn: "2026-10-16", feeling: "good" };
  const b = refined(c);
  assert.equal(a.policy.maxWeekKm, b.policy.maxWeekKm);
  assert.equal(a.guidance.condition, null);
  assert.ok(b.policy.maxWeekKm <= plans.planPolicy(c, "current").maxWeekKm);
});
test("independent goal times are not treated as current fitness", () => {
  const c = context(),
    a = refined(c);
  c.goal.races[0].targetTimeSeconds = 1800;
  c.goal.races[1].targetTimeSeconds = 5000;
  const b = refined(c);
  assert.equal(
    a.guidance.rules.bounds.find((b) => b.kind === "easy").minPace,
    b.guidance.rules.bounds.find((b) => b.kind === "easy").minPace,
  );
  assert.notEqual(
    b.guidance.goals[0].targetPaceSecondsPerKm,
    b.guidance.goals[1].targetPaceSecondsPerKm,
  );
});
test("measured 400m and 800m repeats retain their own pace and recovery envelopes", () => {
  const r = refined(withQuality(), "next");
  assert.equal(r.guidance.rules.intervals.length, 2);
  assert.equal(r.guidance.rules.intervals[0].observedRepetitions, 10);
  assert.equal(r.guidance.rules.intervals[1].observedRepetitions, 5);
  assert.ok(
    r.guidance.rules.intervals[0].minRecoveryMeters <
      r.guidance.rules.intervals[1].minRecoveryMeters,
  );
});
test("interval pace and repetition count cannot progress together or omit recovery", () => {
  const r = refined(withQuality(), "next"),
    rules = r.guidance.rules;
  const option = rules.intervals[0];
  const content = {
    summary: "test",
    workouts: [
      {
        date: r.policy.dates[0],
        kind: "interval",
        distanceKm: 8,
        paceSecondsPerKm: null,
        steps: [
          step("warmup", 2000),
          step("repeats", 400, option.observedPace, 10, 200),
          step("cooldown", 2000),
        ],
      },
    ],
  };
  assert.equal(prescriptions.validatePrescription(content, rules), true);
  content.workouts[0].steps[1].repetitions = 11;
  content.workouts[0].steps[1].paceSecondsPerKm = option.observedPace - 1;
  assert.equal(prescriptions.validatePrescription(content, rules), false);
  content.workouts[0].steps[1].repetitions = 10;
  content.workouts[0].steps[1].paceSecondsPerKm = option.observedPace;
  content.workouts[0].steps[1].recoveryMeters = 0;
  assert.equal(prescriptions.validatePrescription(content, rules), false);
});
test("tempo without sustained work evidence cannot inherit an interval pace", () => {
  const r = refined(withQuality(), "next");
  assert.equal(r.guidance.rules.tempoPaceKnown, false);
  const content = {
    summary: "test",
    workouts: [
      {
        date: r.policy.dates[0],
        kind: "threshold",
        distanceKm: 8,
        paceSecondsPerKm: 230,
        steps: [step("steady", 4000, 230)],
      },
    ],
  };
  assert.equal(
    prescriptions.validatePrescription(content, r.guidance.rules),
    false,
  );
});
test("recovery runs have their own slower pace and distance bounds and cannot masquerade as easy", () => {
  const r = refined(context(), "next"),
    b = r.guidance.rules.bounds;
  assert.ok(
    b.find((b) => b.kind === "recovery").minPace >
      b.find((b) => b.kind === "easy").minPace,
  );
  const content = {
    summary: "test",
    workouts: [
      {
        date: r.policy.dates[0],
        kind: "recovery",
        distanceKm: 7,
        paceSecondsPerKm: 300,
        steps: [step("steady", 7000, 300)],
      },
    ],
  };
  assert.equal(
    prescriptions.validatePrescription(content, r.guidance.rules),
    false,
  );
});
test("manual and unknown completion cannot manufacture a failed session or cut training", () => {
  const c = context(),
    base = refined(c, "next");
  const execution = {
    sessions: [
      { completion: "manual", actualKm: null, plannedKm: 10 },
      { completion: "unknown", actualKm: null, plannedKm: 10 },
    ],
    manualCompleted: 1,
    unconfirmed: 1,
  };
  const r = refined(c, "next", execution);
  assert.equal(r.guidance.noProgression, false);
  assert.equal(r.policy.maxWeekKm, base.policy.maxWeekKm);
  execution.sessions = execution.sessions.map((s) => ({
    ...s,
    completion: "garmin",
    actualKm: 6,
  }));
  assert.equal(refined(c, "next", execution).guidance.noProgression, true);
});
test("long-run dates are flexible within training availability and never overlap protected race dates", () => {
  const c = context("2027-01-11"),
    r = refined(c);
  assert.ok(!r.guidance.rules.allowedLongRunDates.includes("2027-01-17"));
  assert.ok(r.guidance.rules.allowedLongRunDates.length > 0);
  assert.ok(
    r.guidance.rules.allowedLongRunDates.every(
      (d) =>
        !r.policy.easyOnlyDates.includes(d) &&
        !r.policy.blockedDates.includes(d),
    ),
  );
});
test("recovery pace cannot turn interval recoveries into another fast repetition", () => {
  const r = refined(withQuality(), "next"),
    option = r.guidance.rules.intervals.find((o) => o.meters === 400);
  assert.ok(option.minRecoveryPace > option.observedPace);
  const repeat = step("repeats", 400, option.observedPace, 10, 200);
  const content = {
    workouts: [
      {
        date: r.policy.dates[0],
        kind: "interval",
        distanceKm: 8,
        paceSecondsPerKm: null,
        steps: [repeat],
      },
    ],
  };
  repeat.recoveryPaceSecondsPerKm = option.minRecoveryPace - 1;
  assert.equal(
    prescriptions.validatePrescription(content, r.guidance.rules),
    false,
  );
  repeat.recoveryPaceSecondsPerKm = option.minRecoveryPace;
  assert.equal(
    prescriptions.validatePrescription(content, r.guidance.rules),
    true,
  );
});
test("unknown interval fitness uses bounded effort-based repeats instead of invented numeric paces", () => {
  const r = refined(context(), "next"),
    repeat = step("repeats", 400, null, 6, 200);
  const content = {
    workouts: [
      {
        date: r.policy.dates[0],
        kind: "interval",
        distanceKm: 8,
        paceSecondsPerKm: null,
        steps: [repeat],
      },
    ],
  };
  assert.equal(
    prescriptions.validatePrescription(content, r.guidance.rules),
    true,
  );
  repeat.paceSecondsPerKm = 200;
  assert.equal(
    prescriptions.validatePrescription(content, r.guidance.rules),
    false,
  );
  repeat.paceSecondsPerKm = null;
  repeat.repetitions = 9;
  assert.equal(
    prescriptions.validatePrescription(content, r.guidance.rules),
    false,
  );
});
test("race weeks reserve a quality slot and hold progression without inventing failed sessions", () => {
  const r = refined(context("2027-01-11"));
  assert.equal(r.guidance.noProgression, true);
  assert.ok(!r.guidance.warnings.some((w) => w.includes("수행 거리가")));
  assert.ok(r.policy.maxHardSessions <= 1);
});
test("prescription endpoint enforces authentication, query shape, private caching and bounded errors", async () => {
  let auth = { response: new Response(null, { status: 401 }) },
    calls = 0,
    fail = false;
  const api = load("app/api/training/prescription/route.ts", {
    "@/lib/security/admin": { requireAdmin: async () => auth },
    "@/lib/training/prescription-storage": {
      readPrescriptionPreview: async (uid, week) => {
        calls++;
        if (fail) throw new plans.PlanError("input_changed");
        return { week };
      },
    },
    "@/lib/training/weekly-plan": plans,
    "@/lib/training/plan-errors": { planErrorMessage: () => "bounded" },
  });
  let response = await api.GET(
    new Request("https://traini.test/api/training/prescription"),
  );
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
  auth = { userId: "owner" };
  for (const query of ["week=bad", "week=current&week=next", "unknown=1"]) {
    response = await api.GET(
      new Request("https://traini.test/api/training/prescription?" + query),
    );
    assert.equal(response.status, 400);
  }
  response = await api.GET(
    new Request("https://traini.test/api/training/prescription?week=next"),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).week, "next");
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  fail = true;
  response = await api.GET(
    new Request("https://traini.test/api/training/prescription"),
  );
  assert.equal(response.status, 409);
});
test("a distant race does not accidentally disable the normal bounded progression ceiling", () => {
  const c = context(),
    p = refined(c, "next").policy;
  assert.equal(
    p.weeklyCeilingKm,
    Math.floor(p.referenceWeekKm * 1.05 * 10) / 10,
  );
  assert.ok(p.maxWeekKm > p.referenceWeekKm);
});
test("race spacing warnings use chronological order even when the input is reversed", () => {
  const r = races();
  r[0].date = "2027-03-10";
  const calendar = goal.raceCalendar(
    [...r].reverse(),
    "2027-03-08",
    "2027-03-14",
  );
  assert.equal(calendar.events[0].distance, "HALF");
  assert.equal(calendar.warnings.length, 1);
});
