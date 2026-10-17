import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { FeedbackError, type FeedbackInput } from "./workout-feedback";
export async function saveWorkoutFeedback(
  userId: string,
  input: FeedbackInput,
) {
  const { data, error } = await getSupabaseAdmin()
    .rpc("save_workout_feedback", {
      p_user_id: userId,
      p_input: input,
    })
    .abortSignal(AbortSignal.timeout(15_000));
  if (error)
    throw new FeedbackError(
      [
        "feedback_input",
        "feedback_changed",
        "feedback_linked",
        "feedback_workout",
      ].find((code) => error.message.includes(code)) ?? "feedback_storage",
    );
  return data;
}
