export type WorkoutKind = "rest" | "easy" | "threshold" | "interval" | "long";
export type WorkoutStatus = "completed" | "today" | "scheduled" | "skipped";

export type Workout = {
  id: string;
  date: string;
  kind: WorkoutKind;
  status: WorkoutStatus;
  title: string;
  distanceKm?: number;
  targetPace?: string;
  targetHeartRate?: string;
  purpose: string;
};

export type WeeklyTrainingPlan = {
  weekLabel: string;
  targetDistanceKm: number;
  completedDistanceKm: number;
  workouts: Workout[];
};
