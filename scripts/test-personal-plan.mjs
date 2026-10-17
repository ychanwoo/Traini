import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { withLocalAdminSession } from "./lib/local-admin-session.mjs";
import { auditSavedPlan } from "./lib/plan-acceptance.mjs";

function load(file, modules = {}) {
  const context = {
    exports: {},
    Date,
    Intl,
    require: (name) => {
      if (!(name in modules)) throw new Error("Unexpected validation module");
      return modules[name];
    },
  };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2023,
        },
      },
    ).outputText,
    context,
  );
  return context.exports;
}
const goal = load("lib/training/goal.ts");
const { validatePrescription } = load("lib/training/prescription.ts", {
  "./goal": goal,
});

// GETs only: no inference, generation reservation, feedback or preference writes.
await withLocalAdminSession(async ({ request, service, uid, check }) => {
  const snapshot = async () => ({
    profiles: check(
      await service
        .from("profiles")
        .select(
          "race_goals,training_days,long_run_day,training_condition,training_baseline",
        )
        .eq("id", uid),
    ),
    plans: check(
      await service
        .from("training_plans")
        .select("id,summary,generation_id,created_at,input_revision")
        .eq("user_id", uid)
        .order("id"),
    ),
    generations: check(
      await service
        .from("training_generation_requests")
        .select("id,state")
        .eq("user_id", uid)
        .order("id"),
    ),
  });
  const before = await snapshot();
  const quotaBefore = await request("/api/training/generation-status");
  const revisionBefore = check(
    await service.rpc("training_input_revision", { p_user_id: uid }),
  );
  const context = await request("/api/training/context");
  const summary = await request("/api/garmin/weekly-summary?week=current");
  assert.equal(context.history.requestedWeeks, 8);
  assert.equal(context.history.weeks.length, 8);
  assert.ok(
    context.history.end < summary.period.start,
    "History must contain completed weeks only",
  );
  assert.equal(context.timezone, summary.period.timezone);
  assert.equal(context.inputs.assessment, "input_completeness_only");
  const reports = {};
  for (const week of ["current", "next"]) {
    const result = await request(`/api/training/plan?week=${week}`);
    const preview = await request(`/api/training/prescription?week=${week}`);
    assert.equal(preview.period.timezone, context.timezone);
    assert.deepEqual(
      preview.guidance.goals.map((race) =>
        Object.fromEntries(
          Object.entries(race).filter(([key]) => key !== "targetPaceSecondsPerKm"),
        ),
      ),
      context.goal.races,
    );
    assert.equal(
      preview.guidance.condition?.feeling ?? null,
      context.goal.condition?.feeling ?? null,
    );
    if (preview.guidance.condition?.requiresRecheck) {
      assert.equal(preview.limits.maxWeekKm, 0);
      assert.equal(preview.limits.maxRunKm, 0);
      assert.equal(preview.limits.maxHardSessions, 0);
    }
    const audit = auditSavedPlan(
      result,
      context,
      preview,
      validatePrescription,
    );
    assert.notEqual(
      audit.state,
      "invalid",
      `Fresh ${week} plan violates current constraints: ${audit.issues.join(",")}`,
    );
    reports[week] = audit;
  }
  assert.equal(
    check(await service.rpc("training_input_revision", { p_user_id: uid })),
    revisionBefore,
    "Inputs changed during audit; rerun explicitly",
  );
  assert.deepEqual(
    await snapshot(),
    before,
    "Existing goals and plans must remain unchanged",
  );
  const quotaAfter = await request("/api/training/generation-status");
  assert.ok(
    quotaAfter.quota.used <= quotaBefore.quota.used,
    "Audit must not reserve AI usage",
  );
  const requiresPlanRefresh = Object.values(reports).some(
    (r) => r.state !== "validated",
  );
  console.log(
    JSON.stringify(
      {
        checkedOn: context.asOfDate,
        historyWeeks: context.history.requestedWeeks,
        historyActivities: context.history.activityCount,
        currentWeekActivities: summary.totals.activityCount,
        condition: previewCondition(context),
        plans: reports,
        result: requiresPlanRefresh ? "action_required" : "validated",
        aiCalls: 0,
        existingGoalsAndPlansPreserved: true,
        note: "Stale plans are retained historical content, not validated current prescriptions. This audit is not medical clearance.",
      },
      null,
      2,
    ),
  );
  if (requiresPlanRefresh) process.exitCode = 2;
});
function previewCondition(context) {
  return context.goal.condition ? "reported" : "unknown";
}
