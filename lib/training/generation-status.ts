import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
export type GenerationStatus = {
  checkedAt: string;
  quota: {
    limit: number;
    used: number;
    remaining: number;
    retryAt: string | null;
  };
  active: {
    kind: "plan" | "review";
    startsOn: string;
    leaseExpiresAt: string;
  } | null;
};
export async function readGenerationStatus(
  userId: string,
): Promise<GenerationStatus> {
  const { data, error } = await getSupabaseAdmin()
    .rpc("training_generation_status", { p_user_id: userId })
    .abortSignal(AbortSignal.timeout(15_000));
  if (error || !data?.quota || !Number.isSafeInteger(data.quota.remaining))
    throw new Error("storage");
  return data as GenerationStatus;
}
