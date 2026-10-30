import type { RunningSummary } from "@/lib/garmin/running-summary";
import type { StoredPlan } from "./weekly-plan";

/** A forecast, not a mileage target: recorded distance replaces that day's plan. */
export function weeklyDistance(
  runs: RunningSummary["activities"] | undefined,
  plan: StoredPlan | null | undefined,
  unavailable = false,
) {
  if (unavailable || !runs || runs.some(r => r.distanceMeters === null))
    return { actualKm: null, expectedKm: null, includesManualCompletion: false };
  const actualKm = runs.reduce((sum, r) => sum + r.distanceMeters!, 0) / 1000;
  const assigned = new Set(plan?.workouts.flatMap(w =>
    w.matching?.activities.filter(a => a.linked).map(a => a.garminId) ?? []) ?? []);
  const dates = new Set(runs.filter(r => !assigned.has(r.id)).map(r => r.trainingDate));
  const ids = new Set(runs.map(r => r.id));
  let expectedKm = actualKm;
  let includesManualCompletion = false;
  if (!plan) return { actualKm, expectedKm: null, includesManualCompletion };
  for (const workout of plan.workouts) {
    if (workout.kind === "rest" || workout.status === "skipped") continue;
    // Also handle an explicitly linked activity recorded on another local day.
    const linked = workout.matching?.activities.filter(a => a.linked) ?? [];
    if (linked.some(a => !ids.has(a.garminId)))
      return { actualKm, expectedKm: null, includesManualCompletion: false };
    if (linked.length || dates.has(workout.date)) continue;
    expectedKm += workout.distanceKm;
    if (workout.completed) includesManualCompletion = true;
  }
  return { actualKm, expectedKm, includesManualCompletion };
}
