import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(file, modules = {}) {
  const c = {
    exports: {},
    Date,
    Intl,
    Response,
    Request,
    URL,
    Buffer,
    AbortSignal,
    Error,
    process,
    require: (id) => {
      if (!(id in modules)) throw new Error("Unexpected " + id);
      return modules[id];
    },
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
const feedback = load("lib/training/workout-feedback.ts");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rev = "a".repeat(32);
const assessment = (a = {}) => ({
  rpe: null,
  fatigue: null,
  pain: null,
  memo: null,
  ...a,
});
const input = (a = {}) => ({
  workoutId: id(1),
  requestId: id(2),
  revision: rev,
  version: 0,
  outcome: "completed",
  assessment: assessment({ rpe: 6 }),
  skipReason: null,
  ...a,
});
const report = (date, a = {}) => ({
  workoutId: id(1),
  date,
  outcome: "completed",
  version: 1,
  reportedAt: date + "T20:00:00Z",
  plannedDistanceKm: 7,
  assessment: assessment(a),
  skipReason: null,
});
test("feedback validates optional self-reports without filling missing values", () => {
  assert.equal(feedback.parseFeedbackInput(input()).assessment.rpe, 6);
  assert.equal(
    feedback.parseFeedbackInput(input({ assessment: null })).assessment,
    null,
  );
  assert.equal(
    feedback.parseFeedbackInput(
      input({
        outcome: "skipped",
        assessment: assessment({ pain: "discomfort" }),
        skipReason: "피로로 휴식",
      }),
    ).outcome,
    "skipped",
  );
  assert.equal(
    feedback.parseFeedbackInput(
      input({ outcome: "unconfirmed", assessment: null }),
    ).outcome,
    "unconfirmed",
  );
});
test("feedback rejects forged ownership, invalid ranges, missing reason and ambiguous outcomes", () => {
  for (const bad of [
    input({ userId: id(9) }),
    input({ workoutId: "bad" }),
    input({ requestId: "bad" }),
    input({ revision: "bad" }),
    input({ version: -1 }),
    input({ version: 1.5 }),
    input({ outcome: "automatic" }),
    input({ outcome: ["completed"] }),
    input({ assessment: assessment({ fatigue: ["high"] }) }),
    input({ assessment: assessment({ pain: ["none"] }) }),
    input({ assessment: assessment({ rpe: 0 }) }),
    input({ assessment: assessment({ rpe: 11 }) }),
    input({ assessment: assessment({ rpe: "5" }) }),
    input({ assessment: assessment({ rpe: NaN }) }),
    input({ assessment: assessment({ fatigue: "normal" }) }),
    input({ assessment: assessment({ pain: false }) }),
    input({ assessment: assessment({ memo: "x".repeat(201) }) }),
    input({ assessment: assessment({ memo: "\u0001" }) }),
    input({ assessment: { rpe: 5 } }),
    input({ skipReason: "reason" }),
    input({ outcome: "skipped", skipReason: " " }),
    input({ outcome: "skipped", skipReason: "reason" }),
    input({ outcome: "unconfirmed" }),
  ])
    assert.throws(() => feedback.parseFeedbackInput(bad), /feedback_input/);
});
test("absence and high RPE never assert normal recovery or invent physiology", () => {
  assert.equal(feedback.feedbackCondition(null, [], "2026-10-17"), null);
  assert.equal(
    feedback.feedbackCondition(
      null,
      [report("2026-10-16", { pain: "none", fatigue: "low", rpe: 3 })],
      "2026-10-17",
    ),
    null,
  );
  assert.equal(
    feedback.feedbackCondition(
      null,
      [report("2026-10-16", { rpe: 9 })],
      "2026-10-17",
    ).feeling,
    "tired",
  );
});
test("dated pain persists through time and missing reports; explicit newer check-in can replace it", () => {
  const reports = [
    report("2026-08-01", { pain: "pain" }),
    report("2026-10-16", { fatigue: "low" }),
  ];
  assert.equal(
    feedback.feedbackCondition(null, reports, "2026-10-17").feeling,
    "pain",
  );
  assert.equal(
    feedback.feedbackCondition(
      null,
      [...reports, report("2026-10-17", { pain: "none" })],
      "2026-10-17",
    ),
    null,
  );
  assert.equal(
    feedback.feedbackCondition(
      { reportedOn: "2026-10-17", feeling: "normal" },
      reports,
      "2026-10-17",
    ).feeling,
    "normal",
  );
  assert.equal(
    feedback.feedbackCondition(
      { reportedOn: "2026-08-01", feeling: "pain" },
      [report("2026-10-17", { fatigue: "low" })],
      "2026-10-17",
    ).feeling,
    "pain",
  );
});
test("future reports are excluded and older fatigue cannot replace newer condition", () => {
  assert.equal(
    feedback.feedbackCondition(
      null,
      [report("2026-10-18", { pain: "pain" })],
      "2026-10-17",
    ),
    null,
  );
  assert.equal(
    feedback.feedbackCondition(
      { reportedOn: "2026-10-17", feeling: "normal" },
      [report("2026-10-16", { fatigue: "high" })],
      "2026-10-17",
    ).feeling,
    "normal",
  );
});
const json = load("lib/security/json-request.ts");
function route(
  access = { userId: id(7) },
  save = async () => ({ version: 1 }),
) {
  return load("app/api/training/feedback/route.ts", {
    "@/lib/security/admin": { requireAdmin: async () => access },
    "@/lib/security/json-request": json,
    "@/lib/training/workout-feedback": feedback,
    "@/lib/training/feedback-storage": { saveWorkoutFeedback: save },
  });
}
const request = (body = input(), origin = "http://localhost:3017") =>
  new Request("http://localhost:3017/api/training/feedback", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
test("feedback API denies anonymous/non-admin before any writes and never calls inference", async () => {
  for (const status of [401, 403])
    assert.equal(
      (
        await route(
          { response: Response.json({ error: "denied" }, { status }) },
          () => assert.fail(),
        ).POST(request())
      ).status,
      status,
    );
});
test("feedback API enforces origin, payload limits and exact verified owner", async () => {
  let calls = 0;
  const api = route(undefined, async (uid, body) => {
    calls++;
    assert.equal(uid, id(7));
    assert.equal(body.workoutId, id(1));
    return { version: 1 };
  });
  assert.equal(
    (await api.POST(request(input(), "https://evil.test"))).status,
    403,
  );
  assert.equal((await api.POST(request(input({ userId: id(8) })))).status, 400);
  assert.equal(
    (
      await api.POST(
        request(input({ assessment: assessment({ memo: "x".repeat(3000) }) })),
      )
    ).status,
    413,
  );
  const response = await api.POST(request());
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(calls, 1);
});
test("feedback API returns conflict on changed/linked state and hides database details", async () => {
  for (const code of [
    "feedback_changed",
    "feedback_linked",
    "feedback_workout",
    "feedback_storage",
  ]) {
    const r = await route(undefined, () => {
      throw new feedback.FeedbackError(code);
    }).POST(request());
    assert.equal(r.status, code === "feedback_storage" ? 503 : 409);
    assert.equal((await r.json()).error, feedback.feedbackErrorMessage[code]);
  }
  const r = await route(undefined, () => {
    throw new Error("private credentials");
  }).POST(request());
  assert.equal(r.status, 503);
  assert.doesNotMatch(await r.text(), /private/);
});
