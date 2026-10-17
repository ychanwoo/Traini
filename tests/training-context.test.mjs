import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
function load(file, modules = {}, extra = {}) {
  const context = {
    exports: {},
    Response,
    URL,
    Date,
    Intl,
    AbortSignal,
    Buffer,
    Error,
    process,
    require: (id) => {
      if (!(id in modules)) throw new Error(`Unexpected import ${id}`);
      return modules[id];
    },
    ...extra,
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
  const errors =
    compiled.diagnostics?.filter(
      (d) => d.category === ts.DiagnosticCategory.Error,
    ) ?? [];
  assert.equal(
    errors.length,
    0,
    errors
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
      .join("\n"),
  );
  vm.runInNewContext(compiled.outputText, context);
  return context.exports;
}
const running = load("lib/garmin/running-summary.ts");
const goals = load("lib/training/goal.ts");
const context = load("lib/training/context.ts", {
  "@/lib/garmin/running-summary": running,
  "./goal": goals,
});
const now = new Date("2026-10-16T05:00:00Z");
const today = "2026-10-15";
const goal = () => ({
  raceName: "My race",
  targetDistance: "FULL",
  targetDate: "2027-03-01",
  targetTimeSeconds: null,
  trainingDays: [1, 3, 5, 7],
  longRunDay: 7,
});
const profile = (changes = {}) => ({
  race_name: "My race",
  target_distance: "FULL",
  target_date: "2027-03-01",
  target_time_seconds: null,
  training_days: [1, 3, 5, 7],
  long_run_day: 7,
  ...changes,
});
const row = (id, changes = {}) => ({
  garmin_activity_id: String(id),
  started_at: "2026-10-12T06:59:59Z",
  updated_at: "2026-10-16T01:00:00Z",
  distance_meters: 5000,
  duration_seconds: 1800,
  average_pace_seconds_per_km: 360,
  average_heart_rate: 145,
  ...changes,
});
const build = (
  p = profile(),
  rows = [row(1)],
  zone = "America/Los_Angeles",
  instant = now,
) => context.buildTrainingContext(p, rows, zone, instant);
const plain = (value) => JSON.parse(JSON.stringify(value));

test("draft has no invented goal, availability or target time", () => {
  const draft = goals.validateGoalInput(goals.emptyGoal(), today);
  assert.deepEqual(plain(draft), plain(goals.emptyGoal()));
  const result = build({}, []);
  assert.equal(result.goal.raceName, null);
  assert.equal(result.goal.targetTimeSeconds, null);
  assert.deepEqual(
    result.inputs.issues
      .map((i) => i.field)
      .sort()
      .join(","),
    "longRunDay,targetDate,targetDistance,trainingDays",
  );
  assert.equal(result.inputs.readyForPlanInput, false);
});
test("optional race name and time are not blockers, weekdays are normalized", () => {
  const input = goals.validateGoalInput(
    { ...goal(), raceName: " ", trainingDays: [7, 1] },
    today,
  );
  assert.equal(input.raceName, null);
  assert.equal(input.trainingDays.join(","), "1,7");
  assert.equal(build().inputs.readyForPlanInput, true);
  assert.equal(build().goal.targetDistanceMeters, 42195);
});
test("date validation handles leap days, normalization and past dates", () => {
  for (const value of [
    "2026-02-29",
    "2026-04-31",
    "2026-1-01",
    "2026-10-15T00:00:00Z",
    "0000-01-01",
  ])
    assert.equal(goals.validDate(value), false);
  assert.equal(goals.validDate("2028-02-29"), true);
  for (const value of ["2026-10-14", today])
    assert.throws(
      () => goals.validateGoalInput({ ...goal(), targetDate: value }, today),
      goals.GoalValidationError,
    );
  assert.equal(
    goals.validateGoalInput({ ...goal(), targetDate: "2026-10-16" }, today)
      .targetDate,
    "2026-10-16",
  );
});
test("invalid distances, malformed times and arbitrary owner fields are rejected", () => {
  for (const value of ["100K", "__proto__", "toString", 5])
    assert.throws(() =>
      goals.validateGoalInput({ ...goal(), targetDistance: value }, today),
    );
  for (const value of [0, -1, 3.5, "3600", 360000, Infinity])
    assert.throws(() =>
      goals.validateGoalInput({ ...goal(), targetTimeSeconds: value }, today),
    );
  for (const value of [
    { ...goal(), userId: "attacker" },
    { ...goal(), trainingDays: undefined },
    null,
    [],
  ]) {
    assert.throws(() => goals.validateGoalInput(value, today));
  }
  for (const text of [
    "3:30:00",
    "03:60:00",
    "03:00:60",
    "00:00:00",
    "03:30",
    "abc",
  ])
    assert.throws(() => goals.parseTimeText(text));
  assert.equal(goals.parseTimeText(""), null);
  assert.equal(goals.parseTimeText("03:30:00"), 12600);
  assert.equal(goals.timeText(null), "");
  assert.equal(goals.timeText(12600), "03:30:00");
});
test("availability rejects duplicates, invalid weekdays and unavailable long-run day", () => {
  for (const days of [[1, 1], [0], [8], [1.5], ["1"], [null], {}, [[1]]])
    assert.throws(() =>
      goals.validateGoalInput({ ...goal(), trainingDays: days }, today),
    );
  for (const value of [0, 8, "7", 3.5])
    assert.throws(() =>
      goals.validateGoalInput({ ...goal(), longRunDay: value }, today),
    );
  assert.throws(() =>
    goals.validateGoalInput(
      { ...goal(), trainingDays: [1], longRunDay: 7 },
      today,
    ),
  );
  assert.equal(
    goals.validateGoalInput(
      { ...goal(), trainingDays: [], longRunDay: null },
      today,
    ).trainingDays,
    null,
  );
});
test("stored invalid goals are reported without becoming assumed defaults", () => {
  const data = build(
    profile({
      target_distance: "MARATHON",
      target_date: "2020-01-01",
      target_time_seconds: 0,
      training_days: [1, 1],
    }),
  );
  assert.equal(data.goal.targetDistance, null);
  assert.equal(data.goal.targetTimeSeconds, null);
  assert.equal(data.inputs.readyForPlanInput, false);
  assert.equal(data.inputs.issues.length, 5);
});
test("history covers eight completed Monday-Sunday weeks and excludes current week", () => {
  const data = build(profile(), [
    row(1),
    row(2, { started_at: "2026-10-12T07:00:00Z" }),
    row(3, { started_at: "2026-08-17T07:00:00Z" }),
    row(4, { started_at: "2026-08-17T06:59:59Z" }),
  ]);
  assert.equal(data.history.start, "2026-08-17");
  assert.equal(data.history.end, "2026-10-11");
  assert.equal(data.history.weeks.length, 8);
  assert.equal(data.history.activityCount, 2);
  assert.equal(data.history.weeksWithActivities, 2);
  assert.equal(data.history.weeks[7].activityCount, 1);
  assert.equal(data.history.weeks[0].activityCount, 1);
});
test("missing weeks remain unknown instead of zero training volume", () => {
  const data = build();
  assert.equal(data.history.weeks[0].distanceMeters, null);
  assert.equal(data.history.weeks[0].timerSeconds, null);
  assert.equal(data.history.weeks[0].recordStatus, "no_recorded_activities");
  assert.ok(data.inputs.limitations.includes("activity_absence_is_unknown"));
  assert.ok(data.inputs.limitations.includes("limited_history"));
  assert.equal(build(profile(), []).inputs.readyForPlanInput, false);
});
test("weekly pace uses paired distance and timer; longest run and frequency use actual rows", () => {
  const data = build(profile(), [
    row(1, { distance_meters: 1000, duration_seconds: 240 }),
    row(2, { distance_meters: 9000, duration_seconds: 3600 }),
    row(3, { distance_meters: 20000, duration_seconds: null }),
    row(4, { distance_meters: null, duration_seconds: 10000 }),
  ]);
  const week = data.history.weeks[7];
  assert.equal(week.distanceMeters, 30000);
  assert.equal(week.timerSeconds, 13840);
  assert.equal(week.paceSecondsPerKm, 384);
  assert.equal(week.longestRunMeters, 20000);
  assert.equal(week.runningDays, 1);
  assert.equal(week.coverage.paceCount, 2);
  assert.equal(week.coverage.distanceCount, 3);
});
test("missing metrics and heart rate coverage are explicit; zero remains distinct from missing", () => {
  const data = build(profile(), [
    row(1, {
      distance_meters: 0,
      duration_seconds: 0,
      average_heart_rate: null,
    }),
    row(2, {
      distance_meters: null,
      duration_seconds: null,
      average_heart_rate: "145",
    }),
  ]);
  const week = data.history.weeks[7];
  assert.equal(week.distanceMeters, 0);
  assert.equal(week.timerSeconds, 0);
  assert.equal(week.coverage.heartRateCount, 1);
  assert.equal(week.paceSecondsPerKm, null);
  assert.equal(data.inputs.readyForPlanInput, false);
  const missing = build(profile(), [
    row(1, {
      distance_meters: null,
      duration_seconds: null,
      average_heart_rate: null,
    }),
  ]);
  assert.equal(missing.history.weeks[7].distanceMeters, null);
  assert.equal(missing.history.weeks[7].longestRunMeters, null);
});
test("malformed data and duplicates fail instead of producing partial contexts", () => {
  for (const rows of [
    [row(1), row(1)],
    [row(1, { average_heart_rate: -1 })],
    [row(1, { average_heart_rate: Infinity })],
    [row(1, { distance_meters: -1 })],
    [row(1, { started_at: "invalid" })],
  ])
    assert.throws(() => build(profile(), rows));
  assert.throws(() => build(profile(), [], "bad/zone"));
});
test("DST, year boundaries, leap dates and calendar-day durations do not assume 168-hour weeks", () => {
  for (const instant of [
    "2026-03-09T12:00:00Z",
    "2026-11-02T12:00:00Z",
    "2027-01-01T12:00:00Z",
    "2028-03-01T12:00:00Z",
  ]) {
    const data = build(profile(), [], "America/Los_Angeles", new Date(instant));
    assert.equal(new Date(`${data.history.start}T00:00:00Z`).getUTCDay(), 1);
    assert.equal(new Date(`${data.history.end}T00:00:00Z`).getUTCDay(), 0);
    assert.equal(
      goals.calendarDistance(data.history.start, data.history.end),
      55,
    );
  }
  assert.equal(goals.calendarDistance("2026-03-07", "2026-03-09"), 2);
  assert.equal(goals.calendarDistance("2028-02-28", "2028-03-01"), 2);
  const boundary = new Date("2026-10-12T00:30:00Z");
  assert.equal(
    context.historyPeriod("America/Los_Angeles", boundary).end,
    "2026-10-04",
  );
  assert.equal(context.historyPeriod("Asia/Seoul", boundary).end, "2026-10-11");
});
test("context projection excludes profile identifiers, GPS, raw records and arbitrary fields", () => {
  const data = build(
    profile({
      id: "private-owner",
      display_name: "private-name",
      access_token: "private-secret",
    }),
    [row(1, { raw_payload: { gps: "private-gps" }, user_id: "private-owner" })],
  );
  assert.doesNotMatch(
    JSON.stringify(data),
    /private-|garmin_activity_id|raw_payload|user_id/,
  );
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.units.distance, "meters");
  assert.equal(data.inputs.assessment, "input_completeness_only");
  assert.ok(data.inputs.limitations.includes("recovery_data_unavailable"));
});
function storage({
  pages = [{ data: [row(1)], count: 1 }],
  profileResult = { data: profile() },
  env = {},
} = {}) {
  const calls = [];
  let index = 0;
  const db = {
    rpc(name, args) {
      calls.push(["rpc", name, args]);
      return {
        abortSignal: async () =>
          profileResult.data
            ? {
                data:
                  name === "training_feedback_evidence"
                    ? []
                    : name === "training_goal_snapshot"
                      ? {
                          profile: profileResult.data,
                          revision: "a".repeat(32),
                        }
                      : "b".repeat(32),
                error: null,
              }
            : { data: null, error: { message: "missing" } },
      };
    },
    from(table) {
      calls.push(["from", table]);
      const query = {};
      for (const method of [
        "select",
        "eq",
        "gte",
        "lt",
        "order",
        "range",
        "update",
      ])
        query[method] = (...args) => {
          calls.push([table, method, ...args]);
          return query;
        };
      query.abortSignal = () => query;
      query.maybeSingle = async () => profileResult;
      query.then = (resolve, reject) =>
        Promise.resolve(pages[index++]).then(resolve, reject);
      return query;
    },
  };
  return {
    ...load(
      "lib/training/storage.ts",
      {
        "@/lib/supabase/admin": { getSupabaseAdmin: () => db },
        "@/lib/garmin/running-summary": running,
        "./workout-feedback": load("lib/training/workout-feedback.ts"),
        "./context": context,
        "./goal": goals,
      },
      { process: { env } },
    ),
    calls,
  };
}
test("storage scopes all queries to verified owner and only reads required columns", async () => {
  const api = storage();
  await api.readTrainingContext("owner", now);
  for (const filter of [
    ["profiles", "eq", "id", "owner"],
    ["activities", "eq", "user_id", "owner"],
    ["activities", "eq", "source", "garmin_fit"],
    ["activities", "eq", "activity_type", "running"],
  ])
    assert.ok(
      api.calls.some((call) => JSON.stringify(call) === JSON.stringify(filter)),
    );
  const columns = api.calls
    .filter((c) => c[1] === "select")
    .map((c) => c[2])
    .join(",");
  assert.doesNotMatch(
    columns,
    /raw_payload|source_file|sha256|display_name|avatar|\*/,
  );
});
test("history pagination handles server caps and fails on incomplete or changing results", async () => {
  const api = storage({
    pages: [
      { data: [row(1)], count: 2 },
      { data: [row(2)], count: 2 },
    ],
  });
  assert.equal(
    (await api.readTrainingContext("owner", now)).history.activityCount,
    2,
  );
  assert.deepEqual(
    api.calls.filter((c) => c[1] === "range").map((c) => c[2]),
    [0, 1],
  );
  for (const pages of [
    [{ data: [], count: 1 }],
    [{ data: [], count: 10001 }],
    [{ data: [], count: null }],
    [{ data: null, count: 0, error: { message: "secret" } }],
    [
      { data: [row(1)], count: 2 },
      { data: [row(2)], count: 3 },
    ],
  ])
    await assert.rejects(storage({ pages }).readTrainingContext("owner", now));
  await assert.rejects(
    storage({ profileResult: { data: null } }).readTrainingContext(
      "owner",
      now,
    ),
  );
});
test("goal reads and writes preserve unrelated profile fields and never upsert", async () => {
  const api = storage();
  await api.readTrainingGoal("owner", now);
  await api.saveTrainingGoal("owner", goal());
  const update = api.calls.find(
    (c) => c[0] === "rpc" && c[1] === "save_training_preferences",
  )[2];
  assert.equal(update.p_user_id, "owner");
  assert.equal(update.p_goal.raceName, goal().raceName);
  assert.doesNotMatch(
    JSON.stringify(update.p_goal),
    /display_name|avatar|created_at/,
  );
  assert.equal(
    api.calls.some((c) => c[0] === "from"),
    false,
  );
  await assert.rejects(
    storage({ profileResult: { data: null } }).saveTrainingGoal(
      "owner",
      goal(),
    ),
  );
});
function routes({ allowed = true, failure = false } = {}) {
  const calls = [];
  const modules = {
    "@/lib/security/admin": {
      requireAdmin: async () =>
        allowed
          ? { userId: "verified-owner" }
          : { response: new Response(null, { status: 401 }) },
    },
    "@/lib/training/storage": {
      readTrainingContext: async (id) => {
        calls.push(["context", id]);
        if (failure) throw new Error("private-db");
        return { ok: true };
      },
      readTrainingGoal: async (id) => {
        calls.push(["goal", id]);
        if (failure) throw new Error("private-db");
        return { goal: goal() };
      },
      saveTrainingGoal: async (id, data) => {
        calls.push(["save", id, data]);
        if (failure) throw new Error("private-db");
      },
    },
    "@/lib/garmin/running-summary": running,
    "@/lib/training/goal": goals,
  };
  return {
    context: load("app/api/training/context/route.ts", modules),
    goal: load("app/api/training/goal/route.ts", modules),
    calls,
  };
}
const request = (body = goal(), headers = {}) =>
  new Request("http://localhost:3017/api/training/goal", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3017",
      ...headers,
    },
    body: JSON.stringify(body),
  });
