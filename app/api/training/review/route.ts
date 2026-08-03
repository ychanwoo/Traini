import { getRecoveryLabel } from "@/lib/algorithms/fatigue";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { GarminSnapshot } from "@/types/garmin";

export async function POST(request: Request) {
  const { userId } = await request.json() as { userId?: string };
  if (!userId) return Response.json({ error: "userId is required." }, { status: 400 });

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("garmin_snapshots").select("*").eq("user_id", userId).order("recorded_on", { ascending: false }).limit(1).single();
    if (error || !data) return Response.json({ error: "No Garmin snapshot exists for this user." }, { status: 404 });
    const snapshot: GarminSnapshot = { vo2Max: data.vo2_max, averageHeartRate: data.average_heart_rate, averagePaceSecondsPerKm: data.average_pace_seconds_per_km, sleepScore: data.sleep_score, hrvStatus: data.hrv_status, weeklyDistanceKm: data.weekly_distance_km, updatedAt: data.created_at };
    const recovery = getRecoveryLabel(snapshot);
    const adjustment = recovery === "좋음" ? "다음 주 거리와 페이스를 최대 6% 상향할 수 있어요." : "다음 주 고강도 훈련 1회를 가벼운 조깅으로 변경하세요.";
    return Response.json({ recovery, adjustment, shouldReduceIntensity: recovery !== "좋음" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not review training." }, { status: 500 });
  }
}
