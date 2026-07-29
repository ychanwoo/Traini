import type { RoadmapPhase } from "@/types/roadmap";

export const roadmapPhases: RoadmapPhase[] = [
  { id: "base", title: "기초 체력", weeks: "1–6주차", focus: "이지 런 적응과 마일리지 확장", mileageRange: "35–45km" },
  { id: "threshold", title: "심폐·역치 강화", weeks: "7–16주차", focus: "T-Pace와 장거리주로 지구력 강화", mileageRange: "40–50km" },
  { id: "race-pace", title: "레이스 페이스", weeks: "17–21주차", focus: "M-Pace 적응과 30km 장거리주", mileageRange: "45–55km" },
  { id: "taper", title: "테이퍼링", weeks: "22–24주차", focus: "훈련량 감축과 레이스 컨디션 조절", mileageRange: "25–35km" },
];
