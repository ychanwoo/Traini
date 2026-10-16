"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

let browserClient: SupabaseClient<Database> | undefined;

export function getSupabaseBrowserClient() {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publishableKey) {
    throw new Error("Supabase browser configuration is missing.");
  }

  // Retire the former localStorage session; never copy unverified legacy tokens
  // into the new SSR cookie session. Existing cookies remain untouched.
  if (typeof window !== "undefined") {
    try { window.localStorage.removeItem(`sb-${new URL(url).hostname.split(".")[0]}-auth-token`); }
    catch { /* Cookies still work when browser storage access is restricted. */ }
  }
  browserClient = createBrowserClient<Database>(url, publishableKey, {
    cookieOptions: { sameSite: "lax", path: "/", secure: typeof window !== "undefined" && window.location.protocol === "https:" },
  });
  return browserClient;
}
