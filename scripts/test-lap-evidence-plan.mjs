// Default: authenticated read-only audit. --generate permits ONE POST, no retry.
// --browser opens a disposable local browser context; no persistent auth/artifacts.
import assert from 'node:assert/strict';
import { withLocalAdminSession } from './lib/local-admin-session.mjs';
import { auditSavedPlan } from './lib/plan-acceptance.mjs';
import { verifyCurrentEvidence, verifyProtectedWorkouts } from './lib/lap-plan-validation.mjs';
import { typescriptLoader } from '../tests/helpers/load-typescript.mjs';
const args=new Set(process.argv.slice(2));
assert.ok([...args].every(arg=>['--generate','--browser'].includes(arg)),'Unsupported argument');
const load=typescriptLoader();
const {planPolicy,trainingPrompt}=load('lib/training/weekly-plan.ts');
const {validatePrescription}=load('lib/training/prescription.ts');
const {weeklyDistance}=load('lib/training/weekly-distance.ts');
const origin='http://localhost:3017';
const execution={phase:'preflight',generationAttempts:0,generated:false};
await withLocalAdminSession(async({request,service,uid,check,browserCookies})=>{
 const context=await request('/api/training/context');
 const summary=await request('/api/garmin/weekly-summary?week=current');
 const before=await request('/api/training/plan?week=current');
 const preview=await request('/api/training/prescription?week=current');
 const quota=await request('/api/training/generation-status');
 const evidence=verifyCurrentEvidence(context,summary,trainingPrompt(context,planPolicy(context,'current',summary)));
 const beforeAudit=auditSavedPlan(before,context,preview,validatePrescription);
 const snapshot=async()=>check(await service.from('training_plans').select('id,summary,generation_id,created_at,input_revision').eq('user_id',uid).order('id'));
 const savedBefore=await snapshot();
 let attempts=0, generated=false, generationError=null;
 if(args.has('--generate')){
  assert.equal(quota.active,null,'Another generation is running');
  assert.ok(quota.quota.remaining>0,'Generation quota exhausted');
  const connection=await request('/api/chatgpt/connection');
  assert.ok(connection.available&&connection.connected,'ChatGPT connection unavailable');
  if(!before.plan || before.inputsChanged){
   attempts++;execution.generationAttempts=attempts;execution.phase="generation";
   try{await request('/api/training/generate',{method:'POST',body:{week:'current'},timeoutMs:300000});generated=true;execution.generated=true;}
   catch(error){generationError=error.message;}
  }
 }
 const after=await request('/api/training/plan?week=current');
 verifyProtectedWorkouts(before,after);
 if(generationError || !attempts)assert.deepEqual(await snapshot(),savedBefore,'Read or failed generation changed saved plans');
 const afterContext=await request('/api/training/context');
 const afterPreview=await request('/api/training/prescription?week=current');
 const audit=auditSavedPlan(after,afterContext,afterPreview,validatePrescription);
 if(generated)assert.equal(audit.state,'validated',`Generated plan failed audit: ${audit.issues.join(',')}`);
 const afterQuota=await request('/api/training/generation-status');
 // Rolling windows can expire while testing; growth must never exceed our one request.
 assert.ok(afterQuota.quota.used<=quota.quota.used+attempts,'Unexpected additional generation');
 let browserChecked=false;
 if(args.has('--browser')){
  execution.phase='browser';
  const {chromium,expect}=await import('@playwright/test');
  const browser=await chromium.launch();
  try{
   const browserContext=await browser.newContext({viewport:{width:375,height:812}});
   await browserContext.addCookies(browserCookies());
   const page=await browserContext.newPage();const errors=[];
   page.on('pageerror',error=>errors.push(error.name));
   await page.route('**/*',route=>{
    const req=route.request(),url=new URL(req.url());
    if(req.method()==='POST'&&/\/generate$/.test(url.pathname)){errors.push('Unexpected generation POST');return route.abort();}
    // The page may load external fonts, but must never call inference from the browser.
    if(/\/responses(?:$|\/)/.test(url.pathname)){errors.push('Unexpected inference');return route.abort();}
    return route.continue();
   });
   await page.goto(origin+'/schedule');
   const card=page.getByRole('region',{name:'주간 러닝 거리',exact:true});
   const distance=weeklyDistance(after.recordedRuns,after.plan,after.recordsUnavailable);
   assert.notEqual(distance.actualKm,null,'Actual records unavailable');
   await expect(card).toContainText(`${distance.actualKm.toFixed(1)} km`);
   if(distance.expectedKm!==null)await expect(card).toContainText(`${distance.expectedKm.toFixed(1)} km`);
   await expect(page.getByRole('region',{name:'주간 훈련 일정'}).locator('article')).toHaveCount(7);
   const planResponse=page.waitForResponse(r=>r.url().includes('/api/training/plan?week=current')&&r.ok());
   await page.goto(origin+'/today');
   const rendered=await (await planResponse).json();
   assert.equal(rendered.plan?.id,after.plan?.id,'Today uses a different plan');
   assert.deepEqual(rendered.plan?.workouts.map(w=>[w.id,w.date,w.kind,w.distanceKm]),after.plan?.workouts.map(w=>[w.id,w.date,w.kind,w.distanceKm]));
   await expect(page.getByRole('navigation',{name:'오늘 탭 사용 순서'})).toBeVisible();
   for(const path of ['/today','/schedule']){
    await page.goto(origin+path);
    await expect(page.locator('.app-frame').first()).toBeVisible();
    for(const width of [320,375,430,768]){
     await page.setViewportSize({width,height:812});
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');
     assert.ok(await page.locator('.app-frame').evaluateAll(elements=>elements.length>0&&elements.every(e=>e.getBoundingClientRect().width<=430)),'Mobile frame expanded');
    }
   }
   assert.deepEqual(errors,[],'Browser runtime errors');browserChecked=true;
  }finally{await browser.close();}
 }
 // Deliberately omit personal dates, distances, pace, account IDs, and raw model output.
 console.log(JSON.stringify({evidence,generationAttempts:attempts,generated,generationError,
  beforeState:beforeAudit.state,afterState:audit.state,issues:audit.issues,protectedWorkoutsPreserved:true,browserChecked},null,2));
 if(generationError || (generated&&audit.issues.length))process.exitCode=1;
},{origin}).catch(error=>{
 console.error(JSON.stringify({...execution,errorType:error.name,reason:['Horizontal overflow','Mobile frame expanded','Browser runtime errors','Actual records unavailable','Today uses a different plan'].find(reason=>error.message.startsWith(reason))??'assertion_or_request',status:'validation_failed',retry:false}));
 process.exitCode=1;
});
