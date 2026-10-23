import assert from "node:assert/strict";
import { test } from "node:test";
import { typescriptLoader } from "./helpers/load-typescript.mjs";
const load = typescriptLoader();
const calendar = load("lib/training/week-closeout.ts");
const review = load("lib/training/weekly-review.ts");
const collection = load("lib/garmin/collection.ts");
const context = load("lib/training/context.ts");
const zone = "America/Los_Angeles";
test("Sunday closeout and Monday completed week refer to the same Monday–Sunday in each configured zone", () => {
  for (const [timezone, sunday, monday] of [
    [zone, "2026-10-19T06:59:59Z", "2026-10-19T07:00:00Z"],
    ["Asia/Seoul", "2026-10-18T14:59:59Z", "2026-10-18T15:00:00Z"],
    ["Pacific/Kiritimati", "2026-10-18T09:59:59Z", "2026-10-18T10:00:00Z"],
    [zone, "2026-11-02T07:59:59Z", "2026-11-02T08:00:00Z"],
    [zone, "2026-03-09T06:59:59Z", "2026-03-09T07:00:00Z"],
    [zone, "2027-01-04T07:59:59Z", "2027-01-04T08:00:00Z"],
  ]) {
    const a = calendar.closeoutPeriod(timezone, new Date(sunday));
    const b = calendar.closeoutPeriod(timezone, new Date(monday));
    assert.equal(a.early, true);
    assert.equal(b.early, false);
    assert.equal(a.startsOn, b.startsOn);
    assert.equal(a.endsOn, b.endsOn);
    assert.equal(a.nextStartsOn, b.nextStartsOn);
    assert.equal(
      collection.collectionPeriod(timezone, "auto", new Date(sunday)).start,
      a.startsOn,
    );
    assert.equal(
      collection.collectionPeriod(timezone, "previous", new Date(monday)).start,
      b.startsOn,
    );
    assert.equal(
      review.reviewPeriod(timezone, undefined, new Date(sunday), true).startsOn,
      a.startsOn,
    );
    assert.equal(
      review.reviewPeriod(timezone, undefined, new Date(monday)).startsOn,
      b.startsOn,
    );
  }
});
test("Sunday review requires explicit closure, and future or non-Monday dates remain rejected", () => {
  const sunday = new Date("2026-10-18T21:00:00Z"),
    saturday = new Date("2026-10-17T21:00:00Z");
  assert.throws(() => review.reviewPeriod(zone, "2026-10-12", sunday));
  assert.equal(
    review.reviewPeriod(zone, "2026-10-12", sunday, true).startsOn,
    "2026-10-12",
  );
  for (const start of ["2026-10-19", "2026-10-13", "2026-02-30", "2026-08-01"])
    assert.throws(() => review.reviewPeriod(zone, start, sunday, true));
  assert.throws(() =>
    calendar.assertCloseoutPeriod("2026-10-12", zone, saturday),
  );
  assert.equal(collection.collectionPeriod(zone, "current", saturday).end, "2026-10-17");
  assert.equal(
    collection.collectionPeriod(zone, "previous", sunday).start,
    "2026-10-05",
  );
  assert.equal(
    calendar.assertCloseoutPeriod("2026-10-12", zone, sunday).startsOn,
    "2026-10-12",
  );
});
test("closed-week history includes the just-finished week without shifting current condition or plan dates to Monday", () => {
  const now = new Date("2026-10-18T21:00:00Z");
  const ordinary = context.historyPeriod(zone, now);
  const closed = context.historyPeriod(zone, now, "2026-10-12");
  assert.equal(ordinary.end, "2026-10-11");
  assert.equal(closed.end, "2026-10-18");
  assert.equal(closed.today, "2026-10-18");
  assert.equal(
    context.historyPeriod(zone, new Date("2026-10-19T07:00:00Z"), "2026-10-12")
      .end,
    "2026-10-18",
  );
  assert.equal(
    context.historyPeriod(zone, now, "2026-10-19").end,
    "2026-10-11",
  );
});
test("review selection keeps current-plan evidence on the previous week and next-week evidence on the explicitly closed week", async () => {
  const db = {
    from: () => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      abortSignal() {
        return this;
      },
      maybeSingle: async () => ({
        data: {
          closed_at: "2026-10-18T18:00:00Z",
          snapshot_revision: "a".repeat(32),
        },
        error: null,
      }),
    }),
  };
  const select = typescriptLoader({
    "@/lib/supabase/admin": { getSupabaseAdmin: () => db },
  })("lib/training/closeout-storage.ts").reviewSelection;
  const now = new Date("2026-10-18T21:00:00Z");
  assert.equal(
    (await select("owner", zone, undefined, true, now)).period.startsOn,
    "2026-10-12",
  );
  assert.equal(
    (await select("owner", zone, undefined, false, now)).period.startsOn,
    "2026-10-05",
  );
  assert.equal(
    (await select("owner", zone, "2026-10-05", true, now)).period.startsOn,
    "2026-10-05",
  );
});
test("closeout API denies anonymous/other-owner access and rejects malformed, unconfirmed and injected input before storage", async () => {
  let calls = 0;
  const api = typescriptLoader({
    "@/lib/security/admin": {
      requireAdmin: async () => ({
        response: new Response(null, { status: 401 }),
      }),
    },
    "@/lib/training/closeout-storage": {
      readCloseout: () => {
        calls++;
      },
      closeWeek: () => {
        calls++;
      },
    },
  })("app/api/training/closeout/route.ts");
  assert.equal(
    (await api.GET(new Request("http://localhost/api/training/closeout")))
      .status,
    401,
  );
  assert.equal(
    (
      await api.POST(
        new Request("http://localhost/api/training/closeout", {
          method: "POST",
        }),
      )
    ).status,
    401,
  );
  assert.equal(calls, 0);
  const ownerApi = typescriptLoader({
    "@/lib/security/admin": {
      requireAdmin: async () => ({ userId: "verified-owner" }),
    },
    "@/lib/training/closeout-storage": {
      closeWeek: async (uid) => {
        assert.equal(uid, "verified-owner");
        calls++;
        return {};
      },
    },
  })("app/api/training/closeout/route.ts");
  for (const body of [
    { startsOn: "2026-10-12", revision: "a".repeat(32), confirmed: false },
    { startsOn: "2026-02-30", revision: "a".repeat(32), confirmed: true },
    {
      startsOn: "2026-10-12",
      revision: "a".repeat(32),
      confirmed: true,
      userId: "attacker",
    },
  ]) {
    const res = await ownerApi.POST(
      new Request("http://localhost/api/training/closeout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify(body),
      }),
    );
    assert.equal(res.status, 400);
  }
  assert.equal(calls, 0);
  const ok = await ownerApi.POST(
    new Request("http://localhost/api/training/closeout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "http://localhost",
      },
      body: JSON.stringify({
        startsOn: "2026-10-12",
        revision: "a".repeat(32),
        confirmed: true,
      }),
    }),
  );
  assert.equal(ok.status, 200);
  assert.equal(calls, 1);
});
test("an outdated Sunday closeout stops review generation before any reservation or inference", async () => {
  let inference = 0,
    reserved = 0;
  const service = typescriptLoader({
    "@/scripts/lib/chatgpt-inference.mjs": {
      generateWithSubscription: () => {
        inference++;
      },
    },
    "./review-storage": {
      readReview: async () => ({ closeout: { fresh: false } }),
      reserveReview: () => {
        reserved++;
      },
    },
  })("lib/training/review-service.ts");
  await assert.rejects(service.generateReview("owner"), /closeout_changed/);
  assert.equal(inference, 0);
  assert.equal(reserved, 0);
});
