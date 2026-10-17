import { planErrorMessage } from "./plan-errors";
export function reviewErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    busy: "계획 또는 리뷰를 생성하고 있어요. 잠시 후 결과를 확인해 주세요.",
    limited:
      "생성 요청은 1분 간격, 최근 24시간 동안 계획·리뷰 합계 5회까지 가능해요. ChatGPT 자체 사용 한도도 적용될 수 있어요.",
    interrupted:
      "이전 리뷰 생성이 중단됐어요. 기존 리뷰를 확인한 뒤 다시 시도해 주세요.",
    review_period:
      "최근 완료된 8주 중 월요일부터 일요일까지의 주를 선택해 주세요.",
    review_history: "이 주에는 리뷰할 계획이나 러닝 기록이 없어요.",
    review_changed:
      "리뷰 도중 기록이 바뀌었어요. 다시 확인한 뒤 생성해 주세요.",
    review_storage:
      "주간 리뷰를 불러오거나 저장하지 못했어요. 기존 리뷰와 계획은 유지돼요.",
    invalid_review:
      "리뷰 응답이 검증 조건을 충족하지 못했어요. 기존 리뷰와 계획은 유지돼요.",
  };
  return messages[code] ?? planErrorMessage(code);
}
