import { requireAdmin } from "@/lib/security/admin";
import { readMutation, RequestInputError } from "@/lib/security/json-request";
import {
  parseFeedbackInput,
  feedbackErrorMessage,
  FeedbackError,
} from "@/lib/training/workout-feedback";
import { saveWorkoutFeedback } from "@/lib/training/feedback-storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Authorization",
};
export async function POST(request: Request) {
  const access = await requireAdmin(request);
  if (access.response) {
    for (const [k, v] of Object.entries(headers))
      access.response.headers.set(k, v);
    return access.response;
  }
  try {
    const input = parseFeedbackInput(await readMutation(request));
    return Response.json(
      { feedback: await saveWorkoutFeedback(access.userId, input) },
      { headers },
    );
  } catch (error) {
    if (error instanceof RequestInputError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers },
      );
    const code =
      error instanceof FeedbackError ? error.message : "feedback_storage";
    return Response.json(
      {
        error:
          feedbackErrorMessage[code] ?? feedbackErrorMessage.feedback_storage,
      },
      {
        status:
          code === "feedback_input"
            ? 400
            : code === "feedback_storage"
              ? 503
              : 409,
        headers,
      },
    );
  }
}
