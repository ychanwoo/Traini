import "server-only";
import { readPrescriptionEvidence } from "./prescription-storage";
import { refinePrescription } from "./prescription";
import { readApplicableReview } from "./review-storage";
import { applyReviewPolicy } from "./weekly-review";
import { generateWithSubscription } from "@/scripts/lib/chatgpt-inference.mjs";
import { readTrainingContext } from "./storage";
import {
  readPlan,
  reserveGeneration,
  revision,
  savePlan,
  failGeneration,
  generationState,
} from "./plan-storage";
import {
  planPolicy,
  accountCurrentWeek,
  validatePlan,
  trainingPrompt,
  PlanError,
  type PlanWeek,
} from "./weekly-plan";
export async function generatePlan(userId: string, week: PlanWeek) {
  // Revision around the multi-query read prevents a mixed goal/activity snapshot.
  const before = await revision(userId);
  const existing = await readPlan(userId, week);
  if (existing.plan && !existing.inputsChanged) return existing;
  const evidence = await readPrescriptionEvidence(userId, week);
  const context = await readTrainingContext(userId, new Date(), evidence.closedWeekStart);
  const review = await readApplicableReview(userId, context.timezone, week);
  let policy = applyReviewPolicy(
    planPolicy(context, week, evidence.current),
    review,
  );
  policy = refinePrescription(
    context,
    policy,
    evidence.execution,
    evidence.current,
  ).policy;
  if (week === "current") policy = accountCurrentWeek(policy, evidence.current);
  if (existing.plan) {
    const completed = existing.plan.workouts.filter(
      (w) =>
        w.completed || w.status === "skipped" || (w.feedback?.version ?? 0) > 0,
    );
    policy.blockedDates = [
      ...new Set([...policy.blockedDates, ...completed.map((w) => w.date)]),
    ];
    const available = policy.dates.filter(
      (d) =>
        policy.trainingDays.includes(
          ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1,
        ) && !policy.blockedDates.includes(d),
    ).length;
    policy.minWeekKm = Math.min(
      policy.minWeekKm,
      Math.floor(policy.maxRunKm * available * 0.85 * 10) / 10,
    );
  }
  if (before !== (await revision(userId))) throw new PlanError("input_changed");
  const claim = await reserveGeneration(userId, policy.start, before);
  if (claim.state === "existing") return readPlan(userId, week);
  if (claim.state !== "started" || !claim.requestId)
    throw new PlanError(claim.state);
  let usage: unknown = null;
  let saveAttempted = false;
  try {
    const result = await generateWithSubscription(
      userId,
      trainingPrompt(context, policy, review),
      (value: unknown) => {
        usage = value;
      },
    );
    const content = validatePlan(result.content, policy);
    saveAttempted = true;
    await savePlan(
      claim.requestId,
      content,
      result.model,
      context.timezone,
      usage,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "generation";
    // Keep a bounded code only; never persist provider messages, input text or credentials.
    const safe = [
      "network",
      "local_runtime",
      "limited",
      "model",
      "reconnect",
      "permission",
      "invalid_output",
      "input_changed",
      "stream",
      "stream_type",
      "stream_json",
      "stream_delta",
      "stream_terminal",
      "stream_tail",
      "stream_text",
      "incomplete",
      "refusal",
      "storage",
      "busy",
      "provider",
      "output_limit",
    ].includes(code)
      ? code
      : "generation";
    // A timed-out response does not prove the transaction rolled back.
    // If the outcome cannot be read, keep its lease rather than permit another paid request.
    if (saveAttempted) {
      let state: string | null = null;
      try {
        state = await generationState(userId, claim.requestId);
      } catch {
        throw new PlanError("storage");
      }
      if (state === "completed") return readPlan(userId, week);
    }
    await failGeneration(claim.requestId, safe, usage).catch(() => {});
    throw new PlanError(safe);
  }
  // A read failure after commit must never be recorded as a generation failure.
  return readPlan(userId, week);
}
