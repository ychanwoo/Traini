import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { typescriptLoader } from "../tests/helpers/load-typescript.mjs";
const fixturePassword = randomUUID();
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
assert.equal(
  new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,
  "kmmutfcgshellvjgpick.supabase.co",
);
const base = typescriptLoader();
const running = base("lib/garmin/running-summary.ts");
const zone =
  ["Pacific/Kiritimati", "America/Los_Angeles", "Etc/GMT+12"].find(
    (tz) =>
      new Date(
        running.dateInZone(new Date(), tz) + "T00:00:00Z",
      ).getUTCDay() === 0,
  ) ?? "America/Los_Angeles";
process.env.TRAINI_TIMEZONE = zone;
let inference = 0;
const loader = typescriptLoader({
  "@/lib/supabase/admin": { getSupabaseAdmin: () => db },
  "@/scripts/lib/chatgpt-inference.mjs": {
    generateWithSubscription: async (_uid, prompt) => {
      inference++;
      const input = JSON.parse(prompt.input[0].content);
      if (input.metrics)
        return {
          model: "fixture-no-inference",
          content: {
            summary: "확인된 테스트 기록이에요.",
            observations: [
              {
                topic: "volume",
                evidence: ["actualKm"],
                text: "기록에 근거한 테스트예요.",
              },
            ],
            nextWeek: {
              direction: "maintain",
              volumeChangePercent: 0,
              maxQualitySessions:
                input.metrics.envelope.supportedQualitySessions,
              rationale: "현재 제한을 우선해요.",
            },
            limitations: input.metrics.limitations,
          },
        };
      const policy = input.policy;
      assert.equal(
        policy.maxWeekKm,
        0,
        "Pain restrictions must remain active in the new closed-week context",
      );
      return {
        model: "fixture-no-inference",
        content: {
          summary: "통증 제한을 유지하는 테스트 계획이에요.",
          workouts: policy.dates.map((date) => ({
            date,
            kind: "rest",
            title: "휴식",
            purpose: "통증 상태를 확인해요.",
            distanceKm: 0,
            paceSecondsPerKm: null,
            effort: "rest",
            steps: [],
          })),
        },
      };
    },
  },
});
const closeouts = loader("lib/training/closeout-storage.ts"),
  reviews = loader("lib/training/review-storage.ts"),
  service = loader("lib/training/review-service.ts"),
  plans = loader("lib/training/plan-service.ts");
