import "server-only";
import { generateWithSubscription } from "@/scripts/lib/chatgpt-inference.mjs";
import {
  readReview,
  reviewInputs,
  reserveReview,
  saveReview,
  failReview,
  generationState,
} from "./review-storage";
import { ReviewError, reviewPrompt, validateReview } from "./weekly-review";
export async function generateReview(userId: string, start?: string | null) {
  const existing = await readReview(userId, start);
  if (existing.closeout && !existing.closeout.fresh) throw new ReviewError("closeout_changed");
  if (existing.review?.fresh) return existing;
  const { period, snapshot, context, metrics } = await reviewInputs(
    userId,
    start,
  );
  if (!metrics.hasPlan && !metrics.activityCount)
    throw new ReviewError("review_history");
  const claim = await reserveReview(
    userId,
    period.startsOn,
    period.timezone,
    snapshot.revision,
  );
  if (claim.state === "existing") return readReview(userId, period.startsOn);
  if (claim.state !== "started" || !claim.requestId)
    throw new ReviewError(claim.state);
  let usage: unknown = null;
  let saveAttempted = false;
  try {
    const result = await generateWithSubscription(
      userId,
      reviewPrompt(metrics, context),
      (value: unknown) => {
        usage = value;
      },
    );
    const content = validateReview(result.content, metrics);
    saveAttempted = true;
    await saveReview(
      claim.requestId,
      period.timezone,
      metrics,
      content,
      result.model,
      usage,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "generation";
    const safe = [
      "review_changed",
      "review_storage",
      "invalid_review",
      "network",
      "local_runtime",
      "limited",
      "model",
      "reconnect",
      "permission",
      "incomplete",
      "refusal",
      "output_limit",
      "busy",
      "provider",
      "stream",
      "stream_type",
      "stream_json",
      "stream_delta",
      "stream_terminal",
      "stream_tail",
      "stream_text",
    ].includes(code)
      ? code
      : "generation";
    if (saveAttempted) {
      let state: string | null = null;
      try {
        state = await generationState(userId, claim.requestId);
      } catch {
        throw new ReviewError("review_storage");
      }
      if (state === "completed") return readReview(userId, period.startsOn);
    }
    await failReview(claim.requestId, safe, usage).catch(() => {});
    throw new ReviewError(safe);
  }
  return readReview(userId, period.startsOn);
}
