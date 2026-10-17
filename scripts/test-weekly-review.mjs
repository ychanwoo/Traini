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
    await db
      .from("profiles")
      .upsert({
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
    await db
      .from("activities")
      .insert(
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
  let calls = 0;
  let lostResponse = true, lastSave;
  const service = load("lib/training/review-service.ts", {
    "server-only": {},
    "./review-storage": {...rs, saveReview: async (...args) => {
      lastSave = args;
      await rs.saveReview(...args);
      if (lostResponse) {lostResponse=false;throw new review.ReviewError("review_storage");}
    }},
    "./weekly-review": review,
    "@/scripts/lib/chatgpt-inference.mjs": {
      generateWithSubscription: async (_owner, prompt, onUsage) => {
        calls++;
        const m = JSON.parse(prompt.input[0].content).metrics;
        onUsage({ inputTokens: 1, outputTokens: 1 });
        return {
          model: "fixture-model-no-provider-call",
          content: {
            summary: "통합 테스트용 리뷰입니다.",
            observations: [
              {
                topic: "volume",
                evidence: ["actualKm"],
                text: "기록된 주간 거리로 평가합니다.",
              },
            ],
            nextWeek: {
              direction: "maintain",
              volumeChangePercent: 0,
              maxQualitySessions: 2,
              rationale: "관측된 훈련량을 유지합니다.",
            },
            limitations: m.limitations,
          },
        };
      },
    },
  });
  const before = check(
    await db.rpc("training_input_revision", { p_user_id: uid }),
  );
  const result = await service.generateReview(uid);
  await rs.saveReview(...lastSave);
  assert.equal(await rs.generationState(uid,lastSave[0]), "completed");
  assert.equal(result.metrics.actualKm, 28);
  assert.equal(result.review.fresh, true);
  assert.equal(result.review.metrics.plannedKm, null);
  assert.equal(result.metrics.priorWeeks, 3);
  assert.notEqual(
    check(await db.rpc("training_input_revision", { p_user_id: uid })),
    before,
  );
  await service.generateReview(uid);
  assert.equal(calls, 1);
  // Source plan matching is also verified using real FIT-provenance activity fixtures.
  const sourcePlan = check(
    await db
      .from("training_plans")
      .insert({
        user_id: uid,
        starts_on: period.startsOn,
        ends_on: period.endsOn,
        target_distance_km: 16,
        recovery_label: "fixture",
        source_version: 1,
        summary: "fixture",
        timezone,
        model: "fixture",
        input_revision: "fixture",
      })
      .select("id")
      .single(),
  );
  check(
    await db.from("workouts").insert(
      [
        { day: 0, kind: "easy", km: 7 },
        { day: 1, kind: "easy", km: 2, manual: true },
        { day: 3, kind: "easy", km: 7 },
        { day: 4, kind: "rest", km: 0 },
      ].map((w) => ({
        plan_id: sourcePlan.id,
        scheduled_on: running.addCalendarDays(period.startsOn, w.day),
        kind: w.kind,
        status: w.manual ? "completed" : "scheduled",
        manual_completed_at: w.manual
          ? `${running.addCalendarDays(period.startsOn, w.day)}T20:00:00Z`
          : null,
        title: "Fixture",
        purpose: "Fixture",
        distance_km: w.km,
        effort: w.kind === "rest" ? "rest" : "conversational",
        steps: [],
      })),
    ),
  );
  const matched = await rs.readReview(uid);
  assert.equal(matched.review.fresh, false);
  assert.equal(matched.metrics.garminCompleted, 1);
  assert.equal(matched.metrics.manualCompleted, 1);
  assert.equal(matched.metrics.unconfirmed, 1);
  assert.equal(matched.metrics.additionalRuns, 1);
  assert.equal(matched.metrics.unassignedRuns, 2);
  check(
    await db
      .from("training_generation_requests")
      .update({ started_at: new Date(Date.now() - 120000).toISOString() })
      .eq("user_id", uid),
  );
  const updated = await service.generateReview(uid);
  assert.equal(updated.review.fresh, true);
  assert.equal(updated.review.id, result.review.id);
  assert.equal(updated.review.metrics.plannedKm, 16);
  assert.equal(calls, 2);
  const applicable = await rs.readApplicableReview(uid, timezone);
  assert.equal(applicable.id, result.review.id);
  // Exercise the real plan transaction and preserve immutable review provenance.
  check(
    await db
      .from("training_generation_requests")
      .update({ started_at: new Date(Date.now() - 120000).toISOString() })
      .eq("user_id", uid),
  );
  const next = running.runningPeriod(timezone, "current");
  const start = running.addCalendarDays(next.start, 7);
  const claim = check(
    await db.rpc("begin_training_generation", {
      p_user_id: uid,
      p_starts_on: start,
      p_revision: check(
        await db.rpc("training_input_revision", { p_user_id: uid }),
      ),
    }),
  );
  assert.equal(claim.state, "started");
  const planId = check(
    await db.rpc("finish_training_generation", {
      p_request_id: claim.requestId,
      p_timezone: timezone,
      p_model: "fixture-no-provider",
      p_usage: {},
      p_content: {
        summary: "Fixture review-aware plan",
        workouts: [
          {
            date: start,
            kind: "easy",
            title: "Fixture",
            purpose: "Fixture",
            distanceKm: 7,
            paceSecondsPerKm: 330,
            effort: "conversational",
            steps: [],
          },
        ],
      },
    }),
  );
  const plan = check(
    await db
      .from("training_plans")
      .select("review_id,review_context")
      .eq("id", planId)
      .single(),
  );
  assert.equal(plan.review_id, result.review.id);
  assert.equal(plan.review_context.revision, applicable.revision);
  check(
    await db
      .from("activities")
      .update({ distance_meters: 8000 })
      .eq("user_id", uid)
      .eq("garmin_activity_id", "90000000"),
  );
  const stale = await rs.readReview(uid);
  assert.equal(stale.review.fresh, false);
  assert.equal(stale.review.metrics.actualKm, 28);
  assert.equal(stale.metrics.actualKm, 29);
  assert.equal(await rs.readApplicableReview(uid, timezone), null);
  console.log(
    "weekly review DB integration passed: real snapshot/context, deterministic model fixture, save/reuse, plan revision/provenance, stale review preservation. No real provider call.",
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
