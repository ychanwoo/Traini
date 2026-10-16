import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";

export async function getSupabaseServerClient() {
  const store = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Authentication configuration is missing.");
  return createServerClient<Database>(url, key, {
    cookieOptions: { sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(15_000) }) },
    cookies: {
      getAll: () => store.getAll(),
      setAll(values) {
        // Server Components cannot write cookies; Proxy refreshes them before rendering.
        // Route Handlers can write and must not silently discard failures.
        for (const { name, value, options } of values) store.set(name, value, options);
      },
    },
  });
}
