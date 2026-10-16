import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeDestination } from "@/lib/auth/redirect";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // API handlers independently verify credentials. Do not refresh twice or turn
  // API errors into HTML redirects. All API routes requireAdmin before doing work.
  if (path.startsWith("/api/") || path === "/auth/callback" || path === "/auth/signout")
    return NextResponse.next();
  const publicPage = path === "/" || path === "/login";
  const pending: { name: string; value: string; options: CookieOptions }[] = [];
  const finish = (response: NextResponse) => {
    pending.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Vary", "Cookie");
    return response;
  };
  let state: "admin" | "missing" | "denied" | "unavailable" = "missing";
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const adminId = process.env.TRAINI_ADMIN_USER_ID;
    if (!url || !key || !adminId) state = "unavailable";
    else {
      const supabase = createServerClient(url, key, {
        cookieOptions: { sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" },
        global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(15_000) }) },
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll(values) {
            values.forEach(({ name, value }) => request.cookies.set(name, value));
            pending.push(...values);
          },
        },
      });
      const { data: { user }, error } = await supabase.auth.getUser();
      state = user && !error ? user.id === adminId ? "admin" : "denied"
        : error && (error.name === "AuthRetryableFetchError" || (error.status ?? 0) >= 500) ? "unavailable" : "missing";
    }
  } catch { state = "unavailable"; }
  if (state === "admin" && path === "/login") {
    const target = request.nextUrl.clone();
    target.pathname = safeDestination(target.searchParams.get("next"));
    target.search = "";
    return finish(NextResponse.redirect(target));
  }
  if (publicPage || state === "admin") return finish(NextResponse.next({ request }));
  const target = request.nextUrl.clone();
  target.pathname = "/login";
  target.search = "";
  target.searchParams.set("next", safeDestination(path));
  if (state !== "missing") target.searchParams.set("error", state === "denied" ? "admin" : "connection");
  return finish(NextResponse.redirect(target));
}

export const config = {
  matcher: ["/((?!_next/static/|_next/image|images/|icons/|favicon.ico$).*)"],
};
