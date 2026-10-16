import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { safeDestination } from "@/lib/auth/redirect";

export async function GET(request: NextRequest) {
  const target = request.nextUrl.clone();
  target.pathname = "/login";
  target.search = "";
  const response = (error?: string) => {
    if (error) target.searchParams.set("error", error);
    const result = NextResponse.redirect(target);
    result.headers.set("Cache-Control", "private, no-store");
    result.headers.set("Referrer-Policy", "no-referrer");
    return result;
  };
  const code = request.nextUrl.searchParams.get("code");
  if (!code || request.nextUrl.searchParams.has("error")) return response("oauth");
  if (!process.env.TRAINI_ADMIN_USER_ID) return response("connection");
  try {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return response("oauth");
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return response("oauth");
    if (user.id !== process.env.TRAINI_ADMIN_USER_ID) {
      await supabase.auth.signOut({ scope: "local" });
      return response("admin");
    }
    target.pathname = safeDestination(request.nextUrl.searchParams.get("next"));
    return response();
  } catch { return response("connection"); }
}
