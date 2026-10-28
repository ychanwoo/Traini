import test from "node:test";
import assert from "node:assert/strict";
import { typescriptLoader } from "./helpers/load-typescript.mjs";

// Real policy/validators, synthetic activities only. No credentials, network or DB.
const load = typescriptLoader({}, {
  fetch: () => { throw new Error("Network is forbidden in regression tests"); },
});
const plans = load("lib/training/weekly-plan.ts");
const prescriptions = load("lib/training/prescription.ts");
const running = load("lib/garmin/running-summary.ts");
const contexts = load("lib/training/context.ts");
const errors = load("lib/training/plan-errors.ts");
function context(date = "2026-10-28", condition = null) {
  const now = new Date(date + "T19:00:00Z");
  const previous = running.runningPeriod("America/Los_Angeles", "previous", now);
  const rows = [0, 1, 2, 3].flatMap((week) => [0, 2, 3, 4, 6].map((day, i) => {
    const meters = [6000, 8000, 6000, 8000, 14000][i];
    return {
      garmin_activity_id: String(1000 + week * 10 + day),
      started_at: running.addCalendarDays(previous.start, -week * 7 + day) + "T18:00:00Z",
      updated_at: date + "T19:00:00Z", distance_meters: meters,
      duration_seconds: meters * 0.33, average_pace_seconds_per_km: 330,
      average_heart_rate: null,
    };
  }));
  return contexts.buildTrainingContext({
    race_name: "Synthetic race", target_distance: "FULL", target_date: "2027-03-14",
    target_time_seconds: null, training_days: [1, 3, 4, 5, 7], long_run_day: 7,
    race_goals: [], training_condition: condition,
  }, rows, "America/Los_Angeles", now);
}
function summary(c, days = []) {
  return running.buildRunningSummary(days.map((date, i) => ({
    garmin_activity_id: String(9000 + i), started_at: date + "T18:00:00Z",
    updated_at: date + "T19:00:00Z", distance_meters: 8000,
    duration_seconds: 2640, average_pace_seconds_per_km: 330,
  })), running.runningPeriod(c.timezone, "current", new Date(c.generatedAt)));
}
function policy(c = context(), week = "next", current = summary(c)) {
  let p = prescriptions.refinePrescription(c, plans.planPolicy(c, week, current), null, current).policy;
  if (week === "current") p = plans.accountCurrentWeek(p, current);
  return plans.finalizePlanPolicy(p);
}
function step(meters, kind = "steady", pace = null) {
  return { kind, distanceMeters: meters, paceSecondsPerKm: pace, repetitions: 1,
    recoveryMeters: 0, recoverySeconds: null, recoveryAfterLast: false,
    recoveryPaceSecondsPerKm: null };
}
function workout(date, distanceKm = 0) {
  return { date, kind: distanceKm ? "easy" : "rest", title: "검증용 훈련", purpose: "가상 기록으로 검증",
    distanceKm, paceSecondsPerKm: null, effort: distanceKm ? "conversational" : "rest",
    steps: distanceKm ? [step(Math.round(distanceKm * 1000))] : [] };
}
function response(p) {
  const days = p.dates.filter((date) => p.trainingDays.includes(plans.isoWeekday(date)) && !p.blockedDates.includes(date));
  const km = days.length && p.maxRunKm >= 0.5 ? Math.max(0.5, Math.ceil(p.minWeekKm / days.length * 10) / 10) : 0;
  return { summary: "실제 호출 없는 로컬 회귀 테스트", workouts: p.dates.map((date) => workout(date, days.includes(date) ? km : 0)) };
}
const violation = (value, p, reason) => assert.throws(() => plans.validatePlan(value, p),
  (error) => error.code === "invalid_output" && error.reason === reason);

