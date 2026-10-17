import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(file, modules = {}) {
  const c = {
    exports: {},
    require: (id) => {
      if (!(id in modules)) throw new Error("Unexpected " + id);
      return modules[id];
    },
    Date,
    Intl,
    Response,
    Request,
    URL,
    URLSearchParams,
    fetch,
    Buffer,
    AbortSignal,
    process,
  };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../" + file, import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2023,
        },
      },
    ).outputText,
    c,
  );
  return c.exports;
}

// Explicit opt-in: two OpenWeather requests for a public city centre; no OpenAI calls.
const conditions = load("lib/weather/conditions.ts");
const service = load("lib/services/weather.ts", {
  "server-only": {},
  "@/lib/weather/conditions": conditions,
});
const current = await service.getWeather(32.72, -117.16);
assert.equal(current.kind, "current");
assert.equal(conditions.freshWeather(current), true);
const tomorrow = new Date(Date.now() + 24 * 3600000);
const forecast = await service.getWeather(32.72, -117.16, tomorrow);
assert.equal(forecast.kind, "forecast");
assert.equal(conditions.freshWeather(forecast), true);
console.log(
  "PASS: existing key supports current weather and 5-day/3-hour forecast. Real provider timestamps validated; no OpenAI requests.",
);
