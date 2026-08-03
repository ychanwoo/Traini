import { getRecoveryLabel } from "@/lib/algorithms/fatigue";
import { applyWeatherPaceAdjustment } from "@/lib/algorithms/pace";
import type { GarminSnapshot } from "@/types/garmin";
import type { WeeklyTrainingPlan, Workout, WorkoutKind } from "@/types/training";
import type { WeatherSnapshot } from "./weather";

type PlanInput = { snapshot: GarminSnapshot; startDate?: string; weather?: WeatherSnapshot };

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const plusDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

function workout(date: Date, kind: WorkoutKind, title: string, purpose: string, options: Partial<Workout> = {}): Workout {
  return { id: crypto.randomUUID(), date: isoDate(date), kind, status: "scheduled", title, purpose, ...options };
}

export function createAdaptivePlan({ snapshot, startDate = isoDate(new Date()), weather }: PlanInput): WeeklyTrainingPlan {
  const start = new Date(`${startDate}T00:00:00`);
  const weeklyDistance = snapshot.weeklyDistanceKm ?? 30;
  const recovery = getRecoveryLabel(snapshot);
  const fatigueLimited = recovery !== "좋음";
  const targetDistanceKm = Math.round(weeklyDistance * (fatigueLimited ? 0.9 : 1.06));
  const basePaceSeconds = snapshot.averagePaceSecondsPerKm ?? 360;
  const adjustedPace = weather ? applyWeatherPaceAdjustment(basePaceSeconds, weather.temperatureC, weather.humidityPercent) : basePaceSeconds;
  const pace = `${Math.floor(adjustedPace / 60)}'${String(adjustedPace % 60).padStart(2, "0")}"/km`;
  const workouts: Workout[] = [
    workout(start, "rest", "Recovery Rest", "회복을 위한 완전 휴식"),
    workout(plusDays(start, 1), "easy", "Easy Run 6km", "유산소 기반을 유지하는 가벼운 러닝", { distanceKm: 6, targetPace: pace }),
    fatigueLimited
      ? workout(plusDays(start, 2), "easy", "Recovery Run 5km", "수면과 HRV 회복을 우선하는 조깅", { distanceKm: 5, targetPace: pace })
      : workout(plusDays(start, 2), "threshold", "T-Pace 역치주 8km", "지속 가능한 빠른 페이스 적응", { distanceKm: 8, targetPace: pace, targetHeartRate: "Zone 4" }),
    workout(plusDays(start, 3), "rest", "Recovery Rest", "포인트 훈련 후 회복"),
    workout(plusDays(start, 4), "easy", "Easy Run 7km", "편안한 호흡으로 거리 확보", { distanceKm: 7, targetPace: pace }),
    workout(plusDays(start, 5), "long", `LSD ${Math.max(12, Math.round(targetDistanceKm * 0.42))}km`, "지구력과 연료 사용 효율 강화", { distanceKm: Math.max(12, Math.round(targetDistanceKm * 0.42)), targetPace: pace }),
    workout(plusDays(start, 6), "rest", "Full Rest", "다음 주 훈련을 위한 깊은 회복"),
  ];
  workouts[0].status = "completed";
  workouts[1].status = "completed";
  workouts[2].status = "today";

  return { weekLabel: `${start.getMonth() + 1}월 ${start.getDate()}일–${plusDays(start, 6).getMonth() + 1}월 ${plusDays(start, 6).getDate()}일`, targetDistanceKm, completedDistanceKm: 11, workouts };
}
