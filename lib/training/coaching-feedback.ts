import type { ReviewState } from "./review-storage";
import type { ReviewMetrics } from "./weekly-review";
import type { TrainingCondition } from "./goal";
import type { StoredPlan } from "./weekly-plan";

export type CoachingPlan = {
  period: { start: string; end: string; today: string };
  plan: StoredPlan | null;
  inputsChanged: boolean;
  races?: { date: string }[];
};
export type CoachingInputs = {
  today: string;
  condition: TrainingCondition | null | undefined;
  current?: CoachingPlan;
  next?: CoachingPlan;
};
const number = (n: number) => Number(n.toFixed(1)).toLocaleString("ko-KR");

function assessment(m: ReviewMetrics) {
  const complete =
    m.activityCount > 0 &&
    m.distanceKnown === m.activityCount &&
    m.actualKm !== null;
  if (!m.activityCount)
    return {
      headline: "러닝 기록을 먼저 확인할 주예요.",
      summary:
        "이 주에는 확인된 러닝 기록이 없어 훈련량을 평가하기 어려워요. 실제로 쉬었는지, 아직 가져오지 않은 기록이 있는지 구분해 주세요.",
    };
  if (!complete)
    return {
      headline: "이번 주 거리는 일부만 확인됐어요.",
      summary: `${m.activityCount}회 러닝 중 ${m.distanceKnown}회의 거리가 확인됐어요.${m.actualKm === null ? " 주간 거리는 아직 알 수 없어요." : ` 확인된 ${number(m.actualKm)}km는 부분 합계여서 평소보다 늘거나 줄었다고 평가하지 않았어요.`}`,
    };
  const base = m.baselineKm;
  if (base === null || base <= 0)
    return {
      headline: "이번 주 기록을 훈련의 출발점으로 삼아요.",
      summary: `${m.activityCount}회, 총 ${number(m.actualKm!)}km를 달렸어요. 비교할 이전 기록이 충분하지 않아 훈련량의 증감은 판단하지 않았어요.`,
    };
  const delta = Math.round((m.actualKm! / base - 1) * 1000) / 10;
  return {
    headline:
      delta > 0
        ? "비교 기준보다 러닝 거리가 늘었어요."
        : delta < 0
          ? "비교 기준보다 기록된 거리가 적었어요."
          : "비교 기준과 비슷한 거리를 달렸어요.",
    summary: `${m.activityCount}회, 총 ${number(m.actualKm!)}km를 달렸어요. 최근 비교 기준 ${number(base)}km${delta === 0 ? "와 거의 같은 거리예요." : `보다 약 ${number(Math.abs(delta))}% ${delta > 0 ? "많았어요." : "적었어요."}`} 거리 변화만으로 피로가 쌓였거나 회복됐다고 판단하지는 않아요.`,
  };
}

