import type { WeeklyTrainingPlan } from "@/types/training";

export const mockWeeklyTrainingPlan: WeeklyTrainingPlan = {
  weekLabel: "8월 12일–8월 18일",
  targetDistanceKm: 40,
  completedDistanceKm: 22,
  workouts: [
    { id: "mon", date: "월 12", kind: "rest", status: "completed", title: "회복 휴식", purpose: "근육 회복" },
    { id: "tue", date: "화 13", kind: "easy", status: "completed", title: "이지 런", distanceKm: 6, targetPace: "5'42”/km", purpose: "유산소 기반 유지" },
    { id: "wed", date: "수 14", kind: "threshold", status: "today", title: "T-Pace 역치주", distanceKm: 8, targetPace: "4'50”/km", targetHeartRate: "155–168 bpm", purpose: "스피드 지구력 강화" },
    { id: "thu", date: "목 15", kind: "rest", status: "scheduled", title: "회복 휴식", purpose: "회복 확보" },
    { id: "fri", date: "금 16", kind: "easy", status: "scheduled", title: "이지 런", distanceKm: 7, targetPace: "5'45”/km", purpose: "가벼운 유산소 훈련" },
    { id: "sat", date: "토 17", kind: "long", status: "scheduled", title: "LSD", distanceKm: 18, targetPace: "6'05”/km", purpose: "장거리 지구력 강화" },
    { id: "sun", date: "일 18", kind: "rest", status: "scheduled", title: "완전 휴식", purpose: "다음 주 훈련 준비" },
  ],
};
