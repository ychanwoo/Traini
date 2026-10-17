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
let uid;
const check = ({ error, data }) => {
  assert.ifError(error);
  return data;
};
try {
  const account = check(
    await db.auth.admin.createUser({
      email: `review-fixture-${randomUUID()}@example.invalid`,
      password: randomUUID(),
      email_confirm: true,
    }),
  );
  uid = account.user.id;
  check(
    await db.from("profiles").upsert({
      id: uid,
      display_name: "Review test",
      race_name: "Fixture race",
      target_distance: "FULL",
      target_date: running.addCalendarDays(
        running.dateInZone(new Date(), timezone),
        120,
      ),
      training_days: [1, 2, 3, 4, 5, 6, 7],
      long_run_day: 7,
    }),
  );
  const period = review.reviewPeriod(timezone);
  check(
    await db.from("activities").insert(
      [0, 1, 2, 3].flatMap((w) =>
        [0, 2, 4, 6].map((d, i) => ({
          user_id: uid,
          garmin_activity_id: String(90000000 + w * 10 + i),
          activity_type: "running",
          source: "garmin_fit",
          started_at: `${running.addCalendarDays(period.startsOn, -w * 7 + d)}T19:00:00Z`,
          distance_meters: 7000,
          duration_seconds: 2310,
          average_pace_seconds_per_km: 330,
          training_date: running.addCalendarDays(period.startsOn, -w * 7 + d),
          training_timezone: timezone,
          source_file: String(90000000 + w * 10 + i) + ".fit",
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
      ),
    ),
  );

  const saved = await storage.readTrainingGoal(uid),
    today = saved.today;
  const races = [
    {
      id: randomUUID(),
      name: "January-style half fixture",
      distance: "HALF",
      date: running.addCalendarDays(today, 70),
      targetTimeSeconds: 5400,
      priority: "supporting",
    },
    {
      id: randomUUID(),
      name: "March-style full fixture",
      distance: "FULL",
      date: running.addCalendarDays(today, 140),
      targetTimeSeconds: 12600,
      priority: "primary",
    },
  ];
  const preferences = goal.validateGoalInput(
    { ...saved.goal, races, condition: null },
    today,
  );
  await storage.saveTrainingGoal(uid, preferences, saved.revision);
  const loaded = await storage.readTrainingGoal(uid);
  assert.equal(loaded.goal.races.length, 2);
  assert.equal(loaded.goal.targetDistance, "FULL");
  await assert.rejects(
    storage.saveTrainingGoal(uid, preferences, saved.revision),
    /goal_conflict/,
  );
  const preview = await inputs.readPrescriptionPreview(uid, "next");
  assert.equal(preview.guidance.goals.length, 2);
  assert.equal(preview.guidance.source, "rules_and_recorded_evidence");
  let calls = 0;
  let lostResponse = true,
    lastSave;
  const service = load("lib/training/plan-service.ts", {
    "server-only": {},
    "./prescription-storage": inputs,
    "./prescription": prescriptions,
    "./review-storage": rs,
    "./weekly-review": review,
    "./storage": storage,
    "./plan-storage": {
      ...ps,
      savePlan: async (...args) => {
        lastSave = args;
        await ps.savePlan(...args);
        if (lostResponse) {
          lostResponse = false;
          throw new plans.PlanError("storage");
        }
      },
    },
    "./weekly-plan": plans,
    "@/scripts/lib/chatgpt-inference.mjs": {
      generateWithSubscription: async (_uid, prompt) => {
        calls++;
        const input = JSON.parse(prompt.input[0].content);
        assert.ok(input.goal.races.length >= 1);
        assert.ok(input.policy.prescription);
        const p = input.policy;
        const days = p.dates.filter(
          (d) =>
            p.trainingDays.includes(plans.isoWeekday(d)) &&
            !p.blockedDates.includes(d),
        );
        const km = days.length
          ? Math.ceil((p.minWeekKm / days.length) * 10) / 10
          : 0;
        return {
          model: "fixture-no-provider-call",
          content: {
            summary: "Deterministic integration fixture; no AI call",
            workouts: p.dates.map((date) => {
              const run =
                days.includes(date) && p.maxWeekKm >= 0.5 && km >= 0.5;
              return {
                date,
                kind: run ? "easy" : "rest",
                title: run ? "Fixture running" : "Fixture rest",
                purpose: "Integration validation",
                distanceKm: run ? km : 0,
                paceSecondsPerKm: run ? 350 : null,
                effort: run ? "conversational" : "rest",
                steps: run
                  ? [
                      {
                        kind: "steady",
                        distanceMeters: Math.round(km * 1000),
                        paceSecondsPerKm: 350,
                        repetitions: 1,
                        recoveryMeters: 0,
                        recoverySeconds: null,
                        recoveryAfterLast: false,
                      },
                    ]
                  : [],
              };
            }),
          },
        };
      },
    },
  });
  const result = await service.generatePlan(uid, "next");
  assert.ok(result.plan);
  await ps.savePlan(...lastSave); // Replay the committed RPC: no new inference or replacement.
  assert.equal(await ps.generationState(uid, lastSave[0]), "completed");
  assert.equal(result.inputsChanged, false);
  await service.generatePlan(uid, "next");
  assert.equal(calls, 1);
  const runningWorkout = result.plan.workouts.find((w) => w.kind !== "rest");
  check(
    await db
      .from("workouts")
      .update({ kind: "recovery" })
      .eq("id", runningWorkout.id),
  );
  const matched = await matchingStorage.reconcileWorkoutMatches(
    uid,
    result.plan.id,
  );
  assert.ok(matched.has(runningWorkout.id));
  const executionBefore = await ps.revision(uid);
  check(
    await db
      .from("workouts")
      .update({
        manual_completed_at: new Date().toISOString(),
        status: "completed",
      })
      .eq("id", runningWorkout.id),
  );
  assert.notEqual(
    await ps.revision(uid),
    executionBefore,
    "confirmed execution must invalidate a reserved input snapshot",
  );
  assert.equal((await ps.readPlan(uid, "next")).inputsChanged, true);
  const revisionBefore = await ps.revision(uid);
  check(
    await db
      .from("training_generation_requests")
      .update({ started_at: new Date(Date.now() - 120000).toISOString() })
      .eq("user_id", uid),
  );
  const claim = await ps.reserveGeneration(
    uid,
    result.plan.startsOn,
    revisionBefore,
  );
  assert.equal(claim.state, "started");
  const withPain = {
    ...loaded.goal,
    condition: { reportedOn: today, feeling: "pain" },
  };
  await storage.saveTrainingGoal(uid, withPain, loaded.revision);
  assert.notEqual(await ps.revision(uid), revisionBefore);
  await assert.rejects(
    ps.savePlan(
      claim.requestId,
      { summary: "CAS fixture", workouts: [] },
      "fixture-no-call",
      timezone,
      null,
    ),
    /input_changed/,
  );
  await ps.failGeneration(claim.requestId, "input_changed", null);
  const paused = await inputs.readPrescriptionPreview(uid, "next");
  assert.equal(paused.limits.maxWeekKm, 0);
  assert.equal(paused.guidance.condition.requiresRecheck, true);
  const recoveryRace = {
    ...races[1],
    date: running.addCalendarDays(today, -20),
  };
  check(
    await db
      .from("profiles")
      .update({
        race_goals: [recoveryRace],
        target_date: recoveryRace.date,
        training_condition: { reportedOn: today, feeling: "normal" },
      })
      .eq("id", uid),
  );
  const recoveryPreview = await inputs.readPrescriptionPreview(uid, "current");
  assert.equal(
    recoveryPreview.guidance.raceCalendar.events[0].phase,
    "recovery",
  );
  assert.ok(
    ["needs_check_in", "gradual_return"].includes(
      recoveryPreview.guidance.raceCalendar.events[0].recoveryState,
    ),
  );
  check(
    await db
      .from("training_generation_requests")
      .update({ started_at: new Date(Date.now() - 120000).toISOString() })
      .eq("user_id", uid),
  );
  const recoveryResult = await service.generatePlan(uid, "current");
  assert.ok(
    recoveryResult.plan,
    "a final past race must not prevent a recovery plan from being saved",
  );
  assert.equal(recoveryResult.inputsChanged, false);
  assert.equal(calls, 2, "only deterministic fixture inference was called");
  check(await db.from("profiles").update({ race_goals: [] }).eq("id", uid));
  check(
    await db
      .from("training_generation_requests")
      .update({ started_at: new Date(Date.now() - 120000).toISOString() })
      .eq("user_id", uid),
  );
  const legacyRecovery = await service.generatePlan(uid, "current");
  assert.ok(
    legacyRecovery.plan,
    "legacy scalar goals also support post-race recovery without rewriting the profile",
  );
  assert.equal(legacyRecovery.inputsChanged, false);
  assert.equal(calls, 3);
  console.log(
    "PASS: real DB multi-goal save/CAS, evidence preview, mocked inference + atomic plan save/reuse, recovery matching, condition gating and post-final-race plan persistence. Actual OpenAI calls: 0.",
  );
} finally {
  if (uid) {
    check(await db.from("training_plans").delete().eq("user_id", uid));
    check(await db.from("weekly_training_reviews").delete().eq("user_id", uid));
    check(await db.from("activities").delete().eq("user_id", uid));
    check(
      await db.from("training_generation_requests").delete().eq("user_id", uid),
    );
    check(await db.auth.admin.deleteUser(uid));
  }
}