function observations(m: ReviewMetrics) {
  const result: string[] = [];
  const distances = m.activities.flatMap((a) =>
    a.distanceKm === null ? [] : [a.distanceKm],
  );
  if (distances.length) {
    const longest = Math.max(...distances);
    result.push(
      `${m.distanceKnown < m.activityCount ? "거리가 확인된 활동 중 " : ""}가장 긴 러닝은 ${number(longest)}km였어요.${m.structuredQualitySessions > 0 ? ` 빠른 활동 구간이 구분되는 러닝도 ${m.structuredQualitySessions}회 확인됐어요. 이 횟수가 주간 고강도 훈련의 전체 횟수를 뜻하지는 않아요.` : " 활동 구간만으로 템포·인터벌 등 훈련 종류를 확정하지는 않았어요."}`,
    );
  }
  const pain = m.sessions.filter((s) =>
    ["pain", "discomfort"].includes(s.feedback?.assessment?.pain ?? ""),
  );
  const demanding = m.sessions.filter(
    (s) =>
      s.feedback?.assessment?.fatigue === "high" ||
      (s.feedback?.assessment?.rpe ?? 0) >= 9,
  );
  if (pain.length)
    result.push(
      `이 주의 피드백 ${pain.length}개에 통증·불편감이 남아 있어요. 당시 보고이며, 현재 상태는 이후 입력한 컨디션과 함께 확인해요.`,
    );
  else if (demanding.length)
    result.push(
      `피로가 높거나 체감 강도가 9 이상이었다는 피드백이 ${demanding.length}개 있어요. 거리뿐 아니라 실제로 느낀 부담도 다음 계획을 검토할 때 참고해요.`,
    );
  else if (!m.feedbackReports)
    result.push(
      "당시 컨디션 피드백이 없어 이 훈련량을 얼마나 편하게 소화했는지는 확인하기 어려워요.",
    );
  if (m.explicitlySkipped)
    result.push(
      `직접 건너뛴 훈련이 ${m.explicitlySkipped}개 있어요. 빠진 거리는 다음 주에 반드시 보충해야 하는 거리로 다루지 않아요.`,
    );
  else if (m.hasPlan && (m.unconfirmed ?? 0) > 0)
    result.push(
      `수행을 확인하지 못한 훈련이 ${m.unconfirmed}개 있어요. 수행했다면 기록 연결을 확인하고, 하지 못했다면 건너뜀 사유를 남겨 주세요. 아직 실패한 훈련으로 판단하지 않았어요.`,
    );
  else if (!m.hasPlan)
    result.push(
      "저장된 계획이 없어 이행률 대신 실제 러닝을 중심으로 살펴봤어요.",
    );
  return result.slice(0, 3);
}

function reflection(
  week: "current" | "next",
  state: CoachingPlan | undefined,
  input: CoachingInputs,
  review: ReviewState["review"],
) {
  const label = week === "current" ? "이번 주" : "다음 주";
  if (!state)
    return {
      week,
      status: "unavailable",
      text: `${label} 계획을 불러오지 못해 실제 반영 여부는 확인하지 못했어요.`,
    };
  if (!state.plan)
    return {
      week,
      status: "missing",
      text: `${label}에는 저장된 계획이 없어 아직 반영된 일정이 없어요.`,
    };
  if (state.inputsChanged)
    return {
      week,
      status: "stale",
      text: `${label} 계획을 만든 뒤 입력이 바뀌었어요. 현재 상태가 반영됐다고 볼 수 없으므로 일정에서 업데이트한 뒤 확인해 주세요.`,
    };
  const future = state.plan.workouts.filter(
    (w) =>
      w.date >= input.today &&
      !w.completed &&
      !["completed", "skipped"].includes(w.status ?? ""),
  );
  const runs = future.filter((w) => w.kind !== "rest");
  const hold =
    input.condition &&
    input.condition.reportedOn <= input.today &&
    ["pain", "unwell"].includes(input.condition.feeling);
  const linked =
    !!review?.fresh &&
    state.plan.review?.id === review.id &&
    state.plan.review?.revision === review.revision;
  const reference = linked
    ? "선택한 주의 리뷰를 참고한 계획이에요. "
    : state.plan.review
      ? `${state.plan.review.startsOn} 주의 리뷰를 참고한 계획이며, 선택한 리뷰가 직접 반영된 것은 아니에요. `
      : "선택한 리뷰의 반영 기록은 확인되지 않았어요. ";
  if (hold && runs.length)
    return {
      week,
      status: "conflict",
      text: `${label}에 예정된 러닝 ${runs.length}회가 남아 있어 현재 통증·몸 상태 제한과 맞지 않아요. 그대로 수행하지 말고 계획을 갱신해 확인해 주세요.`,
    };
  const covered = new Set([
    ...state.plan.workouts.map((w) => w.date),
    ...(state.races ?? []).map((r) => r.date),
  ]);
  for (
    let date =
      state.period.start < input.today ? input.today : state.period.start;
    date <= state.period.end;
    date = new Date(Date.parse(date + "T00:00:00Z") + 86400000)
      .toISOString()
      .slice(0, 10)
  ) {
    if (!covered.has(date))
      return {
        week,
        status: "partial",
        text: `${label}에는 일정이 저장되지 않은 날짜가 있어요. 저장된 항목만으로 남은 기간 전체가 조정됐다고 확인할 수는 없어요.`,
      };
  }
  if (hold)
    return {
      week,
      status: "held",
      text: `${label}${week === "current" ? " 남은 일정" : " 일정"}에는 훈련으로 배치된 러닝이 없고, 현재 제한과 맞게 저장됐어요. ${reference}${state.races?.some((r) => r.date >= input.today) ? " 등록된 대회 일정도 참가 가능 여부를 보장하지는 않아요." : ""}`,
    };
  const total = runs.reduce((sum, w) => sum + w.distanceKm, 0);
  const hard = runs.filter((w) =>
    ["interval", "threshold"].includes(w.kind),
  ).length;
  const planText = runs.length
    ? `${label}${week === "current" ? " 남은 일정" : " 일정"}에는 러닝 ${runs.length}회, 총 ${number(total)}km가 예정돼 있어요.${hard ? ` 그중 템포·인터벌은 ${hard}회예요.` : " 템포·인터벌은 추가로 배치하지 않았어요."}`
    : `${label}에 추가로 예정된 러닝은 없어요.`;
  return {
    week,
    status: linked ? "linked" : "not_linked",
    text: `${planText} ${reference}`,
  };
}

