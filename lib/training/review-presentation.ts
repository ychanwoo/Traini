import { addCalendarDays } from "@/lib/garmin/running-summary";
export type WeekComparison = { startsOn: string; endsOn: string; actualKm: number | null; activityCount: number; distanceComplete: boolean };
/** Compare adjacent calendar weeks only. Missing data never means zero training. */
export function weekComparisonText(start: string, current: {actualKm: number|null; activityCount: number; distanceKnown:number}, previous: WeekComparison|null|undefined) {
  if (!previous || previous.startsOn !== addCalendarDays(start,-7) || previous.endsOn !== addCalendarDays(start,-1)) return null;
  if (current.activityCount === 0 || current.actualKm === null || current.distanceKnown !== current.activityCount || !previous.distanceComplete || previous.actualKm === null || previous.actualKm <= 0)
    return "이전 주와 비교할 거리 기록이 부족해 증감을 판단하지 않았어요.";
  const change = Math.round((current.actualKm/previous.actualKm-1)*1000)/10;
  const direction = change > 0 ? "늘었어요" : change < 0 ? "줄었어요" : "같아요";
  return `${current.activityCount}회 · ${current.actualKm.toFixed(1)}km. 이전 주 ${previous.actualKm.toFixed(1)}km보다 ${change === 0 ? "거리가 같아요" : `${Math.abs(change)}% ${direction}`}.`;
}
