import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";

// Uses a disposable account, never the configured administrator's activities.
assert.equal(
  new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,
  "kmmutfcgshellvjgpick.supabase.co",
);
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
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
const running = load("lib/garmin/running-summary.ts"),
  goal = load("lib/training/goal.ts");
const matching = load("lib/training/workout-matching.ts", {
  "@/lib/garmin/running-summary": running,
});
const matchingStorage = load("lib/training/matching-storage.ts", {
  "server-only": {},
  "@/lib/supabase/admin": { getSupabaseAdmin: () => db },
  "./workout-matching": matching,
  "@/lib/garmin/running-summary": running,
});
const contexts = load("lib/training/context.ts", {
  "@/lib/garmin/running-summary": running,
  "./goal": goal,
});
const storage = load("lib/training/storage.ts", {
  "./workout-feedback": load("lib/training/workout-feedback.ts"),
  "@/lib/supabase/admin": { getSupabaseAdmin: () => db },
  "@/lib/garmin/running-summary": running,
  "./context": contexts,
  "./goal": goal,
});
const review = load("lib/training/weekly-review.ts", {
  "@/lib/garmin/running-summary": running,
  "./goal": goal,
  "./workout-matching": matching,
});
const rs = load("lib/training/review-storage.ts", {
  "server-only": {},
  "@/lib/supabase/admin": { getSupabaseAdmin: () => db },
  "@/lib/garmin/running-summary": running,
  "./storage": storage,
  "./matching-storage": matchingStorage,
  "./weekly-review": review,
});
const timezone = process.env.TRAINI_TIMEZONE ?? "America/Los_Angeles";
const prescriptions = load("lib/training/prescription.ts", { "./goal": goal });
const plans = load("lib/training/weekly-plan.ts", {
  "@/lib/garmin/running-summary": running,
  "./goal": goal,
  "./prescription": prescriptions,
});
const ps = load("lib/training/plan-storage.ts", {
  "server-only": {},
  "./storage": storage,
  "@/lib/supabase/admin": { getSupabaseAdmin: () => db },
  "./weekly-plan": plans,
  "./matching-storage": matchingStorage,
});
const summary = load("lib/garmin/read-running-summary.ts", {
  "@/lib/supabase/admin": { getSupabaseAdmin: () => db },
  "./running-summary": running,
});
const inputs = load("lib/training/prescription-storage.ts", {
  "server-only": {},
  "./review-storage": rs,
  "@/lib/garmin/read-running-summary": summary,
  "./storage": storage,
  "./plan-storage": ps,
  "./weekly-plan": plans,
  "./weekly-review": review,
  "./prescription": prescriptions,
});
const feedback = load("lib/training/workout-feedback.ts");
const feedbackStorage = load("lib/training/feedback-storage.ts", {
  "server-only": {},
  "@/lib/supabase/admin": { getSupabaseAdmin: () => db },
  "./workout-feedback": feedback,
});
let uid;
const check = ({ error, data }) => {
  assert.ifError(error);
  return data;
};
const today = running.dateInZone(new Date(), timezone);
const current = running.runningPeriod(timezone, "current");
const previous = running.runningPeriod(timezone, "previous");
const assessment = (a = {}) => ({
  rpe: null,
  fatigue: null,
  pain: null,
  memo: null,
  ...a,
});
const blank = { outcome: "unconfirmed", assessment: null, skipReason: null };
async function snapshot(planId) {
  return check(
    await db.rpc("workout_match_snapshot", {
      p_user_id: uid,
      p_plan_id: planId,
    }),
  );
}
async function body(planId, wid, value) {
  const snap = await snapshot(planId),
    w = snap.workouts.find((w) => w.id === wid);
  return {
    workoutId: wid,
    requestId: randomUUID(),
    revision: snap.revision,
    version: w.feedback.version,
    ...value,
  };
}
async function save(planId, wid, value) {
  return feedbackStorage.saveWorkoutFeedback(
    uid,
    feedback.parseFeedbackInput(await body(planId, wid, value)),
  );
}
async function plan(start) {
  const p = check(
    await db
      .from("training_plans")
      .insert({
        user_id: uid,
        starts_on: start,
        ends_on: running.addCalendarDays(start, 6),
        target_distance_km: 42,
        recovery_label: "fixture",
        source_version: 1,
        summary: "Disposable feedback fixture",
        model: "fixture",
        timezone,
        input_revision: "fixture",
      })
      .select("id")
      .single(),
  );
  const workouts = check(
    await db
      .from("workouts")
      .insert(
        Array.from({ length: 7 }, (_, i) => ({
          plan_id: p.id,
          scheduled_on: running.addCalendarDays(start, i),
          kind: i === 1 ? "rest" : "easy",
          status: "scheduled",
          title: "Disposable fixture",
          purpose: "Test only",
          distance_km: i === 1 ? 0 : 7,
          effort: i === 1 ? "rest" : "conversational",
          steps: [],
        })),
      )
      .select("id,scheduled_on,kind"),
  );
  return { id: p.id, workouts };
}
try {
  uid = check(
    await db.auth.admin.createUser({
      email: `traini-feedback-${randomUUID()}@example.invalid`,
      email_confirm: true,
    }),
  ).user.id;
  check(
    await db.from("profiles").upsert({
      id: uid,
      display_name: "Feedback fixture",
      target_distance: "FULL",
      target_date: running.addCalendarDays(today, 120),
      training_days: [1, 2, 3, 4, 5, 6, 7],
      long_run_day: 7,
    }),
  );
  check(
    await db.from("activities").insert(
      Array.from({ length: 4 }, (_, w) =>
        [0, 2, 4, 6].map((d, i) => ({
          user_id: uid,
          garmin_activity_id: String(80000000 + w * 10 + i),
          activity_type: "running",
          source: "garmin_fit",
          started_at:
            running.addCalendarDays(previous.start, -w * 7 + d) + "T19:00:00Z",
          distance_meters: 7000,
          duration_seconds: 2310,
          average_pace_seconds_per_km: 330,
          training_date: running.addCalendarDays(previous.start, -w * 7 + d),
          training_timezone: timezone,
          source_file: String(80000000 + w * 10 + i) + ".fit",
          parser_version: 1,
          decoder_name: "garmin-fit-sdk",
          decoder_version: "fixture",
          metric_sources: {},
          warnings: [],
          imported_at: new Date().toISOString(),
          source_sha256: "a".repeat(64),
          normalized_sha256: "b".repeat(64),
          normalized_schema_version: 1,
        })),
      ).flat(),
    ),
  );
  const past = await plan(previous.start),
    present = await plan(current.start);
  const wid = past.workouts.find((w) => w.scheduled_on === previous.start).id;
  const original = (await snapshot(past.id)).revision;
  const beforeRevision = await ps.revision(uid);
  const operation = await body(past.id, wid, {
    outcome: "completed",
    assessment: assessment({
      rpe: 6,
      fatigue: "moderate",
      pain: "none",
      memo: "피드백 테스트",
    }),
    skipReason: null,
  });
  const saved = await feedbackStorage.saveWorkoutFeedback(uid, operation);
  assert.equal(saved.version, 1);
  assert.equal(
    (await feedbackStorage.saveWorkoutFeedback(uid, operation)).version,
    1,
    "exact retry is idempotent",
  );
  assert.equal(
    check(
      await db.from("workout_feedback_events").select("id").eq("user_id", uid),
    ).length,
    1,
  );
  assert.notEqual(await ps.revision(uid), beforeRevision);
  assert.notEqual((await snapshot(past.id)).revision, original);
  await assert.rejects(
    feedbackStorage.saveWorkoutFeedback(uid, {
      ...operation,
      requestId: randomUUID(),
      assessment: assessment({ rpe: 7 }),
    }),
    /feedback_changed/,
  );
  const conflict = await body(past.id, wid, {
    outcome: "skipped",
    assessment: null,
    skipReason: "일정 충돌",
  });
  const results = await Promise.allSettled([
    feedbackStorage.saveWorkoutFeedback(uid, conflict),
    feedbackStorage.saveWorkoutFeedback(uid, {
      ...conflict,
      requestId: randomUUID(),
    }),
  ]);
  assert.equal(
    results.filter((r) => r.status === "fulfilled").length,
    1,
    "owner lock and revision prevent lost updates",
  );
  let w = (await snapshot(past.id)).workouts.find((w) => w.id === wid);
  assert.equal(w.status, "skipped");
  assert.equal(w.manualCompletedAt, null);
  assert.equal(w.feedback.skipReason, "일정 충돌");
  await matchingStorage.reconcileWorkoutMatches(uid, past.id);
  w = (await snapshot(past.id)).workouts.find((w) => w.id === wid);
  assert.equal(
    w.status,
    "skipped",
    "Garmin import must not undo explicit skip",
  );
  let metrics = (await rs.reviewInputs(uid, previous.start)).metrics;
  assert.equal(metrics.explicitlySkipped, 1);
  assert.equal(
    metrics.sessions.find((s) => s.date === previous.start).feedback.skipReason,
    "일정 충돌",
  );
  await save(past.id, wid, blank);
  w = (await snapshot(past.id)).workouts.find((w) => w.id === wid);
  assert.equal(w.status, "scheduled");
  assert.equal(w.feedback.assessment, null);
  assert.equal(w.feedback.skipReason, null);
  await save(past.id, wid, {
    outcome: "completed",
    assessment: assessment({ pain: "pain" }),
    skipReason: null,
  });
  assert.equal(
    (await inputs.readPrescriptionPreview(uid, "next")).limits.maxWeekKm,
    0,
  );
  const ctx = await storage.readTrainingContext(uid);
  assert.equal(ctx.goal.condition.feeling, "pain");
  const policy = prescriptions.refinePrescription(
    ctx,
    plans.planPolicy(ctx, "next"),
    null,
    null,
  ).policy;
  assert.equal(
    policy.maxWeekKm,
    0,
    "reported pain tightens existing server prescription gate",
  );
  await save(past.id, wid, {
    outcome: "completed",
    assessment: assessment({ pain: "none", fatigue: "low" }),
    skipReason: null,
  });
  assert.equal(
    (await storage.readTrainingContext(uid)).goal.condition,
    null,
    "explicit correction is reflected; no normal recovery invented",
  );
  const rest = past.workouts.find((w) => w.kind === "rest");
  await assert.rejects(
    save(past.id, rest.id, {
      outcome: "completed",
      assessment: null,
      skipReason: null,
    }),
    /feedback_workout/,
  );
  const future = present.workouts.find(
    (w) => w.scheduled_on > today && w.kind !== "rest",
  );
  if (future)
    await assert.rejects(
      save(present.id, future.id, {
        outcome: "skipped",
        assessment: null,
        skipReason: "future",
      }),
      /feedback_workout/,
    );
  const foreign = await body(past.id, wid, blank);
  await assert.rejects(
    feedbackStorage.saveWorkoutFeedback(randomUUID(), foreign),
    /feedback_workout/,
  );
  // Choose a recorded Wednesday: auto-matching locks Garmin evidence until explicit unlink.
  const linkedId = past.workouts.find(
    (w) => w.scheduled_on === running.addCalendarDays(previous.start, 2),
  ).id;
  await matchingStorage.reconcileWorkoutMatches(uid, past.id);
  let snap = await snapshot(past.id);
  assert.ok(snap.links.some((l) => l.workoutId === linkedId && l.active));
  await assert.rejects(
    save(past.id, linkedId, {
      outcome: "skipped",
      assessment: null,
      skipReason: "must unlink",
    }),
    /feedback_linked/,
  );
  await save(past.id, linkedId, {
    outcome: "completed",
    assessment: assessment({ rpe: 8 }),
    skipReason: null,
  });
  snap = await snapshot(past.id);
  assert.ok(snap.links.some((l) => l.workoutId === linkedId && l.active));
  await matchingStorage.saveWorkoutMatch(uid, linkedId, snap.revision, []);
  await save(past.id, linkedId, {
    outcome: "skipped",
    assessment: assessment({ fatigue: "high" }),
    skipReason: "기록은 별도 러닝, 계획 세션은 건너뜀",
  });
  check(await db.from("activities").select("id").eq("user_id", uid));
  metrics = (await rs.reviewInputs(uid, previous.start)).metrics;
  assert.equal(metrics.envelope.canProgress, false);
  assert.ok(
    metrics.sessions.some((s) => s.feedback?.assessment?.fatigue === "high"),
  );
  // Simulate a provider job without importing or calling any inference transport.
  const todayWorkout = present.workouts.find(
    (w) => w.scheduled_on === today && w.kind !== "rest",
  );
  if (todayWorkout) {
    await save(present.id, todayWorkout.id, {
      outcome: "skipped",
      assessment: null,
      skipReason: "오늘 휴식",
    });
    const context = await storage.readTrainingContext(uid);
    const base = plans.planPolicy(context, "current");
    const refined = prescriptions.refinePrescription(
      context,
      base,
      null,
      null,
    ).policy;
    assert.ok(refined.blockedDates.includes(today));
    assert.equal(refined.minWeekKm, 0);
    const revision = await ps.revision(uid);
    const job = check(
      await db.rpc("begin_training_generation", {
        p_user_id: uid,
        p_starts_on: current.start,
        p_revision: revision,
      }),
    );
    assert.equal(job.state, "started");
    await ps.savePlan(
      job.requestId,
      {
        summary: "Atomic preservation fixture",
        workouts: [
          {
            date: today,
            kind: "rest",
            title: "Must not replace skip",
            purpose: "Test",
            distanceKm: 0,
            paceSecondsPerKm: null,
            effort: "rest",
            steps: [],
          },
        ],
      },
      "fixture",
      timezone,
      null,
    );
    const preserved = check(
      await db
        .from("workouts")
        .select("id,status,skip_reason")
        .eq("id", todayWorkout.id)
        .single(),
    );
    assert.equal(preserved.status, "skipped");
    assert.equal(preserved.skip_reason, "오늘 휴식");
    assert.equal(
      (await ps.readPlan(uid, "current")).plan.workouts.find(
        (w) => w.id === todayWorkout.id,
      ).feedback.skipReason,
      "오늘 휴식",
    );
  }
  // Verify the completed-week read endpoint can serve the same reports without regeneration.
  assert.ok(
    (await ps.readPlan(uid, "previous")).plan.workouts.some(
      (w) => w.feedback.reportedAt,
    ),
  );
  console.log(
    "PASS: real DB feedback, retries, CAS/concurrency, completion/skip/reset, ownership, future/rest denial, Garmin conflict/unlink, review/context gates and regeneration preservation. Actual OpenAI calls: 0.",
  );
} finally {
  if (uid) {
    check(await db.from("training_plans").delete().eq("user_id", uid));
    check(await db.from("activities").delete().eq("user_id", uid));
    check(
      await db.from("training_generation_requests").delete().eq("user_id", uid),
    );
    check(await db.auth.admin.deleteUser(uid));
  }
}