/** Grounded display narrative, not a new AI response or a medical assessment. */
export function buildCoachingFeedback(
  state: Pick<ReviewState, "metrics" | "review">,
  input: CoachingInputs,
) {
  const m = state.metrics;
  const review = state.review;
  const recommendation = review?.fresh
    ? `검토한 주의 기록을 바탕으로 AI 리뷰는 ${review.content.nextWeek.direction === "reduce" ? "훈련량을 줄이는 방향" : review.content.nextWeek.direction === "progress" ? "훈련량을 조금 늘리는 방향" : "훈련량을 유지하는 방향"}${review.content.nextWeek.volumeChangePercent ? `(${review.content.nextWeek.volumeChangePercent > 0 ? "+" : ""}${review.content.nextWeek.volumeChangePercent}%)` : ""}을 제안했어요. 실제 배치는 이후의 컨디션과 저장된 계획을 함께 봐야 해요.`
    : review
      ? "저장된 AI 리뷰 이후 자료가 바뀌어 이전 제안을 현재 계획의 근거로 삼지 않았어요."
      : "아직 저장된 AI 리뷰가 없어 아래 내용은 확인된 기록과 현재 계획을 바탕으로 정리했어요.";
  const condition =
    input.condition === undefined
      ? "현재 컨디션을 불러오지 못했어요. 계획 반영 여부와 별개로 상태를 확인해 주세요."
      : input.condition === null
        ? "현재 컨디션은 미입력이에요. 기록만으로 정상 상태나 회복 여부를 판단하지 않아요."
        : input.condition.reportedOn <= input.today &&
            ["pain", "unwell"].includes(input.condition.feeling)
          ? `${input.condition.reportedOn}에 ${input.condition.feeling === "pain" ? "통증" : "몸 상태 이상"}을 보고했어요. 상태를 다시 확인하기 전까지 러닝 제한이 적용돼요. 날짜가 지났다고 자동 복귀하거나 빠진 거리를 몰아서 보충하지 않아요.`
          : null;
  return {
    source: "recorded_evidence_and_saved_plans" as const,
    ...assessment(m),
    observations: observations(m),
    recommendation,
    condition,
    reflections: [
      reflection("current", input.current, input, review),
      reflection("next", input.next, input, review),
    ],
  };
}
export type CoachingFeedback = ReturnType<typeof buildCoachingFeedback>;
