import { AppHeader } from "@/components/layout/app-header";
import { Card } from "@/components/ui/card";
import { mockWeeklyTrainingPlan } from "@/features/training/mock-data";

export default function TodayPage() {
  const today = mockWeeklyTrainingPlan.workouts.find((workout) => workout.status === "today");

  return (
    <div className="pb-6">
      <AppHeader trailing={<span className="text-xs font-medium text-[#6B21A8]">D-42</span>} />
      <div className="space-y-7 px-5">
        <div>
          <p className="text-sm text-[#6B6470]">좋은 아침이에요, 민준님</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#1F1726]">오늘의 훈련</h1>
        </div>
        <Card className="border-[#6B21A8] bg-[#FBF8FD]">
          <p className="text-xs font-semibold tracking-wide text-[#6B21A8]">TODAY</p>
          <h2 className="mt-3 text-xl font-semibold text-[#1F1726]">{today?.title}</h2>
          <p className="mt-1 text-4xl font-semibold tracking-tight text-[#1F1726]">{today?.distanceKm}<span className="ml-1 text-base font-medium">km</span></p>
          <p className="mt-4 text-sm text-[#6B6470]">목표 페이스 {today?.targetPace} · {today?.targetHeartRate}</p>
        </Card>
      </div>
    </div>
  );
}
