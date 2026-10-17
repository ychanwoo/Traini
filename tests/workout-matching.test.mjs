import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(file, modules = {}) {
  const c = {
    exports: {},
    require: (id) => {
      if (!(id in modules)) throw new Error("Unexpected " + id);
      return modules[id];
    },
    Date,
    Intl,
    Response,
    Request,
    URL,
    Buffer,
    AbortSignal,
    process,
    Error,
  };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../" + file, import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2023,
        },
      },
    ).outputText,
    c,
  );
  return c.exports;
}
const running = load("lib/garmin/running-summary.ts");
const match = load("lib/training/workout-matching.ts", {
  "@/lib/garmin/running-summary": running,
});
const id = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const rev = "a".repeat(32);
const now = new Date("2026-10-17T01:00:00Z");
const steady = (meters, pace = 330) => ({
  kind: "steady",
  distanceMeters: meters,
  paceSecondsPerKm: pace,
  repetitions: 1,
  recoveryMeters: 0,
  recoverySeconds: null,
  recoveryAfterLast: false,
});
function fixture(kind = "easy", km = 7) {
  return {
    planId: id(1),
    timezone: "America/Los_Angeles",
    today: "2026-10-16",
    revision: rev,
    workouts: [
      {
        id: id(2),
        date: "2026-10-14",
        kind,
        status: "scheduled",
        distanceKm: km,
        steps: [steady(km * 1000)],
        manualCompletedAt: null,
        state: "unmatched",
        reason: "no_activity",
        dismissed: false,
      },
    ],
    activities: [
      {
        id: id(3),
        garminId: "100",
        startedAt: "2026-10-14T19:00:00Z",
        distanceMeters: km * 1000,
        timerSeconds: km * 330,
        paceSecondsPerKm: 330,
        verified: true,
        revision: rev,
        evidence: null,
      },
    ],
    links: [],
  };
}
const decision = (s) => match.decideWorkoutMatches(s, now)[0];
const lap = (distanceMeters, paceSecondsPerKm, intensity) => ({
  distanceMeters,
  paceSecondsPerKm,
  intensity,
});
function intervals(distance = 800, repetitions = 5, recovery = 400) {
  const s = fixture("interval", 10);
  s.workouts[0].steps = [
    steady(2000),
    {
      ...steady(distance, 238),
      kind: "repeats",
      repetitions,
      recoveryMeters: recovery,
    },
    steady(2400),
  ];
  s.activities[0].evidence = {
    lapsComplete: true,
    laps: [
      lap(2000, 340, "warmup"),
      ...Array.from({ length: repetitions }, (_, i) => [
        lap(distance, 235, "active"),
        ...(i < repetitions - 1 ? [lap(recovery, 400, "recovery")] : []),
      ]).flat(),
      lap(2400, 350, "cooldown"),
    ],
  };
  return s;
}
for (const [name, kind, km] of [
  ["recovery", "easy", 7],
  ["easy", "easy", 8],
  ["long", "long", 20],
])
  test(`${name} run matches its own date and planned distance without requiring interval labels`, () =>
    assert.equal(decision(fixture(kind, km)).state, "matched"));
test("tempo uses sustained active distance and work pace rather than session average", () => {
  const s = fixture("threshold", 10);
  s.workouts[0].steps = [
    { ...steady(1500, 330), kind: "warmup" },
    steady(7000, 255),
    { ...steady(1500, 330), kind: "cooldown" },
  ];
  s.activities[0].evidence = {
    lapsComplete: true,
    laps: [
      lap(1500, 330, "warmup"),
      lap(7000, 260, "active"),
      lap(1500, 330, "cooldown"),
    ],
  };
  assert.equal(decision(s).state, "matched");
  s.activities[0].evidence.laps[1].paceSecondsPerKm = 350;
  assert.equal(decision(s).reason, "session_unverified");
});
for (const distance of [400, 800])
  test(`${distance}m intervals require the prescribed work and between-repeat recovery`, () => {
    const s = intervals(
      distance,
      distance === 400 ? 10 : 5,
      distance === 400 ? 200 : 400,
    );
    assert.equal(decision(s).state, "matched");
    s.activities[0].evidence.laps[2].distanceMeters = 50;
    assert.equal(decision(s).reason, "session_unverified");
  });
