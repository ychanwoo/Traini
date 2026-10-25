import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(file, modules = {}) {
  const scope = {
    exports: {},
    Date,
    Intl,
    require: (name) => {
      if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
      return modules[name];
    },
  };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2023,
          module: ts.ModuleKind.CommonJS,
        },
      },
    ).outputText,
    scope,
  );
  return scope.exports;
}
const feedback = load("lib/training/coaching-feedback.ts");
const { buildCoachingFeedback: build } = feedback;
const date = (start, i) =>
  new Date(Date.parse(start + "T00:00:00Z") + i * 86400000)
    .toISOString()
    .slice(0, 10);
function fixture() {
  const state = {
    period: {
      startsOn: "2026-10-05",
      endsOn: "2026-10-11",
      timezone: "America/Los_Angeles",
    },
    metrics: {
      actualKm: 56.182,
      activityCount: 6,
      distanceKnown: 6,
      baselineKm: 53.052,
      hasPlan: false,
      feedbackReports: 0,
      explicitlySkipped: 0,
      unconfirmed: null,
      structuredQualitySessions: 1,
      activities: [20, 10, 10, 8, 7.4, 0.782].map((distanceKm) => ({
        distanceKm,
      })),
      sessions: [],
    },
    review: {
      id: "review-a",
      revision: "revision-a",
      fresh: true,
      content: { nextWeek: { direction: "maintain", volumeChangePercent: 0 } },
    },
  };
  const plan = (start) => ({
    period: { start, end: date(start, 6), today: "2026-10-17" },
    inputsChanged: false,
    plan: {
      review: {
        id: "review-a",
        startsOn: "2026-10-05",
        revision: "revision-a",
      },
      workouts: Array.from({ length: 7 }, (_, i) => ({
        date: date(start, i),
        kind: "rest",
        distanceKm: 0,
        completed: false,
        status: "scheduled",
      })),
    },
  });
  const input = {
    today: "2026-10-17",
    condition: { reportedOn: "2026-10-17", feeling: "pain" },
    current: plan("2026-10-12"),
    next: plan("2026-10-19"),
  };
  Object.assign(input.current.plan.workouts[4], {
    kind: "easy",
    distanceKm: 4,
    completed: true,
    status: "completed",
  });
  return { state, input };
}
test("coaching leads with a supported assessment and connects actual rest plans to the later symptom report", () => {
  const { state, input } = fixture(),
    before = structuredClone({ state, input });
  const r = build(state, input);
  assert.match(r.summary, /6회, 총 56.2km/);
  assert.match(r.summary, /53.1km보다 약 5.9% 많았어요/);
  assert.ok(r.observations.some((t) => t.includes("20km")));
  assert.ok(
    r.observations.some((t) => t.includes("당시 컨디션 피드백이 없어")),
  );
  for (const p of r.reflections) {
    assert.equal(p.status, "held");
    assert.match(p.text, /현재 제한과 맞게 저장/);
    assert.match(p.text, /선택한 주의 리뷰를 참고/);
  }
  assert.match(r.condition, /2026-10-17에 통증을 보고/);
  assert.deepEqual({ state, input }, before);
  assert.equal(r.source, "recorded_evidence_and_saved_plans");
});
test("partial, absent and zero-baseline history never produce a false workload comparison", () => {
  for (const change of [
    { actualKm: null, distanceKnown: 0 },
    { actualKm: 12, distanceKnown: 2 },
    { actualKm: null, activityCount: 0, distanceKnown: 0, activities: [] },
    { baselineKm: null },
    { baselineKm: 0 },
  ]) {
    const { state, input } = fixture();
    Object.assign(state.metrics, change);
    const r = build(state, input);
    assert.ok(!r.summary.includes("%"));
    assert.ok(!/NaN|Infinity/.test(JSON.stringify(r)));
  }
});
test("lower recorded volume and skipped training are not described as recovery or mileage debt", () => {
  const { state, input } = fixture();
  Object.assign(state.metrics, { actualKm: 30, explicitlySkipped: 2 });
  const r = build(state, input);
  assert.match(r.headline, /기록된 거리가 적/);
  assert.ok(
    r.observations.some((t) =>
      t.includes("반드시 보충해야 하는 거리로 다루지 않아요"),
    ),
  );
  assert.ok(!JSON.stringify(r).includes("회복됐어요"));
});
test("a stale review, stale plan and missing plan are different from confirmed application", () => {
  const { state, input } = fixture();
  state.review.fresh = false;
  input.current.inputsChanged = true;
  input.next.plan = null;
  input.condition = null;
  const r = build(state, input);
  assert.match(r.recommendation, /자료가 바뀌어/);
  assert.equal(r.reflections[0].status, "stale");
  assert.equal(r.reflections[1].status, "missing");
  assert.match(r.condition, /미입력/);
  assert.ok(!r.reflections.some((p) => p.text.includes("제한과 맞게 배치")));
});
test("a future reported session still conflicts with a pain hold even if regeneration protects its feedback", () => {
  const { state, input } = fixture();
  Object.assign(input.current.plan.workouts[5], {
    kind: "easy",
    distanceKm: 5,
    feedback: { version: 1 },
  });
  assert.equal(build(state, input).reflections[0].status, "conflict");
  // A saved completion remains protected even if a matching read has not
  // resolved the derived `completed` flag yet.
  input.current.plan.workouts[5].status = "completed";
  assert.equal(build(state, input).reflections[0].status, "held");
});
test("elapsed days never clear pain, and incomplete date coverage is not called a full rest plan", () => {
  const { state, input } = fixture();
  input.condition.reportedOn = "2026-09-01";
  assert.equal(build(state, input).reflections[1].status, "held");
  input.next.plan.workouts.pop();
  assert.equal(build(state, input).reflections[1].status, "partial");
});
test("reflection names the saved schedule rather than promising the AI recommendation was executed", () => {
  const { state, input } = fixture();
  input.condition = { reportedOn: "2026-10-17", feeling: "normal" };
  Object.assign(input.current.plan.workouts[6], {
    kind: "long",
    distanceKm: 12,
  });
  state.review.content.nextWeek = {
    direction: "progress",
    volumeChangePercent: 3,
  };
  const r = build(state, input);
  assert.match(r.recommendation, /늘리는 방향\(\+3%\)/);
  assert.match(r.reflections[0].text, /러닝 1회, 총 12km/);
  assert.equal(r.reflections[0].status, "linked");
  input.current.plan.review.revision = "older-revision";
  assert.equal(build(state, input).reflections[0].status, "not_linked");
  assert.match(
    build(state, input).reflections[0].text,
    /선택한 리뷰가 직접 반영된 것은 아니에요/,
  );
});
test("dated historical feedback is not silently treated as a current diagnosis", () => {
  const { state, input } = fixture();
  state.metrics.sessions = [
    { feedback: { assessment: { pain: "discomfort" } } },
  ];
  state.metrics.feedbackReports = 1;
  const r = build(state, input);
  assert.ok(r.observations.some((t) => t.includes("당시 보고이며")));
  input.condition = undefined;
  input.current = undefined;
  input.next = undefined;
  const unknown = build(state, input);
  assert.match(unknown.condition, /불러오지 못했어요/);
  assert.ok(unknown.reflections.every((p) => p.status === "unavailable"));
});
test("registered races remain separate from symptom-related training holds", () => {
  const { state, input } = fixture();
  input.next.races = [{ date: "2026-10-25" }];
  assert.match(
    build(state, input).reflections[1].text,
    /참가 가능 여부를 보장하지는 않아요/,
  );
});
test("coaching reads guard against mixed snapshots and retain weekly history when current state is unavailable", async () => {
  for (const mode of ["stable", "changed", "unavailable"]) {
    const { state, input } = fixture();
    let revisions = 0;
    const store = load("lib/training/coaching-storage.ts", {
      "server-only": {},
      "./review-storage": { readReview: async () => state },
      "./storage": {
        readTrainingContext: async () => {
          if (mode === "unavailable") throw Error("private failure");
          return {
            asOfDate: input.today,
            goal: { condition: input.condition },
          };
        },
      },
      "./plan-storage": {
        revision: async () =>
          mode === "changed" ? String(revisions++) : "same",
        readPlan: async (_id, week, _now, options) => {
          assert.equal(options.reconcile, false);
          return input[week];
        },
      },
      "./coaching-feedback": feedback,
      "@/lib/garmin/running-summary": { dateInZone: () => input.today, addCalendarDays: (date,n)=>new Date(Date.parse(date+"T00:00:00Z")+n*86400000).toISOString().slice(0,10) },
    });
    const result = await store.readCoachingReview("fixture-user");
    assert.equal(result.metrics, state.metrics);
    assert.equal(
      result.coaching.reflections[0].status,
      mode === "stable" ? "held" : "unavailable",
    );
    assert.ok(!JSON.stringify(result.coaching).includes("private failure"));
  }
});
