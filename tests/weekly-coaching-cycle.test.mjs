import test from 'node:test';
import assert from 'node:assert/strict';
import {runWeeklyCycle, verifyCyclePeriods, verifyFullWeek, verifyReviewLink, verifyReviewEvidence} from '../scripts/lib/weekly-cycle-validation.mjs';
import {fixtureNoon} from '../scripts/lib/fixture-time.mjs';

test('DB fixture timestamps preserve local training dates across DST and date-line zones',()=>{
  for(const zone of ['America/Los_Angeles','Pacific/Kiritimati','Etc/GMT+12']) {
    for(const date of ['2026-03-08','2026-11-01','2026-11-02']) {
      const actual=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(fixtureNoon(date,zone)));
      assert.equal(actual,date);
    }
  }
});
test('review evidence includes every imported run while retaining missing measurements',()=>{
  const summary={period:{start:'2026-10-26',end:'2026-11-01'},activities:[
    {trainingDate:'2026-10-30',distanceMeters:8000.25,timerSeconds:2400.1234},
    {trainingDate:'2026-11-01',distanceMeters:null,timerSeconds:null},
  ]};
  const review={period:{startsOn:summary.period.start,endsOn:summary.period.end},metrics:{activityCount:2,activities:[
    {date:'2026-10-30',distanceKm:8,timerSeconds:2400.1234},
    {date:'2026-11-01',distanceKm:null,timerSeconds:null},
  ]}};
  verifyReviewEvidence(summary,review);
  review.metrics.activities.pop();assert.throws(()=>verifyReviewEvidence(summary,review),/measurements/);
});

function fixture({fresh = false, saved = false, fail = null} = {}) {
  const context = {asOfDate: '2026-11-02', timezone: 'America/Los_Angeles'};
  const review = {period: {startsOn: '2026-10-26', endsOn: '2026-11-01', timezone: context.timezone}, review: fresh ? {id:'fixture-review', revision:'r1', fresh:true} : null};
  const plan = {period: {start:'2026-11-02', end:'2026-11-08', today:context.asOfDate, timezone:context.timezone}, inputsChanged:false, plan:null};
  const fill = () => {plan.plan = {review:{id:'fixture-review',revision:'r1',startsOn:review.period.startsOn},workouts:Array.from({length:7},(_,i)=>({date:`2026-11-0${i+2}`}))};};
  if(saved) fill();
  const posts = [];
  const request = async (path, options) => {
    if(options?.method === 'POST') {
      posts.push([path,options.body]);
      if(path === fail) throw new Error('fixture failure');
      if(path === '/api/training/review') {review.review = {id:'fixture-review', revision:'r1', fresh:true}; plan.inputsChanged = !!plan.plan;}
      else {fill();plan.inputsChanged=false;}
    }
    if(path === '/api/training/context') return structuredClone(context);
    if(path === '/api/training/review') return structuredClone(review);
    if(path === '/api/training/generation-status') return {active:null,quota:{remaining:5}};
    return structuredClone(plan);
  };
  return {context,review,plan,request,posts};
}

test('read-only cycle never generates missing review or plan', async()=>{
  const f=fixture();const result=await runWeeklyCycle(f);
  assert.deepEqual(f.posts,[]);assert.deepEqual(result.attempts,{review:0,plan:0});
});
test('Monday after DST generates previous-week review before all seven current-week days',async()=>{
  const f=fixture();const r=await runWeeklyCycle({...f,generate:true});
  assert.deepEqual(f.posts,[['/api/training/review',{startsOn:'2026-10-26'}],['/api/training/generate',{week:'current'}]]);
  verifyReviewLink(r.review,r.plan);verifyFullWeek(r.plan);
  assert.deepEqual(r.attempts,{review:1,plan:1});
});
test('fresh linked review and plan are reused without inference',async()=>{
  const f=fixture({fresh:true,saved:true});await runWeeklyCycle({...f,generate:true});assert.deepEqual(f.posts,[]);
});
test('saving a new review triggers a new read before deciding whether to update a plan',async()=>{
  const f=fixture({saved:true});await runWeeklyCycle({...f,generate:true});assert.equal(f.posts.length,2);
});
for(const fail of ['/api/training/review','/api/training/generate']) {
  test(`failure at ${fail} stops without retry`,async()=>{
    const f=fixture({fail});await assert.rejects(runWeeklyCycle({...f,generate:true}),/fixture failure/);
    assert.equal(f.posts.filter(([path])=>path===fail).length,1);
    assert.equal(f.posts.at(-1)[0],fail);
  });
}
test('quota rejection prevents all generation calls',async()=>{
  const f=fixture();const request=(path,...args)=>path.endsWith('generation-status')?{active:null,quota:{remaining:0}}:f.request(path,...args);
  await assert.rejects(runWeeklyCycle({request,generate:true}),/quota exhausted/);assert.deepEqual(f.posts,[]);
});
test('shared cooldown is respected before a request, without retrying inference',async()=>{
  const f=fixture({fresh:true});let clock=0;const waits=[];
  const request=(path,...args)=>path.endsWith('generation-status')?
    {active:null,quota:{remaining:4,retryAt:clock===0?new Date(15000).toISOString():null}}:f.request(path,...args);
  await runWeeklyCycle({request,generate:true,now:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms;}});
  assert.deepEqual(waits,[15000]);assert.equal(f.posts.length,1);
});
test('long cooldown never sleeps or attempts generation',async()=>{
  const f=fixture();const request=(path,...args)=>path.endsWith('generation-status')?
    {active:null,quota:{remaining:1,retryAt:new Date(120000).toISOString()}}:f.request(path,...args);
  await assert.rejects(runWeeklyCycle({request,generate:true,now:()=>0,wait:()=>assert.fail('Unexpected wait')}),/later run/);
  assert.deepEqual(f.posts,[]);
});
test('cooldown uses server time even when the local clock is ahead',async()=>{
  const f=fixture({fresh:true});let clock=0;const waits=[];
  const request=(path,...args)=>path.endsWith('generation-status')?
    {checkedAt:new Date(clock).toISOString(),active:null,quota:{remaining:4,retryAt:clock===0?new Date(15000).toISOString():null}}:f.request(path,...args);
  await runWeeklyCycle({request,generate:true,now:()=>43000,wait:async ms=>{waits.push(ms);clock+=ms;}});
  assert.deepEqual(waits,[15000]);assert.equal(f.posts.length,1);
});
test('wrong review week, mismatched revision and duplicate calendar days fail acceptance',()=>{
  const f=fixture({fresh:true,saved:true});
  verifyCyclePeriods(f.context,f.review,f.plan);
  f.review.period.startsOn='2026-10-19';assert.throws(()=>verifyCyclePeriods(f.context,f.review,f.plan),/previous week/);
  f.review.period.startsOn='2026-10-26';f.plan.plan.review.revision='old';assert.throws(()=>verifyReviewLink(f.review,f.plan),/revision/);
  f.plan.plan.workouts[6].date='2026-11-07';assert.throws(()=>verifyFullWeek(f.plan),/exactly once/);
});
