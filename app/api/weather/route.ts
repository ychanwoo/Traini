import { NextRequest } from "next/server";
import { getWeather } from "@/lib/services/weather";

export async function GET(request: NextRequest) {
  const latitude = Number(request.nextUrl.searchParams.get("lat"));
  const longitude = Number(request.nextUrl.searchParams.get("lon"));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return Response.json({ error: "lat and lon query parameters are required." }, { status: 400 });
  }

  try {
    return Response.json(await getWeather(latitude, longitude));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Weather request failed." }, { status: 502 });
  }
}
