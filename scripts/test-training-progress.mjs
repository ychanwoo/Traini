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
const closeouts = load("lib/training/closeout-storage.ts", {
  "server-only": {}, "@/lib/supabase/admin": { getSupabaseAdmin: () => db },
  "@/lib/garmin/running-summary": running, "./weekly-review": review,
});
const rs = load("lib/training/review-storage.ts", {
  "./closeout-storage": closeouts,
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
const progress = load("lib/training/progress.ts", {
  "@/lib/garmin/running-summary": running,
  "./goal": goal,
  "./weekly-review": review,
});
const service = load("lib/training/progress-storage.ts", {
  "server-only": {},
  "./storage": storage,
  "@/lib/garmin/read-running-summary": summary,
  "./plan-storage": ps,
  "./review-storage": rs,
  "@/lib/garmin/running-summary": running,
  "./progress": progress,
});
let uid;
const check = ({ error, data }) => {
  assert.ifError(error);
  return data;
};
try {
  uid = check(
    await db.auth.admin.createUser({
      email: `progress-fixture-${randomUUID()}@example.invalid`,
      password: randomUUID(),
      email_confirm: true,
    }),
  ).user.id;
  const now = new Date(),
    current = running.runningPeriod(timezone, "current", now),
    today = current.today;
  const races = [
    {
      id: randomUUID(),
      name: "Half fixture",
      date: running.addCalendarDays(today, 70),
      distance: "HALF",
      targetTimeSeconds: 5700,
      priority: "supporting",
    },
    {
      id: randomUUID(),
      name: "Full fixture",
      date: running.addCalendarDays(today, 140),
      distance: "FULL",
      targetTimeSeconds: 12600,
      priority: "primary",
    },
  ];
  check(
    await db.from("profiles").upsert({
      id: uid,
      display_name: "Progress fixture",
      race_name: "Full fixture",
      target_distance: "FULL",
      target_date: races[1].date,
      race_goals: races,
      training_days: [1, 3, 5, 7],
      long_run_day: 7,
    }),
  );
  const rows = Array.from({ length: 8 }, (_, w) => ({
    date: running.addCalendarDays(current.start, -56 + w * 7),
    index: w,
  }));
  rows.push({ date: today, index: 8 });
  check(
    await db.from("activities").insert(
      rows.map(({ date, index }) => ({
        user_id: uid,
        garmin_activity_id: String(98000000 + index),
        activity_type: "running",
        source: "garmin_fit",
        started_at: index === 8 ? now.toISOString() : `${date}T06:00:00-07:00`,
        distance_meters: 10000,
        duration_seconds: 3300,
        average_pace_seconds_per_km: 330,
        training_date: date,
        training_timezone: timezone,
        source_file: String(98000000 + index) + ".fit",
        parser_version: 1,
        decoder_name: "garmin-fit-sdk",
        decoder_version: "fixture",
        metric_sources: {},
        warnings: [],
        imported_at: now.toISOString(),
        source_sha256: "a".repeat(64),
        normalized_sha256: "b".repeat(64),
        normalized_schema_version: 1,
      })),
    ),
  );
  const historicalPlan = check(
    await db
      .from("training_plans")
      .insert({
        user_id: uid,
        starts_on: rows[7].date,
        ends_on: running.addCalendarDays(rows[7].date, 6),
        target_distance_km: 20,
        source_version: 1,
        recovery_label: "미수집",
        summary: "fixture",
        model: "fixture-no-AI",
        timezone,
        input_revision: await ps.revision(uid),
      })
      .select("id")
      .single(),
  );
  check(
    await db.from("workouts").insert([
      {
        plan_id: historicalPlan.id,
        scheduled_on: rows[7].date,
        kind: "easy",
        status: "scheduled",
        title: "fixture",
        purpose: "fixture",
        distance_km: 10,
        pace_seconds_per_km: 330,
        effort: "conversational",
        steps: [],
      },
      {
        plan_id: historicalPlan.id,
        scheduled_on: running.addCalendarDays(rows[7].date, 2),
        kind: "recovery",
        status: "completed",
        manual_completed_at: now.toISOString(),
        title: "fixture",
        purpose: "fixture",
        distance_km: 7,
        pace_seconds_per_km: 350,
        effort: "conversational",
        steps: [],
      },
    ]),
  );
  await matchingStorage.reconcileWorkoutMatches(uid, historicalPlan.id);
  const currentPlan = check(
    await db
      .from("training_plans")
      .insert({
        user_id: uid,
        starts_on: current.start,
        ends_on: current.end,
        target_distance_km: 7,
        source_version: 1,
        recovery_label: "미수집",
        summary: "fixture",
        model: "fixture-no-AI",
        timezone,
        input_revision: await ps.revision(uid),
      })
      .select("id")
      .single(),
  );
  check(
    await db.from("workouts").insert({
      plan_id: currentPlan.id,
      scheduled_on: today,
      kind: "easy",
      status: "completed",
      manual_completed_at: now.toISOString(),
      title: "fixture",
      purpose: "fixture",
      distance_km: 7,
      pace_seconds_per_km: 330,
      effort: "conversational",
      steps: [],
    }),
  );
  const jobsBefore = check(
    await db
      .from("training_generation_requests")
      .select("id", { count: "exact" })
      .eq("user_id", uid),
  );
  const revisionBefore = await ps.revision(uid);
  const value = await service.readProgressInsights(uid);
  assert.equal(value.totals.activityCount, 8);
  assert.equal(value.totals.averageRecordedWeekMeters, 10000);
  assert.equal(value.totals.paceSecondsPerKm, 330);
  assert.equal(value.current.distanceMeters, 10000);
  assert.equal(value.races.length, 2);
  assert.equal(value.weeks[7].performance.garminCompleted, 1);
  assert.equal(value.weeks[7].performance.manualCompleted, 1);
  assert.equal(value.weeks[7].performance.plannedKm, 17);
  assert.equal(value.current.performance.manualCompleted, 1);
  assert.equal(
    await ps.revision(uid),
    revisionBefore,
    "progress reads must not reconcile or mutate completion",
  );
  await service.readProgressInsights(uid);
  const jobsAfter = check(
    await db
      .from("training_generation_requests")
      .select("id")
      .eq("user_id", uid),
  );
  assert.equal(jobsAfter.length, jobsBefore.length);
  check(
    await db
      .from("training_plans")
      .update({ timezone: timezone === "UTC" ? "America/Los_Angeles" : "UTC" })
      .eq("id", currentPlan.id),
  );
  assert.equal(
    (await service.readProgressInsights(uid)).current.performance,
    null,
    "do not mix plans saved in a different training timezone",
  );
  console.log(
    "PASS: real Supabase eight-week aggregation, weighted pace, two goals, Garmin/manual separation, read-only snapshots and zero generation requests. Actual OpenAI calls: 0.",
  );
} finally {
  if (uid) {
    check(await db.from("training_plans").delete().eq("user_id", uid));
    check(await db.from("activities").delete().eq("user_id", uid));
    check(await db.auth.admin.deleteUser(uid));
  }
}
