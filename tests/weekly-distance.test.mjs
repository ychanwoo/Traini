import test from 'node:test';
import assert from 'node:assert/strict';
import { typescriptLoader } from './helpers/load-typescript.mjs';
const {weeklyDistance}=typescriptLoader()('lib/training/weekly-distance.ts');
const runs=[{id:'1',trainingDate:'2026-10-26',distanceMeters:8460},{id:'2',trainingDate:'2026-10-28',distanceMeters:10000},{id:'3',trainingDate:'2026-10-29',distanceMeters:7360}];
const plan=()=>({workouts:[{date:'2026-10-30',kind:'threshold',distanceKm:10,completed:true},{date:'2026-11-01',kind:'long',distanceKm:15.5,completed:false}]});
test('late plan includes earlier actual distance and pending manual completion in forecast only',()=>{
 const d=weeklyDistance(runs,plan());assert.equal(d.actualKm,25.82);assert.equal(d.expectedKm,51.32);assert.equal(d.includesManualCompletion,true);
});
test('imported actual replaces same-day planned distance, including multiple runs',()=>{
 const d=weeklyDistance([...runs,{id:'4',trainingDate:'2026-10-30',distanceMeters:10200},{id:'5',trainingDate:'2026-10-30',distanceMeters:1000}],plan());
 assert.equal(d.actualKm,37.02);assert.equal(d.expectedKm,52.52);assert.equal(d.includesManualCompletion,false);
});
test('skipped distance is excluded but actual running is never erased',()=>{
 const p=plan();p.workouts[0].status='skipped';assert.equal(weeklyDistance(runs,p).expectedKm,41.32);
});
test('explicit cross-day links replace plan once and missing linked records remain unknown',()=>{
 const p=plan();p.workouts[0].matching={activities:[{garminId:'2',linked:true}]};
 assert.equal(weeklyDistance(runs,p).expectedKm,41.32);
 p.workouts[0].matching.activities[0].garminId='missing';assert.equal(weeklyDistance(runs,p).expectedKm,null);
});
test('missing measurements and unavailable reads are not shown as zero; no plan has no forecast',()=>{
 for(const r of [undefined,[{id:'1',trainingDate:'2026-10-26',distanceMeters:null}]])assert.equal(weeklyDistance(r,plan()).actualKm,null);
 assert.equal(weeklyDistance(runs,plan(),true).expectedKm,null);
 assert.equal(weeklyDistance(runs,null).expectedKm,null);
 assert.equal(weeklyDistance([],plan()).expectedKm,25.5);
});

test('cross-day linked activity does not also replace another scheduled workout',()=>{
 const p=plan();p.workouts[0].matching={activities:[{garminId:'4',linked:true}]};
 const d=weeklyDistance([...runs,{id:'4',trainingDate:'2026-11-01',distanceMeters:10000}],p);
 assert.equal(d.expectedKm,51.32);
});