test("Sunday first generation after the final run accepts all-rest without impossible minimum mileage", () => {
  const c = context("2026-11-01"), p = policy(c, "current", summary(c, ["2026-11-01"]));
  assert.equal(p.dates.length, 1);
  assert.equal(p.minWeekKm, 0); assert.equal(p.maxWeekKm, 0); assert.equal(p.maxRunKm, 0);
  assert.equal(p.maxHardSessions, 0);
  assert.equal(plans.validatePlan(response(p), p).workouts[0].kind, "rest");
});
test("recorded runs and protected completed/skipped/feedback dates cannot retain infeasible weekly floors", () => {
  const c = context("2026-10-30"), observed = summary(c, ["2026-10-30"]);
  let p = policy(c, "current", observed);
  p.prescription.dayLimits.push({ date: "2026-11-01", maxDistanceKm: 3.27, easyOnly: true, minPace: 330 });
  p = plans.finalizePlanPolicy(p);
  assert.equal(p.maxWeekKm, 3.2); assert.equal(p.minWeekKm, 3.2);
  const value = { summary: "남은 일요일만 조정", workouts: p.dates.map((d) => workout(d, d === "2026-11-01" ? 3.2 : 0)) };
  plans.validatePlan(value, p);
  p = plans.finalizePlanPolicy(p, ["2026-11-01"]);
  assert.equal(p.minWeekKm, 0); assert.equal(p.maxWeekKm, 0);
  assert.equal(p.prescription.allowedLongRunDates.length, 0);
  plans.validatePlan(response(p), p);
});
test("sub-500m daily capacity becomes rest and repeated finalization does not change the policy", () => {
  const p = policy();
  p.prescription.dayLimits = p.dates.map((date) => ({ date, maxDistanceKm: 0.49, easyOnly: true, minPace: 330 }));
  const final = plans.finalizePlanPolicy(p);
  assert.equal(final.maxWeekKm, 0); assert.equal(final.minWeekKm, 0);
  assert.deepEqual(plans.finalizePlanPolicy(final), final);
  plans.validatePlan(response(final), final);
});
test("Monday, midweek, Sunday and DST next-week plans retain feasible bounds", () => {
  for (const date of ["2026-10-26", "2026-10-28", "2026-11-01", "2026-11-02"]) {
    for (const week of ["current", "next"]) {
      const p = policy(context(date), week);
      assert.ok(p.minWeekKm <= p.maxWeekKm);
      plans.validatePlan(response(p), p);
      assert.ok(p.dates.every((d) => d >= p.today));
    }
  }
});
test("unresolved symptoms and race recovery never regain a minimum through finalization", () => {
  const c = context("2026-10-28", { reportedOn: "2026-10-28", feeling: "pain" });
  for (const week of ["current", "next"]) {
    const p = policy(c, week); assert.equal(p.maxWeekKm, 0);
    plans.validatePlan(response(p), p);
  }
  const p = plans.finalizePlanPolicy({ ...policy(), allowAllRest: true });
  assert.equal(p.minWeekKm, 0);
  plans.validatePlan({ summary: "회복 확인 전 휴식", workouts: p.dates.map((d) => workout(d)) }, p);
});
function hardPolicy() {
  const p = policy(); p.minWeekKm = 0; p.maxHardSessions = 2; p.maxQualityKm = 10;
  return p;
}
function hardResponse(p, kind = "threshold", repetitions = 5, pace = null) {
  const value = { summary: "가상 강도 검증", workouts: p.dates.map((d) => workout(d)) };
  const w = value.workouts.find((w) => w.date === "2026-11-04");
  const work = kind === "interval" ? { ...step(800, "repeats", pace), repetitions, recoveryMeters: 400 } : step(4000, "steady", pace);
  Object.assign(w, { kind, effort: "controlled", distanceKm: kind === "interval" ? (4000 + 800 * repetitions + 400 * (repetitions - 1)) / 1000 : 8,
    steps: [step(2000, "warmup"), work, step(2000, "cooldown")] });
  return value;
}
test("unknown tempo pace explicitly requires null while known bounded tempo pace stays valid", () => {
  const p = hardPolicy(); assert.equal(p.prescription.tempoPaceKnown, false);
  plans.validatePlan(hardResponse(p), p);
  violation(hardResponse(p, "threshold", 5, 330), p, "tempo_pace");
  const w = hardResponse(p); w.workouts[2].paceSecondsPerKm = 330;
  violation(w, p, "tempo_pace");
  p.prescription.tempoPaceKnown = true;
  plans.validatePlan(hardResponse(p, "threshold", 5, 330), p);
  assert.match(plans.trainingPrompt(context(), p).instructions, /tempoPaceKnown=false.*MUST be null/);
});
test("800m progression requires known non-faster pace; null is valid when repetitions are maintained", () => {
  const p = hardPolicy();
  p.prescription.intervals = [{ meters: 800, observedRepetitions: 5, maxRepetitions: 6,
    observedPace: 320, minPace: 310, minRecoveryMeters: 300, maxRecoveryMeters: 600, minRecoveryPace: null }];
  plans.validatePlan(hardResponse(p, "interval", 5), p);
  violation(hardResponse(p, "interval", 6), p, "interval_progression");
  violation(hardResponse(p, "interval", 6, 315), p, "interval_progression");
  plans.validatePlan(hardResponse(p, "interval", 6, 320), p);
  p.prescription.noProgression = true;
  violation(hardResponse(p, "interval", 6, 320), p, "interval_progression");
  assert.match(plans.trainingPrompt(context(), p).instructions, /when work pace is uncertain\/null, never exceed observedRepetitions/);
});
test("strict JSON schema and instructions share step count, numeric bounds and required keys", () => {
  const p = policy(), prompt = plans.trainingPrompt(context(), p);
  const format = prompt.text.format;
  assert.equal(format.type, "json_schema"); assert.equal(format.strict, true);
  const root = format.schema, workouts = root.properties.workouts;
  assert.equal(root.additionalProperties, false);
  assert.equal(workouts.minItems, p.dates.length); assert.equal(workouts.maxItems, p.dates.length);
  assert.deepEqual(Array.from(workouts.items.required), Object.keys(workouts.items.properties));
  const steps = workouts.items.properties.steps;
  assert.equal(steps.maxItems, plans.PLAN_LIMITS.steps);
  assert.equal(steps.items.additionalProperties, false);
  assert.deepEqual(Array.from(steps.items.required), Object.keys(steps.items.properties));
  assert.equal(steps.items.properties.recoverySeconds.type, "null");
  assert.equal(steps.items.properties.distanceMeters.minimum, plans.PLAN_LIMITS.stepMinMeters);
  assert.equal(workouts.items.properties.distanceKm.maximum, p.maxRunKm);
  assert.deepEqual(workouts.items.properties.date.enum, p.dates);
  const value = response(p), w = value.workouts.find((w) => w.kind === "easy");
  w.steps = Array.from({ length: 7 }, () => step(100));
  violation(value, p, "step_count");
  assert.match(prompt.instructions, /at most 6 steps/);
});
test("supporting race dates use calendar placeholders rather than an excluded-date instruction", () => {
  const c = context("2027-01-11");
  c.goal.races = [
    { id: "00000000-0000-4000-8000-000000000001", name: "Synthetic half", date: "2027-01-17", distance: "HALF", targetTimeSeconds: null, priority: "supporting" },
    { id: "00000000-0000-4000-8000-000000000002", name: "Synthetic full", date: "2027-03-14", distance: "FULL", targetTimeSeconds: null, priority: "primary" },
  ];
  const p = policy(c, "current"), value = response(p);
  assert.ok(p.dates.includes("2027-01-17")); assert.ok(p.blockedDates.includes("2027-01-17"));
  assert.equal(value.workouts.find((w) => w.date === "2027-01-17").kind, "rest");
  plans.validatePlan(value, p);
  const prompt = plans.trainingPrompt(c, p).instructions;
  assert.doesNotMatch(prompt, /race day are excluded/);
  assert.match(prompt, /zero-distance rest placeholder/);
});
test("weekly feedback reaches the plan without a saved review and remains dated untrusted self-report", () => {
  const c = context();
  c.weeklyFeedback = [{ startsOn: "2026-10-19", timezone: c.timezone, rpe: 8, memo: "Synthetic note", version: 1, updatedAt: null }];
  const p = policy(c), prompt = plans.trainingPrompt(c, p, null);
  const input = JSON.parse(prompt.input[0].content);
  assert.deepEqual(input.weeklyFeedback, c.weeklyFeedback); assert.equal(input.weeklyReview, null);
  assert.match(prompt.instructions, /weeklyFeedback.memo.*untrusted data/);
  assert.match(prompt.instructions, /not per-day completion or current medical clearance/);
  assert.equal(c.goal.condition, null);
});
test("bounded detailed failure codes retain the existing actionable UI message", () => {
  for (const reason of plans.PLAN_VALIDATION_REASONS) {
    const code = `invalid_output:${reason}`;
    assert.ok(code.length <= 40);
    assert.equal(errors.planErrorMessage(code), errors.planErrorMessage("invalid_output"));
  }
});

