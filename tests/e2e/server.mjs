import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { initialState, planView, reviewView, closeoutView, saveFeedback, prescription } from "./fixtures.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = await mkdtemp(path.join(tmpdir(), "traini-browser-test-"));
const port = Number(process.env.TRAINI_E2E_PORT ?? 3027);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid test port");
const adapter = path.join(root, "tests/e2e/platform.tsx");
await build({ absWorkingDir: root, entryPoints: ["tests/e2e/app.tsx"], outfile: path.join(output, "app.js"), bundle: true, format: "esm", jsx: "automatic", sourcemap: true,
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "isolated-platform", setup(builder) {
    builder.onResolve({ filter: /^next\/(link|image|navigation)$|^@\/lib\/supabase\/client$/ }, args => ({ path: args.path, namespace: "platform" }));
    builder.onLoad({ filter: /.*/, namespace: "platform" }, args => ({ contents: args.path === "next/link" ? `export { Link as default } from ${JSON.stringify(adapter)}` : args.path === "next/image" ? `export { Image as default } from ${JSON.stringify(adapter)}` : `export * from ${JSON.stringify(adapter)}`, loader: "tsx", resolveDir: root }));
    builder.onResolve({ filter: /^server-only$|^node:/ }, args => { throw new Error(`Server dependency in test browser bundle: ${args.path}`); });
  }}],
});
await build({ absWorkingDir: root, entryPoints: ["lib/training/coaching-feedback.ts"], outfile: path.join(output, "coaching.cjs"), bundle: true, platform: "node", format: "cjs" });
const { buildCoachingFeedback } = createRequire(import.meta.url)(path.join(output, "coaching.cjs"));
await build({ absWorkingDir: root, entryPoints: ["lib/garmin/running-summary.ts"], outfile: path.join(output, "summary.cjs"), bundle: true, platform: "node", format: "cjs" });
const { buildRunningSummary, addCalendarDays } = createRequire(import.meta.url)(path.join(output, "summary.cjs"));
const globalSource = (await readFile(path.join(root, "app/globals.css"), "utf8")).replace(/^@import url\([^\n]+\);\s*/m, "");
const globalCss = await postcss([tailwind()]).process(globalSource, { from: path.join(root, "app/globals.css") });
const css = globalCss.css + "\n" + await readFile(path.join(output, "app.css"), "utf8");
const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Traini · isolated coaching test</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
let state = initialState();
const scenarios = new Set(["normal", "reset", "empty", "partial", "stale", "pain", "review-error", "summary-error", "plan-error", "unauthorized", "forbidden", "malformed", "slow", "save-error", "save-lost", "save-conflict", "closeout-sunday", "closeout-monday", "closeout-stale"]);
async function jsonBody(req) {
  let body = "";
  for await (const chunk of req) { body += chunk; if (body.length > 8192) throw new Error("Body too large"); }
  return JSON.parse(body);
}
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'");
  const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === "/health") return send(200, {ready: true, isolated: true});
    if (url.pathname === "/__test/control" && req.method === "POST") {
      const body = await jsonBody(req);
      if (!scenarios.has(body.scenario)) return send(400, {error: "Unknown scenario"});
      if (body.scenario === "reset") state = initialState();
      else { state.scenario = body.scenario; if(body.scenario === "closeout-stale") {state.closeoutStale = true; state.closeoutVersion++;} }
      return send(200, {scenario: state.scenario});
    }
    if (url.pathname === "/__test/diagnostics") return send(200, {
      closeoutRequests: state.closeoutRequests, feedbackRequests: state.feedbackRequests, unexpectedRequests: state.unexpectedRequests, reviewGenerationRequests: state.reviewGenerationRequests, reviewRequests: state.reviewRequests,
      planRequests: state.planRequests, inferenceRequests: state.inferenceRequests,
    });
    if (url.pathname.startsWith("/api/")) {
      if (state.scenario === "slow") await new Promise(resolve => setTimeout(resolve, 800));
      if (state.scenario === "unauthorized") return send(401, {error: "Unauthorized"});
      if (state.scenario === "forbidden") return send(403, {error: "Forbidden"});
      if (state.scenario === "malformed") { res.writeHead(200, {"Content-Type": "text/html"}); return res.end("<html>Unavailable</html>"); }
      if (url.pathname === "/api/garmin/weekly-summary") {
        if (state.scenario === "summary-error") return send(503, {error: "Fixture summary failed"});
        const selection = url.searchParams.get("week") === "previous" ? "previous" : "current";
        const period = {...state.plans[selection].period, selection};
        const rows = state.scenario === "empty" ? [] : [7, 8].map((km, i) => ({
          garmin_activity_id: String(i + 1), started_at: addCalendarDays(period.start, i * 2) + "T15:00:00Z", updated_at: "2026-10-17T18:00:00Z",
          distance_meters: state.scenario === "partial" && i === 1 ? null : km * 1000,
          duration_seconds: km * 330, average_pace_seconds_per_km: 330,
        }));
        return send(200, buildRunningSummary(rows, period));
      }
      if (url.pathname === "/api/training/closeout") {
        if (req.method === "POST") {
          const body = await jsonBody(req);
          state.closeoutRequests.push(body);
          const current = closeoutView(state);
          if (body.confirmed !== true || body.startsOn !== current.startsOn || body.revision !== current.revision) return send(409, {error: "기록이 바뀌었어요. 다시 확인해 주세요."});
          state.closed = true; state.closedRevision = body.revision; state.closeoutStale = false;
        }
        return send(200, closeoutView(state));
      }
      if (url.pathname === "/api/training/review") {
        state.reviewRequests++;
        if (req.method === "POST") state.reviewGenerationRequests++;
        if (state.scenario === "review-error") return send(503, {error: "테스트 리뷰 조회 실패"});
        // POST also returns a fixture; there is no provider transport in this process.
        return send(200, reviewView(state, url.searchParams.get("start"), buildCoachingFeedback));
      }
      if (url.pathname === "/api/training/plan") {
        state.planRequests++;
        if (state.scenario === "plan-error") return send(503, {error: "테스트 계획 조회 실패"});
        return send(200, planView(state, url.searchParams.get("week") ?? "current"));
      }
      if (url.pathname === "/api/training/prescription") return send(200, {...prescription, period: state.plans[url.searchParams.get("week") ?? "current"].period});
      if (url.pathname === "/api/training/feedback" && req.method === "POST") {
        const result = saveFeedback(state, await jsonBody(req));
        return send(result.status, result.error ? {error: result.error} : {saved: true});
      }
      // Unexpected API calls fail closed, including plan generation and weather.
      state.unexpectedRequests.push({path: url.pathname, method: req.method});
      return send(501, {error: "This API is unavailable in the isolated harness"});
    }
    if (url.pathname === "/app.css") { res.writeHead(200, {"Content-Type": "text/css"}); return res.end(css); }
    if (["/app.js", "/app.js.map"].includes(url.pathname)) {
      res.writeHead(200, {"Content-Type": "text/javascript"}); return res.end(await readFile(path.join(output, url.pathname.slice(1))));
    }
    if (url.pathname === "/images/brand/traini-logo.png") {
      res.writeHead(200, {"Content-Type": "image/png"}); return res.end(await readFile(path.join(root, "public/images/brand/traini-logo.png")));
    }
    if (["/", "/schedule", "/today"].includes(url.pathname)) { res.writeHead(200, {"Content-Type": "text/html"}); return res.end(html.replace("<body>", `<body data-scenario="${state.scenario}">`)); }
    send(404, {error: "Not found"});
  } catch { if (!res.headersSent) send(500, {error: "Fixture request failed"}); else res.end(); }
});
server.listen(port, "127.0.0.1", () => console.log(`Isolated coaching harness: http://127.0.0.1:${port}/schedule`));
async function stop() { server.closeAllConnections(); server.close(); await rm(output, {recursive: true, force: true}); process.exit(0); }
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
