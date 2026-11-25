import { addCalendarDays } from "../garmin/running-summary";
import type { ProgressInsights } from "./progress";

type Race = ProgressInsights["races"][number];

const focus = {
  FULL: "장거리에서 일정한 강도를 유지하고 급수·보급을 연습해요.",
  HALF: "지속주와 편안한 장거리로 후반에도 일정하게 달리는 연습을 해요.",
  "10K": "통제된 템포 구간과 짧은 반복주로 지속 가능한 속도를 연습해요.",
  "5K": "짧은 반복과 충분한 회복으로 빠른 구간의 리듬을 연습해요.",
};

/** A calendar projection. Saved workouts and readiness checks remain authoritative. */
export function raceRoadmap(race: Race, data: Pick<ProgressInsights, "asOfDate" | "races" | "totals">) {
  const today = data.asOfDate;
  if (race.date < today) return [];
  const specificDays = { FULL: 42, HALF: 28, "10K": 21, "5K": 14 }[race.distance];
  const specific = addCalendarDays(race.taperStart, -specificDays);
  const afterRace = addCalendarDays(race.date, 1);
  const nearby = data.races.filter(r => r.id !== race.id && r.taperStart <= race.date && r.recoveryEnd >= today);
  const cuts = new Set([today, specific, race.taperStart, race.date, afterRace]);
  for (const r of nearby) {
    for (const day of [r.taperStart, r.date, r.recoveryStart, addCalendarDays(r.recoveryEnd, 1)]) cuts.add(day);
  }
  const starts = [...cuts].filter(d => d >= today && d <= afterRace).sort();
  const blocks: { start: string; end: string; label: string; description: string }[] = [];
  for (const [i, start] of starts.slice(0, -1).entries()) {
    const end = addCalendarDays(starts[i + 1], -1);
    const overlap = nearby.find(r => r.date === start)
      ?? nearby.find(r => start >= r.recoveryStart && start <= r.recoveryEnd)
      ?? nearby.find(r => start >= r.taperStart && start < r.date);
    let label: string, description: string;
    if (start === race.date) {
      label = "대회일";
      description = race.priority === "primary" ? "선택한 목표 대회 일정이에요." : "주목표 준비 과정에 포함한 대회예요.";
    } else if (overlap) {
      label = overlap.name || overlap.distance;
      description = start === overlap.date ? "다른 대회 일정이에요. 별도 강도 훈련은 배치하지 않아요." : start < overlap.date ? "이 대회의 테이퍼와 겹쳐 추가 고강도 훈련을 줄여요." : "이 대회 이후 컨디션과 복귀 기록을 확인하며 다음 훈련으로 이어가요.";
    } else if (start >= race.taperStart) {
      label = "테이퍼";
      description = "장거리와 총거리를 줄이고 익숙한 리듬을 짧게 유지해요.";
    } else if (start >= specific) {
      label = "대회 특화 준비";
      description = focus[race.distance] + (race.targetTimeSeconds ? " 목표 페이스 구간은 최근 수행 근거 안에서 정해요." : "");
    } else {
      label = "기초 지구력";
      description = data.totals.weeksWithActivities >= 3 ? "최근 소화한 주간 거리에서 이지런과 장거리의 규칙성을 확보해요." : "편안한 러닝 기록을 쌓아 지속할 수 있는 주간 거리를 확인해요.";
    }
    const previous = blocks.at(-1);
    if (previous && previous.label === label && previous.description === description) previous.end = end;
    else blocks.push({ start, end, label, description });
  }
  return blocks;
}
