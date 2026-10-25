import "server-only";
import { readReview } from "./review-storage";
import { readTrainingContext } from "./storage";
import { readPlan, revision } from "./plan-storage";
import { buildCoachingFeedback } from "./coaching-feedback";
import { addCalendarDays } from "@/lib/garmin/running-summary";
import type { WeekComparison } from "./review-presentation";
import { dateInZone } from "@/lib/garmin/running-summary";

/** No inference or plan writes. A failed current-state read must not hide history. */
export async function readCoachingReview(
  userId: string,
  start?: string | null,
) {
  const before = await revision(userId).catch(() => null);
  const state = await readReview(userId, start);
  const previousWeek: WeekComparison | null = await readReview(userId, addCalendarDays(state.period.startsOn, -7)).then(previous => ({
    startsOn: previous.period.startsOn, endsOn: previous.period.endsOn,
    actualKm: previous.metrics.actualKm, activityCount: previous.metrics.activityCount,
    distanceComplete: previous.metrics.activityCount > 0 && previous.metrics.distanceKnown === previous.metrics.activityCount,
  })).catch(() => null);
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
          previousWeek,
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
    previousWeek: null,
    coaching: buildCoachingFeedback(state, {
      today: dateInZone(new Date(), state.period.timezone),
      condition: undefined,
    }),
  };
}
export type CoachingReviewState = Awaited<
  ReturnType<typeof readCoachingReview>
>;
