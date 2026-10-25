import { typescriptLoader } from "./helpers/load-typescript.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";

function load(file, modules = {}) {
  const scope = {
    exports: {},
    Date,
    Intl,
    AbortController,
    require: (name) => {
      if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
      return modules[name];
    },
  };
  const result = ts.transpileModule(
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
      reportDiagnostics: true,
    },
  );
  assert.equal(
    result.diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error)
      .length,
    0,
  );
  vm.runInNewContext(result.outputText, scope);
  return scope.exports;
}
const copy = load("lib/training/coaching-copy.ts");
const { coachingText } = copy;
const { buildCoachingFeedback } = load("lib/training/coaching-feedback.ts");
test("legacy review identifiers become Korean without changing recorded numbers or uncertainty", () => {
  const input =
    "actualKm은 56.182km로 baselineKm 53.052km보다 3.130km, 약 5.9% 많습니다. feedbackReports는 0이며 unconfirmed는 미상입니다.";
  const output = coachingText(input);
  assert.equal(
    output,
    "기록된 거리는 56.182km로 최근 기록의 비교 기준 거리 53.052km보다 3.130km, 약 5.9% 많습니다. 피드백을 남긴 훈련 수는 0이며 수행 미확인 훈련 수는 미상입니다.",
  );
  assert.deepEqual(
    output.match(/[+-]?\d+(?:\.\d+)?/g),
    input.match(/[+-]?\d+(?:\.\d+)?/g),
  );
  assert.equal(coachingText(output), output);
});
test("Korean particles work with quoted identifiers, consonants, vowels and final rieul", () => {
  for (const [input, expected] of [
    ["`actualKm`은", "기록된 거리는"],
    ["activityCount이", "러닝 횟수가"],
    ["maxQualitySessions가", "다음 계획의 고강도 훈련 상한이"],
    ["actualKm을", "기록된 거리를"],
    ["actualKm과", "기록된 거리와"],
    ["maxQualitySessions와", "다음 계획의 고강도 훈련 상한과"],
    ["actualKm으로", "기록된 거리로"],
    ["maxQualitySessions로", "다음 계획의 고강도 훈련 상한으로"],
    ["volumeChangePercent으로", "훈련량 조정 비율로"],
  ])
    assert.equal(coachingText(input), expected);
});
test("ordinary prose, units, dates, unknown values and similar identifiers are preserved", () => {
  const text =
    "2026-10-19 · 400m × 10회 · 3′50″/km · -15% · HRV·RPE 미입력. 회복 여부는 알 수 없습니다.";
  assert.equal(coachingText(text), text);
  assert.equal(coachingText(""), "");
  assert.equal(
    coachingText("myactualKm actualKmExtra old_actualKm"),
    "myactualKm actualKmExtra old_actualKm",
  );
  assert.equal(
    coachingText("actualKm이상 actualKm이하 actualKm가량"),
    "기록된 거리 이상 기록된 거리 이하 기록된 거리 가량",
  );
  assert.ok(
    !coachingText("structuredQualitySessions는 1회").includes("고강도"),
  );
});

