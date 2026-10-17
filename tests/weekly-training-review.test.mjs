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
const reviews = load("lib/training/weekly-review.ts", {
  "@/lib/garmin/running-summary": running,
  "./goal": goal,
  "./prescription": { validatePrescription: () => true },
  "./workout-matching": matching,
});
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  rev = "a".repeat(32);
function fixture() {
  return {
    startsOn: "2026-10-05",
    endsOn: "2026-10-11",
    timezone: "America/Los_Angeles",
    revision: rev,
    contextHash: rev,
    source: {
      planId: id(1),
      timezone: "America/Los_Angeles",
      today: "2026-10-16",
      revision: rev,
      workouts: [
        {
          id: id(2),
          date: "2026-10-05",
          kind: "easy",
          status: "scheduled",
          distanceKm: 7,
          steps: [],
          manualCompletedAt: null,
          state: "unmatched",
          reason: "no_activity",
          dismissed: false,
        },
      ],
      activities: [
        {
          id: id(3),
          garminId: "123",
          startedAt: "2026-10-05T19:00:00Z",
          distanceMeters: 7000,
          timerSeconds: 2310,
          paceSecondsPerKm: 330,
          verified: true,
          revision: rev,
          evidence: null,
        },
      ],
      links: [],
    },
  };
}
function context() {
  return {
    goal: { raceName: "PRIVATE GOAL" },
    reportedBaseline: null,
    history: {
      weeks: [0, 1, 2, 3].map((i) => ({
        start: running.addCalendarDays("2026-09-07", i * 7),
        end: running.addCalendarDays("2026-09-13", i * 7),
        activityCount: 4,
        distanceMeters: 28000,
        coverage: { distanceCount: 4 },
      })),
      sessions: [],
    },
  };
}
function valid(m) {
  return {
    summary: "실제 러닝 기록을 기준으로 검토했어요.",
    observations: [
      {
        topic: "volume",
        evidence: ["actualKm"],
        text: "확인된 러닝 거리를 바탕으로 정리했어요.",
      },
    ],
    nextWeek: {
      direction: "maintain",
      volumeChangePercent: 0,
      maxQualitySessions: m.envelope.supportedQualitySessions,
      rationale: "이전 훈련 수준을 유지합니다.",
    },
    limitations: [...m.limitations],
  };
}
const metrics = (s = fixture(), c = context()) =>
  reviews.buildReviewMetrics(reviews.parseReviewSnapshot(s), c);
