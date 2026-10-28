export const planErrorMessages: Record<string, string> = {
  closeout_changed: "마감 이후 기록·피드백이 바뀌었어요. 주간 마감을 갱신한 뒤 계획을 확인해 주세요.",
  local_runtime:
    "ChatGPT 구독 기반 생성은 연결을 설정한 Mac에서 Traini 서버를 실행해야 사용할 수 있어요.",
  inputs: "목표와 훈련 가능 요일·장거리 요일을 먼저 설정해 주세요.",
  period: "목표 날짜 이전에 계획할 훈련 날짜가 없어요.",
  history:
    "최근 기록의 거리·시간이 부족해 계획을 생성할 수 없어요. Garmin 기록을 확인해 주세요.",
  input_changed:
    "생성 중 목표 또는 러닝 기록이 바뀌었어요. 최신 데이터로 다시 시도해 주세요.",
  busy: "이미 훈련계획을 생성하고 있어요. 잠시 후 결과를 확인해 주세요.",
  started: "계획을 생성하고 있어요.",
  limited:
    "요청 한도에 도달했어요. 잠시 후 다시 시도하거나 ChatGPT 사용 한도를 확인해 주세요.",
  model:
    "설정한 모델을 사용할 수 없어요. ChatGPT 연결과 모델 설정을 확인해 주세요.",
  reconnect: "내 목표 및 대회에서 ChatGPT를 다시 연결해 주세요.",
  permission: "ChatGPT 구독 사용 권한을 확인해 주세요.",
  invalid_output:
    "생성 결과가 훈련 조건을 충족하지 않아 저장하지 않았어요. 기존 계획은 유지돼요.",
  interrupted:
    "이전 생성 작업이 중단됐어요. 기존 계획을 확인한 뒤 다시 시도해 주세요.",
  network:
    "OpenAI에 연결하지 못했어요. 기존 계획을 유지했으니 잠시 후 다시 시도해 주세요.",
  workout:
    "오늘 예정된 러닝 훈련만 완료할 수 있어요. 화면을 새로고침해 주세요.",
  storage:
    "저장 결과를 확인하지 못했어요. 새로고침으로 기존 계획을 먼저 확인해 주세요.",
};
export const planErrorMessage = (code: string) =>
  planErrorMessages[code.startsWith("invalid_output:") ? "invalid_output" : code] ??
  "훈련계획 생성을 완료하지 못했어요. 기존 계획을 유지했으니 잠시 후 다시 확인해 주세요.";
