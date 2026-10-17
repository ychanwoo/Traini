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
function race(distance = "FULL", date = "2027-01-17", priority = "primary") {
  return {
    id: id(1),
    name: "Fixture race",
    distance,
    date,
    priority,
    targetTimeSeconds: distance === "FULL" ? 12600 : 5700,
  };
}
function fixture(
  today = "2027-01-11",
  races = [race()],
  condition = null,
  volumes = [55, 55, 55, 55, 55, 55, 55, 55],
) {
  const period = running.runningPeriod(
    "America/Los_Angeles",
    "previous",
    new Date(today + "T18:00:00Z"),
  );
  const rows = volumes.flatMap((km, w) =>
    [0, 2, 3, 4, 6].map((day, i) => ({
      garmin_activity_id: String(1000 + w * 10 + i),
      started_at:
        running.addCalendarDays(period.start, -49 + w * 7 + day) + "T19:00:00Z",
      updated_at: today + "T18:00:00Z",
      distance_meters: (km * 1000) / 5,
      duration_seconds: (km / 5) * 330,
      average_pace_seconds_per_km: 330,
      average_heart_rate: 140,
    })),
  );
  const main = races.find((r) => r.priority === "primary");
  return contexts.buildTrainingContext(
    {
      race_name: main.name,
      target_distance: main.distance,
      target_date: main.date,
      target_time_seconds: main.targetTimeSeconds,
      race_goals: races,
      training_condition: condition,
      training_days: [1, 3, 4, 5, 7],
      long_run_day: 7,
      training_baseline: {
        version: 1,
        source: "user_reported",
        reportedOn: today,
        weeklyDistanceKm: 55,
        longRunKm: 20,
        easyPaceSecondsPerKm: 330,
        qualityPaceSecondsPerKm: 255,
        weeklyQualityKm: 14,
        weeklyQualitySessions: 2,
        routine: [],
      },
    },
    rows,
    "America/Los_Angeles",
    new Date(today + "T18:00:00Z"),
  );
}
function rules(c, week = "current", current = null) {
  return prescriptions.refinePrescription(
    c,
    plans.planPolicy(c, week, current),
    null,
    current,
  );
}
test("taper duration uses distance, importance, load evidence and dated fatigue instead of three days for every supporting race", () => {
  for (const distance of ["5K", "10K", "HALF", "FULL"]) {
    const primary = goal.raceCalendar(
      [race(distance)],
      "2027-01-01",
      "2027-01-07",
    ).events[0];
    const supporting = goal.raceCalendar(
      [race(distance, undefined, "supporting")],
      "2027-01-01",
      "2027-01-07",
    ).events[0];
    assert.ok(primary.taperDays >= supporting.taperDays);
    if (distance === "FULL") assert.ok(supporting.taperDays >= 10);
    if (distance === "HALF") assert.ok(supporting.taperDays >= 7);
  }
  const stable = fixture(),
    high = fixture(
      undefined,
      undefined,
      null,
      [55, 55, 55, 55, 55, 55, 55, 70],
    );
  const a = goal.raceCalendar(
    stable.goal.races,
    "2027-01-11",
    "2027-01-17",
    goal.raceEvidence(stable),
  );
  const b = goal.raceCalendar(
    high.goal.races,
    "2027-01-11",
    "2027-01-17",
    goal.raceEvidence(high),
  );
  assert.ok(b.events[0].taperDays > a.events[0].taperDays);
  assert.ok(b.events[0].recoveryDays > a.events[0].recoveryDays);
  assert.equal(b.load.elevated, true);
  const tired = fixture(undefined, undefined, {
    reportedOn: "2027-01-11",
    feeling: "tired",
  });
  assert.ok(
    goal.raceCalendar(
      tired.goal.races,
      "2027-01-11",
      "2027-01-17",
      goal.raceEvidence(tired),
    ).events[0].taperDays > a.events[0].taperDays,
  );
});
test("taper preserves one bounded familiar stimulus, reduces work volume, and separates long-run restrictions from all intensity", () => {
  const c = fixture(),
    p = rules(c).policy;
  assert.equal(p.maxHardSessions, 1);
  assert.ok(p.maxQualityKm < 14);
  assert.ok(!p.easyOnlyDates.includes("2027-01-13"));
  assert.ok(p.easyOnlyDates.includes("2027-01-15"));
  assert.equal(p.prescription.allowedLongRunDates.length, 0);
  assert.ok(p.maxWeekKm > 0);
  assert.ok(p.maxWeekKm <= 22.1);
  const step = (kind, m, repetitions = 1, recovery = 0) => ({
    kind,
    distanceMeters: m,
    paceSecondsPerKm: null,
    repetitions,
    recoveryMeters: recovery,
    recoverySeconds: null,
    recoveryAfterLast: false,
    recoveryPaceSecondsPerKm: null,
  });
  const workouts = p.dates.map((date) => ({
    date,
    kind: "rest",
    title: "Fixture rest",
    purpose: "Fixture",
    distanceKm: 0,
    paceSecondsPerKm: null,
    effort: "rest",
    steps: [],
  }));
  Object.assign(
    workouts.find((w) => w.date === "2027-01-13"),
    {
      kind: "interval",
      title: "Short familiar stimulus",
      distanceKm: 3,
      effort: "controlled",
      steps: [
        step("warmup", 1000),
        step("repeats", 400, 2, 200),
        step("cooldown", 1000),
      ],
    },
  );
  assert.doesNotThrow(() =>
    plans.validatePlan(
      { summary: "Fixture; no model call", workouts },
      { ...p, minWeekKm: 0 },
    ),
  );
  workouts.find((w) => w.date === "2027-01-13").date = "2027-01-15";
  assert.throws(
    () =>
      plans.validatePlan(
        { summary: "Fixture", workouts },
        { ...p, minWeekKm: 0 },
      ),
    /invalid_output/,
  );
});
test("race week budgets the race separately instead of forcing an entire week of rest", () => {
  const c = fixture(),
    p = rules(c).policy;
  assert.ok(p.weeklyCeilingKm >= p.maxWeekKm + 42.195 - 0.01);
  assert.ok(p.maxWeekKm > 10);
  assert.ok(p.blockedDates.includes("2027-01-17"));
});
test("calendar expiry alone never clears recovery or admits long/quality training", () => {
  const c = fixture("2027-02-01", [race()]);
  const p = rules(c).policy;
  assert.equal(p.calendar.events[0].phase, "recovery");
  assert.equal(p.calendar.events[0].recoveryState, "needs_check_in");
  assert.equal(p.maxHardSessions, 0);
  assert.equal(p.prescription.allowedLongRunDates.length, 0);
  assert.ok(p.calendar.warnings.length);
  assert.ok(p.dates.every((d) => p.easyOnlyDates.includes(d)));
});
test("a future plan cannot presume that recovery will be complete when the review date arrives", () => {
  const c = fixture("2027-01-20", [race()]);
  const p = rules(c, "next").policy;
  assert.ok(p.dates.includes("2027-01-25"));
  assert.equal(p.maxHardSessions, 0);
  assert.ok(p.easyOnlyDates.includes("2027-01-25"));
});
test("normal/good report alone and reports before the review point do not unlock recovery", () => {
  for (const reportedOn of ["2027-01-20", "2027-02-01"]) {
    const c = fixture("2027-02-01", [race()], { reportedOn, feeling: "good" });
    c.history.sessions = [];
    const p = rules(c).policy;
    assert.equal(p.calendar.events[0].recoveryState, "needs_check_in");
    assert.equal(p.maxHardSessions, 0);
  }
});
test("post-window check-in plus distinct return-running days allows bounded gradual return, never declares recovered", () => {
  const c = fixture("2027-02-05", [race()], {
    reportedOn: "2027-02-03",
    feeling: "normal",
  });
  c.history.sessions.push(
    ...["2027-01-30", "2027-02-02"].map((trainingDate) => ({
      trainingDate,
      distanceMeters: 5000,
      timerSeconds: 1800,
      paceSecondsPerKm: 360,
      evidence: null,
    })),
  );
  const p = rules(c).policy;
  assert.equal(p.calendar.events[0].recoveryState, "gradual_return");
  assert.equal(p.calendar.events[0].phase, "recovery");
  assert.ok(p.maxHardSessions <= 1);
  assert.equal(p.prescription.allowedLongRunDates.length, 0);
  assert.ok(p.maxWeekKm <= 55 * 0.85);
  assert.ok(!("recovered" in p.calendar.events[0]));
});
test("pain/unwell still blocks all new running beyond any nominal recovery window", () => {
  for (const feeling of ["pain", "unwell"]) {
    const c = fixture("2027-02-05", [race()], {
      reportedOn: "2027-02-01",
      feeling,
    });
    const p = rules(c).policy;
    assert.equal(p.maxWeekKm, 0);
    assert.ok(p.dates.every((d) => p.blockedDates.includes(d)));
  }
});
test("supporting half and main full races both constrain the plan and close events expose conflicts", () => {
  const a = race("HALF", "2027-01-17", "supporting"),
    b = { ...race("FULL", "2027-01-24"), id: id(2) };
  const c = fixture("2027-01-11", [a, b]);
  const p = rules(c).policy;
  assert.equal(p.calendar.events.length, 2);
  assert.ok(p.calendar.warnings.length > 0);
  assert.ok(p.noLongRunDates.includes("2027-01-13"));
});
test("old race dates stay recovery-unknown in the roadmap without forcing an unbounded historical calendar restriction", () => {
  const c = fixture("2027-04-01", [
    race(),
    { ...race("FULL", "2027-06-01"), id: id(2), priority: "supporting" },
  ]);
  const cal = goal.raceCalendar(
    c.goal.races,
    "2027-04-01",
    "2027-04-07",
    goal.raceEvidence(c),
  );
  assert.equal(cal.events[0].phase, "recovery");
  assert.equal(cal.events[0].affectsCurrentPlan, false);
  assert.equal(cal.loadFactor, 1);
});
test("missed/unconfirmed sessions are not added as training debt to the remaining week", () => {
  const c = fixture("2027-01-08", [race("FULL", "2027-03-14")]),
    p = rules(c).policy;
  assert.ok(p.maxWeekKm < rules(c, "next").policy.maxWeekKm);
  assert.match(plans.trainingPrompt(c, p).instructions, /do not cram/);
});
test("race day can produce rest/recovery placeholders without allowing a running prescription on the race date", () => {
  const c = fixture("2027-01-17"),
    p = rules(c).policy;
  assert.ok(p.dates.includes("2027-01-17"));
  assert.ok(p.blockedDates.includes("2027-01-17"));
  assert.equal(p.maxWeekKm, 0);
});
test("negative, expired and future condition reports cannot fabricate a positive recovery check-in", () => {
  const c = fixture("2027-02-05", [race()], {
    reportedOn: "2027-02-06",
    feeling: "good",
  });
  const event = goal.raceCalendar(
    c.goal.races,
    "2027-02-05",
    "2027-02-11",
    goal.raceEvidence(c),
  ).events[0];
  assert.equal(event.checkInOn, null);
  assert.equal(event.recoveryState, "needs_check_in");
});
test("supporting race importance never overrides a previous full-marathon recovery restriction", () => {
  const c = fixture("2027-01-20", [
    race(),
    { ...race("HALF", "2027-02-01", "supporting"), id: id(2) },
  ]);
  const p = rules(c).policy;
  assert.equal(p.maxHardSessions, 0);
  assert.equal(p.prescription.allowedLongRunDates.length, 0);
});
test("stale positive check-in cannot stand in for current recovery condition", () => {
  const c = fixture("2027-02-05", [race()], {
    reportedOn: "2027-01-31",
    feeling: "normal",
  });
  const p = rules(c).policy;
  assert.equal(p.calendar.events[0].recoveryState, "needs_check_in");
  assert.equal(p.maxHardSessions, 0);
});
test("two recorded rebuilding weeks plus fresh check-in still report evidence, not recovered status", () => {
  const c = fixture("2027-02-22", [race()], {
    reportedOn: "2027-02-22",
    feeling: "normal",
  });
  const p = rules(c).policy;
  assert.equal(p.calendar.events[0].recoveryState, "return_recorded");
  assert.equal(p.calendar.events[0].phase, "recovery");
});
test("weekly review cannot raise taper floors or consume reserved race distance as ordinary training", () => {
  const review = load("lib/training/weekly-review.ts", {
    "@/lib/garmin/running-summary": running,
    "./goal": goal,
    "./workout-matching": {},
  });
  const p = rules(fixture()).policy;
  const n = {
    startsOn: "2027-01-04",
    nextWeek: {
      direction: "progress",
      volumeChangePercent: 5,
      maxQualitySessions: 2,
    },
  };
  assert.equal(review.applyReviewPolicy(p, n).minWeekKm, p.minWeekKm);
  n.nextWeek.direction = "reduce";
  n.nextWeek.volumeChangePercent = -15;
  const r = review.applyReviewPolicy(p, n);
  assert.ok(r.weeklyCeilingKm >= 42.195);
  assert.ok(r.maxWeekKm <= p.maxWeekKm);
});
test("gradual return cannot forecast a fresh positive condition for next week", () => {
  const c = fixture("2027-02-05", [race()], {
    reportedOn: "2027-02-05",
    feeling: "normal",
  });
  c.history.sessions.push(
    ...["2027-01-30", "2027-02-02"].map((trainingDate) => ({
      trainingDate,
      distanceMeters: 5000,
      timerSeconds: 1800,
      paceSecondsPerKm: 360,
      evidence: null,
    })),
  );
  const p = rules(c, "next").policy;
  assert.equal(p.calendar.events[0].recoveryState, "gradual_return");
  assert.equal(p.maxHardSessions, 0);
  assert.ok(p.dates.every((d) => p.easyOnlyDates.includes(d)));
});
test("context distinguishes missing future goals from usable post-race recovery inputs", () => {
  const c = fixture("2027-02-01");
  assert.equal(c.inputs.readyForPlanInput, false);
  assert.equal(c.inputs.readyForRecoveryInput, true);
  c.goal.trainingDays = null;
  assert.throws(() => plans.planPolicy(c, "current"), /inputs/);
});
test("unconfirmed recovery permits rest without forcing a pre-race mileage minimum", () => {
  const p = rules(fixture("2027-02-01")).policy;
  assert.equal(p.allowAllRest, true);
  assert.equal(p.minWeekKm, 0);
  const workouts = p.dates.map((date) => ({
    date,
    kind: "rest",
    title: "회복 확인",
    purpose: "상태 확인 전 거리 채우기를 강제하지 않음",
    distanceKm: 0,
    paceSecondsPerKm: null,
    effort: "rest",
    steps: [],
  }));
  assert.doesNotThrow(() =>
    plans.validatePlan({ summary: "회복 확인 중 휴식도 허용", workouts }, p),
  );
});
