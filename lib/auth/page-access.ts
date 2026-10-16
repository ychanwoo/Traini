import "server-only";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function requireAdminPage() {
  let reason = "expired";
  try {
    if (!process.env.TRAINI_ADMIN_USER_ID) reason = "connection";
    else {
      const client = await getSupabaseServerClient();
      const { data: { user }, error } = await client.auth.getUser();
      if (!error && user?.id === process.env.TRAINI_ADMIN_USER_ID) return;
      reason = user ? "admin" : error && error.status && error.status >= 500 ? "connection" : "expired";
    }
  } catch { reason = "connection"; }
  redirect(`/login?error=${reason}`);
}
