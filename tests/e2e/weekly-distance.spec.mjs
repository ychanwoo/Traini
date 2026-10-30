import { test, expect } from '@playwright/test';
test('schedule separates actual and expected distance and replaces imported manual completion',async({page})=>{
 let imported=false;
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!=='http://127.0.0.1:3027')throw Error('Unexpected external request');
  if(url.pathname!=='/api/training/plan')return route.continue();
  const response=await route.fetch();const body=await response.json();
  const template=body.plan.workouts[0];
  body.plan.workouts=[{...template,date:'2026-10-16',distanceKm:10,completed:true},
    {...template,id:'remaining-long',date:'2026-10-18',kind:'long',distanceKm:15.5,completed:false}];
  body.plan.targetDistanceKm=25.5;
  body.recordedRuns=[['1','2026-10-12',8460],['2','2026-10-14',10000],['3','2026-10-15',7360],
    ...(imported?[['4','2026-10-16',10200]]:[])].map(([id,trainingDate,distanceMeters])=>({id,trainingDate,distanceMeters,timerSeconds:null}));
  body.recordsUnavailable=false;
  await route.fulfill({response,json:body});
 });
 await page.goto('/schedule');
 const card=page.getByRole('region',{name:'주간 러닝 거리',exact:true});
 await expect(card).toContainText('25.8 km');await expect(card).toContainText('51.3 km');
 await expect(card).not.toContainText('완료 표시한 훈련의 예정 거리 포함');
 await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow','50');
 await expect(card).not.toContainText('/');
 for(const width of [320,375,430,768]){
  await page.setViewportSize({width,height:812});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.locator('.app-frame').evaluate(e=>e.getBoundingClientRect().width)).toBeLessThanOrEqual(430);
 }
 imported=true;await page.reload();
 await expect(card).toContainText('36.0 km');await expect(card).toContainText('51.5 km');
 await expect(card).not.toContainText('완료 표시한');
 await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow','70');
});
