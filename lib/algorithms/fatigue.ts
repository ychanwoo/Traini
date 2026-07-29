import type { GarminSnapshot } from "@/types/garmin";

export function getRecoveryLabel(snapshot: GarminSnapshot) {
  if (snapshot.sleepScore !== null && snapshot.sleepScore < 60) return "회복 권장";
  if (snapshot.hrvStatus === "low") return "주의";
  return "좋음";
}
