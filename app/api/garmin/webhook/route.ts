import { timingSafeEqual } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type GarminWebhook = {
  userId?: string;
  snapshot?: { vo2Max?: number; averageHeartRate?: number; averagePaceSecondsPerKm?: number; sleepScore?: number; hrvStatus?: "low" | "normal" | "high"; weeklyDistanceKm?: number; recordedOn?: string };
  activity?: { id: string | number; type?: string; startedAt?: string; distanceMeters?: number; durationSeconds?: number; averageHeartRate?: number; averagePaceSecondsPerKm?: number };
};

export async function POST(request: Request) {
  const expectedSecret = process.env.GARMIN_WEBHOOK_SECRET;
  const receivedSecret = request.headers.get("x-traini-webhook-secret");
  const expected = expectedSecret ? Buffer.from(expectedSecret) : null;
  const received = receivedSecret ? Buffer.from(receivedSecret) : null;
  if (!expected || !received || expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return Response.json({ error: "Unauthorized webhook." }, { status: 401 });
  }

  try {
    const payload = await request.json() as GarminWebhook;
    if (!payload.userId) return Response.json({ error: "Webhook payload requires a mapped Traini userId." }, { status: 400 });
    const supabase = getSupabaseAdmin();

    if (payload.snapshot) {
      const snapshot = payload.snapshot;
      const { error } = await supabase.from("garmin_snapshots").upsert({ user_id: payload.userId, recorded_on: snapshot.recordedOn ?? new Date().toISOString().slice(0, 10), vo2_max: snapshot.vo2Max ?? null, average_heart_rate: snapshot.averageHeartRate ?? null, average_pace_seconds_per_km: snapshot.averagePaceSecondsPerKm ?? null, sleep_score: snapshot.sleepScore ?? null, hrv_status: snapshot.hrvStatus ?? null, weekly_distance_km: snapshot.weeklyDistanceKm ?? null, raw_payload: payload }, { onConflict: "user_id,recorded_on" });
      if (error) throw error;
    }

    if (payload.activity) {
      const activity = payload.activity;
      const { error } = await supabase.from("activities").upsert({ user_id: payload.userId, garmin_activity_id: String(activity.id), activity_type: activity.type ?? "running", started_at: activity.startedAt ?? new Date().toISOString(), distance_meters: activity.distanceMeters ?? null, duration_seconds: activity.durationSeconds ?? null, average_heart_rate: activity.averageHeartRate ?? null, average_pace_seconds_per_km: activity.averagePaceSecondsPerKm ?? null, raw_payload: payload }, { onConflict: "user_id,garmin_activity_id" });
      if (error) throw error;
    }

    return Response.json({ received: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Webhook processing failed." }, { status: 500 });
  }
}