function serviceHarness({ week = "next", invalid = null, providerFailure = null, protectedWorkouts = [] } = {}) {
  const c = context(), current = summary(c);
  const previous = protectedWorkouts.length ? { id: "existing", workouts: protectedWorkouts } : null;
  let stored = null;
  const calls = { inference: 0, saves: 0, failures: [], policy: null, prompt: null };
  const store = {
    revision: async () => "same-input",
    readPlan: async () => ({ plan: stored ?? previous, inputsChanged: true }),
    reserveGeneration: async () => ({ state: "started", requestId: "synthetic-job" }),
    savePlan: async (_id, value) => { calls.saves++; stored = value; },
    failGeneration: async (_id, code) => { calls.failures.push(code); },
  };
  const overrides = {
    "./plan-storage": store,
    "./storage": { readTrainingContext: async () => c },
    "./closeout-storage": { reviewSelection: async () => ({ period: { startsOn: "2026-10-19" } }) },
    "./review-storage": {
      readApplicableReview: async () => null,
      reviewInputs: async () => ({ metrics: null, closeout: null }),
    },
    "@/lib/garmin/read-running-summary": { readRunningSummary: async () => current },
    "@/scripts/lib/chatgpt-inference.mjs": { generateWithSubscription: async (_owner, prompt) => {
      calls.inference++; calls.prompt = prompt;
      calls.policy = JSON.parse(prompt.input[0].content).policy;
      if (providerFailure) throw new Error(providerFailure);
      const value = response(calls.policy);
      if (invalid) invalid(value, calls.policy);
      return { content: value, model: "synthetic-model" };
    } },
  };
  const modules = typescriptLoader(overrides);
  return { calls, c, previous, run: () => modules("lib/training/plan-service.ts").generatePlan("synthetic-owner", week),
    preview: () => modules("lib/training/prescription-storage.ts").readPrescriptionPreview("synthetic-owner", week) };
}
test("real service and preview share protected-date limits, structured output and weekly inputs", async () => {
  for (const week of ["current", "next"]) {
    const dates = week === "current" ? ["2026-10-28", "2026-10-29", "2026-10-30"] : ["2026-11-02", "2026-11-04", "2026-11-05"];
    const h = serviceHarness({ week, protectedWorkouts: [
      { ...workout(dates[0], 6), completed: true },
      { ...workout(dates[1], 6), status: "skipped" },
      { ...workout(dates[2], 6), feedback: { version: 1 } },
    ] });
    h.c.weeklyFeedback = [{ startsOn: "2026-10-19", timezone: h.c.timezone, rpe: 7, memo: "Synthetic feedback", version: 1, updatedAt: null }];
    const preview = await h.preview();
    const result = await h.run();
    assert.equal(h.calls.inference, 1); assert.equal(h.calls.saves, 1);
    assert.equal(h.calls.prompt.text.format.strict, true);
    const input = JSON.parse(h.calls.prompt.input[0].content);
    assert.equal(input.weeklyFeedback[0].memo, "Synthetic feedback");
    assert.equal(input.weeklyReview, null);
    assert.equal(preview.limits.maxWeekKm, h.calls.policy.maxWeekKm);
    assert.equal(preview.limits.maxRunKm, h.calls.policy.maxRunKm);
    assert.equal(preview.limits.maxHardSessions, h.calls.policy.maxHardSessions);
    for (const date of dates) {
      assert.ok(h.calls.policy.blockedDates.includes(date));
      assert.equal(result.plan.workouts.find((w) => w.date === date)?.kind, "rest");
    }
    assert.equal(h.previous.workouts[0].distanceKm, 6);
    assert.equal(h.previous.workouts[1].status, "skipped");
  }
});
test("invalid output persists only a bounded reason, preserves the previous plan and never retries inference", async () => {
  const h = serviceHarness({ protectedWorkouts: [{ ...workout("2026-11-02", 6), completed: true }],
    invalid: (value) => { value.workouts.find((w) => w.kind !== "rest").steps = Array.from({ length: 7 }, () => step(100)); } });
  await assert.rejects(h.run(), (e) => e.code === "invalid_output" && e.reason === "step_count");
  assert.deepEqual(h.calls.failures, ["invalid_output:step_count"]);
  assert.equal(h.calls.inference, 1); assert.equal(h.calls.saves, 0);
  assert.equal(h.previous.workouts[0].distanceKm, 6);
});
test("JSON parse failure is distinguished from semantic rejection without storing provider content", async () => {
  const h = serviceHarness({ providerFailure: "invalid_output" });
  await assert.rejects(h.run(), (e) => e.code === "invalid_output" && e.reason === "json");
  assert.deepEqual(h.calls.failures, ["invalid_output:json"]);
  assert.equal(h.calls.inference, 1); assert.equal(h.calls.saves, 0);
});
test("generation API returns bounded diagnostic reason with the existing code and private response headers", async () => {
  const modules = typescriptLoader({
    "@/lib/security/admin": { requireAdmin: async () => ({ userId: "synthetic-owner" }) },
    "@/lib/training/plan-service": { generatePlan: async () => { throw new plans.PlanError("invalid_output", "tempo_pace"); } },
    "@/lib/training/weekly-plan": plans,
  });
  const api = modules("app/api/training/generate/route.ts");
  const result = await api.POST(new Request("http://localhost:3017/api/training/generate", {
    method: "POST", headers: { origin: "http://localhost:3017", "content-type": "application/json" }, body: JSON.stringify({ week: "current" }),
  }));
  assert.equal(result.status, 503);
  assert.match(result.headers.get("cache-control"), /no-store/);
  const body = await result.json();
  assert.equal(body.code, "invalid_output"); assert.equal(body.reason, "tempo_pace");
  assert.match(body.error, /기존 계획은 유지/);
});

