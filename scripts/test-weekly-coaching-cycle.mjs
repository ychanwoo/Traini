// Authenticated read-only by default. --generate opts into at most one review
// and one plan request. No retries, condition edits, or closeout acknowledgements.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {withLocalAdminSession} from './lib/local-admin-session.mjs';
import {runWeeklyCycle, verifyReviewLink, verifyFullWeek, verifyReviewEvidence} from './lib/weekly-cycle-validation.mjs';
import {verifyProtectedWorkouts} from './lib/lap-plan-validation.mjs';
import {auditSavedPlan} from './lib/plan-acceptance.mjs';
import {typescriptLoader} from '../tests/helpers/load-typescript.mjs';
const args = new Set(process.argv.slice(2));
assert.ok([...args].every(arg=>['--generate','--browser'].includes(arg)), 'Unsupported argument');
const {validatePrescription} = typescriptLoader()('lib/training/prescription.ts');
const attempts = {review:0,plan:0};
await withLocalAdminSession(async({request,service,uid,check})=>{
  const before = await request('/api/training/plan?week=current');
  const imported = await request('/api/garmin/weekly-summary?week=previous');
  verifyReviewEvidence(imported, await request('/api/training/review'));
  const snapshot = async()=>check(await service.from('training_plans')
    .select('id,starts_on,summary,generation_id,created_at,input_revision,workouts(*)')
    .eq('user_id',uid).order('id'));
  const plansBefore = await snapshot();
  let result;
  try {
    result = await runWeeklyCycle({request,generate:args.has('--generate'),onAttempt:kind=>attempts[kind]++});
  } catch(error) {
    assert.deepEqual(await snapshot(), plansBefore, 'Failed cycle changed saved plans');
    throw error;
  }
  const plansAfter = await snapshot();
  verifyReviewEvidence(imported, result.review);
  // A new review must never rewrite historical prescriptions or feedback.
  const historical = rows=>rows.filter(row=>row.starts_on!==before.period.start);
  assert.deepEqual(historical(plansAfter),historical(plansBefore),'Historical plans changed');
  if(!attempts.plan) assert.deepEqual(plansAfter,plansBefore,'Read-only plan changed');
  verifyProtectedWorkouts(before,result.plan);
  const preview = await request('/api/training/prescription?week=current');
  const context = await request('/api/training/context');
  const audit = auditSavedPlan(result.plan,context,preview,validatePrescription);
  if(result.plan.plan && result.review.review?.fresh) verifyReviewLink(result.review,result.plan);
  if(result.plan.plan && context.asOfDate===result.plan.period.start) verifyFullWeek(result.plan);
  if(args.has('--generate')) assert.equal(audit.state,'validated','Saved plan failed acceptance');
  // Aggregate-only output: no IDs, dates, personal metrics, or model responses.
  console.log(JSON.stringify({attempts,reviewFresh:!!result.review.review?.fresh,planState:audit.state,
    issues:audit.issues,historicalPlansPreserved:true,protectedWorkoutsPreserved:true},null,2));
}).catch(error=>{
  console.error(JSON.stringify({attempts,errorType:error.name,httpStatus:error.status,
    code:error.code,status:'cycle_validation_failed',retry:false}));
  process.exitCode=1;
});
if(!process.exitCode && args.has('--browser')) {
  // This child is strictly read-only, including after live generation above.
  const child = spawnSync(process.execPath,['--env-file=.env.local','scripts/test-lap-evidence-plan.mjs','--browser'],{stdio:'inherit'});
  if(child.status!==0) process.exitCode=1;
}
