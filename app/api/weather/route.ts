import { requireAdmin } from "@/lib/security/admin";
import { getWeather } from "@/lib/services/weather";
import {
  weatherQuery,
  WeatherError,
  weatherErrorMessage,
} from "@/lib/weather/conditions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Authorization",
};
export async function GET(request: Request) {
  const access = await requireAdmin(request);
  if (access.response) {
    for (const [key, value] of Object.entries(headers))
      access.response.headers.set(key, value);
    return access.response;
  }
  try {
    const timezone = process.env.TRAINI_TIMEZONE ?? "America/Los_Angeles";
    const { latitude, longitude, target } = weatherQuery(
      new URL(request.url).searchParams,
      timezone,
    );
    return Response.json(
      { ...(await getWeather(latitude, longitude, target)), timezone },
      { headers },
    );
  } catch (error) {
    const code =
      error instanceof WeatherError ? error.code : "weather_provider";
    return Response.json(
      { error: weatherErrorMessage(code), code },
      {
        status: ["weather_input", "weather_time"].includes(code)
          ? 400
          : code === "weather_coverage"
            ? 422
            : code === "weather_limited"
              ? 429
              : code === "weather_config"
                ? 503
                : 502,
        headers,
      },
    );
  }
}
