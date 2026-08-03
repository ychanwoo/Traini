import { createAdaptivePlan } from "@/lib/services/training";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getWeather } from "@/lib/services/weather";
import type { GarminSnapshot } from "@/types/garmin";

type GenerateRequest = { userId: string; startDate?: string; latitude?: number; longitude?: number };

export async function POST(request: Request) {
  const body = await request.json() as GenerateRequest;
  if (!body.userId) return Response.json({ error: "userId is required." }, { status: 400 });

  try {
    const supabase = getSupabaseAdmin();
    const { data: snapshot, error } = await supabase.from("garmin_snapshots").select("*").eq("user_id", body.userId).order("recorded_on", { ascending: false }).limit(1).single();
    if (error || !snapshot) return Response.json({ error: "No Garmin snapshot exists for this user." }, { status: 404 });

    const weather = Number.isFinite(body.latitude) && Number.isFinite(body.longitude)
      ? await getWeather(body.latitude!, body.longitude!)
      : undefined;
    const plan = createAdaptivePlan({ snapshot: {
      vo2Max: snapshot.vo2_max, averageHeartRate: snapshot.average_heart_rate, averagePaceSecondsPerKm: snapshot.average_pace_seconds_per_km,
      sleepScore: snapshot.sleep_score, hrvStatus: snapshot.hrv_status, weeklyDistanceKm: snapshot.weekly_distance_km, updatedAt: snapshot.created_at,
    } as GarminSnapshot, startDate: body.startDate, weather });
    const startsOn = plan.workouts[0].date;
    const endsOn = plan.workouts.at(-1)?.date ?? startsOn;
    const { data: storedPlan, error: planError } = await supabase.from("training_plans").upsert({ user_id: body.userId, starts_on: startsOn, ends_on: endsOn, target_distance_km: plan.targetDistanceKm, recovery_label: snapshot.sleep_score < 60 ? "회복 권장" : "좋음" }, { onConflict: "user_id,starts_on" }).select("id").single();
    if (planError || !storedPlan) throw planError ?? new Error("Could not save training plan.");

    await supabase.from("workouts").delete().eq("plan_id", storedPlan.id);
    const { error: workoutsError } = await supabase.from("workouts").insert(plan.workouts.map(({ id: _id, date, ...workout }) => ({ plan_id: storedPlan.id, scheduled_on: date, ...workout })));
    if (workoutsError) throw workoutsError;
    return Response.json({ plan, weather });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not generate plan." }, { status: 500 });
  }
}