test("completed weeks follow local Mondays across timezone and DST", () => {
  const now = new Date("2026-11-02T07:30:00Z");
  assert.equal(
    reviews.reviewPeriod("America/Los_Angeles", null, now).startsOn,
    "2026-10-19",
  );
  assert.equal(
    reviews.reviewPeriod("Asia/Seoul", null, now).startsOn,
    "2026-10-26",
  );
  for (const start of ["2026-10-27", "2026-11-02", "2026-08-31", "garbage"])
    assert.throws(
      () => reviews.reviewPeriod("Asia/Seoul", start, now),
      /review_period/,
    );
});
test("no plan is unknown and unmatched running is not fabricated additional training", () => {
  const s = fixture();
  s.source.planId = null;
  s.source.workouts = [];
  const m = metrics(s);
  assert.equal(m.plannedKm, null);
  assert.equal(m.plannedSessions, null);
  assert.equal(m.unconfirmed, null);
  assert.equal(m.actualKm, 7);
  assert.equal(m.additionalRuns, 0);
  assert.equal(m.unassignedRuns, 1);
  assert.equal(m.envelope.minVolumeChangePercent, 0);
  assert.equal(m.envelope.supportedQualitySessions, 2);
});
test("manual completion and unknown sessions never count as Garmin confirmation", () => {
  const s = fixture();
  let m = metrics(s);
  assert.equal(m.unconfirmed, 1);
  s.source.workouts[0].manualCompletedAt = "2026-10-05T20:00:00Z";
  m = metrics(s);
  assert.equal(m.manualCompleted, 1);
  assert.equal(m.garminCompleted, 0);
  assert.equal(m.manualPlanKm, 7);
  assert.equal(m.actualKm, 7);
});
test("only valid dated revision-bound links confirm Garmin; stale links are ignored", () => {
  const s = fixture();
  s.source.links = [
    {
      workoutId: id(2),
      activityId: id(3),
      method: "confirmed",
      active: true,
      revision: rev,
    },
  ];
  assert.equal(metrics(s).garminCompleted, 1);
  s.source.links[0].revision = "b".repeat(32);
  assert.equal(metrics(s).garminCompleted, 0);
  s.source.links[0].revision = rev;
  s.source.workouts[0].date = "2026-10-06";
  assert.equal(metrics(s).garminCompleted, 0);
});
test("rest-day runs, null metrics and unverified records stay distinct", () => {
  const s = fixture();
  s.source.workouts[0].kind = "rest";
  s.source.workouts[0].distanceKm = 0;
  assert.equal(metrics(s).additionalRuns, 1);
  s.source.activities[0].distanceMeters = null;
  assert.equal(metrics(s).actualKm, null);
  assert.equal(metrics(s).averagePaceSecondsPerKm, null);
  assert.ok(metrics(s).limitations.includes("missing_metrics"));
  s.source.activities[0].verified = false;
  assert.equal(metrics(s).activityCount, 0);
});
test("snapshot corruption, duplicate activity and outside-week activity fail closed", () => {
  for (const edit of [
    (s) => (s.revision = "bad"),
    (s) => s.source.activities.push(s.source.activities[0]),
    (s) => (s.source.activities[0].startedAt = "2026-10-12T19:00:00Z"),
  ]) {
    const s = fixture();
    edit(s);
    assert.throws(() => reviews.parseReviewSnapshot(s), /review_storage/);
  }
});
test("missing history does not authorize reduced distance or fewer quality sessions", () => {
  const c = context();
  c.history.weeks = [];
  const m = metrics(fixture(), c),
    v = valid(m);
  assert.equal(m.envelope.canReduce, false);
  assert.equal(m.envelope.canProgress, false);
  v.nextWeek.maxQualitySessions = 0;
  assert.throws(() => reviews.validateReview(v, m), /invalid_review/);
  v.nextWeek.maxQualitySessions = 2;
  v.nextWeek.direction = "reduce";
  v.nextWeek.volumeChangePercent = -5;
  assert.throws(() => reviews.validateReview(v, m), /invalid_review/);
});
test("load above established baseline opens bounded reduction but never unbounded progression", () => {
  const s = fixture();
  s.source.activities[0].distanceMeters = 40000;
  const m = metrics(s);
  assert.equal(m.baselineKm, 28);
  assert.equal(m.envelope.canReduce, true);
  const v = valid(m);
  v.nextWeek.direction = "reduce";
  v.nextWeek.volumeChangePercent = -15;
  assert.equal(reviews.validateReview(v, m).nextWeek.volumeChangePercent, -15);
  v.nextWeek.volumeChangePercent = -16;
  assert.throws(() => reviews.validateReview(v, m), /invalid_review/);
});
test("all Garmin-confirmed sessions with complete prior history can open modest progression", () => {
  const s = fixture();
  s.source.workouts = [];
  s.source.activities = [];
  for (let i = 0; i < 4; i++) {
    s.source.workouts.push({
      ...fixture().source.workouts[0],
      id: id(10 + i),
      date: running.addCalendarDays(s.startsOn, i),
    });
    s.source.activities.push({
      ...fixture().source.activities[0],
      id: id(20 + i),
      startedAt: `${running.addCalendarDays(s.startsOn, i)}T19:00:00Z`,
    });
    s.source.links.push({
      workoutId: id(10 + i),
      activityId: id(20 + i),
      method: "automatic",
      active: true,
      revision: rev,
    });
  }
  const m = metrics(s);
  assert.equal(m.envelope.canProgress, true);
  const v = valid(m);
  v.nextWeek.direction = "progress";
  v.nextWeek.volumeChangePercent = 5;
  reviews.validateReview(v, m);
  v.nextWeek.volumeChangePercent = 6;
  assert.throws(() => reviews.validateReview(v, m), /invalid_review/);
});
test("generic interval laps do not prove hard training; measured active blocks require contrast", () => {
  const s = fixture(),
    laps = [
      { intensity: "warmup", distanceMeters: 2000, paceSecondsPerKm: 340 },
      { intensity: "active", distanceMeters: 400, paceSecondsPerKm: 230 },
      { intensity: "recovery", distanceMeters: 200, paceSecondsPerKm: 360 },
      { intensity: "cooldown", distanceMeters: 2000, paceSecondsPerKm: 340 },
    ];
  s.source.activities[0].evidence = { lapsComplete: true, laps };
  assert.equal(metrics(s).structuredQualitySessions, 1);
  laps[1].intensity = "interval";
  assert.equal(metrics(s).structuredQualitySessions, 0);
  laps[1].intensity = "active";
  laps[1].paceSecondsPerKm = 335;
  assert.equal(metrics(s).structuredQualitySessions, 0);
});
test("strict review validator rejects extra keys, invented evidence and omitted limitations", () => {
  const m = metrics();
  for (const edit of [
    (v) => (v.extra = 1),
    (v) => (v.summary = ""),
    (v) => (v.observations[0].evidence = ["sleepScore"]),
    (v) => (v.limitations = []),
    (v) => (v.nextWeek.direction = "progress"),
    (v) => (v.nextWeek.volumeChangePercent = NaN),
    (v) => (v.nextWeek.maxQualitySessions = 3),
    (v) => (v.summary = "x".repeat(1001)),
  ]) {
    const v = valid(m);
    edit(v);
    assert.throws(() => reviews.validateReview(v, m), /invalid_review/);
  }
  assert.ok(reviews.validateReview(valid(m), m));
});
test("review prompt uses strict structured output and excludes activity IDs and GPS", () => {
  const m = metrics(),
    p = reviews.reviewPrompt(m, context()),
    text = JSON.stringify(p);
  assert.equal(p.text.format.strict, true);
  assert.equal(p.text.format.schema.additionalProperties, false);
  assert.equal(text.includes(id(3)), false);
  assert.equal(text.includes("garminId"), false);
  assert.match(p.instructions, /missing activities are unknown/);
});
test("review policy cannot raise caps or defeat race taper and applies before current-week accounting", () => {
  const p = {
    start: "2026-10-19",
    maxHardSessions: 2,
    maxQualityKm: 15,
    weeklyCeilingKm: 60,
    referenceWeekKm: 56,
    maxWeekKm: 60,
    minWeekKm: 50,
    maxRunKm: 24,
  };
  const review = {
    startsOn: "2026-10-05",
    nextWeek: {
      direction: "reduce",
      volumeChangePercent: -10,
      maxQualitySessions: 1,
    },
  };
  const next = reviews.applyReviewPolicy(p, review);
  assert.equal(next.weeklyCeilingKm, 50.4);
  assert.equal(next.maxHardSessions, 1);
  assert.ok(next.maxRunKm <= p.maxRunKm);
  assert.equal(p.weeklyCeilingKm, 60);
  const taper = { ...p, weeklyCeilingKm: 40, maxWeekKm: 40, minWeekKm: 30 };
  const progress = {
    ...review,
    nextWeek: {
      direction: "progress",
      volumeChangePercent: 5,
      maxQualitySessions: 2,
    },
  };
  assert.equal(reviews.applyReviewPolicy(taper, progress).maxWeekKm, 40);
  assert.equal(reviews.applyReviewPolicy(taper, progress).minWeekKm, 30);
  assert.equal(
    reviews.applyReviewPolicy(p, { ...review, startsOn: "2026-09-28" }),
    p,
  );
});
function service(
  overrides = {},
  inference = async () => {
    throw new Error("network");
  },
) {
  return load("lib/training/review-service.ts", {
    "server-only": {},
    "@/scripts/lib/chatgpt-inference.mjs": {
      generateWithSubscription: inference,
    },
    "./weekly-review": reviews,
    "./review-storage": {
      readReview: async () => ({ review: null }),
      reviewInputs: async () => ({
        period: { startsOn: "2026-10-05", timezone: "America/Los_Angeles" },
        snapshot: fixture(),
        context: context(),
        metrics: metrics(),
      }),
      reserveReview: async () => ({ state: "started", requestId: "job" }),
      saveReview: async () => {},
      failReview: async () => {},
      generationState: async () => "running",
      ...overrides,
    },
  });
}
test("identical review reuse and reservation conflicts stop before inference", async () => {
  let calls = 0;
  const ai = async () => {
    calls++;
    throw new Error("network");
  };
  await service(
    { readReview: async () => ({ review: { fresh: true } }) },
    ai,
  ).generateReview("owner");
  for (const state of ["busy", "limited"])
    await assert.rejects(
      service({ reserveReview: async () => ({ state }) }, ai).generateReview(
        "owner",
      ),
      new RegExp(state),
    );
  assert.equal(calls, 0);
});
test("invalid AI output and network failures retain saved review; bounded failure code persists", async () => {
  let saves = 0,
    failed = [];
  for (const inference of [
    async () => ({ content: {}, model: "model" }),
    async () => {
      throw new Error("secret provider detail");
    },
  ])
    await assert.rejects(
      service(
        {
          saveReview: async () => {
            saves++;
          },
          failReview: async (_id, code) => {
            failed.push(code);
          },
        },
        inference,
      ).generateReview("owner"),
    );
  assert.equal(saves, 0);
  assert.equal(failed.join(","), "invalid_review,generation");
});
test("validated review is saved once and changed snapshot cannot be committed", async () => {
  let saves = 0;
  const ai = async () => ({ content: valid(metrics()), model: "fixture" });
  await service(
    {
      saveReview: async () => {
        saves++;
      },
    },
    ai,
  ).generateReview("owner");
  assert.equal(saves, 1);
  await assert.rejects(
    service(
      {
        saveReview: async () => {
          throw new reviews.ReviewError("review_changed");
        },
      },
      ai,
    ).generateReview("owner"),
    /review_changed/,
  );
});
const requestInput = load("lib/security/json-request.ts");
function route(admin = true) {
  return load("app/api/training/review/route.ts", {
    "@/lib/security/admin": {
      requireAdmin: async () =>
        admin
          ? { userId: "owner" }
          : {
              response: Response.json(
                { error: "unauthorized" },
                { status: 401 },
              ),
            },
    },
    "@/lib/security/json-request": requestInput,
    "@/lib/training/coaching-storage": {
      readCoachingReview: async (uid, start) => {
        reviews.reviewPeriod(
          "America/Los_Angeles",
          start,
          new Date("2026-10-16T19:00:00Z"),
        );
        return { uid, start };
      },
    },
    "@/lib/training/review-service": {
      generateReview: async () => {
        throw new reviews.ReviewError("limited");
      },
    },
    "@/lib/training/weekly-review": reviews,
    "@/lib/training/review-errors": { reviewErrorMessage: (code) => code },
  });
}
test("review API rejects unauthenticated, foreign-origin, oversize and owner-injected requests", async () => {
  const base = "http://localhost:3017/api/training/review";
  assert.equal((await route(false).GET(new Request(base))).status, 401);
  const post = (body, origin = "http://localhost:3017") =>
    new Request(base, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal((await route().POST(post({}, "https://evil.test"))).status, 403);
  assert.equal((await route().POST(post({ userId: "other" }))).status, 400);
  assert.equal(
    (await route().POST(post({ startsOn: "x".repeat(3000) }))).status,
    413,
  );
  const limited = await route().POST(post({}));
  assert.equal(limited.status, 429);
  assert.match(limited.headers.get("cache-control"), /no-store/);
  assert.equal(
    (await route().GET(new Request(base + "?start=2026-10-12"))).status,
    400,
  );
  assert.equal(
    (await route().GET(new Request(base + "?start=2026-10-05"))).status,
    200,
  );
});
test("plan generation passes the fresh review and reduced server policy to inference", async () => {
  const contexts = load("lib/training/context.ts", {
    "@/lib/garmin/running-summary": running,
    "./goal": goal,
    "./prescription": { validatePrescription: () => true },
  });
  const plans = load("lib/training/weekly-plan.ts", {
    "@/lib/garmin/running-summary": running,
    "./goal": goal,
    "./prescription": { validatePrescription: () => true },
  });
  const rows = [0, 1, 2, 3].flatMap((w) =>
    [0, 2, 4, 6].map((d, i) => ({
      garmin_activity_id: String(1000 + w * 10 + i),
      started_at: `${running.addCalendarDays("2026-09-14", w * 7 + d)}T19:00:00Z`,
      updated_at: "2026-10-12T00:00:00Z",
      distance_meters: 7000,
      duration_seconds: 2310,
      average_pace_seconds_per_km: 330,
      average_heart_rate: null,
    })),
  );
  const ctx = contexts.buildTrainingContext(
    {
      race_name: "Fixture",
      target_distance: "FULL",
      target_date: "2027-03-01",
      target_time_seconds: null,
      training_days: [1, 3, 5, 7],
      long_run_day: 7,
    },
    rows,
    "America/Los_Angeles",
    new Date("2026-10-16T18:00:00Z"),
  );
  const applied = {
    id: id(90),
    startsOn: "2026-10-05",
    revision: rev,
    summary: "실측 부하에 따른 조정",
    nextWeek: {
      direction: "reduce",
      volumeChangePercent: -10,
      maxQualitySessions: 2,
      rationale: "직전 훈련량을 검토했어요.",
    },
  };
  let prompt;
  const svc = load("lib/training/plan-service.ts", {
    "./prescription-storage": {
      readPrescriptionEvidence: async () => ({
        execution: null,
        current: null,
      }),
    },
    "./prescription": { refinePrescription: (_c, policy) => ({ policy }) },
    "server-only": {},
    "./review-storage": { readApplicableReview: async () => applied },
    "./weekly-review": reviews,
    "./storage": { readTrainingContext: async () => ctx },
    "./weekly-plan": plans,
    "@/lib/garmin/read-running-summary": {
      readRunningSummary: async () => {
        throw new Error("not current");
      },
    },
    "./plan-storage": {
      revision: async () => rev,
      readPlan: async () => ({ plan: null }),
      reserveGeneration: async () => ({ state: "started", requestId: "job" }),
      savePlan: async () => {
        throw new Error("invalid output saved");
      },
      failGeneration: async () => {},
    },
    "@/scripts/lib/chatgpt-inference.mjs": {
      generateWithSubscription: async (_owner, p) => {
        prompt = p;
        return { content: {}, model: "fixture" };
      },
    },
  });
  await assert.rejects(svc.generatePlan("owner", "next"), /invalid_output/);
  const input = JSON.parse(prompt.input[0].content);
  assert.equal(input.weeklyReview.id, applied.id);
  assert.equal(input.policy.weeklyCeilingKm, 25.2);
  assert.ok(input.policy.maxWeekKm <= 25.2);
});

test("committed review survives a lost save response without another inference or failure write", async () => {
  let calls = 0,
    failed = 0,
    reads = 0;
  const result = await service(
    {
      readReview: async () =>
        ++reads === 1
          ? { review: null }
          : { review: { id: "saved", fresh: true } },
      saveReview: async () => {
        throw new reviews.ReviewError("review_storage");
      },
      generationState: async () => "completed",
      failReview: async () => {
        failed++;
      },
    },
    async () => {
      calls++;
      return { content: valid(metrics()), model: "fixture" };
    },
  ).generateReview("owner");
  assert.equal(result.review.id, "saved");
  assert.equal(calls, 1);
  assert.equal(failed, 0);
});
test("unknown review save outcome retains lease instead of permitting a duplicate inference", async () => {
  let failed = 0;
  await assert.rejects(
    service(
      {
        saveReview: async () => {
          throw new reviews.ReviewError("review_storage");
        },
        generationState: async () => {
          throw new Error("unreachable");
        },
        failReview: async () => {
          failed++;
        },
      },
      async () => ({ content: valid(metrics()), model: "fixture" }),
    ).generateReview("owner"),
    /review_storage/,
  );
  assert.equal(failed, 0);
});
