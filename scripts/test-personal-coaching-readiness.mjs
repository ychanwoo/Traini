// Real imports are opt-in. Training generation endpoints are never called here.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { withLocalAdminSession } from "./lib/local-admin-session.mjs";
import {
  verifyReviewEvidence,
  verifyCyclePeriods,
} from "./lib/weekly-cycle-validation.mjs";
import { auditSavedPlan } from "./lib/plan-acceptance.mjs";
import { typescriptLoader } from "../tests/helpers/load-typescript.mjs";

const options = new Set(process.argv.slice(2));
assert.ok(
  [...options].every((o) => ["--import", "--browser"].includes(o)),
  "Unsupported option",
);
const { validatePrescription } = typescriptLoader()(
  "lib/training/prescription.ts",
);
const report = { imports: [], generationAttempts: 0 };
let phase = "authentication";
await withLocalAdminSession(async ({ request, service, uid, check }) => {
  const snapshot = async () =>
    check(
      await service
        .from("training_plans")
        .select(
          "id,starts_on,summary,generation_id,input_revision,created_at,workouts(id,scheduled_on,kind,title,purpose,distance_km,pace_seconds_per_km,steps,manual_completed_at,feedback_version,workout_assessment,skip_reason)",
        )
        .eq("user_id", uid)
        .order("id"),
    ).map((p) => ({
      ...p,
      workouts: p.workouts.sort((a, b) => a.id.localeCompare(b.id)),
    }));
  const before = await snapshot();
  const requests = async () =>
    check(
      await service
        .from("training_generation_requests")
        .select("id,state")
        .eq("user_id", uid)
        .order("id"),
    );
  const requestsBefore = await requests();
  try {
    for (const week of ["previous", "current"]) {
      phase = "import_" + week;
      let first = null;
      for (let pass = 0; pass < (options.has("--import") ? 2 : 1); pass++) {
        if (options.has("--import")) {
          const status = await request("/api/garmin/sync?week=" + week);
          assert.ok(status.available, "Collector unavailable");
          assert.notEqual(
            status.job?.status,
            "running",
            "Another import is active",
          );
          const oldId = status.job?.id;
          await request("/api/garmin/sync", { method: "POST", body: { week } });
          const deadline = Date.now() + 330000;
          let job;
          while (Date.now() < deadline) {
            const progress = await request("/api/garmin/sync?week=" + week);
            if (
              progress.job?.id !== oldId &&
              progress.job?.status !== "running"
            ) {
              job = progress.job;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
          assert.equal(job?.status, "succeeded", "Import failed or timed out");
          assert.deepEqual(
            job.period,
            status.period,
            "Imported a different week",
          );
          assert.equal(
            job.counts.failed + job.parsing.failed + job.upload.failed,
            0,
            "Partial import",
          );
          if (pass)
            assert.equal(
              job.upload.inserted + job.upload.updated,
              0,
              "Repeat changed uploaded data",
            );
          report.imports.push({
            week,
            repeated: pass === 1,
            failed: 0,
            inserted: job.upload.inserted,
            updated: job.upload.updated,
          });
        }
        const summary = await request(
          "/api/garmin/weekly-summary?week=" + week,
        );
        const rows = summary.activities
          .map((a) => [a.id, a.trainingDate, a.distanceMeters, a.timerSeconds])
          .sort();
        assert.equal(
          new Set(rows.map((a) => a[0])).size,
          rows.length,
          "Duplicate activity",
        );
        if (first)
          assert.deepEqual(rows, first, "Repeated import changed records");
        first = rows;
        if (week === "previous")
          verifyReviewEvidence(summary, await request("/api/training/review"));
      }
    }
    phase = "saved_plan_acceptance";
    const context = await request("/api/training/context");
    const review = await request("/api/training/review");
    const plan = await request("/api/training/plan?week=current");
    const preview = await request("/api/training/prescription?week=current");
    verifyCyclePeriods(context, review, plan);
    const audit = auditSavedPlan(plan, context, preview, validatePrescription);
    assert.notEqual(audit.state, "invalid", "Fresh plan violates prescription");
    const connection = await request("/api/chatgpt/connection");
    report.status =
      audit.state === "validated" && review.review?.fresh
        ? "saved_cycle_validated"
        : "explicit_plan_or_review_action_required";
    report.planState = audit.state;
    report.planIssues = audit.issues;
    report.reviewFresh = !!review.review?.fresh;
    report.connectionReady = !!connection.available && !!connection.connected;
    report.currentRecordCount = context.currentWeek.sessions.length;
    report.performanceAvailable = !!preview.guidance.performance;
    report.requiresExplicitPlanUpdate = !!plan.inputsChanged;
  } finally {
    assert.deepEqual(
      await snapshot(),
      before,
      "Import/read altered prescribed sessions or feedback",
    );
    assert.deepEqual(
      await requests(),
      requestsBefore,
      "Unexpected generation request",
    );
    report.existingPrescriptionsPreserved = true;
  }
  console.log(JSON.stringify(report, null, 2));
}).catch((e) => {
  console.error(
    JSON.stringify({
      status: "readiness_failed",
      phase,
      error: e.name,
      reason: e.operator ? "assertion" : (e.code ?? "request"),
      generationAttempts: 0,
    }),
  );
  process.exitCode = 1;
});
if (!process.exitCode && options.has("--browser")) {
  const child = spawnSync(
    process.execPath,
    [
      "--env-file=.env.local",
      "scripts/test-lap-evidence-plan.mjs",
      "--browser",
    ],
    { stdio: "inherit" },
  );
  if (child.status !== 0) process.exitCode = 1;
}
