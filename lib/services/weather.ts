import "server-only";
import {
  WeatherError,
  WEATHER_TTL_MS,
  parseWeatherSnapshot,
  freshWeather,
  type WeatherSnapshot,
} from "@/lib/weather/conditions";
export type { WeatherSnapshot } from "@/lib/weather/conditions";
const cache = new Map<string, { expires: number; rows: WeatherSnapshot[] }>();
const inFlight = new Map<string, Promise<WeatherSnapshot[]>>();
let activeKey: string | undefined;
let providerCooldownUntil = 0;
function optional(value: unknown, min: number, max: number) {
  return value === undefined || value === null
    ? null
    : typeof value === "number" &&
        Number.isFinite(value) &&
        value >= min &&
        value <= max
      ? value
      : NaN;
}
function decode(
  raw: unknown,
  kind: WeatherSnapshot["kind"],
  fetchedAt: string,
): WeatherSnapshot {
  const d = raw as {
    dt?: number;
    main?: { temp?: number; feels_like?: number; humidity?: number };
    wind?: { speed?: number; gust?: number };
    weather?: { id?: number; description?: string }[];
  };
  if (
    !d ||
    typeof d !== "object" ||
    !Number.isInteger(d.dt) ||
    d.dt! < 0 ||
    d.dt! > 8640000000000 ||
    !d.main ||
    !Array.isArray(d.weather) ||
    !d.weather.length ||
    !d.weather[0] ||
    typeof d.weather[0] !== "object"
  )
    throw new WeatherError("weather_data");
  const snapshot = parseWeatherSnapshot({
    kind,
    temperatureC: d.main.temp,
    feelsLikeC: optional(d.main.feels_like, -120, 90),
    humidityPercent: d.main.humidity,
    windMetersPerSecond: optional(d.wind?.speed, 0, 150),
    gustMetersPerSecond: optional(d.wind?.gust, 0, 150),
    conditionCode: d.weather[0].id,
    summary:
      typeof d.weather[0].description === "string"
        ? d.weather[0].description.slice(0, 120)
        : "날씨",
    validAt: new Date(d.dt! * 1000).toISOString(),
    fetchedAt,
    requestedFor: null,
  });
  return snapshot;
}
async function provider(
  latitude: number,
  longitude: number,
  kind: WeatherSnapshot["kind"],
  key: string,
) {
  const url = new URL(
    `https://api.openweathermap.org/data/2.5/${kind === "current" ? "weather" : "forecast"}`,
  );
  url.search = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    units: "metric",
    lang: "kr",
    appid: key,
  }).toString();
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new WeatherError("weather_provider");
  }
  if (!response.ok)
    throw new WeatherError(
      response.status === 429
        ? "weather_limited"
        : response.status === 401 || response.status === 403
          ? "weather_config"
          : "weather_provider",
    );
  let data: unknown;
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 262144) throw new Error();
        chunks.push(value);
      }
      data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } catch {
    throw new WeatherError("weather_data");
  }
  const fetchedAt = new Date().toISOString();
  if (kind === "current") return [decode(data, kind, fetchedAt)];
  const list = (data as { list?: unknown[] })?.list;
  if (!Array.isArray(list) || !list.length || list.length > 40)
    throw new WeatherError("weather_data");
  const rows = list
    .map((row) => decode(row, kind, fetchedAt))
    .sort((a, b) => a.validAt.localeCompare(b.validAt));
  if (new Set(rows.map((r) => r.validAt)).size !== rows.length)
    throw new WeatherError("weather_data");
  return rows;
}
/** Bounded per-process cache, coalesced requests, no stale-on-error fallback. */
export async function getWeather(
  latitude: number,
  longitude: number,
  target: Date | null = null,
): Promise<WeatherSnapshot> {
  if (
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180
  )
    throw new WeatherError("weather_input");
  const key = process.env.WEATHER_API_KEY?.trim();
  if (!key) throw new WeatherError("weather_config");
  if (activeKey !== key) {
    cache.clear();
    inFlight.clear();
    activeKey = key;
    providerCooldownUntil = 0;
  }
  const now = Date.now();
  if (
    target &&
    (!Number.isFinite(target.getTime()) ||
      target.getTime() <= now ||
      target.getTime() > now + 5 * 86400_000)
  )
    throw new WeatherError("weather_coverage");
  const kind = target ? "forecast" : "current",
    lat = Math.round(latitude * 100) / 100,
    lon = Math.round(longitude * 100) / 100,
    cacheKey = `${kind}:${lat}:${lon}`;
  for (const [id, value] of cache) if (value.expires <= now) cache.delete(id);
  let rows = cache.get(cacheKey)?.rows;
  if (!rows) {
    let pending = inFlight.get(cacheKey);
    if (!pending) {
      if (now < providerCooldownUntil)
        throw new WeatherError("weather_limited");
      if (inFlight.size >= 64) throw new WeatherError("weather_limited");
      pending = provider(lat, lon, kind, key)
        .then((result) => {
          if (activeKey === key) {
            if (cache.size >= 64) cache.delete(cache.keys().next().value!);
            cache.set(cacheKey, {
              expires: Date.now() + WEATHER_TTL_MS,
              rows: result,
            });
          }
          return result;
        })
        .catch((error: unknown) => {
          if (
            activeKey === key &&
            error instanceof WeatherError &&
            error.code === "weather_limited"
          )
            providerCooldownUntil = Date.now() + 60000;
          throw error;
        })
        .finally(() => {
          if (inFlight.get(cacheKey) === pending) inFlight.delete(cacheKey);
        });
      inFlight.set(cacheKey, pending);
    }
    rows = await pending;
  }
  let chosen: WeatherSnapshot;
  if (!target) chosen = { ...rows[0] };
  else {
    const time = target.getTime();
    if (
      time < Date.parse(rows[0].validAt) ||
      time > Date.parse(rows[rows.length - 1].validAt)
    )
      throw new WeatherError("weather_coverage");
    const nearest = rows.reduce((a, b) =>
      Math.abs(Date.parse(a.validAt) - time) <=
      Math.abs(Date.parse(b.validAt) - time)
        ? a
        : b,
    );
    chosen = { ...nearest, requestedFor: target.toISOString() };
  }
  if (!freshWeather(chosen, new Date()))
    throw new WeatherError("weather_stale");
  return chosen;
}
