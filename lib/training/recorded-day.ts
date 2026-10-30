import type { RunningSummary } from "@/lib/garmin/running-summary";
export function recordedDay(activities: RunningSummary["activities"], date: string) {
  const runs = activities.filter((a) => a.trainingDate === date);
  if (!runs.length) return null;
  const completeDistance = runs.every((a) => a.distanceMeters !== null);
  const distance = completeDistance ? runs.reduce((n, a) => n + a.distanceMeters!, 0) : null;
  const completeTime = runs.every((a) => a.timerSeconds !== null);
  const seconds = completeTime ? runs.reduce((n, a) => n + a.timerSeconds!, 0) : null;
  return { count: runs.length, distanceKm: distance === null ? null : distance / 1000,
    pace: distance && seconds !== null ? Math.round(seconds / distance * 1000) : null };
}
