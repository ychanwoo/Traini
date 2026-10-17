import "server-only";
import { readTrainingContext } from "./storage";
import { readRunningSummary } from "@/lib/garmin/read-running-summary";
import { readPlan, revision } from "./plan-storage";
import { reviewSnapshot } from "./review-storage";
import { addCalendarDays } from "@/lib/garmin/running-summary";
import { buildProgressInsights } from "./progress";
export class ProgressError extends Error {}
/** Read only: no reconciliation, inference, or generation reservation in this service. */
export async function readProgressInsights(userId: string, now = new Date()) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await revision(userId);
    const context = await readTrainingContext(userId, now);
    const [current, plan, snapshots] = await Promise.all([
      readRunningSummary(userId, "current", now, { verifiedOnly: true }),
      readPlan(userId, "current", now, { reconcile: false }),
      Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          reviewSnapshot(
            userId,
            addCalendarDays(context.history.start, i * 7),
            context.timezone,
          ),
        ),
      ),
    ]);
    if (before !== (await revision(userId))) continue;
    return buildProgressInsights(
      context,
      current,
      snapshots,
      plan.plan,
      plan.inputsChanged,
    );
  }
  throw new ProgressError("progress_changed");
}
