import test from 'node:test';
import assert from 'node:assert/strict';
import {typescriptLoader} from './helpers/load-typescript.mjs';
const load=typescriptLoader(), {recordedDay}=load('lib/training/recorded-day.ts');
test('late planning preserves actual days and computes distance-weighted pace across runs',()=>{
 const rows=[{trainingDate:'2026-10-26',distanceMeters:6000,timerSeconds:1800},{trainingDate:'2026-10-26',distanceMeters:2000,timerSeconds:800}];
 const day=recordedDay(rows,'2026-10-26');assert.equal(day.distanceKm,8);assert.equal(day.pace,325);assert.equal(day.count,2);
 assert.equal(recordedDay(rows,'2026-10-27'),null);
 assert.equal(recordedDay([...rows,{trainingDate:'2026-10-26',distanceMeters:null,timerSeconds:null}],'2026-10-26').distanceKm,null);
});
