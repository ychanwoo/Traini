import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

// A separate test session. No email is sent and the browser session is untouched.
export async function withLocalAdminSession(run) {
  const origin = "http://localhost:3017";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  assert.equal(new URL(url).hostname, "kmmutfcgshellvjgpick.supabase.co");
  const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, init) =>
        fetch(url, { ...init, signal: AbortSignal.timeout(15000) }),
    },
  });
  const check = ({ data, error }) => {
    if (error) throw new Error("Local validation setup unavailable");
    return data;
  };
  const uid = process.env.TRAINI_ADMIN_USER_ID;
  const cookies = new Map();
  const auth = createServerClient(
    url,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
        setAll: (values) => {
          for (const { name, value } of values) cookies.set(name, value);
        },
      },
    },
  );
  async function request(
    path,
    { method = "GET", body, timeoutMs = 30000 } = {},
  ) {
    assert.ok(path.startsWith("/api/") && !path.startsWith("//"));
    assert.ok(
      Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 300000,
    );
    const response = await fetch(origin + path, {
      method,
      redirect: "error",
      headers: {
        cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        origin,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok)
      throw new Error(`Local validation request failed (${response.status})`);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    return response.json();
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
    return await run({ request, service, uid, check });
  } finally {
    await auth.auth.signOut({ scope: "local" });
  }
}