test("all weekday import/protection combinations admit a server-valid remaining plan", () => {
  for (let day = 0; day < 7; day++) {
    const date = running.addCalendarDays("2026-10-26", day), c = context(date);
    const observed = summary(c, [date]);
    for (const week of ["current", "next"]) {
      const original = policy(c, week, observed);
      for (const protectAll of [false, true]) {
        const protectedDates = original.dates.filter((_, i) => protectAll || i % 2 === 0);
        original.prescription.dayLimits = original.dates.map((date, i) => ({
          date, maxDistanceKm: [0.49, 2.27, 5.13][i % 3], easyOnly: true, minPace: 330,
        }));
        const p = plans.finalizePlanPolicy(original, protectedDates);
        let remaining = p.minWeekKm;
        const value = { summary: "요일별 제한 검증", workouts: p.dates.map((date) => {
          if (p.blockedDates.includes(date) || !p.trainingDays.includes(plans.isoWeekday(date))) return workout(date);
          const cap = Math.floor(Math.min(p.maxRunKm, p.prescription.dayLimits.find((d) => d.date === date).maxDistanceKm) * 10 + 1e-7) / 10;
          if (cap < 0.5 || remaining < 0.01) return workout(date);
          const distance = Math.max(0.5, Math.min(cap, Math.ceil(remaining * 10 - 1e-7) / 10));
          remaining -= distance;
          return workout(date, distance);
        }) };
        // A zero floor with available capacity still requires one non-rest session.
        if (p.maxWeekKm >= 0.5 && value.workouts.every((w) => w.kind === "rest")) {
          const date = p.dates.find((d) => p.trainingDays.includes(plans.isoWeekday(d)) && !p.blockedDates.includes(d) && p.prescription.dayLimits.find((l) => l.date === d).maxDistanceKm >= 0.5);
          value.workouts[value.workouts.findIndex((w) => w.date === date)] = workout(date, 0.5);
        }
        plans.validatePlan(value, p);
      }
    }
  }
});
