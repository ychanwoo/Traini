import { GoalSettings } from "@/components/training/goal-settings";
import { PastWorkoutFeedback } from "@/components/training/weekly-plan-view";

export default function TrainingPreferencesPage() {
  return <main className="page">
    <GoalSettings preferences />
    <PastWorkoutFeedback />
  </main>;
}