test("all routes reject unauthorized access before querying or writing", async () => {
  const api = routes({ allowed: false });
  assert.equal(
    (
      await api.context.GET(
        new Request("http://localhost/api/training/context"),
      )
    ).status,
    401,
  );
  assert.equal(
    (await api.goal.GET(new Request("http://localhost/api/training/goal")))
      .status,
    401,
  );
  assert.equal((await api.goal.PUT(request())).status, 401);
  assert.equal(api.calls.length, 0);
});
test("context ignores caller owner, timezone and week count; responses are private and uncached", async () => {
  const api = routes();
  const response = await api.context.GET(
    new Request(
      "http://localhost/api/training/context?userId=attacker&timezone=UTC&weeks=100",
    ),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(api.calls, [["context", "verified-owner"]]);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie, Authorization");
});
test("goal route rejects unsafe origin, unknown fields, malformed JSON and oversized bodies", async () => {
  const api = routes();
  assert.equal(
    (await api.goal.PUT(request(goal(), { origin: "http://attacker" }))).status,
    403,
  );
  assert.equal(
    (await api.goal.PUT(request({ ...goal(), userId: "attacker" }))).status,
    400,
  );
  assert.equal(
    (await api.goal.PUT(request(goal(), { "content-type": "text/plain" })))
      .status,
    415,
  );
  assert.equal(
    (await api.goal.PUT(request({ ...goal(), raceName: "x".repeat(9000) })))
      .status,
    413,
  );
  const malformed = new Request("http://localhost/api/training/goal", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  assert.equal((await api.goal.PUT(malformed)).status, 400);
  assert.equal(api.calls.length, 0);
});
test("goal save uses verified owner and validates dates in configured timezone", async () => {
  const api = routes();
  const response = await api.goal.PUT(
    request({ ...goal(), targetDate: "2099-01-01" }),
  );
  assert.equal(response.status, 200);
  assert.equal(api.calls[0][0], "save");
  assert.equal(api.calls[0][1], "verified-owner");
});
test("database failures never masquerade as successful empty data or successful saves", async () => {
  const api = routes({ failure: true });
  for (const response of [
    await api.context.GET(new Request("http://localhost/api/training/context")),
    await api.goal.GET(new Request("http://localhost/api/training/goal")),
    await api.goal.PUT(request({ ...goal(), targetDate: "2099-01-01" })),
  ]) {
    assert.equal(response.status, 503);
    assert.doesNotMatch(
      await response.text(),
      /private-db|schema|service_role/,
    );
  }
});

test("numeric mobile input formats six digits without requiring a colon key", () => {
  assert.equal(goals.formatTimeInput("031313"), "03:13:13");
  assert.equal(goals.formatTimeInput("03:13:13"), "03:13:13");
  assert.equal(goals.formatTimeInput("031"), "03:1");
  assert.equal(goals.formatTimeInput(""), "");
  assert.equal(goals.parseTimeText(goals.formatTimeInput("031313")), 11593);
  assert.throws(() => goals.parseTimeText(goals.formatTimeInput("036000")));
});

test("eight observed weeks retain explicit coverage without a limited-history warning", () => {
  const period = context.historyPeriod("America/Los_Angeles", now);
  const rows = Array.from({ length: 8 }, (_, index) =>
    row(index + 1, {
      started_at: `${running.addCalendarDays(period.start, index * 7)}T12:00:00Z`,
    }),
  );
  const data = build(profile(), rows);
  assert.equal(data.history.weeksWithActivities, 8);
  assert.equal(data.history.coverage.heartRateCount, 8);
  assert.equal(data.inputs.readyForPlanInput, true);
  assert.equal(data.inputs.limitations.includes("limited_history"), false);
  assert.ok(data.history.weeks.every((week) => week.runningDays === 1));
});
