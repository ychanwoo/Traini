export type RoadmapPhaseId = "base" | "threshold" | "race-pace" | "taper";

export type RoadmapPhase = {
  id: RoadmapPhaseId;
  title: string;
  weeks: string;
  focus: string;
  mileageRange: string;
};