const check = ({ data, error }) => {
  assert.ifError(error);
  return data;
};
let uid;
try {
  uid = check(
    await db.auth.admin.createUser({
      email: `closeout-${randomUUID()}@example.invalid`,
      password: fixturePassword,
      email_confirm: true,
    }),
  ).user.id;
  const today = running.dateInZone(new Date(), zone);
  check(
    await db.from("profiles").upsert({
      id: uid,
      display_name: "Closeout fixture",
      race_name: "Test race",
      target_distance: "FULL",
      target_date: running.addCalendarDays(today, 120),
      training_days: [1, 2, 3, 4, 5, 6, 7],
      long_run_day: 7,
      training_timezone: zone,
      training_condition: { reportedOn: today, feeling: "pain" },
    }),
  );
  const before = await closeouts.readCloseout(uid);
  assert.equal(before.early, new Date(today + "T00:00:00Z").getUTCDay() === 0);
  const start = before.startsOn;
  const makeActivity = (id, day) => ({
    user_id: uid,
    garmin_activity_id: String(id),
    activity_type: "running",
    source: "garmin_fit",
    started_at: day + "T00:00:00Z",
    distance_meters: 7000,
    duration_seconds: 2310,
    average_pace_seconds_per_km: 330,
    training_date: day,
    training_timezone: zone,
    source_file: String(id) + ".fit",
    parser_version: 1,
    decoder_name: "garmin-fit-sdk",
    decoder_version: "fixture",
    metric_sources: {},
    warnings: [],
    imported_at: new Date().toISOString(),
    source_sha256: "a".repeat(64),
    normalized_sha256: "b".repeat(64),
    normalized_schema_version: 1,
  });
  check(
    await db
      .from("activities")
      .insert(
        Array.from({ length: 4 }, (_, w) =>
          [0, 2, 4].map((d, i) =>
            makeActivity(
              800000 + w * 10 + i,
              running.addCalendarDays(start, -w * 7 + d),
            ),
          ),
        ).flat(),
      ),
  );
  // A manual, unconfirmed planned session must remain unconfirmed after closeout.
  const p = check(
    await db
      .from("training_plans")
      .insert({
        user_id: uid,
        starts_on: start,
        ends_on: running.addCalendarDays(start, 6),
        target_distance_km: 7,
        recovery_label: "미확인",
        source_version: 1,
        summary: "Fixture",
        model: "fixture",
        timezone: zone,
        input_revision: "0".repeat(32),
      })
      .select("id")
      .single(),
  );
  const workout = check(
    await db
      .from("workouts")
      .insert({
        plan_id: p.id,
        scheduled_on: start,
        kind: "easy",
        status: "scheduled",
        title: "이지런",
        purpose: "Fixture",
        distance_km: 7,
        pace_seconds_per_km: 330,
        effort: "conversational",
        steps: [],
        garmin_match_dismissed: true,
      })
      .select("*")
      .single(),
  );
  if (before.early)
    await assert.rejects(reviews.reviewInputs(uid, start), /review_period/);
  const ready = await closeouts.readCloseout(uid);
  assert.equal(ready.unconfirmed, 1);
  await assert.rejects(
    closeouts.closeWeek(uid, start, before.revision),
    /closeout_changed/,
  );
  const emptyQuota = check(
    await db.rpc("training_generation_status", { p_user_id: uid }),
  );
  const closed = await closeouts.closeWeek(uid, start, ready.revision);
  assert.equal(closed.closeout.fresh, true);
  const outsider = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  assert.ok(
    (
      await outsider.rpc("close_training_week", {
        p_user_id: uid,
        p_starts_on: start,
        p_timezone: zone,
        p_revision: ready.revision,
      })
    ).error,
  );
  const fixtureEmail = check(await db.auth.admin.getUserById(uid)).user.email;
  check(
    await outsider.auth.signInWithPassword({
      email: fixtureEmail,
      password: fixturePassword,
    }),
  );
  assert.ok(
    (
      await outsider.rpc("training_week_closeout_status", {
        p_user_id: uid,
        p_timezone: zone,
      })
    ).error,
  );
  assert.equal(
    check(await outsider.from("training_week_closeouts").select("starts_on"))
      .length,
    0,
  );
  assert.ok(
    (
      await outsider
        .from("training_week_closeouts")
        .update({ snapshot_revision: "f".repeat(32) })
        .eq("user_id", uid)
    ).error,
  );
  await outsider.auth.signOut();
  const repeated = await closeouts.closeWeek(uid, start, ready.revision);
  assert.equal(repeated.closeout.closedAt, closed.closeout.closedAt);
  const concurrent = await Promise.all([
    closeouts.closeWeek(uid, start, ready.revision),
    closeouts.closeWeek(uid, start, ready.revision),
  ]);
  assert.ok(
    concurrent.every(
      (value) => value.closeout.closedAt === closed.closeout.closedAt,
    ),
  );
  assert.equal(
    check(
      await db.from("workouts").select("status").eq("id", workout.id).single(),
    ).status,
    "scheduled",
  );
  assert.deepEqual(
    check(await db.rpc("training_generation_status", { p_user_id: uid })).quota,
    emptyQuota.quota,
  );
  const reviewed = await service.generateReview(uid, start);
  assert.equal(reviewed.review.fresh, true);
  const applicable = await reviews.readApplicableReview(uid, zone, "next");
  assert.equal(applicable.id, reviewed.review.id);
  assert.equal(applicable.revision, reviewed.review.revision);
  await assert.rejects(plans.generatePlan(uid, "next"), /limited/);
  // Advance only this disposable fixture's reservation beyond the shared cooldown.
  const previousJob = check(
    await db
      .from("training_generation_requests")
      .select("started_at")
      .eq("user_id", uid)
      .eq("kind", "review")
      .single(),
  );
  check(
    await db
      .from("training_generation_requests")
      .update({
        started_at: new Date(
          Date.parse(previousJob.started_at) - 120000,
        ).toISOString(),
      })
      .eq("user_id", uid),
  );
  const planned = await plans.generatePlan(uid, "next");
  assert.equal(planned.plan.review.id, reviewed.review.id);
  assert.equal(planned.plan.review.revision, reviewed.review.revision);
  assert.ok(planned.plan.workouts.every((w) => w.kind === "rest"));
  const planBeforeLateData = JSON.stringify(planned.plan.workouts);
  check(
    await db
      .from("activities")
      .insert(makeActivity(899999, running.addCalendarDays(start, 5))),
  );
  assert.equal((await closeouts.readCloseout(uid)).closeout.fresh, false);
  if (before.early)
    await assert.rejects(
      service.generateReview(uid, start),
      /closeout_changed/,
    );
  const afterLateImport = await closeouts.readCloseout(uid);
  await closeouts.closeWeek(uid, start, afterLateImport.revision);
  assert.equal((await closeouts.readCloseout(uid)).closeout.fresh, true);
  const savedNext = await loader("lib/training/plan-storage.ts").readPlan(
    uid,
    "next",
  );
  assert.equal(JSON.stringify(savedNext.plan.workouts), planBeforeLateData);
  assert.equal(savedNext.inputsChanged, true);
  const immutable = JSON.stringify(
    check(await db.from("workouts").select("*").eq("id", workout.id).single()),
  );
  check(
    await db
      .from("workouts")
      .update({
        feedback_version: 1,
        workout_assessment: {
          rpe: null,
          fatigue: null,
          pain: "pain",
          memo: "Late feedback",
        },
        feedback_reported_at: new Date().toISOString(),
      })
      .eq("id", workout.id),
  );
  assert.equal((await closeouts.readCloseout(uid)).closeout.fresh, false);
  assert.equal((await reviews.readReview(uid, start)).review.fresh, false);
  assert.equal(await reviews.readApplicableReview(uid, zone, "next"), null);
  const used = inference;
  if (before.early) {
    await assert.rejects(
      service.generateReview(uid, start),
      /closeout_changed/,
    );
    await assert.rejects(plans.generatePlan(uid, "next"), /closeout_changed/);
  }
  assert.equal(inference, used);
  const updated = await closeouts.readCloseout(uid);
  await assert.rejects(
    closeouts.closeWeek(
      uid,
      running.addCalendarDays(start, 7),
      updated.revision,
    ),
    /closeout_period/,
  );
  await closeouts.closeWeek(uid, start, updated.revision);
  assert.equal((await closeouts.readCloseout(uid)).closeout.fresh, true);
  assert.notEqual(
    JSON.stringify(
      check(
        await db.from("workouts").select("*").eq("id", workout.id).single(),
      ),
    ),
    immutable,
  );
  assert.equal(
    check(
      await db.from("workouts").select("status").eq("id", workout.id).single(),
    ).status,
    "scheduled",
  );
  console.log(
    JSON.stringify({
      passed: true,
      sundayDatabasePath: before.early,
      duplicateCloseoutStable: true,
      concurrentCloseoutStable: true,
      reviewAndPlanProvenance: true,
      lateFeedbackInvalidates: true,
      lateImportInvalidates: true,
      directAccessDenied: true,
      workoutOutcomesPreserved: true,
      actualOpenAICalls: 0,
      fixtureGenerations: inference,
    }),
  );
} finally {
  if (uid) {
    await db.from("training_plans").delete().eq("user_id", uid);
    const removed = await db.auth.admin.deleteUser(uid);
    assert.ifError(removed.error);
  }
}
