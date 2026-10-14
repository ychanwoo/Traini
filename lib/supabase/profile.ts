"use client";

import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "./client";

export async function ensureProfile(user: User) {
  const displayName = user.user_metadata.full_name ?? user.user_metadata.name ?? user.email?.split("@")[0] ?? "러너";
  // Create missing profiles without overwriting a name or existing race goal.
  const { error } = await getSupabaseBrowserClient().from("profiles").upsert(
    { id: user.id, display_name: displayName }, { onConflict: "id", ignoreDuplicates: true },
  );
  if (error) throw error;
}
