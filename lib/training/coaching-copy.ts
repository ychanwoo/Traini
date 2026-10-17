/** Presentation only: retain the saved facts, numbers and uncertainty. */
const metricLabels: Record<string, string> = {
  actualKm: "기록된 거리",
  plannedKm: "계획 거리",
  activityCount: "러닝 횟수",
  garminCompleted: "Garmin으로 확인한 계획 훈련 수",
  manualCompleted: "직접 완료로 표시한 훈련 수",
  unconfirmed: "수행 미확인 훈련 수",
  explicitlySkipped: "직접 건너뛴 훈련 수",
  feedbackReports: "피드백을 남긴 훈련 수",
  additionalRuns: "계획된 휴식일의 러닝 횟수",
  unassignedRuns: "계획과 연결되지 않은 러닝 횟수",
  baselineKm: "최근 기록의 비교 기준 거리",
  structuredQualitySessions: "측정된 활동 구간이 확인된 훈련 수",
  supportedQualitySessions: "계획에서 허용한 고강도 훈련 수",
  maxQualitySessions: "다음 계획의 고강도 훈련 상한",
  volumeChangePercent: "훈련량 조정 비율",
};
const keys = Object.keys(metricLabels).join("|");
// Match whole identifiers, with optional code quotes. Do not alter similar names
// or mistake comparison words such as 이상/이하/가량 for attached particles.
const identifier = new RegExp(
  `(?<![A-Za-z0-9_])(?:\x60(${keys})\x60|(${keys}))(?![A-Za-z0-9_])(?:(이상|이하|이내|이후|이전|이외|가량)|(으로|은|는|이|가|을|를|과|와|로))?`,
  "g",
);
function particle(label: string, suffix: string) {
  const last = label.charCodeAt(label.length - 1) - 0xac00;
  const ending = last >= 0 && last < 11172 ? last % 28 : 0;
  if (["은", "는"].includes(suffix)) return ending ? "은" : "는";
  if (["이", "가"].includes(suffix)) return ending ? "이" : "가";
  if (["을", "를"].includes(suffix)) return ending ? "을" : "를";
  if (["과", "와"].includes(suffix)) return ending ? "과" : "와";
  if (["으로", "로"].includes(suffix))
    return ending && ending !== 8 ? "으로" : "로";
  return suffix;
}
/** Use for generated prose only, never user-authored names, memos or reasons. */
export function coachingText(text: string): string {
  return text.replace(
    identifier,
    (_match, quoted, bare, comparison, suffix = "") => {
      const label = metricLabels[quoted ?? bare];
      return label + (comparison ? ` ${comparison}` : particle(label, suffix));
    },
  );
}
export const coachingCopy = {
  appliedReview:
    "주간 리뷰를 참고했어요. 실제 훈련은 계획 생성 시점의 컨디션과 허용 범위에 맞춰 조정돼요.",
  unknownCondition:
    "컨디션을 아직 입력하지 않았어요. 기록만으로 통증이나 회복 상태를 판단하지 않아요.",
  reportedCondition:
    "직접 입력한 상태예요. 통증의 진단이나 회복 여부를 확정하는 정보는 아니에요.",
  manualCompletion:
    "직접 완료 표시는 실측 거리와 구분해요. 수행 미확인 훈련을 실패로 판단하거나 완료율로 목표 달성 가능성을 예측하지 않아요.",
} as const;
