import test from 'node:test';
import assert from 'node:assert/strict';
import { typescriptLoader } from './helpers/load-typescript.mjs';
const { todayWorkflow } = typescriptLoader()('lib/training/today-workflow.ts');
test('Sunday and Monday use the training timezone across midnight and DST', () => {
  for (const [instant, expected] of [
    ['2026-10-26T06:59:59Z', 'next'], ['2026-10-26T07:00:00Z', 'current'],
    ['2026-11-01T08:30:00Z', 'next'], ['2026-11-01T09:30:00Z', 'next'],
    ['2026-11-02T07:59:59Z', 'next'], ['2026-11-02T08:00:00Z', 'current'],
  ]) {
    const result = todayWorkflow('America/Los_Angeles', new Date(instant));
    assert.equal(result.planWeek, expected);
    assert.equal(result.importWeek, expected === 'next' ? 'current' : 'previous');
  }
});
test('Monday through Saturday select previous records and remaining current plan', () => {
  for (let day = 26; day <= 31; day++) {
    const result = todayWorkflow('America/Los_Angeles', new Date(`2026-10-${day}T19:00:00Z`));
    assert.equal(result.importWeek, 'previous'); assert.equal(result.planWeek, 'current');
  }
});

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
function render(instant) {
  const stub = () => null;
  const load = typescriptLoader({
    react: { ...React, useEffect: () => {}, useState: () => [new Date(instant), () => {}] },
    './use-weekly-plan': { useWeeklyPlan: () => ({data:{period:{timezone:'America/Los_Angeles'}}}) },
    '@/components/garmin/current-running-metrics': {CurrentRunningMetrics:stub},
    '@/components/garmin/weekly-sync-card': {WeeklySyncCard:({initialSelection})=>React.createElement('div',{'data-import':initialSelection})},
    '@/components/garmin/weekly-running-summary': {WeeklyRunningSummary:stub},
    './weekly-plan-view': {TodayPlan:stub}, './weekly-closeout-card':{WeeklyCloseoutCard:stub},
    './weekly-review-card':{WeeklyReviewCard:stub},
    './plan-management':{PlanManagement:({week})=>React.createElement('div',{'data-plan':week})},
    './today-workflow.module.css':{default:{}},
  });
  return renderToStaticMarkup(React.createElement(load('components/training/today-workflow.tsx').TodayWorkflow));
}
test('four-step Today composition uses Sunday defaults and moves current planning to step four on weekdays',()=>{
  const sunday=render('2026-11-01T20:00:00Z'), weekday=render('2026-10-29T20:00:00Z');
  assert.match(sunday,/data-import="current"/);assert.match(sunday,/data-plan="next"/);
  assert.match(weekday,/data-import="previous"/);assert.doesNotMatch(weekday,/data-plan="next"/);
  assert.equal((weekday.match(/data-plan="current"/g)||[]).length,1);
  assert.ok(weekday.indexOf('data-plan="current"')>weekday.indexOf('id="today-next"'));
  for(const html of [sunday,weekday]) for(const id of ['today-import','today-session','today-review','today-next']) assert.match(html,new RegExp(`id="${id}"`));
});
