import assert from "node:assert/strict";
import { test } from "node:test";
import { auditSavedPlan } from "../scripts/lib/plan-acceptance.mjs";

function fixture() {
  const run = {
    date: "2026-10-19",
    kind: "easy",
    distanceKm: 6,
    paceSecondsPerKm: 330,
    completed: false,
    status: "scheduled",
    steps: [
      {
        kind: "steady",
        distanceMeters: 6000,
        repetitions: 1,
        paceSecondsPerKm: 330,
        recoveryMeters: 0,
        recoveryAfterLast: false,
      },
    ],
  };
  return {
    result: {
      period: { start: "2026-10-19", end: "2026-10-25" },
      inputsChanged: false,
      plan: { summary: "Fixture", workouts: [run] },
    },
    context: {
      asOfDate: "2026-10-17",
      goal: { trainingDays: [1, 3, 4, 5, 7] },
    },
    preview: {
      limits: { maxWeekKm: 55, maxRunKm: 20, maxHardSessions: 2 },
      guidance: { condition: null, rules: {} },
    },
  };
}
const audit = ({ result, context, preview }, validator = () => true) =>
  auditSavedPlan(result, context, preview, validator);
test("saved plans are distinguished from missing, stale and invalid plans", () => {
  const f = fixture();
  assert.equal(audit(f).state, "validated");
  f.result.plan = null;
  assert.equal(audit(f).state, "missing");
  const stale = fixture();
  stale.result.inputsChanged = true;
  stale.preview.guidance.condition = { requiresRecheck: true };
  assert.equal(audit(stale).state, "stale");
  assert.ok(audit(stale).issues.includes("unresolved_condition"));
  assert.equal(audit(fixture(), () => false).state, "invalid");
});
test("a pain hold detects future runs while preserving historical and explicitly handled sessions", () => {
  const f = fixture();
  f.preview.guidance.condition = { requiresRecheck: true };
  f.preview.limits = { maxWeekKm: 0, maxRunKm: 0, maxHardSessions: 0 };
  assert.ok(audit(f).issues.includes("unresolved_condition"));
  for (const edit of [
    (w) => {
      w.completed = true;
    },
    (w) => {
      w.status = "skipped";
    },
    (w) => {
      w.feedback = { version: 1 };
    },
    (w) => {
      w.date = "2026-10-16";
    },
  ]) {
    const copy = structuredClone(f);
    edit(copy.result.plan.workouts[0]);
    assert.equal(audit(copy).pendingRuns, 0);
    assert.ok(!audit(copy).issues.includes("unresolved_condition"));
  }
});
test("interval total includes recovery between repetitions and optional final recovery", () => {
  const f = fixture();
  const w = f.result.plan.workouts[0];
  w.kind = "interval";
  w.steps = [
    {
      kind: "warmup",
      distanceMeters: 2000,
      repetitions: 1,
      paceSecondsPerKm: 340,
      recoveryMeters: 0,
    },
    {
      kind: "repeats",
      distanceMeters: 400,
      repetitions: 10,
      paceSecondsPerKm: 240,
      recoveryMeters: 200,
      recoveryAfterLast: false,
    },
    {
      kind: "cooldown",
      distanceMeters: 2000,
      repetitions: 1,
      paceSecondsPerKm: 340,
      recoveryMeters: 0,
    },
  ];
  w.distanceKm = 9.8;
  assert.deepEqual(audit(f).issues, []);
  w.steps[1].recoveryAfterLast = true;
  assert.ok(audit(f).issues.includes("step_distance"));
  w.distanceKm = 10;
  assert.deepEqual(audit(f).issues, []);
});
test("race rest, easy-only and no-long-run dates are audited independently of distance caps", () => {
  for (const [field, kind, issue] of [
    ["restDates", "easy", "race_rest_date"],
    ["raceDates", "easy", "race_rest_date"],
    ["easyOnlyDates", "threshold", "race_easy_only"],
    ["noLongRunDates", "long", "race_no_long_run"],
  ]) {
    const f = fixture();
    const w = f.result.plan.workouts[0];
    w.kind = kind;
    f.preview.guidance.raceCalendar = {
      restDates: [],
      raceDates: [],
      easyOnlyDates: [],
      noLongRunDates: [],
      [field]: [w.date],
    };
    assert.ok(audit(f).issues.includes(issue));
  }
});
test("invalid numbers, unavailable days, duplicate dates and crowded demanding days are reported", () => {
  for (const [edit, issue] of [
    [
      (w) => {
        w.distanceKm = NaN;
      },
      "session_distance",
    ],
    [
      (w) => {
        w.distanceKm = 56;
      },
      "weekly_distance",
    ],
    [
      (w) => {
        w.paceSecondsPerKm = -1;
      },
      "invalid_pace",
    ],
    [
      (w) => {
        w.date = "2026-10-20";
      },
      "unavailable_day",
    ],
    [
      (w) => {
        w.date = "2026-10-26";
      },
      "outside_week",
    ],
    [
      (w) => {
        w.steps[0].repetitions = 1.2;
      },
      "invalid_step",
    ],
    [
      (w) => {
        w.kind = "rest";
      },
      "rest_structure",
    ],
  ]) {
    const f = fixture();
    edit(f.result.plan.workouts[0]);
    assert.ok(audit(f).issues.includes(issue), issue);
  }
  const f = fixture();
  f.result.plan.workouts.push(structuredClone(f.result.plan.workouts[0]));
  assert.ok(audit(f).issues.includes("duplicate_date"));
  f.result.plan.workouts[0].kind = "threshold";
  f.result.plan.workouts[1].kind = "long";
  f.result.plan.workouts[1].date = "2026-10-20";
  assert.ok(audit(f).issues.includes("demanding_spacing"));
});
