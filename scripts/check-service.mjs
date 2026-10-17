import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  privateDirectory,
  readRecord,
  publicStatus,
} from "./lib/chatgpt-connection.mjs";

// Read only. No Garmin login, inference, generation reservation or writes to training data.
const output = {
  database: "unavailable",
  localCollector: false,
  chatgptConnected: false,
  generation: null,
};
const owner = process.env.TRAINI_ADMIN_USER_ID;
try {
  if (
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !==
      "kmmutfcgshellvjgpick.supabase.co" ||
    !owner ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  )
    throw new Error();
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (url, init) =>
          fetch(url, { ...init, signal: AbortSignal.timeout(15000) }),
      },
    },
  );
  const [profile, config] = await Promise.all([
    db.from("profiles").select("id").eq("id", owner).maybeSingle(),
    db
      .from("traini_admin_config")
      .select("user_id")
      .eq("singleton", true)
      .maybeSingle(),
  ]);
  if (
    profile.error ||
    config.error ||
    profile.data?.id !== owner ||
    config.data?.user_id !== owner
  )
    throw new Error();
  const { data, error } = await db.rpc("training_generation_status", {
    p_user_id: owner,
  });
  if (error) throw new Error();
  output.database = "ready";
  output.generation = data;
} catch {
  /* Print a bounded status, never credentials, URLs, provider bodies or private records. */
}
try {
  const python = process.env.TRAINI_COLLECTOR_PYTHON;
  if (
    process.env.TRAINI_LOCAL_COLLECTOR_ENABLED === "true" &&
    process.platform === "darwin" &&
    isAbsolute(python ?? "")
  ) {
    await access(python, constants.X_OK);
    output.localCollector = true;
  }
} catch {
  /* Configuration may be intentionally unavailable on hosted environments. */
}
try {
  output.chatgptConnected = Boolean(
    publicStatus(await readRecord(privateDirectory()), owner).connected,
  );
} catch {
  /* Never dump connection records. */
}
console.log(JSON.stringify(output, null, 2));
if (output.database !== "ready") process.exitCode = 1;
