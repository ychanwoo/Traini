/** Provider-neutral weather data. Times are UTC instants; display uses training timezone. */
export type WeatherSnapshot = {
  kind: "current" | "forecast";
  temperatureC: number;
  feelsLikeC: number | null;
  humidityPercent: number;
  windMetersPerSecond: number | null;
  gustMetersPerSecond: number | null;
  conditionCode: number;
  summary: string;
  validAt: string;
  fetchedAt: string;
  requestedFor: string | null;
};
export class WeatherError extends Error {
  constructor(
    public code:
      | "weather_input"
      | "weather_time"
      | "weather_coverage"
      | "weather_stale"
      | "weather_data"
      | "weather_config"
      | "weather_provider"
      | "weather_limited",
  ) {
    super(code);
  }
}
export const WEATHER_TTL_MS = 10 * 60_000;
export function freshWeather(weather: WeatherSnapshot, now = new Date()) {
  const fetched = Date.parse(weather.fetchedAt),
    valid = Date.parse(weather.validAt),
    requested =
      weather.requestedFor === null ? null : Date.parse(weather.requestedFor);
  if (
    !Number.isFinite(fetched) ||
    !Number.isFinite(valid) ||
    fetched > now.getTime() + 60_000 ||
    now.getTime() - fetched > WEATHER_TTL_MS
  )
    return false;
  return weather.kind === "current"
    ? weather.requestedFor === null &&
        valid <= now.getTime() + 5 * 60_000 &&
        now.getTime() - valid <= 90 * 60_000
    : requested !== null &&
        Number.isFinite(requested) &&
        requested > now.getTime() &&
        valid > now.getTime() &&
        Math.abs(valid - requested) <= 90 * 60_000;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const number = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;
export function parseWeatherSnapshot(value: unknown): WeatherSnapshot {
  if (
    !object(value) ||
    !["current", "forecast"].includes(String(value.kind)) ||
    !number(value.temperatureC, -100, 70) ||
    !number(value.humidityPercent, 0, 100) ||
    !(value.feelsLikeC === null || number(value.feelsLikeC, -120, 90)) ||
    !(
      value.windMetersPerSecond === null ||
      number(value.windMetersPerSecond, 0, 150)
    ) ||
    !(
      value.gustMetersPerSecond === null ||
      number(value.gustMetersPerSecond, 0, 150)
    ) ||
    !number(value.conditionCode, 200, 804) ||
    !Number.isInteger(value.conditionCode) ||
    typeof value.summary !== "string" ||
    value.summary.length > 120 ||
    typeof value.validAt !== "string" ||
    !Number.isFinite(Date.parse(value.validAt)) ||
    typeof value.fetchedAt !== "string" ||
    !Number.isFinite(Date.parse(value.fetchedAt)) ||
    !(
      value.requestedFor === null ||
      (typeof value.requestedFor === "string" &&
        Number.isFinite(Date.parse(value.requestedFor)))
    )
  )
    throw new WeatherError("weather_data");
  return value as WeatherSnapshot;
}
/** Reject DST gaps and repeated clock times rather than silently moving a workout. */
export function trainingInstant(
  date: string,
  time: string,
  timezone: string,
): Date {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  )
    throw new WeatherError("weather_time");
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new WeatherError("weather_time");
  }
  const epoch = Date.parse(`${date}T${time}:00Z`),
    matches: Date[] = [];
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const candidate = new Date(epoch - offset * 60_000),
      parts = formatter.formatToParts(candidate),
      get = (name: string) => parts.find((p) => p.type === name)?.value;
    if (
      `${get("year")}-${get("month")}-${get("day")}` === date &&
      `${get("hour")}:${get("minute")}` === time
    )
      matches.push(candidate);
  }
  if (matches.length !== 1) throw new WeatherError("weather_time");
  return matches[0];
}
export function weatherQuery(
  params: URLSearchParams,
  timezone: string,
  now = new Date(),
) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(now);
  } catch {
    throw new WeatherError("weather_config");
  }
  const allowed = ["lat", "lon", "date", "time"];
  if (
    [...params.keys()].some(
      (k) => !allowed.includes(k) || params.getAll(k).length !== 1,
    )
  )
    throw new WeatherError("weather_input");
  const coordinate = (key: string, max: number) => {
    const raw = params.get(key);
    if (
      raw === null ||
      !/^-?\d+(\.\d+)?$/.test(raw) ||
      !Number.isFinite(Number(raw)) ||
      Math.abs(Number(raw)) > max
    )
      throw new WeatherError("weather_input");
    return Math.round(Number(raw) * 100) / 100;
  };
  const latitude = coordinate("lat", 90),
    longitude = coordinate("lon", 180);
  if (params.has("date") !== params.has("time"))
    throw new WeatherError("weather_time");
  const target = params.has("date")
    ? trainingInstant(params.get("date")!, params.get("time")!, timezone)
    : null;
  if (
    target &&
    (target.getTime() <= now.getTime() ||
      target.getTime() > now.getTime() + 5 * 86400_000)
  )
    throw new WeatherError("weather_coverage");
  return { latitude, longitude, target };
}
export const weatherErrorMessage = (code: string) =>
  (
    ({
      weather_input: "날씨를 확인할 위치를 다시 선택해 주세요.",
      weather_time:
        "훈련 시간을 확인해 주세요. 시간대 변경으로 중복되거나 존재하지 않는 시간은 사용할 수 없어요.",
      weather_coverage:
        "이 시간의 예보는 아직 제공되지 않거나 이미 지난 시간이에요. 원래 훈련 처방을 유지해요.",
      weather_stale:
        "날씨 정보가 오래되어 보정하지 않았어요. 다시 확인해 주세요.",
      weather_data: "날씨 정보를 검증하지 못해 원래 훈련 처방을 유지해요.",
      weather_config:
        "날씨 연결 설정을 확인해 주세요. 원래 훈련 처방은 유지돼요.",
      weather_limited:
        "날씨 조회가 일시적으로 제한됐어요. 잠시 후 다시 확인해 주세요.",
      weather_provider:
        "날씨 정보를 가져오지 못했어요. 원래 훈련 처방을 유지해요.",
    }) as Record<string, string>
  )[code] ?? "날씨를 확인하지 못했어요. 원래 훈련 처방을 유지해요.";
