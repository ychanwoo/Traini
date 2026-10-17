import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
assert.equal(
  new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,
  "kmmutfcgshellvjgpick.supabase.co",
);
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const check = ({ data, error }) => {
  assert.ifError(error);
  return data;
};
function load(file, modules = {}) {
  const c = {
    exports: {},
    Date,
    Intl,
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
const running = load("lib/garmin/running-summary.ts");
const matching = load("lib/training/workout-matching.ts", {
  "@/lib/garmin/running-summary": running,
});
let uid;
try {
  uid = check(
    await db.auth.admin.createUser({
      email: `traini-reliability-${randomUUID()}@example.invalid`,
      email_confirm: true,
    }),
  ).user.id;
  check(
    await db
      .from("profiles")
      .upsert({ id: uid, display_name: "Disposable reliability fixture" }),
  );
  const status = async () =>
    check(await db.rpc("training_generation_status", { p_user_id: uid }));
  assert.equal((await status()).quota.remaining, 5);
  const start = "2026-10-12",
    revision = check(
      await db.rpc("training_input_revision", { p_user_id: uid }),
    );
  check(
    await db.from("training_generation_requests").insert(
      Array.from({ length: 5 }, (_, i) => ({
        user_id: uid,
        kind: i % 2 ? "review" : "plan",
        starts_on: start,
        state: "failed",
        input_revision: revision,
        started_at: new Date(Date.now() - (i + 1) * 3600000).toISOString(),
        failure_code: "network",
      })),
    ),
  );
  const full = await status();
  assert.equal(full.quota.remaining, 0);
  assert.equal(full.quota.used, 5);
  assert.ok(Date.parse(full.quota.retryAt) > Date.now());
  assert.equal(
    check(
      await db.rpc("begin_training_generation", {
        p_user_id: uid,
        p_starts_on: start,
        p_revision: revision,
      }),
    ).state,
    "limited",
  );
  assert.equal(
    check(
      await db
        .from("training_generation_requests")
        .select("id")
        .eq("user_id", uid),
    ).length,
    5,
    "quota denial must not reserve/call anything",
  );
  check(
    await db
      .from("training_generation_requests")
      .update({ started_at: new Date(Date.now() - 25 * 3600000).toISOString() })
      .eq("user_id", uid),
  );
  assert.equal((await status()).quota.remaining, 5);
  const expired = check(
    await db
      .from("training_generation_requests")
      .insert({
        user_id: uid,
        kind: "plan",
        starts_on: start,
        state: "running",
        input_revision: revision,
        started_at: new Date(Date.now() - 7 * 60000).toISOString(),
        lease_expires_at: new Date(Date.now() - 60000).toISOString(),
      })
      .select("id")
      .single(),
  );
  assert.equal((await status()).active, null);
  const reserved = check(
    await db.rpc("begin_training_generation", {
      p_user_id: uid,
      p_starts_on: start,
      p_revision: revision,
    }),
  );
  assert.equal(reserved.state, "started");
  assert.equal(
    check(
      await db
        .from("training_generation_requests")
        .select("state,failure_code")
        .eq("id", expired.id)
        .single(),
    ).failure_code,
    "interrupted",
  );
  const busy = await status();
  assert.equal(busy.active.kind, "plan");
  assert.ok(Date.parse(busy.quota.retryAt) > Date.now());
  assert.equal(
    check(
      await db.rpc("begin_training_generation", {
        p_user_id: uid,
        p_starts_on: start,
        p_revision: revision,
      }),
    ).state,
    "busy",
  );
  // Cross the actual Python decoder/upload and database/matching/feedback boundaries.
  await promisify(execFile)(
    process.env.TRAINI_COLLECTOR_PYTHON ?? "collector/.venv/bin/python",
    ["collector/tests/live_pipeline_fixture.py"],
    {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        PYTHONNOUSERSITE: "1",
        TRAINI_TIMEZONE: process.env.TRAINI_TIMEZONE ?? "America/Los_Angeles",
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        TRAINI_FIXTURE_OWNER: uid,
      },
      timeout: 90000,
    },
  );
  const rows = check(
    await db
      .from("activities")
      .select(
        "garmin_activity_id,started_at,updated_at,distance_meters,duration_seconds,average_pace_seconds_per_km",
      )
      .eq("user_id", uid),
  );
  assert.equal(rows.length, 1);
  const period = running.runningPeriod(
    process.env.TRAINI_TIMEZONE ?? "America/Los_Angeles",
    "previous",
  );
  const summary = running.buildRunningSummary(rows, period);
  assert.equal(summary.totals.distanceMeters, 5000.25);
  assert.equal(summary.totals.timerSeconds, 1800);
  const pid = check(
    await db
      .from("training_plans")
      .insert({
        user_id: uid,
        starts_on: period.start,
        ends_on: period.end,
        target_distance_km: 5,
        recovery_label: "fixture",
        source_version: 1,
        summary: "Synthetic end-to-end fixture",
        model: "no-ai",
        timezone: period.timezone,
        input_revision: revision,
      })
      .select("id")
      .single(),
  ).id;
  const wid = check(
    await db
      .from("workouts")
      .insert({
        plan_id: pid,
        scheduled_on: period.end,
        kind: "easy",
        status: "scheduled",
        title: "Synthetic FIT fixture",
        purpose: "Integration",
        distance_km: 5,
        effort: "conversational",
        steps: [],
      })
      .select("id")
      .single(),
  ).id;
  const snapshot = () =>
    db
      .rpc("workout_match_snapshot", { p_user_id: uid, p_plan_id: pid })
      .then(check);
  const beforeMatch = matching.parseMatchSnapshot(await snapshot());
  check(
    await db.rpc("apply_workout_matches", {
      p_user_id: uid,
      p_plan_id: pid,
      p_revision: beforeMatch.revision,
      p_decisions: matching.decideWorkoutMatches(beforeMatch),
    }),
  );
  const matched = await snapshot();
  assert.ok(matched.links.some((l) => l.workoutId === wid && l.active));
  check(
    await db.rpc("save_workout_feedback", {
      p_user_id: uid,
      p_input: {
        workoutId: wid,
        requestId: randomUUID(),
        revision: matched.revision,
        version: 0,
        outcome: "completed",
        assessment: {
          rpe: 6,
          fatigue: "moderate",
          pain: "none",
          memo: "Synthetic round trip",
        },
        skipReason: null,
      },
    }),
  );
  const review = check(
    await db.rpc("weekly_review_snapshot", {
      p_user_id: uid,
      p_starts_on: period.start,
      p_timezone: period.timezone,
    }),
  );
  assert.equal(review.source.workouts[0].feedback.assessment.rpe, 6);
  assert.equal(review.source.activities.length, 1);
  assert.equal(review.source.workouts[0].status, "completed");
  console.log(
    "PASS: rolling plan/review quota, failed-attempt accounting, read-only status, cooldown, expired-lease recovery concurrent reservation denial, synthetic FIT decode/upload/reimport, weekly summary, matching, feedback and review snapshot. OpenAI calls: 0.",
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
