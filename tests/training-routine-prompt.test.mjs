import test from 'node:test';
import assert from 'node:assert/strict';
import {typescriptLoader} from './helpers/load-typescript.mjs';
const load=typescriptLoader();
test('routine instructions preserve current evidence constraints and distinguish old injury from current symptoms',()=>{
 const {trainingPrompt}=load('lib/training/weekly-plan.ts');
 const prompt=trainingPrompt({goal:{},history:{},weeklyFeedback:[]},{dates:['2026-10-30'],maxRunKm:10,minEasyPace:300,minHardPace:240});
 assert.match(prompt.instructions,/preferred weekly session pattern/);
 assert.match(prompt.instructions,/Historical injury alone is not an active symptom/);
 assert.match(prompt.instructions,/Never override policy to preserve a routine/);
 assert.match(prompt.instructions,/Unknown tempo pace means use null pace/);
});
