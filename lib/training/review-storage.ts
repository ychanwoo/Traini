import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { addCalendarDays } from "@/lib/garmin/running-summary";
import { readTrainingContext } from "./storage";
import { reconcileWorkoutMatches } from "./matching-storage";
import {
  buildReviewMetrics,
  parseReviewSnapshot,
  reviewPeriod,
  ReviewError,
  validateReview,
  type AppliedReview,
  type ReviewMetrics,
  type ReviewContent,
} from "./weekly-review";
const timeout = () => AbortSignal.timeout(15_000);
export async function reviewSnapshot(
  userId: string,
  start: string,
  timezone: string,
) {
  const { data, error } = await getSupabaseAdmin()
    .rpc("weekly_review_snapshot", {
      p_user_id: userId,
      p_starts_on: start,
      p_timezone: timezone,
    })
    .abortSignal(timeout());
  if (error)
    throw new ReviewError(
      error.message.includes("review_period")
        ? "review_period"
        : "review_storage",
    );
  return parseReviewSnapshot(data);
}
export async function reviewInputs(userId: string, start?: string | null) {
  const period = reviewPeriod(
    process.env.TRAINI_TIMEZONE ?? "America/Los_Angeles",
    start,
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    let before = await reviewSnapshot(userId, period.startsOn, period.timezone);
    if (before.source.planId) {
      await reconcileWorkoutMatches(userId, before.source.planId);
      before = await reviewSnapshot(userId, period.startsOn, period.timezone);
    }
    const context = await readTrainingContext(
      userId,
      new Date(`${addCalendarDays(period.startsOn, 7)}T12:00:00Z`),
    );
    const after = await reviewSnapshot(
      userId,
      period.startsOn,
      period.timezone,
    );
    if (before.revision === after.revision)
      return {
        period,
        snapshot: after,
        context,
        metrics: buildReviewMetrics(after, context),
      };
  }
  throw new ReviewError("review_changed");
}
export async function readReview(userId: string, start?: string | null) {
  const inputs = await reviewInputs(userId, start),
    db = getSupabaseAdmin();
  const { data, error } = await db
    .from("weekly_training_reviews")
    .select("id,input_revision,metrics,content,model,created_at")
    .eq("user_id", userId)
    .eq("starts_on", inputs.period.startsOn)
    .eq("timezone", inputs.period.timezone)
    .abortSignal(timeout())
    .maybeSingle();
  if (error) throw new ReviewError("review_storage");
  const { data: job, error: jobError } = await db
    .from("training_generation_requests")
    .select("state,lease_expires_at,failure_code")
    .eq("user_id", userId)
    .eq("kind", "review")
    .eq("starts_on", inputs.period.startsOn)
    .order("started_at", { ascending: false })
    .limit(1)
    .abortSignal(timeout())
    .maybeSingle();
  if (jobError) throw new ReviewError("review_storage");
  const generating =
    job?.state === "running" && Date.parse(job.lease_expires_at) > Date.now();
  return {
    latestStartsOn: reviewPeriod(inputs.period.timezone).startsOn,
    period: inputs.period,
    metrics: inputs.metrics,
    review: data
      ? {
          id: data.id,
          content: validateReview(data.content, data.metrics as ReviewMetrics),
          metrics: data.metrics as ReviewMetrics,
          model: data.model,
          createdAt: data.created_at,
          fresh: data.input_revision === inputs.snapshot.revision,
        }
      : null,
    generating,
    generationError:
      job?.state === "failed"
        ? job.failure_code
        : job?.state === "running" && !generating
          ? "interrupted"
          : null,
  };
}
export type ReviewState = Awaited<ReturnType<typeof readReview>>;
export async function readApplicableReview(
  userId: string,
  timezone: string,
): Promise<AppliedReview | null> {
  const period = reviewPeriod(timezone);
  const { data, error } = await getSupabaseAdmin()
    .from("weekly_training_reviews")
    .select("id,starts_on,input_revision,metrics,content")
    .eq("user_id", userId)
    .eq("starts_on", period.startsOn)
    .eq("timezone", timezone)
    .abortSignal(timeout())
    .maybeSingle();
  if (error) throw new ReviewError("review_storage");
  if (!data) return null;
  const snapshot = await reviewSnapshot(userId, period.startsOn, timezone);
  if (snapshot.revision !== data.input_revision) return null;
  const content = validateReview(data.content, data.metrics as ReviewMetrics);
  return {
    id: data.id,
    startsOn: data.starts_on,
    revision: data.input_revision,
    summary: content.summary,
    nextWeek: content.nextWeek,
  };
}
export async function reserveReview(
  userId: string,
  start: string,
  timezone: string,
  revision: string,
) {
  const { data, error } = await getSupabaseAdmin()
    .rpc("begin_weekly_review", {
      p_user_id: userId,
      p_starts_on: start,
      p_timezone: timezone,
      p_revision: revision,
    })
    .abortSignal(timeout());
  if (
    error ||
    !data ||
    !["existing", "started", "busy", "limited"].includes(data.state)
  )
    throw new ReviewError(
      error?.message.includes("review_changed")
        ? "review_changed"
        : "review_storage",
    );
  return data as { state: string; requestId?: string };
}
export async function saveReview(
  requestId: string,
  timezone: string,
  metrics: ReviewMetrics,
  content: ReviewContent,
  model: string,
  usage: unknown,
) {
  const { error } = await getSupabaseAdmin()
    .rpc("finish_weekly_review", {
      p_request_id: requestId,
      p_timezone: timezone,
      p_metrics: metrics,
      p_content: content,
      p_model: model,
      p_usage: usage,
    })
    .abortSignal(timeout());
  if (error)
    throw new ReviewError(
      error.message.includes("review_changed")
        ? "review_changed"
        : "review_storage",
    );
}
export async function failReview(
  requestId: string,
  code: string,
  usage: unknown,
) {
  const { error } = await getSupabaseAdmin()
    .rpc("fail_training_generation", {
      p_request_id: requestId,
      p_code: code,
      p_usage: usage,
    })
    .abortSignal(timeout());
  if (error) throw new ReviewError("review_storage");
}
