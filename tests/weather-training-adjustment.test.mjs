import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(file, modules = {}) {
  const context = {
    exports: {},
    Response,
    Request,
    URL,
    URLSearchParams,
    Buffer,
    AbortSignal,
    Date,
    Intl,
    Error,
    process,
    require: (id) => {
      if (!(id in modules)) throw new Error(`Unexpected import ${id}`);
      return modules[id];
    },
  };
  const compiled = ts.transpileModule(
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
    {
      reportDiagnostics: true,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2017,
      },
    },
  );
  assert.equal(
    compiled.diagnostics?.filter(
      (d) => d.category === ts.DiagnosticCategory.Error,
    ).length ?? 0,
    0,
  );
  vm.runInNewContext(compiled.outputText, context);
  return context.exports;
}
const conditions = load("lib/weather/conditions.ts");
const guidance = load("lib/weather/guidance.ts", {
  "./conditions": conditions,
});
const epoch = Date.parse("2026-10-16T18:00:00Z"),
  now = new Date(epoch);
function snapshot(edit = {}) {
  return {
    kind: "current",
    temperatureC: 20,
    feelsLikeC: 20,
    humidityPercent: 50,
    windMetersPerSecond: 2,
    gustMetersPerSecond: null,
    conditionCode: 800,
    summary: "맑음",
    validAt: now.toISOString(),
    fetchedAt: now.toISOString(),
    requestedFor: null,
    ...edit,
  };
}
const workout = (kind = "easy", paceSecondsPerKm = 330) => ({
  kind,
  paceSecondsPerKm,
  completed: false,
});
function providerData(edit = {}) {
  return {
    dt: epoch / 1000,
    main: { temp: 25, feels_like: 27, humidity: 60 },
    wind: { speed: 3, gust: 5 },
    weather: [{ id: 800, description: "맑음" }],
    ...edit,
  };
}
function service(fetcher, clock = { value: epoch }) {
  class Clock extends Date {
    constructor(...args) {
      super(...(args.length ? args : [clock.value]));
    }
    static now() {
      return clock.value;
    }
  }
  const source = readFileSync(
    new URL("../lib/services/weather.ts", import.meta.url),
    "utf8",
  );
  const c = {
    exports: {},
    require: (id) => {
      if (id === "server-only") return {};
      assert.equal(id, "@/lib/weather/conditions");
      return conditions;
    },
    process: { env: { WEATHER_API_KEY: "private-test-key" } },
    Buffer,
    Date: Clock,
    URL,
    URLSearchParams,
    Response,
    AbortSignal,
    fetch: fetcher,
  };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2023,
      },
    }).outputText,
    c,
  );
  return c.exports;
}
test("provider snapshot preserves null optional data and rejects invalid or missing metrics", () => {
  assert.equal(
    conditions.parseWeatherSnapshot(
      snapshot({ feelsLikeC: null, windMetersPerSecond: null }),
    ).feelsLikeC,
    null,
  );
  for (const edit of [
    { temperatureC: NaN },
    { temperatureC: null },
    { humidityPercent: 101 },
    { windMetersPerSecond: -1 },
    { gustMetersPerSecond: Infinity },
    { validAt: "bad" },
    { conditionCode: "800" },
    { summary: "x".repeat(121) },
  ])
    assert.throws(
      () => conditions.parseWeatherSnapshot(snapshot(edit)),
      /weather_data/,
    );
});
test("current observation freshness uses provider time, not retrieval time", () => {
  assert.equal(conditions.freshWeather(snapshot(), now), true);
  for (const edit of [
    { validAt: new Date(epoch - 91 * 60000).toISOString() },
    { validAt: new Date(epoch + 6 * 60000).toISOString() },
    { fetchedAt: new Date(epoch - 11 * 60000).toISOString() },
    { fetchedAt: "invalid" },
  ])
    assert.equal(conditions.freshWeather(snapshot(edit), now), false);
});
test("forecast expires at requested time and never passes as current weather", () => {
  const w = snapshot({
    kind: "forecast",
    validAt: new Date(epoch + 3 * 3600000).toISOString(),
    requestedFor: new Date(epoch + 4 * 3600000).toISOString(),
  });
  assert.equal(conditions.freshWeather(w, now), true);
  assert.equal(
    conditions.freshWeather({ ...w, requestedFor: null }, now),
    false,
  );
  assert.equal(
    conditions.freshWeather(
      { ...w, requestedFor: new Date(epoch - 1000).toISOString() },
      now,
    ),
    false,
  );
  assert.equal(
    conditions.freshWeather(
      { ...w, validAt: new Date(epoch + 6 * 3600000).toISOString() },
      now,
    ),
    false,
  );
});
test("training clock conversion honors timezone, date rollover and fractional offsets", () => {
  assert.equal(
    conditions
      .trainingInstant("2026-10-18", "07:00", "America/Los_Angeles")
      .toISOString(),
    "2026-10-18T14:00:00.000Z",
  );
  assert.equal(
    conditions
      .trainingInstant("2026-10-18", "07:00", "Asia/Seoul")
      .toISOString(),
    "2026-10-17T22:00:00.000Z",
  );
  assert.equal(
    conditions
      .trainingInstant("2026-10-18", "07:00", "Asia/Kathmandu")
      .toISOString(),
    "2026-10-18T01:15:00.000Z",
  );
});
test("DST nonexistent and ambiguous times are rejected instead of silently shifted", () => {
  for (const [date, time] of [
    ["2026-03-08", "02:30"],
    ["2026-11-01", "01:30"],
    ["2026-02-30", "07:00"],
    ["2026-10-18", "25:00"],
    ["2026-13-18", "07:00"],
  ])
    assert.throws(
      () => conditions.trainingInstant(date, time, "America/Los_Angeles"),
      /weather_time/,
    );
  assert.equal(
    conditions
      .trainingInstant("2026-11-01", "07:00", "America/Los_Angeles")
      .toISOString(),
    "2026-11-01T15:00:00.000Z",
  );
});
test("query rejects empty, duplicate, malformed and out-of-range coordinates before provider access", () => {
  for (const q of [
    "lat=&lon=1",
    "lat=0x20&lon=1",
    "lat=NaN&lon=1",
    "lat=91&lon=1",
    "lat=0&lon=-181",
    "lat=1&lat=2&lon=1",
    "lat=1&lon=1&key=secret",
    "lat=1",
    "lat=1&lon=1&date=2026-10-18",
  ])
    assert.throws(
      () =>
        conditions.weatherQuery(
          new URLSearchParams(q),
          "America/Los_Angeles",
          now,
        ),
      /weather_input|weather_time/,
    );
  const q = conditions.weatherQuery(
    new URLSearchParams("lat=32.7157&lon=-117.1611"),
    "America/Los_Angeles",
    now,
  );
  assert.equal(q.latitude, 32.72);
  assert.equal(q.longitude, -117.16);
  assert.equal(q.target, null);
  for (const date of ["2026-10-15", "2026-10-25"])
    assert.throws(
      () =>
        conditions.weatherQuery(
          new URLSearchParams(`lat=1&lon=1&date=${date}&time=07:00`),
          "America/Los_Angeles",
          now,
        ),
      /weather_coverage/,
    );
});
test("cool or humid-only conditions do not speed up or arbitrarily slow a session", () => {
  for (const temperatureC of [-1, 5, 15, 20]) {
    const g = guidance.weatherGuidance(
      workout(),
      snapshot({ temperatureC, feelsLikeC: temperatureC, humidityPercent: 95 }),
      now,
    );
    assert.equal(g.adjustedPace, null);
    assert.equal(g.slowdownPercent, 0);
  }
});
test("easy and long runs receive bounded heat references without changing original prescription", () => {
  for (const kind of ["easy", "long"]) {
    const w = Object.freeze(workout(kind)),
      s = Object.freeze(
        snapshot({ temperatureC: 30, feelsLikeC: 32, humidityPercent: 85 }),
      ),
      g = guidance.weatherGuidance(w, s, now);
    assert.equal(g.status, "reference");
    assert.equal(g.slowdownPercent, 10);
    assert.equal(g.originalPace, 330);
    assert.ok(g.adjustedPace >= 330 && g.adjustedPace <= Math.ceil(330 * 1.1));
    assert.equal(w.paceSecondsPerKm, 330);
  }
});
test("interval and tempo sessions use effort guidance without rewriting repetition paces", () => {
  for (const kind of ["interval", "threshold"]) {
    const g = guidance.weatherGuidance(
      workout(kind, 230),
      snapshot({ temperatureC: 30, feelsLikeC: 31, humidityPercent: 80 }),
      now,
    );
    assert.equal(g.status, "effort");
    assert.equal(g.adjustedPace, null);
    assert.equal(g.originalPace, 230);
    assert.match(g.reasons.join(" "), /반복 페이스/);
  }
});
test("wind and gust guidance never assumes route direction or computes fake wind pace", () => {
  for (const s of [
    snapshot({ windMetersPerSecond: 7 }),
    snapshot({ gustMetersPerSecond: 12 }),
  ]) {
    const g = guidance.weatherGuidance(workout(), s, now);
    assert.equal(g.adjustedPace, null);
    assert.match(g.reasons.join(" "), /진행 방향/);
    assert.equal(g.status, "effort");
  }
});
test("severe heat, cold, storms and hazardous precipitation suppress numerical prescriptions", () => {
  for (const edit of [
    { temperatureC: 36 },
    { temperatureC: -12 },
    { windMetersPerSecond: 16 },
    { gustMetersPerSecond: 21 },
    { conditionCode: 211 },
    { conditionCode: 511 },
    { conditionCode: 602 },
    { conditionCode: 781 },
  ]) {
    const g = guidance.weatherGuidance(workout(), snapshot(edit), now);
    assert.equal(g.status, "conditions");
    assert.equal(g.adjustedPace, null);
    assert.match(g.reasons.join(" "), /실내/);
  }
});
test("missing or stale weather, null pace, completed workouts and rest never invent a pace", () => {
  for (const s of [
    null,
    snapshot({ validAt: new Date(epoch - 2 * 3600000).toISOString() }),
  ])
    assert.equal(
      guidance.weatherGuidance(workout(), s, now).status,
      "unavailable",
    );
  const hot = snapshot({ temperatureC: 30, feelsLikeC: 31 });
  assert.equal(
    guidance.weatherGuidance(workout("easy", null), hot, now).adjustedPace,
    null,
  );
  assert.equal(
    guidance.weatherGuidance({ ...workout(), completed: true }, hot, now)
      .status,
    "completed",
  );
  assert.equal(
    guidance.weatherGuidance(workout("rest", null), hot, now).status,
    "rest",
  );
});
test("weather service uses current provider dt, metric units and redacted responses", async () => {
  let requested;
  const svc = service(async (url) => {
    requested = new URL(url);
    return Response.json(providerData({ dt: (epoch - 30 * 60000) / 1000 }));
  });
  const result = await svc.getWeather(32.7157, -117.1611);
  assert.equal(result.validAt, new Date(epoch - 30 * 60000).toISOString());
  assert.equal(result.fetchedAt, now.toISOString());
  assert.equal(requested.searchParams.get("lat"), "32.72");
  assert.equal(requested.searchParams.get("units"), "metric");
  assert.equal(JSON.stringify(result).includes("private-test-key"), false);
  assert.equal(result.windMetersPerSecond, 3);
});
test("cache coalesces parallel requests and expires after ten minutes", async () => {
  const clock = { value: epoch };
  let calls = 0;
  const svc = service(async () => {
    calls++;
    return Response.json(providerData({ dt: clock.value / 1000 }));
  }, clock);
  await Promise.all([svc.getWeather(32, -117), svc.getWeather(32, -117)]);
  assert.equal(calls, 1);
  clock.value += 9 * 60000;
  await svc.getWeather(32, -117);
  assert.equal(calls, 1);
  clock.value += 2 * 60000;
  await svc.getWeather(32, -117);
  assert.equal(calls, 2);
});
test("forecast uses nearest actual slot and rejects dates beyond returned coverage", async () => {
  const svc = service(async (url) => {
    assert.match(String(url), /\/forecast\?/);
    return Response.json({
      list: [3, 6, 9].map((h) =>
        providerData({ dt: (epoch + h * 3600000) / 1000 }),
      ),
    });
  });
  const target = new Date(epoch + 4 * 3600000),
    result = await svc.getWeather(32, -117, target);
  assert.equal(result.kind, "forecast");
  assert.equal(result.validAt, new Date(epoch + 3 * 3600000).toISOString());
  assert.equal(result.requestedFor, target.toISOString());
  await assert.rejects(
    svc.getWeather(32, -117, new Date(epoch + 10 * 3600000)),
    /weather_coverage/,
  );
  await assert.rejects(
    svc.getWeather(32, -117, new Date(epoch + 3600000)),
    /weather_coverage/,
  );
});
test("unsupported provider access, rate limits, outages and malformed data fail without stale fallback", async () => {
  for (const [status, code] of [
    [401, "weather_config"],
    [403, "weather_config"],
    [429, "weather_limited"],
    [500, "weather_provider"],
  ])
    await assert.rejects(
      service(async () => new Response("SECRET", { status })).getWeather(
        32,
        -117,
      ),
      new RegExp(code),
    );
  for (const data of [
    {},
    providerData({ main: { temp: 20 } }),
    providerData({ dt: Infinity }),
    providerData({ wind: { speed: "3" } }),
  ])
    await assert.rejects(
      service(async () => Response.json(data)).getWeather(32, -117),
      /weather_data/,
    );
  await assert.rejects(
    service(async () => {
      throw new Error("SECRET");
    }).getWeather(32, -117),
    /^Error: weather_provider$/,
  );
  await assert.rejects(
    service(async () => new Response("not JSON")).getWeather(32, -117),
    /weather_data/,
  );
  await assert.rejects(
    service(async () =>
      Response.json(providerData({ dt: (epoch - 2 * 3600000) / 1000 })),
    ).getWeather(32, -117),
    /weather_stale/,
  );
});
test("cache is bounded and evicts oldest regions without dropping active request deduplication", async () => {
  let calls = 0;
  const svc = service(async () => {
    calls++;
    return Response.json(providerData());
  });
  for (let i = 0; i < 65; i++) await svc.getWeather(i, 0);
  assert.equal(calls, 65);
  await svc.getWeather(0, 0);
  assert.equal(calls, 66);
});
function route(access, backend = async () => snapshot()) {
  return load("app/api/weather/route.ts", {
    "@/lib/security/admin": { requireAdmin: async () => access },
    "@/lib/services/weather": { getWeather: backend },
    "@/lib/weather/conditions": conditions,
  });
}
test("weather API checks administrator before any provider call and marks every response private", async () => {
  let calls = 0;
  for (const status of [401, 403]) {
    const r = await route(
      { response: Response.json({ error: "denied" }, { status }) },
      async () => {
        calls++;
      },
    ).GET(new Request("https://traini.test/api/weather?lat=32&lon=-117"));
    assert.equal(r.status, status);
    assert.match(r.headers.get("cache-control"), /private, no-store/);
    assert.match(r.headers.get("vary"), /Cookie/);
  }
  assert.equal(calls, 0);
});
test("weather API validates requests and exposes bounded errors without API key leakage", async () => {
  const good = route({ userId: "owner" }),
    origin = "https://traini.test/api/weather";
  assert.equal(
    (await good.GET(new Request(origin + "?lat=&lon=1"))).status,
    400,
  );
  const r = await good.GET(new Request(origin + "?lat=32&lon=-117"));
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control"), /no-store/);
  const failed = await route({ userId: "owner" }, async () => {
    throw new Error("private-test-key");
  }).GET(new Request(origin + "?lat=32&lon=-117"));
  assert.equal(failed.status, 502);
  assert.equal((await failed.text()).includes("private-test-key"), false);
});
test("feels-like and humidity signals are not counted twice and cold windchill suppresses pace", () => {
  const g = guidance.weatherGuidance(
    workout(),
    snapshot({ temperatureC: 25, feelsLikeC: 30, humidityPercent: 85 }),
    now,
  );
  assert.equal(g.slowdownPercent, 8);
  assert.equal(
    guidance.weatherGuidance(
      workout(),
      snapshot({ temperatureC: 1, feelsLikeC: -12 }),
      now,
    ).status,
    "conditions",
  );
});
test("expired cache followed by provider failure never serves previous observations", async () => {
  const clock = { value: epoch };
  let calls = 0;
  const svc = service(async () => {
    if (++calls > 1) throw new Error("offline");
    return Response.json(providerData());
  }, clock);
  await svc.getWeather(32, -117);
  clock.value += 11 * 60000;
  await assert.rejects(svc.getWeather(32, -117), /weather_provider/);
  assert.equal(calls, 2);
});
test("in-flight requests are capped and coalescing remains available at the cap", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const svc = service(async () => {
    calls++;
    await gate;
    return Response.json(providerData());
  });
  const requests = Array.from({ length: 64 }, (_, i) => svc.getWeather(i, 0));
  const repeated = svc.getWeather(0, 0);
  await assert.rejects(svc.getWeather(65, 0), /weather_limited/);
  release();
  await Promise.all([...requests, repeated]);
  assert.equal(calls, 64);
});
test("provider rate limits pause new uncached regions for a minute without switching providers", async () => {
  const clock = { value: epoch };
  let calls = 0;
  const svc = service(async () => {
    calls++;
    return new Response("", { status: 429 });
  }, clock);
  await assert.rejects(svc.getWeather(32, -117), /weather_limited/);
  await assert.rejects(svc.getWeather(33, -118), /weather_limited/);
  assert.equal(calls, 1);
  clock.value += 61000;
  await assert.rejects(svc.getWeather(33, -118), /weather_limited/);
  assert.equal(calls, 2);
});
