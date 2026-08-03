export type WeatherSnapshot = {
  temperatureC: number;
  humidityPercent: number;
  summary: string;
  observedAt: string;
};

export async function getWeather(latitude: number, longitude: number): Promise<WeatherSnapshot> {
  const key = process.env.WEATHER_API_KEY;
  if (!key) throw new Error("WEATHER_API_KEY is not configured.");

  const url = new URL("https://api.openweathermap.org/data/2.5/weather");
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("units", "metric");
  url.searchParams.set("appid", key);

  const response = await fetch(url, { next: { revalidate: 600 } });
  if (!response.ok) throw new Error("Weather provider request failed.");
  const data = await response.json() as { main: { temp: number; humidity: number }; weather?: Array<{ description?: string }> };

  return {
    temperatureC: Math.round(data.main.temp * 10) / 10,
    humidityPercent: data.main.humidity,
    summary: data.weather?.[0]?.description ?? "현재 날씨",
    observedAt: new Date().toISOString(),
  };
}
