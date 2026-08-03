import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { encryptToken } from "@/lib/security/tokens";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const stateCookie = "traini_garmin_oauth_state";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const rawState = request.nextUrl.searchParams.get("state");
  const tokenUrl = process.env.GARMIN_TOKEN_URL;
  const clientId = process.env.GARMIN_CLIENT_ID;
  const clientSecret = process.env.GARMIN_CLIENT_SECRET;
  const redirectUri = process.env.GARMIN_REDIRECT_URI;
  const stateSecret = process.env.GARMIN_STATE_SECRET;
  if (!code || !rawState || !tokenUrl || !clientId || !clientSecret || !redirectUri || !stateSecret) return Response.json({ error: "Invalid Garmin OAuth callback." }, { status: 400 });

  try {
    const state = JSON.parse(Buffer.from(rawState, "base64url").toString()) as { userId: string; nonce: string; signature: string };
    const expected = createHmac("sha256", stateSecret).update(`${state.userId}.${state.nonce}`).digest("hex");
    const cookieNonce = request.cookies.get(stateCookie)?.value;
    if (!cookieNonce || cookieNonce !== state.nonce || !timingSafeEqual(Buffer.from(expected), Buffer.from(state.signature))) throw new Error("OAuth state validation failed.");

    const tokenResponse = await fetch(tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }) });
    if (!tokenResponse.ok) throw new Error("Garmin token exchange failed.");
    const token = await tokenResponse.json() as { access_token?: string; refresh_token?: string; expires_in?: number; user_id?: string | number };
    if (!token.access_token || !token.refresh_token) throw new Error("Garmin did not return OAuth tokens.");

    const supabase = getSupabaseAdmin();
    await supabase.from("profiles").upsert({ id: state.userId });
    const { error } = await supabase.from("garmin_connections").upsert({ user_id: state.userId, garmin_user_id: token.user_id ? String(token.user_id) : null, access_token_encrypted: encryptToken(token.access_token), refresh_token_encrypted: encryptToken(token.refresh_token), expires_at: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null, updated_at: new Date().toISOString() });
    if (error) throw error;
    const response = NextResponse.redirect(new URL("/running-analysis?garmin=connected", request.url));
    response.cookies.delete(stateCookie);
    return response;
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Garmin connection failed." }, { status: 400 });
  }
}
