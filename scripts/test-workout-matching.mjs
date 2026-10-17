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
const running = load("lib/garmin/running-summary.ts");
const matching = load("lib/training/workout-matching.ts", {
  "@/lib/garmin/running-summary": running,
});
const storage = load("lib/training/matching-storage.ts", {
  "server-only": {},
  "@/lib/supabase/admin": { getSupabaseAdmin: () => db },
  "./workout-matching": matching,
  "@/lib/garmin/running-summary": running,
});
const step = (distanceMeters, paceSecondsPerKm, kind = "steady") => ({
  kind,
  distanceMeters,
  paceSecondsPerKm,
  repetitions: 1,
  recoveryMeters: 0,
  recoverySeconds: null,
  recoveryAfterLast: false,
});
const repeats = (
  distanceMeters = 800,
  repetitions = 5,
  recoveryMeters = 400,
) => ({ ...step(distanceMeters, 240, "repeats"), repetitions, recoveryMeters });
const lap = (distanceMeters, paceSecondsPerKm, intensity) => ({
  distanceMeters,
  paceSecondsPerKm,
  intensity,
  timerSeconds: (distanceMeters / 1000) * paceSecondsPerKm,
  averageHeartRate: null,
});
const empty = {
  version: 1,
  lapCount: 0,
  lapsComplete: false,
  laps: [],
  warnings: [],
};
const intervalEvidence = (distance = 800, count = 5, recovery = 400) => {
  const laps = [
    lap(2000, 340, "warmup"),
    ...Array.from({ length: count }, (_, i) => [
      lap(distance, 240, "active"),
      ...(i < count - 1 ? [lap(recovery, 400, "recovery")] : []),
    ]).flat(),
    lap(
      10000 - 2000 - distance * count - recovery * (count - 1),
      350,
      "cooldown",
    ),
  ];
  return { ...empty, lapCount: laps.length, lapsComplete: true, laps };
};
let userId;
try {
  const created = await db.auth.admin.createUser({
    email: `traini-match-test-${randomUUID()}@example.invalid`,
    email_confirm: true,
    app_metadata: { traini_fixture: "workout_matching" },
  });
  assert.ifError(created.error);
  userId = created.data.user.id;
  assert.ifError(
    (
      await db
        .from("profiles")
        .insert({ id: userId, display_name: "Disposable matching test" })
    ).error,
  );
  const start = running.addCalendarDays(
    running.runningPeriod("America/Los_Angeles", "current").start,
    -14,
  );
  const plan = await db
    .from("training_plans")
    .insert({
      user_id: userId,
      starts_on: start,
      ends_on: running.addCalendarDays(start, 6),
      target_distance_km: 60,
      recovery_label: "test fixture",
      source_version: 1,
      summary: "Synthetic matching fixtures, not a training recommendation",
      model: "test",
      timezone: "America/Los_Angeles",
      input_revision: "test",
    })
    .select("id")
    .single();
  assert.ifError(plan.error);
  const planId = plan.data.id;
  const kinds = [
    "easy",
    "easy",
    "interval",
    "threshold",
    "long",
    "rest",
    "easy",
  ];
  const km = [7, 8, 10, 10, 20, 0, 5];
  const steps = km.map((m) => (m ? [step(m * 1000, 330)] : []));
  steps[2] = [
    step(2000, 340, "warmup"),
    repeats(),
    step(2400, 350, "cooldown"),
  ];
  steps[3] = [
    step(1500, 340, "warmup"),
    step(7000, 255),
    step(1500, 350, "cooldown"),
  ];
  const result = await db
    .from("workouts")
    .insert(
      kinds.map((kind, i) => ({
        plan_id: planId,
        scheduled_on: running.addCalendarDays(start, i),
        kind,
        status: "scheduled",
        title: "Matching fixture",
        purpose: "Test only",
        distance_km: km[i],
        steps: steps[i],
        effort:
          kind === "rest"
            ? "rest"
            : ["interval", "threshold"].includes(kind)
              ? "controlled"
              : "conversational",
      })),
    )
    .select("id,scheduled_on")
    .order("scheduled_on");
  assert.ifError(result.error);
  const w = result.data;
  const rows = [];
  async function upload(index, meters, evidence = empty, slot = 0) {
    const garminId = String(910000 + index * 10 + slot);
    const date = running.addCalendarDays(start, index);
    const startedAt = `${date}T${19 + slot}:00:00Z`;
    const row = {
      user_id: userId,
      garmin_activity_id: garminId,
      activity_type: "running",
      source: "garmin_fit",
      sub_sport: "generic",
      started_at: startedAt,
      training_date: date,
      training_timezone: "America/Los_Angeles",
      distance_meters: meters,
      duration_seconds: (meters / 1000) * 330,
      elapsed_time_seconds: (meters / 1000) * 330,
      moving_time_seconds: null,
      average_pace_seconds_per_km: 330,
      average_heart_rate: null,
      average_cadence_steps_per_minute: null,
      source_file: garminId + ".fit",
      source_sha256: "a".repeat(64),
      normalized_sha256: "b".repeat(64),
      normalized_schema_version: 1,
      parser_version: 1,
      decoder_name: "garmin-fit-sdk",
      decoder_version: "fixture",
      metric_sources: {},
      warnings: [],
    };
    const r = await db.rpc("import_garmin_activity_with_details", {
      p_activity: row,
      p_details: evidence,
    });
    assert.ifError(r.error);
    rows.push({ row, evidence });
    return row;
  }
  await upload(0, 7000);
  await upload(1, 8000);
  await upload(2, 10000, intervalEvidence());
  await upload(3, 10000, {
    ...empty,
    lapsComplete: true,
    lapCount: 3,
    laps: [
      lap(1500, 340, "warmup"),
      lap(7000, 255, "active"),
      lap(1500, 350, "cooldown"),
    ],
  });
  await upload(4, 20000);
  await upload(6, 2000, empty, 0);
  await upload(6, 3000, empty, 1);
  const concurrent = await Promise.all([
    storage.reconcileWorkoutMatches(userId, planId),
    storage.reconcileWorkoutMatches(userId, planId),
  ]);
  let out = concurrent[0];
  assert.equal(concurrent[1].get(w[0].id).source, "garmin");
  for (let i = 0; i < 5; i++)
    assert.equal(out.get(w[i].id).source, "garmin", kinds[i]);
  assert.equal(out.get(w[5].id).state, "unmatched");
  assert.equal(out.get(w[6].id).reason, "multiple_activities");
  const recent = await storage.reconcileRecentWorkoutMatches(userId);
  assert.equal(recent.checked, 1);
  assert.equal(recent.failed, 0);
  const again = await storage.reconcileWorkoutMatches(userId, planId);
  assert.equal(
    again.get(w[0].id).revision,
    out.get(w[0].id).revision,
    "idempotent snapshot revision",
  );
  console.log(
    "PASS: recovery/easy, 800m intervals, tempo, long run, rest and ambiguous activities",
  );

  let entry = out.get(w[6].id);
  const selected = entry.activities.map((a) => a.id);
  await storage.saveWorkoutMatch(userId, w[6].id, entry.revision, selected);
  out = await storage.reconcileWorkoutMatches(userId, planId);
  entry = out.get(w[6].id);
  assert.equal(entry.actualDistanceKm, 5);
  assert.equal(entry.method, "confirmed");
  const oldRevision = entry.revision;
  const changed = {
    ...rows.at(-1).row,
    distance_meters: 3100,
    normalized_sha256: "c".repeat(64),
  };
  assert.ifError(
    (
      await db.rpc("import_garmin_activity_with_details", {
        p_activity: changed,
        p_details: empty,
      })
    ).error,
  );
  await assert.rejects(
    storage.saveWorkoutMatch(userId, w[6].id, oldRevision, selected),
    /match_changed/,
  );
  out = await storage.reconcileWorkoutMatches(userId, planId);
  entry = out.get(w[6].id);
  assert.equal(entry.reason, "activity_changed");
  assert.equal(entry.source, null);
  await storage.saveWorkoutMatch(userId, w[6].id, entry.revision, selected);
  out = await storage.reconcileWorkoutMatches(userId, planId);
  assert.equal(out.get(w[6].id).actualDistanceKm, 5.1);
  entry = out.get(w[6].id);
  await storage.saveWorkoutMatch(userId, w[6].id, entry.revision, []);
  out = await storage.reconcileWorkoutMatches(userId, planId);
  assert.equal(out.get(w[6].id).reason, "user_unlinked");
  assert.equal(out.get(w[6].id).source, null);
  console.log(
    "PASS: multiple-file confirmation, stale request conflict, changed evidence invalidation and unlink",
  );

  assert.ifError(
    (
      await db
        .from("workouts")
        .update({
          manual_completed_at: new Date().toISOString(),
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", w[4].id)
    ).error,
  );
  assert.ifError(
    (
      await db.rpc("import_garmin_activity_with_details", {
        p_activity: {
          ...rows[4].row,
          distance_meters: 6000,
          normalized_sha256: "c".repeat(64),
        },
        p_details: empty,
      })
    ).error,
  );
  out = await storage.reconcileWorkoutMatches(userId, planId);
  assert.equal(out.get(w[4].id).source, "manual");
  assert.equal(out.get(w[4].id).reason, "distance_mismatch");
  const manual = await db
    .from("workouts")
    .select("status,manual_completed_at")
    .eq("id", w[4].id)
    .single();
  assert.ifError(manual.error);
  assert.equal(manual.data.status, "completed");
  assert.ok(manual.data.manual_completed_at);
  // Reimport and switch the prescribed interval structure, preserving stable activity UUIDs.
  assert.ifError(
    (
      await db
        .from("workouts")
        .update({
          steps: [
            step(2000, 340, "warmup"),
            repeats(400, 10, 200),
            step(2200, 350, "cooldown"),
          ],
        })
        .eq("id", w[2].id)
    ).error,
  );
  assert.ifError(
    (
      await db.rpc("import_garmin_activity_with_details", {
        p_activity: rows[2].row,
        p_details: intervalEvidence(400, 10, 200),
      })
    ).error,
  );
  out = await storage.reconcileWorkoutMatches(userId, planId);
  assert.equal(out.get(w[2].id).state, "matched");
  const a = await db
    .from("workout_activity_matches")
    .select("activity_id")
    .eq("workout_id", w[0].id)
    .single();
  assert.ifError(a.error);
  await assert.rejects(
    storage.saveWorkoutMatch(userId, w[6].id, out.get(w[6].id).revision, [
      a.data.activity_id,
    ]),
    /match_activity/,
  );
  const nonexistent = await db.rpc("workout_match_snapshot", {
    p_user_id: randomUUID(),
    p_plan_id: planId,
  });
  assert.ok(nonexistent.error, "cross-owner snapshot denied");
  console.log(
    "PASS: manual completion preservation, 400m alternate session, wrong-day and cross-owner denial",
  );

  const raw = await db.rpc("workout_match_snapshot", {
    p_user_id: userId,
    p_plan_id: planId,
  });
  assert.ifError(raw.error);
  const before = matching.parseMatchSnapshot(raw.data);
  const decisions = matching.decideWorkoutMatches(before);
  decisions[0] = {
    ...decisions[0],
    state: "unmatched",
    reason: "user_unlinked",
    dismissed: true,
    links: [],
  };
  decisions.at(-1).state = "matched";
  decisions.at(-1).links = [
    {
      activityId: a.data.activity_id,
      revision: "a".repeat(32),
      method: "confirmed",
    },
  ];
  const invalid = await db.rpc("apply_workout_matches", {
    p_user_id: userId,
    p_plan_id: planId,
    p_revision: before.revision,
    p_decisions: decisions,
    p_confirmation: w[0].id,
  });
  assert.ok(invalid.error);
  const after = await db.rpc("workout_match_snapshot", {
    p_user_id: userId,
    p_plan_id: planId,
  });
  assert.ifError(after.error);
  assert.equal(
    after.data.revision,
    before.revision,
    "failed batch rolled back every preceding write",
  );
  const anonymous = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  );
  assert.ok(
    (
      await anonymous.rpc("workout_match_snapshot", {
        p_user_id: userId,
        p_plan_id: planId,
      })
    ).error,
  );
  console.log("PASS: atomic rollback and service-only matching RPCs");
  const movedDate = running.addCalendarDays(start, 1);
  assert.ifError(
    (
      await db.rpc("import_garmin_activity_with_details", {
        p_activity: {
          ...rows[0].row,
          started_at: `${movedDate}T19:00:00Z`,
          training_date: movedDate,
          normalized_sha256: "d".repeat(64),
        },
        p_details: empty,
      })
    ).error,
  );
  out = await storage.reconcileWorkoutMatches(userId, planId);
  assert.equal(out.get(w[0].id).source, null);
  assert.equal(out.get(w[1].id).reason, "multiple_activities");
  await storage.saveWorkoutMatch(userId, w[1].id, out.get(w[1].id).revision, [
    a.data.activity_id,
  ]);
  out = await storage.reconcileWorkoutMatches(userId, planId);
  assert.equal(out.get(w[1].id).method, "confirmed");
  console.log(
    "PASS: corrected activity dates require explicit reassignment without duplicate links",
  );
} finally {
  if (userId) {
    assert.notEqual(userId, process.env.TRAINI_ADMIN_USER_ID);
    assert.ifError(
      (await db.from("training_plans").delete().eq("user_id", userId)).error,
    );
    assert.ifError(
      (await db.from("activities").delete().eq("user_id", userId)).error,
    );
    const removed = await db.auth.admin.deleteUser(userId);
    assert.ifError(removed.error);
  }
}
console.log("All matching integration checks passed; disposable data removed.");
