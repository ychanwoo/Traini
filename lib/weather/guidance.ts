import { freshWeather, type WeatherSnapshot } from "./conditions";
export type WeatherWorkout = {
  kind: string;
  paceSecondsPerKm: number | null;
  completed: boolean;
};
/** Product heuristics, not a physiological pace model or a replacement prescription. */
export function weatherGuidance(
  workout: WeatherWorkout,
  weather: WeatherSnapshot | null,
  now = new Date(),
) {
  const base = {
    version: 1 as const,
    originalPace: workout.paceSecondsPerKm,
    adjustedPace: null as number | null,
    slowdownPercent: 0,
    reasons: [] as string[],
    status: "unchanged" as
      | "unchanged"
      | "reference"
      | "effort"
      | "conditions"
      | "unavailable"
      | "completed"
      | "rest",
  };
  if (workout.completed)
    return {
      ...base,
      status: "completed" as const,
      reasons: ["완료된 훈련에는 날씨 보정을 적용하지 않아요."],
    };
  if (workout.kind === "rest")
    return {
      ...base,
      status: "rest" as const,
      reasons: ["휴식일에는 러닝 페이스를 제안하지 않아요."],
    };
  if (!weather || !freshWeather(weather, now))
    return {
      ...base,
      status: "unavailable" as const,
      reasons: ["확인 가능한 최신 날씨가 없어 원래 훈련 처방을 유지해요."],
    };
  const heat = Math.max(
      weather.temperatureC,
      weather.feelsLikeC ?? weather.temperatureC,
    ),
    wind = weather.windMetersPerSecond,
    gust = weather.gustMetersPerSecond;
  const storm = weather.conditionCode >= 200 && weather.conditionCode < 300;
  const hazardousPrecip = [
    502, 503, 504, 511, 522, 531, 602, 611, 612, 613, 616, 622, 731, 751, 761,
    762, 771, 781,
  ].includes(weather.conditionCode);
  if (
    heat >= 35 ||
    weather.temperatureC <= -10 ||
    (weather.feelsLikeC !== null && weather.feelsLikeC <= -10) ||
    (wind !== null && wind >= 15) ||
    (gust !== null && gust >= 20) ||
    storm ||
    hazardousPrecip
  )
    return {
      ...base,
      status: "conditions" as const,
      reasons: [
        ...(heat >= 35
          ? ["기온 또는 체감온도가 높아 페이스 수치 보정을 제공하지 않아요."]
          : []),
        ...(weather.temperatureC <= -10 ||
        (weather.feelsLikeC !== null && weather.feelsLikeC <= -10)
          ? ["추운 조건에서는 노출 시간과 체감 추위를 먼저 확인해 주세요."]
          : []),
        ...(storm || hazardousPrecip
          ? ["뇌우·강한 강수 또는 시야에 영향을 주는 기상 조건이 확인됐어요."]
          : []),
        ...((wind !== null && wind >= 15) || (gust !== null && gust >= 20)
          ? ["강한 바람이나 돌풍이 있어요."]
          : []),
        "시간 변경이나 실내 훈련을 우선 검토하고, 현지 경보와 노면 상태를 확인해 주세요.",
      ],
    };
  const band = (temperature: number) =>
    temperature >= 30
      ? 8
      : temperature >= 28
        ? 6
        : temperature >= 25
          ? 4
          : temperature >= 22
            ? 2
            : 0;
  // Feels-like already incorporates humidity: choose the stronger signal, do not add twice.
  const percent = Math.min(
    10,
    Math.max(
      band(heat),
      band(weather.temperatureC) +
        (weather.temperatureC >= 22 && weather.humidityPercent >= 70 ? 2 : 0),
    ),
  );
  const reasons: string[] = [];
  if (percent)
    reasons.push(
      `더위${weather.humidityPercent >= 70 ? "와 높은 습도" : ""}를 고려해 평소보다 편안한 강도를 우선해 주세요.`,
    );
  if ((wind !== null && wind >= 5) || (gust !== null && gust >= 10))
    reasons.push(
      "바람은 진행 방향에 따라 영향이 달라요. 맞바람에서는 목표 페이스보다 같은 운동 강도를 유지해 주세요.",
    );
  if (weather.temperatureC <= 5)
    reasons.push(
      "추운 날은 충분히 몸을 풀고 노면 상태를 확인해 주세요. 추위를 이유로 목표 페이스를 높이지 않아요.",
    );
  if (weather.feelsLikeC === null || wind === null)
    reasons.push("체감온도 또는 바람 정보가 일부 없어 제공된 항목만 참고해요.");
  if (weather.conditionCode >= 300 && weather.conditionCode < 700)
    reasons.push(
      "강수 조건에서는 노면과 가시거리를 확인하고, 페이스 수치보다 발 디딤과 운동 강도를 우선해 주세요.",
    );
  const controlled = ["threshold", "interval"].includes(workout.kind);
  const pace = workout.paceSecondsPerKm;
  if (controlled && (percent > 0 || reasons.length > 0))
    return {
      ...base,
      status: "effort" as const,
      reasons: [
        ...reasons,
        "템포·인터벌의 반복 페이스를 일괄 변경하지 않아요. 평소의 통제 가능한 강도를 기준으로 반복 수나 훈련 시간을 조정해 주세요.",
      ],
    };
  if (
    percent &&
    pace !== null &&
    Number.isInteger(pace) &&
    pace >= 100 &&
    pace <= 3600 &&
    ["recovery", "easy", "long"].includes(workout.kind)
  )
    return {
      ...base,
      status: "reference" as const,
      slowdownPercent: percent,
      adjustedPace: Math.floor(pace * (1 + percent / 100)),
      reasons,
    };
  const needsEffortGuidance = reasons.length > 0 || pace === null;
  if (!reasons.length)
    reasons.push(
      "현재 확인된 조건에서는 추가 페이스 보정 없이 원래 처방을 참고해요.",
    );
  if (pace === null)
    reasons.push(
      "목표 페이스가 없는 세션은 거리와 원래 운동 강도를 기준으로 진행해 주세요.",
    );
  return {
    ...base,
    status: needsEffortGuidance ? ("effort" as const) : ("unchanged" as const),
    reasons,
  };
}