test("ordinary auto-lap interval labels are not evidence of hard training", () => {
  const s = fixture();
  s.activities[0].evidence = {
    lapsComplete: true,
    laps: [lap(7000, 330, "interval")],
  };
  assert.equal(decision(s).state, "matched");
  s.workouts[0].kind = "interval";
  assert.equal(decision(s).reason, "session_unverified");
});
test("structured easy run remains easy when its one active block is at easy effort pace", () => {
  const s = fixture();
  s.activities[0].evidence = {
    lapsComplete: true,
    laps: [
      lap(1000, 350, "warmup"),
      lap(5000, 330, "active"),
      lap(1000, 350, "cooldown"),
    ],
  };
  assert.equal(decision(s).state, "matched");
  s.activities[0].evidence.laps[1].paceSecondsPerKm = 240;
  assert.equal(decision(s).reason, "session_unverified");
});
test("missing, incomplete or mismatched quality evidence requires review", () => {
  for (const evidence of [
    null,
    { lapsComplete: false, laps: [] },
    { lapsComplete: true, laps: [lap(7000, 255, "interval")] },
  ]) {
    const s = fixture("threshold", 10);
    s.activities[0].evidence = evidence;
    assert.equal(decision(s).reason, "session_unverified");
  }
});
test("incorrect repeat count, adjacent work laps, missing warmup and final recovery fail closed", () => {
  let s = intervals();
  s.activities[0].evidence.laps.splice(1, 1);
  assert.equal(decision(s).reason, "session_unverified");
  s = intervals();
  s.activities[0].evidence.laps[0].intensity = "interval";
  assert.equal(decision(s).reason, "session_unverified");
  s = intervals();
  const laps = s.activities[0].evidence.laps;
  [laps[laps.length - 2], laps[laps.length - 3]] = [
    laps[laps.length - 3],
    laps[laps.length - 2],
  ];
  assert.equal(decision(s).reason, "session_unverified");
  s = intervals();
  s.workouts[0].steps[1].recoveryAfterLast = true;
  assert.equal(decision(s).reason, "session_unverified");
});
test("multiple runs never silently sum into a completed workout", () => {
  const s = fixture();
  s.activities.push({ ...s.activities[0], id: id(4), distanceMeters: 1000 });
  assert.equal(decision(s).reason, "multiple_activities");
  const confirmed = match.confirmWorkoutMatch(s, id(2), [id(3), id(4)], now)[0];
  assert.equal(confirmed.state, "matched");
  assert.equal(confirmed.links.length, 2);
  assert.ok(confirmed.links.every((l) => l.method === "confirmed"));
});
test("distance tolerance has explicit inclusive boundaries and large differences require confirmation", () => {
  const s = fixture("long", 20);
  for (const meters of [18000, 20000, 22000]) {
    s.activities[0].distanceMeters = meters;
    assert.equal(decision(s).state, "matched");
  }
  s.activities[0].distanceMeters = 17999;
  assert.equal(decision(s).reason, "distance_mismatch");
  s.activities[0].distanceMeters = 30000;
  assert.equal(decision(s).reason, "distance_mismatch");
});
test("timezone decides training date across UTC midnight and DST changes", () => {
  const s = fixture();
  s.activities[0].startedAt = "2026-10-15T02:00:00Z";
  assert.equal(decision(s).state, "matched");
  s.activities[0].startedAt = "2026-10-15T08:00:00Z";
  assert.equal(decision(s).reason, "no_activity");
  s.timezone = "America/Los_Angeles";
  s.workouts[0].date = "2026-11-01";
  s.today = "2026-11-01";
  s.activities[0].startedAt = "2026-11-02T07:30:00Z";
  assert.equal(
    match.decideWorkoutMatches(s, new Date("2026-11-03T00:00:00Z"))[0].state,
    "matched",
  );
});
test("missing distance, timer or provenance cannot automatically or manually link", () => {
  for (const field of ["distanceMeters", "timerSeconds", "verified"]) {
    const s = fixture();
    s.activities[0][field] = field === "verified" ? false : null;
    assert.equal(decision(s).reason, "missing_metrics");
    assert.throws(
      () => match.confirmWorkoutMatch(s, id(2), [id(3)], now),
      /match_activity/,
    );
  }
});
test("rest, skipped and future days cannot be marked complete by Garmin", () => {
  for (const change of [
    { kind: "rest" },
    { status: "skipped" },
    { date: "2026-10-18" },
  ]) {
    const s = fixture();
    Object.assign(s.workouts[0], change);
    assert.notEqual(decision(s).state, "matched");
    assert.throws(
      () => match.confirmWorkoutMatch(s, id(2), [id(3)], now),
      /match_activity/,
    );
  }
});
test("an activity cannot be claimed by another workout, even through manual confirmation", () => {
  const s = fixture();
  s.links.push({
    workoutId: id(9),
    activityId: id(3),
    revision: rev,
    method: "automatic",
    active: true,
  });
  assert.equal(decision(s).reason, "already_linked");
  assert.throws(
    () => match.confirmWorkoutMatch(s, id(2), [id(3)], now),
    /match_activity/,
  );
});
test("repeated evaluation is deterministic and unchanged confirmations remain confirmed", () => {
  const s = fixture();
  s.links = [
    {
      workoutId: id(2),
      activityId: id(3),
      revision: rev,
      method: "confirmed",
      active: true,
    },
  ];
  assert.deepEqual(decision(s), decision(structuredClone(s)));
  assert.equal(decision(s).reason, "confirmed");
  s.links.push({
    workoutId: id(2),
    activityId: id(4),
    revision: rev,
    method: "confirmed",
    active: false,
  });
  assert.equal(decision(s).reason, "confirmed");
});
test("changed confirmed evidence is invalidated until explicitly reconfirmed", () => {
  const s = fixture();
  s.links = [
    {
      workoutId: id(2),
      activityId: id(3),
      revision: "b".repeat(32),
      method: "confirmed",
      active: true,
    },
  ];
  assert.equal(decision(s).reason, "activity_changed");
  s.links[0].active = false;
  s.workouts[0].reason = "activity_changed";
  assert.equal(decision(s).reason, "activity_changed");
  assert.equal(
    match.confirmWorkoutMatch(s, id(2), [id(3)], now)[0].reason,
    "confirmed",
  );
});
test("unlink suppresses auto relinking and manual completion remains independently visible", () => {
  const s = fixture();
  s.workouts[0].manualCompletedAt = "2026-10-14T22:00:00Z";
  s.workouts[0].dismissed = true;
  assert.equal(decision(s).reason, "user_unlinked");
  const projected = match.projectWorkoutMatches(s, now).get(id(2));
  assert.equal(projected.source, "manual");
  assert.equal(projected.actualDistanceKm, null);
});
test("projection reports actual totals separately from prescribed distance without exposing raw evidence", () => {
  const s = fixture();
  s.activities[0].distanceMeters = 7100;
  s.links = [
    {
      workoutId: id(2),
      activityId: id(3),
      revision: rev,
      method: "confirmed",
      active: true,
    },
  ];
  s.workouts[0].state = "matched";
  s.activities[0].evidence = { gps: "never project" };
  const out = match.projectWorkoutMatches(s, now).get(id(2));
  assert.equal(out.actualDistanceKm, 7.1);
  assert.equal(out.source, "garmin");
  assert.doesNotMatch(JSON.stringify(out), /never project|evidence|source_sha/);
});
test("snapshot parser rejects corrupt or unbounded input instead of reporting no activity", () => {
  const s = fixture();
  assert.equal(match.parseMatchSnapshot(s).planId, id(1));
  for (const bad of [
    null,
    { ...s, revision: "bad" },
    { ...s, activities: Array(101).fill(s.activities[0]) },
    { ...s, activities: [{ ...s.activities[0], timerSeconds: Infinity }] },
  ])
    assert.throws(() => match.parseMatchSnapshot(bad), /match_storage/);
});
const mutation = load("lib/security/json-request.ts");
const request = (body) =>
  new Request("https://traini.test/api/training/match", {
    method: "POST",
    headers: {
      origin: "https://traini.test",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
test("match API rejects unauthorized requests before reading bodies or accessing storage", async () => {
  let saved = false;
  const route = load("app/api/training/match/route.ts", {
    "@/lib/security/admin": {
      requireAdmin: async () => ({
        response: Response.json({}, { status: 403 }),
      }),
    },
    "@/lib/security/json-request": mutation,
    "@/lib/training/matching-storage": {
      saveWorkoutMatch: async () => {
        saved = true;
      },
    },
  });
  assert.equal((await route.POST(request({}))).status, 403);
  assert.equal(saved, false);
});
test("match API bounds UUID selection, rejects foreign ownership fields and uses verified owner only", async () => {
  let args;
  const route = load("app/api/training/match/route.ts", {
    "@/lib/security/admin": {
      requireAdmin: async () => ({ userId: "verified-owner" }),
    },
    "@/lib/security/json-request": mutation,
    "@/lib/training/matching-storage": {
      saveWorkoutMatch: async (...a) => {
        args = a;
      },
    },
  });
  const body = { workoutId: id(2), revision: rev, activityIds: [id(3)] };
  for (const invalid of [
    { ...body, userId: "forged" },
    { ...body, activityIds: [id(3), id(3)] },
    { ...body, activityIds: Array.from({ length: 13 }, (_, i) => id(i + 20)) },
    { ...body, revision: "bad" },
    { ...body, activityIds: ["foreign"] },
  ])
    assert.equal((await route.POST(request(invalid))).status, 400);
  assert.equal((await route.POST(request(body))).status, 200);
  assert.equal(args[0], "verified-owner");
});
test("stale matching requests return 409 and storage failures preserve a generic retryable response", async () => {
  for (const [code, status] of [
    ["match_changed", 409],
    ["match_activity", 409],
    ["match_conflict", 409],
    ["private database detail", 503],
  ]) {
    const route = load("app/api/training/match/route.ts", {
      "@/lib/security/admin": {
        requireAdmin: async () => ({ userId: "owner" }),
      },
      "@/lib/security/json-request": mutation,
      "@/lib/training/matching-storage": {
        saveWorkoutMatch: async () => {
          throw new Error(code);
        },
      },
    });
    const r = await route.POST(
      request({ workoutId: id(2), revision: rev, activityIds: [] }),
    );
    assert.equal(r.status, status);
    assert.doesNotMatch(await r.text(), /private database detail/);
  }
});

test("recent-plan reconciliation bounds its query and handles an empty history", async () => {
  let limit;
  const query = {
    eq() {
      return this;
    },
    gte() {
      return this;
    },
    lte() {
      return this;
    },
    order() {
      return this;
    },
    limit(n) {
      limit = n;
      return this;
    },
    async abortSignal() {
      return { data: [], error: null };
    },
  };
  const backend = load("lib/training/matching-storage.ts", {
    "server-only": {},
    "@/lib/supabase/admin": {
      getSupabaseAdmin: () => ({ from: () => ({ select: () => query }) }),
    },
    "./workout-matching": match,
    "@/lib/garmin/running-summary": running,
  });
  const result = await backend.reconcileRecentWorkoutMatches("owner");
  assert.equal(result.checked, 0);
  assert.equal(result.failed, 0);
  assert.equal(limit, 10);
});
test("matching API rejects a foreign browser Origin before saving", async () => {
  let saved = false;
  const route = load("app/api/training/match/route.ts", {
    "@/lib/security/admin": { requireAdmin: async () => ({ userId: "owner" }) },
    "@/lib/security/json-request": mutation,
    "@/lib/training/matching-storage": {
      saveWorkoutMatch: async () => {
        saved = true;
      },
    },
  });
  const r = await route.POST(
    new Request("https://traini.test/api/training/match", {
      method: "POST",
      headers: {
        origin: "https://evil.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workoutId: id(2),
        revision: rev,
        activityIds: [id(3)],
      }),
    }),
  );
  assert.equal(r.status, 403);
  assert.equal(saved, false);
});

test("inactive prior links require explicit reassignment and active links cannot be taken", () => {
  const s = fixture();
  s.links = [
    {
      workoutId: id(9),
      activityId: id(3),
      revision: rev,
      method: "automatic",
      active: false,
    },
  ];
  assert.equal(decision(s).reason, "already_linked");
  assert.equal(
    match.confirmWorkoutMatch(s, id(2), [id(3)], now)[0].reason,
    "confirmed",
  );
  s.links[0].active = true;
  assert.throws(
    () => match.confirmWorkoutMatch(s, id(2), [id(3)], now),
    /match_activity/,
  );
});
