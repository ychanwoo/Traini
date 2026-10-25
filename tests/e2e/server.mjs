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
    builder.onResolve({filter:/^\.\/client$/},args => args.importer === path.join(root,"lib/supabase/profile.ts") ? {path:"@/lib/supabase/client",namespace:"platform"} : undefined);
    builder.onResolve({ filter: /^next\/(link|image|navigation)$|^@\/lib\/supabase\/client$/ }, args => ({ path: args.path, namespace: "platform" }));
    builder.onLoad({ filter: /.*/, namespace: "platform" }, args => ({ contents: args.path === "next/link" ? `export { Link as default } from ${JSON.stringify(adapter)}` : args.path === "next/image" ? `export { Image as default } from ${JSON.stringify(adapter)}` : `export * from ${JSON.stringify(adapter)}`, loader: "tsx", resolveDir: root }));
    builder.onResolve({ filter: /^server-only$|^node:/ }, args => { throw new Error(`Server dependency in test browser bundle: ${args.path}`); });
  }}],
});
await build({ absWorkingDir: root, entryPoints: ["lib/training/coaching-feedback.ts"], outfile: path.join(output, "coaching.cjs"), bundle: true, platform: "node", format: "cjs" });
const { buildCoachingFeedback } = createRequire(import.meta.url)(path.join(output, "coaching.cjs"));
await build({ absWorkingDir: root, entryPoints: ["lib/garmin/running-summary.ts"], outfile: path.join(output, "summary.cjs"), bundle: true, platform: "node", format: "cjs" });
const { buildRunningSummary, addCalendarDays, runningPeriod } = createRequire(import.meta.url)(path.join(output, "summary.cjs"));
const globalSource = (await readFile(path.join(root, "app/globals.css"), "utf8")).replace(/^@import url\([^\n]+\);\s*/m, "");
const globalCss = await postcss([tailwind()]).process(globalSource, { from: path.join(root, "app/globals.css") });
const css = globalCss.css + "\n" + await readFile(path.join(output, "app.css"), "utf8");
const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Traini · isolated coaching test</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
let state = initialState();
const scenarios = new Set(["normal", "reset", "plan-adjustment-invalid", "plan-generating", "empty", "partial", "stale", "pain", "review-error", "summary-error", "plan-error", "unauthorized", "forbidden", "malformed", "slow", "save-error", "save-lost", "save-conflict", "closeout-sunday", "closeout-monday", "closeout-stale", "progress-error", "auth-check-failed", "race-preparation", "race-taper", "race-recovery"]);
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
      weeklyFeedbackRequests:state.weeklyFeedbackRequests, closeoutRequests: state.closeoutRequests, feedbackRequests: state.feedbackRequests, unexpectedRequests: state.unexpectedRequests, reviewGenerationRequests: state.reviewGenerationRequests, reviewRequests: state.reviewRequests,
      planRequests: state.planRequests, planGenerationRequests: state.planGenerationRequests, inferenceRequests: state.inferenceRequests,
    });
    if (url.pathname.startsWith("/api/")) {
      if (state.scenario === "slow") await new Promise(resolve => setTimeout(resolve, 800));
      if (state.scenario === "unauthorized") return send(401, {error: "Unauthorized"});
      if (state.scenario === "forbidden") return send(403, {error: "Forbidden"});
      if (state.scenario === "malformed") { res.writeHead(200, {"Content-Type": "text/html"}); return res.end("<html>Unavailable</html>"); }
      if(url.pathname === "/api/admin/session") return send(state.scenario === "auth-check-failed" ? 503 : 200, {authenticated:state.scenario !== "auth-check-failed"});
      if(url.pathname === "/api/garmin/sync") {
        const current=runningPeriod("America/Los_Angeles","current");
        const selection=req.method === "POST" ? (await jsonBody(req)).week : url.searchParams.get("week");
        const previous=selection === "previous";
        const period={start:previous?addCalendarDays(current.start,-7):current.start,end:previous?addCalendarDays(current.start,-1):current.today,timezone:current.timezone};
        if(req.method === "POST") state.fixtureImport={version:2,id:"00000000-0000-4000-8000-000000000003",status:"succeeded",stage:"finished",startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),errorCode:null,period,counts:{found:2,downloaded:0,skipped:2,failed:0},parsing:{found:2,processed:0,skipped:2,failed:0},upload:{found:2,eligible:2,validated:2,inserted:0,updated:0,unchanged:2,failed:0,excluded:0},uploadStarted:true,failedStage:null};
        return send(200,{available:true,period,job:state.fixtureImport??null,notice:null});
      }
      if(url.pathname === "/api/training/match/reconcile" && req.method === "POST") return send(200,{reconciled:true,failed:0});
      if (url.pathname === "/api/training/progress") {
        if(state.scenario === "progress-error") return send(503,{error:"Fixture progress refresh failed"});
        const period=runningPeriod("America/Los_Angeles","current");
        const totals={activityCount:24,weeksWithActivities:8,completeDistanceWeeks:8,recordedDistanceMeters:240000,averageRecordedWeekMeters:30000,paceSecondsPerKm:330,paceActivityCount:24,missingDistanceCount:0,missingTimerCount:0,longestRunMeters:14000,excludedUnverifiedActivities:0};
        const weeks=Array.from({length:8},(_,i)=>({start:addCalendarDays(period.start,-56+i*7),end:addCalendarDays(period.start,-50+i*7),activityCount:3,distanceMeters:30000,timerSeconds:9900,paceSecondsPerKm:330,longestRunMeters:14000,status:"recorded_activities",coverage:{distanceCount:3,timerCount:3},performance:{hasPlan:false}}));
        const phase=state.scenario === "race-recovery" ? "recovery" : state.scenario === "race-taper" ? "taper" : "preparation";
        const daysUntil=phase === "recovery" ? -16 : phase === "taper" ? 5 : 90;
        const raceDate=addCalendarDays(period.today,daysUntil);
        const races=state.scenario.startsWith("race-") ? [{id:"fixture-race",name:"테스트 주목표",date:raceDate,distance:"FULL",priority:"primary",targetTimeSeconds:null,targetPaceSecondsPerKm:null,daysUntil,phase,taperDays:14,recoveryDays:14,taperStart:addCalendarDays(raceDate,-14),taperEnd:addCalendarDays(raceDate,-1),recoveryStart:addCalendarDays(raceDate,1),recoveryEnd:addCalendarDays(raceDate,14),recoveryState:phase === "recovery"?"needs_check_in":null,affectsCurrentPlan:phase!=="preparation",participation:"unconfirmed"}] : [];
        return send(200,{version:1,generatedAt:new Date().toISOString(),asOfDate:period.today,timezone:period.timezone,period:{start:weeks[0].start,end:weeks[7].end},totals,weeks,current:{start:period.start,end:period.end,activityCount:state.scenario === "empty"?0:2,distanceMeters:state.scenario === "empty"?null:state.scenario === "partial"?7000:15000,timerSeconds:4950,paceSecondsPerKm:330,longestRunMeters:8000,status:"recorded_activities",coverage:{distanceCount:state.scenario === "empty"?0:state.scenario === "partial"?1:2,timerCount:2},performance:null},races,raceWarnings:[],comparison:null,limitations:[]});
      }
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
      // Explicit UI-action test only: synthetic rejection, no provider transport.
      if (url.pathname === "/api/training/generate" && req.method === "POST" && state.scenario === "plan-adjustment-invalid") {
        const body = await jsonBody(req);
        if (!["current", "next"].includes(body.week)) return send(400, {error:"Invalid test week"});
        state.planGenerationRequests.push(body);
        state.plans[body.week].generationError = "invalid_output";
        await new Promise(resolve => setTimeout(resolve, 150));
        return send(422, {error:"생성 결과가 훈련 조건을 충족하지 않아 저장하지 않았어요. 기존 계획은 유지돼요."});
      }
      if(url.pathname === "/api/training/weekly-feedback" && req.method === "POST") {
        const body=await jsonBody(req);state.weeklyFeedbackRequests.push(body);
        const previous=state.weeklyNoteOperations.find(n=>n.requestId===body.requestId);
        if(previous) return send(200,{note:previous.note});
        if(state.scenario==="save-error") return send(503,{error:"테스트 저장 실패: 입력을 유지하고 다시 확인해 주세요."});
        const existing=state.weeklyNotes[body.startsOn];
        if(state.scenario==="save-conflict" || body.version!==(existing?.version??0)) return send(409,{error:"다른 화면에서 주간 메모가 바뀌었어요."});
        const note={rpe:body.rpe,memo:body.memo,version:body.version+1,updatedAt:"2026-10-17T18:00:00Z"};
        state.weeklyNotes[body.startsOn]=note;state.weeklyNoteOperations.push({requestId:body.requestId,note});
        for(const plan of Object.values(state.plans)) plan.inputsChanged=true;
        return state.scenario==="save-lost"?send(502,{error:"저장 응답을 확인하지 못했어요."}):send(200,{note});
      }
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
    if (["/", "/coaching-regression", "/schedule", "/today", "/my", "/roadmap", "/running-analysis", "/garmin-connect", "/auth-refresh", "/login"].includes(url.pathname)) { res.writeHead(200, {"Content-Type": "text/html"}); return res.end(html.replace("<body>", `<body data-scenario="${state.scenario}">`)); }
    send(404, {error: "Not found"});
  } catch { if (!res.headersSent) send(500, {error: "Fixture request failed"}); else res.end(); }
});
server.listen(port, "127.0.0.1", () => console.log(`Isolated coaching harness: http://127.0.0.1:${port}/schedule`));
async function stop() { server.closeAllConnections(); server.close(); await rm(output, {recursive: true, force: true}); process.exit(0); }
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
