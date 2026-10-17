// Explicit, opt-in production-transport smoke test. At most one generation POST, never retries.
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
if (process.env.TRAINI_LIVE_AI_TEST !== "1")
  throw new Error(
    "Explicit opt-in required: TRAINI_LIVE_AI_TEST=1 npm run test:subscription:live",
  );
const origin = "http://localhost:3017";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
assert.equal(new URL(url).hostname, "kmmutfcgshellvjgpick.supabase.co");
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const check = ({ data, error }) => {
  if (error) throw new Error("Smoke-test setup unavailable");
  return data;
};
const uid = process.env.TRAINI_ADMIN_USER_ID;
const before = check(
  await service
    .from("training_plans")
    .select("id,summary,generation_id,created_at")
    .eq("user_id", uid)
    .order("id"),
);
const cookies = new Map();
const auth = createServerClient(url, key, {
  cookies: {
    getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
    setAll: (values) => {
      for (const { name, value } of values) cookies.set(name, value);
    },
  },
});
async function request(path, body) {
  const response = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    redirect: "error",
    headers: {
      cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      origin,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(240000),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      `Live review stopped (${response.status}, ${typeof value.code === "string" ? value.code : "request_failed"}); no automatic retry`,
    );
  return value;
}
try {
  const account = check(await service.auth.admin.getUserById(uid));
  const link = check(
    await service.auth.admin.generateLink({
      type: "magiclink",
      email: account.user.email,
    }),
  );
  check(
    await auth.auth.verifyOtp({
      type: "magiclink",
      token_hash: link.properties.hashed_token,
    }),
  );
  const quota = await request("/api/training/generation-status");
  if (
    quota.active ||
    quota.quota.remaining < 1 ||
    (quota.quota.retryAt && Date.parse(quota.quota.retryAt) > Date.now())
  )
    throw new Error(
      "Generation currently busy or limited; no inference requested",
    );
  const existing = await request("/api/training/review");
  const result = existing.review?.fresh
    ? existing
    : await request("/api/training/review", {
        startsOn: existing.period.startsOn,
      });
  assert.ok(
    result.review?.fresh,
    "Saved review must validate against the current inputs",
  );
  const after = await request("/api/training/generation-status");
  assert.ok(
    after.quota.used - quota.quota.used <= 1,
    "No more than one reserved request",
  );
  assert.deepEqual(
    check(
      await service
        .from("training_plans")
        .select("id,summary,generation_id,created_at")
        .eq("user_id", uid)
        .order("id"),
    ),
    before,
    "Existing training plans must remain unchanged",
  );
  console.log(
    JSON.stringify({
      reviewSavedAndFresh: true,
      newGenerationRequests: after.quota.used - quota.quota.used,
      remaining: after.quota.remaining,
      existingPlansPreserved: true,
    }),
  );
} finally {
  await auth.auth.signOut({ scope: "local" });
}
