import { createHmac, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

const stateCookie = "traini_garmin_oauth_state";

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId");
  const authorizationUrl = process.env.GARMIN_AUTHORIZATION_URL;
  const clientId = process.env.GARMIN_CLIENT_ID;
  const redirectUri = process.env.GARMIN_REDIRECT_URI;
  const secret = process.env.GARMIN_STATE_SECRET;
  if (!userId || !authorizationUrl || !clientId || !redirectUri || !secret) {
    return Response.json({ error: "Garmin OAuth is not configured. Set the Garmin environment variables and supply userId." }, { status: 503 });
  }

  const nonce = randomUUID();
  const signature = createHmac("sha256", secret).update(`${userId}.${nonce}`).digest("hex");
  const state = Buffer.from(JSON.stringify({ userId, nonce, signature })).toString("base64url");
  const url = new URL(authorizationUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);

  const response = NextResponse.redirect(url);
  response.cookies.set(stateCookie, nonce, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" });
  return response;
}
