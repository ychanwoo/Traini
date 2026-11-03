import test from "node:test";
import assert from "node:assert/strict";
import { typescriptLoader } from "./helpers/load-typescript.mjs";
const load = typescriptLoader(
  {},
  {
    fetch: () => {
      throw Error("Network forbidden");
    },
  },
);
const { buildTrainingContext } = load("lib/training/context.ts");
const { performanceEvidence } = load("lib/training/performance-evidence.ts");
const { analyzeLaps } = load("lib/training/session-evidence.ts");
const { planPolicy, trainingPrompt } = load("lib/training/weekly-plan.ts");
const { refinePrescription } = load("lib/training/prescription.ts");
const { reviewPrompt } = load("lib/training/weekly-review.ts");
const dates = ["2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30"];
const lap = (m, p, i, hr = 160) => ({
  distanceMeters: m,
  timerSeconds: (m * p) / 1000,
  paceSecondsPerKm: p,
  intensity: i,
  averageHeartRate: hr,
});
function context(
  kind = "sustained",
  paces = [270, 270, 260, 260],
  hrs = [160, 160, 160, 160],
  rpes = [6, 6, 6, 6],
) {
  const rows = dates.map((date, i) => {
    const work =
      kind === "interval"
        ? Array.from({ length: 8 }, (_, j) => [
            lap(400, paces[i], "active", hrs[i]),
            ...(j < 7 ? [lap(200, 360, "recovery", 140)] : []),
          ]).flat()
        : [
            lap(
              kind === "long" ? 16000 : kind === "continuous" ? 8000 : 5000,
              paces[i],
              kind === "sustained" ? "active" : null,
              hrs[i],
            ),
          ];
    const laps =
      kind === "interval" || kind === "sustained"
        ? [
            lap(1500, 360, "warmup", 130),
            ...work,
            lap(1500, 360, "cooldown", 140),
          ]
        : work;
    const distance = laps.reduce((n, l) => n + l.distanceMeters, 0),
      duration = laps.reduce((n, l) => n + l.timerSeconds, 0);
    return {
      garmin_activity_id: String(i + 1),
      started_at: date + "T18:00:00Z",
      updated_at: date + "T19:00:00Z",
      distance_meters: distance,
      duration_seconds: duration,
      average_pace_seconds_per_km: (duration / distance) * 1000,
      average_heart_rate: hrs[i],
      activity_training_details: {
        evidence: {
          version: 1,
          lapsComplete: true,
          lapCount: laps.length,
          laps,
        },
      },
    };
  });
  const c = buildTrainingContext(
    {
      race_name: "Synthetic",
      target_distance: "FULL",
      target_date: "2027-04-04",
      training_days: [1, 3, 5, 7],
      long_run_day: 7,
      training_condition: { feeling: "normal", reportedOn: "2026-11-02" },
    },
    rows,
    "America/Los_Angeles",
    new Date("2026-11-02T20:00:00Z"),
  );
  c.workoutFeedback = dates.map((date, i) => ({
    date,
    workoutId: String(i),
    outcome: "completed",
    plannedDistanceKm: 8,
    reportedAt: date + "T20:00:00Z",
    version: 1,
    assessment: { rpe: rpes[i], pain: null, fatigue: null, memo: null },
    skipReason: null,
  }));
  return c;
}
test("repeated comparable improvement uses measured work HR and dated session RPE", () => {
  for (const kind of ["sustained", "interval", "continuous", "long"]) {
    const e = performanceEvidence(context(kind));
    assert.equal(e.trends.length, 1);
    assert.equal(e.trends[0].direction, "supported_progress");
    assert.equal(e.trends[0].after.averageHeartRate, 160);
  }
});
test("stable, missing HR, missing RPE and higher effort do not prove improvement", () => {
  for (const c of [
    context("sustained", [270, 270, 270, 270]),
    context("sustained", undefined, [null, null, null, null]),
    context("sustained", undefined, undefined, [null, null, null, null]),
    context("sustained", undefined, [160, 160, 170, 170], [6, 6, 8, 8]),
  ])
    assert.equal(performanceEvidence(c).trends[0].direction, "maintain");
});
test("higher HR and RPE at unchanged pace holds progression without diagnosing fatigue", () => {
  const c = context(
    "sustained",
    [270, 270, 270, 270],
    [160, 160, 168, 168],
    [6, 6, 8, 8],
  );
  assert.equal(performanceEvidence(c).holdProgression, true);
  const p = refinePrescription(c, planPolicy(c, "current")).policy;
  assert.equal(p.prescription.noProgression, true);
  assert.ok(p.maxWeekKm <= p.referenceWeekKm);
  assert.ok(p.prescription.tempoMaxWorkKm <= 5);
});
test("two observations, duplicates, stale observations and different distances cannot establish a trend", () => {
  for (const edit of [
    (c) => c.history.sessions.splice(0, 2),
    (c) => c.history.sessions.forEach((s) => (s.trainingDate = dates[3])),
    (c) => (c.asOfDate = "2026-12-01"),
    (c) => (c.history.sessions[0].evidence.laps[1] = lap(3000, 270, "active")),
  ]) {
    const c = context();
    edit(c);
    assert.equal(performanceEvidence(c).trends.length, 0);
  }
});
test("changed recovery or repetitions cannot masquerade as interval improvement", () => {
  for (const edit of [
    (s) => s.evidence.laps.splice(1, 2),
    (s) =>
      s.evidence.laps
        .filter((l) => l.intensity === "recovery")
        .forEach((l) => Object.assign(l, lap(400, 360, "recovery"))),
    (s) => (s.evidence.warnings = ["paused_non_work_lap"]),
  ]) {
    const c = context("interval");
    edit(c.history.sessions.at(-1));
    assert.equal(performanceEvidence(c).trends.length, 0);
  }
});
test("work heart rate is time weighted; missing or zero lap HR never becomes zero effort", () => {
  const raw = {
    lapsComplete: true,
    laps: [
      lap(1000, 360, "warmup"),
      lap(1000, 240, "active", 150),
      lap(1000, 270, "active", 170),
    ],
  };
  assert.equal(
    analyzeLaps(raw).work[0].averageHeartRate,
    (150 * 240 + 170 * 270) / 510,
  );
  for (const hr of [null, 0, 999]) {
    raw.laps[2].averageHeartRate = hr;
    assert.equal(analyzeLaps(raw).work[0].averageHeartRate, null);
  }
  for (const raw of [null, {}, { lapsComplete: true, laps: [null] }])
    assert.equal(analyzeLaps(raw).classification, "uncertain");
});
test("weekly RPE is not assigned to individual sessions and high recent RPE holds increases", () => {
  const c = context();
  c.workoutFeedback = [];
  c.weeklyFeedback = [
    {
      startsOn: "2026-10-26",
      rpe: 9,
      memo: null,
      version: 1,
      timezone: c.timezone,
      updatedAt: c.generatedAt,
    },
  ];
  const e = performanceEvidence(c);
  assert.equal(e.trends[0].direction, "maintain");
  assert.equal(e.holdProgression, true);
  assert.ok(e.observations.every((o) => o.rpe === null));
});
test("supported pace progression preserves volume, repetitions and recovery envelopes", () => {
  const c = context("interval");
  const p = refinePrescription(c, planPolicy(c, "current")).policy;
  assert.ok(p.maxWeekKm <= p.referenceWeekKm);
  const interval = p.prescription.intervals[0];
  assert.equal(interval.maxRepetitions, interval.observedRepetitions);
  assert.ok(interval.minRecoveryMeters >= 200);
  assert.ok(interval.minRecoveryPace >= 360);
  const input = JSON.parse(trainingPrompt(c, p).input[0].content);
  assert.equal(
    input.policy.prescription.performance.trends[0].direction,
    "supported_progress",
  );
});
test("current pain overrides favorable performance and existing context remains unchanged", () => {
  const c = context();
  c.goal.condition = { reportedOn: c.asOfDate, feeling: "pain" };
  const before = JSON.stringify(c);
  const p = refinePrescription(c, planPolicy(c, "current")).policy;
  assert.equal(p.maxWeekKm, 0);
  assert.equal(JSON.stringify(c), before);
});
test("review performance excludes later runs; plan keeps current partial week separate", () => {
  const c = context();
  const p = JSON.parse(
    reviewPrompt({ endsOn: "2026-10-25", limitations: [] }, c).input[0].content,
  );
  assert.ok(p.performance.observations.every((o) => o.date <= "2026-10-25"));
  assert.equal(p.performance.trends.length, 0);
  c.currentWeek.sessions = [
    {
      ...c.history.sessions.at(-1),
      trainingDate: "2026-11-02",
      startedAt: "2026-11-02T18:00:00Z",
    },
  ];
  assert.equal(performanceEvidence(c).observations.length, 5);
  assert.equal(c.history.sessions.length, 4);
});
test("validator rejects faster work, extra repeats and shorter recovery beyond the derived envelope", () => {
  const { validatePrescription } = load("lib/training/prescription.ts");
  const c = context("interval"),
    rules = refinePrescription(c, planPolicy(c, "current")).policy.prescription;
  const option = rules.intervals[0];
  const plan = {
    workouts: [
      {
        date: "2026-11-04",
        kind: "interval",
        distanceKm: 3.4,
        paceSecondsPerKm: null,
        steps: [
          {
            kind: "repeats",
            distanceMeters: 400,
            repetitions: 6,
            paceSecondsPerKm: option.minPace,
            recoveryMeters: 200,
            recoveryPaceSecondsPerKm: 360,
          },
        ],
      },
    ],
  };
  // This checks the prescription layer; full schema and arithmetic are covered separately.
  const reasons = [];
  assert.equal(
    validatePrescription(plan, rules, (r) => reasons.push(r)),
    true,
    reasons.join(","),
  );
  for (const edit of [
    (s) => (s.paceSecondsPerKm = option.minPace - 1),
    (s) => (s.repetitions = 9),
    (s) => (s.recoveryMeters = 150),
    (s) => (s.recoveryPaceSecondsPerKm = 350),
  ]) {
    const copy = structuredClone(plan);
    edit(copy.workouts[0].steps[0]);
    assert.equal(validatePrescription(copy, rules), false);
  }
});
test("one outlier or faster shorter work is not repeatable improvement", () => {
  assert.equal(
    performanceEvidence(context("sustained", [270, 270, 260, 270])).trends[0]
      .direction,
    "maintain",
  );
  const c = context();
  for (const s of c.history.sessions.slice(2))
    s.evidence.laps[1] = lap(4600, 260, "active");
  assert.equal(performanceEvidence(c).trends[0].direction, "maintain");
});
test("weekly effort holds faster tempo pace without forcing missing HR into a reduction", () => {
  const c = context();
  c.weeklyFeedback = [{ startsOn: "2026-10-26", rpe: 9 }];
  const p = refinePrescription(c, planPolicy(c, "current")).policy;
  assert.ok(
    p.prescription.bounds.find((b) => b.kind === "threshold").minPace >= 265,
  );
  const missing = context("sustained", undefined, [null, null, null, null]);
  assert.equal(performanceEvidence(missing).holdProgression, false);
});
test("a changed latest structure cannot reuse an older successful trend envelope", () => {
  const c = context("interval");
  const latest = structuredClone(c.history.sessions.at(-1));
  latest.trainingDate = "2026-11-02";
  latest.startedAt = "2026-11-02T18:00:00Z";
  for (const l of latest.evidence.laps.filter(
    (l) => l.intensity === "recovery",
  ))
    Object.assign(l, lap(400, 360, "recovery"));
  c.currentWeek.sessions = [latest];
  assert.equal(performanceEvidence(c).trends.length, 0);
});
