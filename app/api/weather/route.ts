import { requireAdmin } from "@/lib/security/admin";
import { NextRequest } from "next/server";
import { getWeather } from "@/lib/services/weather";

export async function GET(request: NextRequest) {
  const access = await requireAdmin(request);
  if (access.response) return access.response;
  const latitude = Number(request.nextUrl.searchParams.get("lat"));
  const longitude = Number(request.nextUrl.searchParams.get("lon"));
  if (!request.nextUrl.searchParams.has("lat") || !request.nextUrl.searchParams.has("lon") || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return Response.json({ error: "lat and lon query parameters are required." }, { status: 400 });
  }

  try {
    return Response.json(await getWeather(latitude, longitude), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "날씨 정보를 가져오지 못했습니다." }, { status: 502 });
  }
}
