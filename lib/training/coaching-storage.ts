import "server-only";
import { readReview } from "./review-storage";
import { readTrainingContext } from "./storage";
import { readPlan, revision } from "./plan-storage";
import { buildCoachingFeedback } from "./coaching-feedback";
import { dateInZone } from "@/lib/garmin/running-summary";

/** No inference or plan writes. A failed current-state read must not hide history. */
export async function readCoachingReview(
  userId: string,
  start?: string | null,
) {
  const before = await revision(userId).catch(() => null);
  const state = await readReview(userId, start);
  if (before !== null) {
    try {
      const now = new Date();
      const [context, current, next] = await Promise.all([
        readTrainingContext(userId, now),
        readPlan(userId, "current", now, { reconcile: false }),
        readPlan(userId, "next", now, { reconcile: false }),
      ]);
      if (
        before === (await revision(userId)) &&
        current.period.today === context.asOfDate &&
        next.period.today === context.asOfDate
      )
        return {
          ...state,
          coaching: buildCoachingFeedback(state, {
            today: context.asOfDate,
            condition: context.goal.condition,
            current,
            next,
          }),
        };
    } catch {
      // Keep the independently validated weekly history available.
    }
  }
  return {
    ...state,
    coaching: buildCoachingFeedback(state, {
      today: dateInZone(new Date(), state.period.timezone),
      condition: undefined,
    }),
  };
}
export type CoachingReviewState = Awaited<
  ReturnType<typeof readCoachingReview>
>;
