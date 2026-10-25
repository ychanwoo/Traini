import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { typescriptLoader } from "./helpers/load-typescript.mjs";
function render(week, overrides = {}) {
  const data = {period:{start:"2026-10-19",end:"2026-10-25"},plan:{id:"saved"},inputsChanged:false,generating:false,generationError:null,...overrides.data};
  const state = {data,loading:false,error:null,busy:false,completing:false,generate:()=>{throw new Error("Rendering must never generate");},...overrides,data:overrides.data === null ? null : data};
  const load=typescriptLoader({
    "./use-weekly-plan":{useWeeklyPlan:selected=>{assert.equal(selected,week);return state;}},
    "./training.module.css":{default:{}},"./today-workflow.module.css":{default:{}},
    "next/link":{default:({children,href})=>createElement("a",{href},children)},
  });
  return renderToStaticMarkup(createElement(load("components/training/plan-management.tsx").PlanManagement,{week}));
}
test("existing plans are optional and unchanged inputs never invite unnecessary generation",()=>{
  const html=render("current");
  assert.match(html,/선택/); assert.match(html,/이번 주 계획 조정 열기/);
  assert.match(html,/새로 반영할 변경사항이 없어요/);
  assert.doesNotMatch(html,/<button/);assert.doesNotMatch(html,/최신 기록으로 계획 업데이트/);
});
test("initial creation and adjustments identify their target week and date range",()=>{
  assert.match(render("current",{data:{plan:null}}),/이번 주 남은 훈련 계획 만들기/);
  assert.match(render("next",{data:{plan:null}}),/다음 주 계획 만들기/);
  const current=render("current",{data:{inputsChanged:true}});
  assert.match(current,/이번 주 남은 훈련 다시 조정/);assert.match(current,/완료한 훈련은 유지/);
  assert.match(current,/2026-10-19.*2026-10-25/);
  assert.match(render("next",{data:{inputsChanged:true}}),/다음 주 계획 다시 조정/);
});
test("loading, authorization/read failure, pending and failed generation remain visible",()=>{
  assert.match(render("current",{data:null,loading:true}),/저장된 계획을 확인/);
  const failedRead=render("current",{data:null,error:"로그인 상태 확인 필요"});
  assert.match(failedRead,/role="alert"/);assert.match(failedRead,/다시 확인/);
  for(const state of [{busy:true},{data:{generating:true}}]) {
    const html=render("current",state);assert.match(html,/훈련계획 생성 중/);assert.match(html,/disabled/);
  }
  const invalid=render("next",{data:{inputsChanged:true,generationError:"invalid_output"}});
  assert.match(invalid,/기존 계획은 유지돼요/);assert.match(invalid,/수행하기 전에 현재 상태/);
});

test("weekly comparison uses adjacent complete weeks and never treats absent activity as rest",()=>{
  const {weekComparisonText}=typescriptLoader()("lib/training/review-presentation.ts");
  const current={actualKm:33.8,activityCount:4,distanceKnown:4};
  const prev={startsOn:"2026-10-12",endsOn:"2026-10-18",actualKm:40,activityCount:5,distanceComplete:true};
  assert.match(weekComparisonText("2026-10-19",current,prev),/15.5% 줄었어요/);
  assert.match(weekComparisonText("2026-10-19",{...current,distanceKnown:3},prev),/부족/);
  assert.match(weekComparisonText("2026-10-19",{actualKm:0,activityCount:0,distanceKnown:0},prev),/부족/);
  assert.equal(weekComparisonText("2026-10-19",current,{...prev,startsOn:"2026-10-05"}),null);
  assert.equal(weekComparisonText("2026-10-19",current,null),null);
});
