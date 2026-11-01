import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCurrentEvidence,verifyProtectedWorkouts} from '../scripts/lib/lap-plan-validation.mjs';
const run={trainingDate:'2026-01-14',distanceMeters:8000,timerSeconds:2500,evidence:{laps:[]}};
const context=()=>({history:{requestedWeeks:8,end:'2026-01-11',activityCount:20},currentWeek:{start:'2026-01-12',sessions:[run]}});
const prompt=c=>({input:[{content:JSON.stringify({currentWeek:c.currentWeek,sessionAnalysis:[{classification:'interval'}]})}]});
test('current-week validation compares complete activity measurements and prompt evidence',()=>{
 const c=context();const summary={activities:[run]};
 assert.equal(verifyCurrentEvidence(c,summary,prompt(c)).classifiedIntervals,1);
 assert.throws(()=>verifyCurrentEvidence(c,{activities:[]},prompt(c)),/missing/);
 assert.throws(()=>verifyCurrentEvidence(c,summary,prompt({...c,currentWeek:{...c.currentWeek,sessions:[]}})),/prompt/);
 c.history.end='2026-01-18';assert.throws(()=>verifyCurrentEvidence(c,summary,prompt(c)),/baseline/);
});
test('protected-workout audit rejects removal and changes but permits matching metadata refresh',()=>{
 const before={plan:{workouts:[{id:'synthetic',date:'2026-01-14',kind:'threshold',distanceKm:10,completed:true,steps:[]}]}};
 const after=structuredClone(before);after.plan.workouts[0].matching={source:'garmin'};
 verifyProtectedWorkouts(before,after);
 after.plan.workouts[0].distanceKm=8;assert.throws(()=>verifyProtectedWorkouts(before,after),/changed/);
 after.plan.workouts=[];assert.throws(()=>verifyProtectedWorkouts(before,after),/removed/);
});
test('skipped and feedback-protected sessions remain protected without a completion flag',()=>{
 for(const marker of [{status:'skipped'},{feedback:{version:1}}]){
  const before={plan:{workouts:[{id:'synthetic',date:'2026-01-14',completed:false,...marker}]}};
  assert.throws(()=>verifyProtectedWorkouts(before,{plan:{workouts:[]}}),/removed/);
 }
});
