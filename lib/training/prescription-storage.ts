import "server-only";
import { reviewInputs } from "./review-storage";
import { readRunningSummary } from "@/lib/garmin/read-running-summary";
import { readTrainingContext } from "./storage";
import { revision } from "./plan-storage";
import {
  planPolicy,
  accountCurrentWeek,
  PlanError,
  type PlanWeek,
} from "./weekly-plan";
import { readApplicableReview } from "./review-storage";
import { applyReviewPolicy } from "./weekly-review";
import { refinePrescription } from "./prescription";
export async function readPrescriptionEvidence(userId: string) {
  const previous = await reviewInputs(userId);
  const current = await readRunningSummary(userId, "current");
  return { execution: previous.metrics, current };
}
export async function readPrescriptionPreview(userId: string, week: PlanWeek) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await revision(userId),
      context = await readTrainingContext(userId),
      evidence = await readPrescriptionEvidence(userId),
      review = await readApplicableReview(userId, context.timezone);
    const result = refinePrescription(
      context,
      applyReviewPolicy(planPolicy(context, week, evidence.current), review),
      evidence.execution,
      evidence.current,
    );
    if (week === "current")
      result.policy = accountCurrentWeek(
        result.policy,
        evidence.current,
      ) as typeof result.policy;
    if (before === (await revision(userId)))
      return {
        week,
        period: {
          start: result.policy.start,
          end: result.policy.end,
          timezone: result.policy.timezone,
        },
        guidance: result.guidance,
        limits: {
          maxWeekKm: result.policy.maxWeekKm,
          maxRunKm: result.policy.maxRunKm,
          maxHardSessions: result.policy.maxHardSessions,
        },
      };
  }
  throw new PlanError("input_changed");
}