function reviewState({ fresh = true, hasPlan = true } = {}) {
  const metrics = {
    plannedKm: hasPlan ? 40 : null,
    actualKm: null,
    distanceKnown: 0,
    activityCount: 2,
    activities: [{ distanceKm: null }, { distanceKm: null }],
    garminCompleted: 0,
    manualCompleted: hasPlan ? 1 : 0,
    unconfirmed: hasPlan ? 1 : null,
    explicitlySkipped: 0,
    feedbackReports: hasPlan ? 1 : 0,
    additionalRuns: 0,
    unassignedRuns: 2,
    hasPlan,
    sessions: [
      {
        date: "2026-10-07",
        completion: "manual",
        feedback: {
          assessment: {
            rpe: null,
            fatigue: null,
            pain: "pain",
            memo: "actualKm은 내 메모 그대로 <script>memo</script>",
          },
          skipReason: null,
        },
      },
    ],
  };
  if (hasPlan)
    metrics.sessions.push({
      date: "2026-10-09",
      completion: "unconfirmed",
      feedback: null,
    });
  else metrics.sessions = [];
  return {
    period: { startsOn: "2026-10-05", timezone: "America/Los_Angeles" },
    latestStartsOn: "2026-10-05",
    generating: false,
    generationError: null,
    metrics,
    review: {
      fresh,
      metrics,
      model: "fixture-model",
      createdAt: "2026-10-17T18:00:00Z",
      content: {
        summary:
          "actualKm은 미확인이며, 회복 여부도 알 수 없어요. " +
          "긴 설명을 확인해요. ".repeat(60),
        observations: [
          { text: "baselineKm은 53.052km예요. <img src=x onerror=alert(1)>" },
        ],
        nextWeek: {
          direction: "maintain",
          volumeChangePercent: 0,
          rationale:
            "supportedQualitySessions는 2회이며 현재 수행 가능성을 보장하지 않아요.",
        },
        limitations: ["recovery_unavailable"],
      },
    },
  };
}
function renderReview(data) {
  const view = data
    ? {
        ...data,
        coaching: buildCoachingFeedback(data, {
          today: "2026-10-17",
          condition: null,
        }),
      }
    : null;
  const state = [undefined, view, null, false, false, null];
  let index = 0;
  const { WeeklyReviewCard } = load(
    "components/training/weekly-review-card.tsx",
    {
      react: {
        useState: () => [state[index++], () => {}],
        useRef: (current) => ({ current }),
        useEffect: () => {},
        useCallback: (fn) => fn,
      },
      "@/lib/training/coaching-presentation": typescriptLoader()("lib/training/coaching-presentation.ts"),
      "@/lib/training/review-presentation": typescriptLoader()("lib/training/review-presentation.ts"),
      "./weekly-feedback-form": {WeeklyFeedbackForm:()=>null},
      "./coaching-detail": typescriptLoader({"./training.module.css": {default: {}}})("components/training/coaching-detail.tsx"),
      "react/jsx-runtime": jsxRuntime,
      "@/lib/http/client-request": {
        ReadRequestGate: class {},
        requestJson: () => {
          throw new Error("No network expected");
        },
      },
      "@/lib/garmin/running-summary": {
        addCalendarDays: (date, offset) =>
          new Date(Date.parse(date + "T00:00:00Z") + offset * 86400000)
            .toISOString()
            .slice(0, 10),
      },
      "@/lib/training/review-errors": {
        reviewErrorMessage: () => "fixture error",
      },
      "@/lib/garmin/collection": { IMPORT_FINISHED_EVENT: "fixture-import" },
      "@/lib/training/coaching-copy": copy,
      "./training.module.css": {
        default: new Proxy({}, { get: (_, key) => String(key) }),
      },
    },
  );
  return renderToStaticMarkup(jsxRuntime.jsx(WeeklyReviewCard, {}));
}
test("saved reviews render readable prose and priority guidance while keeping user memos intact and escaped", () => {
  const data = reviewState();
  const before = structuredClone(data);
  const html = renderReview(data);
  assert.match(html, /기록된 거리는 미확인/);
  assert.match(html, /최근 기록의 비교 기준 거리는 53.052km/);
  assert.match(html, /계획에서 허용한 고강도 훈련 수는 2회/);
  assert.match(html, /다음 훈련 방향/);
  assert.match(html, /현재 컨디션은 미입력/);
  assert.match(html, /저장된 AI 리뷰 원문/);
  assert.ok(html.includes("actualKm은 내 메모 그대로"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("&lt;script&gt;memo&lt;/script&gt;"));
  assert.ok(!html.includes("<script>memo"));
  assert.ok(!html.includes("<img src=x"));
  assert.match(html, /기록된 거리 · 부분 합계/);
  assert.match(
    renderReview(reviewState({ hasPlan: false })),
    /저장된 계획이 없어/,
  );
  assert.match(html, /체감 강도\(RPE\) 미입력/);
  assert.deepEqual(data, before);
});
test("stale and empty review states retain their warnings rather than implying a new plan was applied", () => {
  const html = renderReview(reviewState({ fresh: false, hasPlan: true }));
  assert.match(html, /이전 입력으로 저장된/);
  assert.match(html, /새 계획에는 아직 반영되지 않아요/);
  assert.match(html, /최신 기록으로 리뷰 업데이트/);
  assert.match(html, /수행 미확인 1개/);
  const empty = renderReview(null);
  assert.match(empty, /다시 확인/);
  assert.ok(!empty.includes("현재 계획에서는"));
});
test("review recommendations preserve their direction and signed percentages without overriding current restrictions", () => {
  for (const [direction, change, label] of [
    ["reduce", -10, "훈련량을 줄이는 방향"],
    ["progress", 3, "훈련량을 조금 늘리는 방향"],
    ["maintain", 0, "훈련량을 유지하는 방향"],
  ]) {
    const data = reviewState();
    Object.assign(data.review.content.nextWeek, {
      direction,
      volumeChangePercent: change,
    });
    const html = renderReview(data);
    assert.ok(html.includes(label));
    if (change)
      assert.ok(html.includes(`(${change > 0 ? "+" : ""}${change}%)`));
    assert.match(html, /실제 배치는 이후의 컨디션과 저장된 계획을 함께/);
    assert.equal(data.review.content.nextWeek.volumeChangePercent, change);
  }
});
