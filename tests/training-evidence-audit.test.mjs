import test from 'node:test';
import assert from 'node:assert/strict';
import {typescriptLoader} from './helpers/load-typescript.mjs';
const load=typescriptLoader();
const {buildTrainingContext}=load('lib/training/context.ts');
const {planPolicy,trainingPrompt}=load('lib/training/weekly-plan.ts');
const {analyzeSession}=load('lib/training/prescription.ts');
const {reviewPrompt,buildReviewMetrics}=load('lib/training/weekly-review.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
const profile={race_name:'Synthetic race',target_distance:'FULL',target_date:'2027-04-04',
  target_time_seconds:14400,training_days:[1,3,5,7],long_run_day:7};
const lap=(meters,pace,intensity,hr)=>({distanceMeters:meters,timerSeconds:meters*pace/1000,
  paceSecondsPerKm:pace,averageHeartRate:hr,intensity});
const laps=()=>[lap(1000,360,'warmup',130),lap(2000,270,'active',165),lap(1000,360,'cooldown',140)];
function context(change=()=>{}) {
  const rows=['2026-10-30','2026-11-02'].map((date,i)=>({
    garmin_activity_id:String(100+i),started_at:date+'T18:00:00Z',updated_at:date+'T19:00:00Z',
    distance_meters:4000,duration_seconds:1260,average_pace_seconds_per_km:315,average_heart_rate:150,
    elapsed_time_seconds:1300,moving_time_seconds:1250,average_cadence_steps_per_minute:174,
    activity_training_details:{evidence:{version:1,lapCount:3,lapsComplete:true,laps:laps(),aerobicTrainingEffect:3.2,anaerobicTrainingEffect:1.1}},
  }));
  change(rows);
  return buildTrainingContext(profile,rows,'America/Los_Angeles',new Date('2026-11-02T20:00:00Z'));
}

test('activity and lap heart rates survive history/current-week context and plan serialization',()=>{
  const c=context();const p=JSON.parse(trainingPrompt(c,planPolicy(c,'current')).input[0].content);
  for(const s of [...p.history.sessions,...p.currentWeek.sessions]) {
    assert.equal(s.averageHeartRate,150);
    assert.deepEqual(s.evidence.laps.map(l=>l.averageHeartRate),[130,165,140]);
    assert.equal(s.evidence.aerobicTrainingEffect,3.2);
    assert.equal(s.evidence.anaerobicTrainingEffect,1.1);
    assert.equal(s.timerSeconds,1260);
    assert.equal(s.paceSecondsPerKm,315);
    assert.equal('id' in s,false);
  }
  assert.deepEqual(p.history,plain(c.history));
  assert.deepEqual(p.currentWeek,plain(c.currentWeek));
});
test('missing heart rate remains unknown even with complete distance and pace',()=>{
  const c=context(rows=>rows.forEach(r=>{r.average_heart_rate=null;r.activity_training_details.evidence.laps.forEach(l=>l.averageHeartRate=null);}));
  assert.equal(c.history.sessions[0].averageHeartRate,null);
  assert.equal(c.history.coverage.heartRateCount,0);
  assert.ok(c.inputs.limitations.includes('missing_heart_rate'));
  assert.ok(c.history.sessions[0].evidence.laps.every(l=>l.averageHeartRate===null));
});
test('stored cadence and elapsed/moving time are not yet part of plan input',()=>{
  const c=context();const p=JSON.parse(trainingPrompt(c,planPolicy(c,'current')).input[0].content);
  for(const s of [...p.history.sessions,...p.currentWeek.sessions]) {
    for(const key of ['average_cadence_steps_per_minute','cadence','elapsed_time_seconds','moving_time_seconds']) assert.equal(key in s,false);
  }
});
test('classification is structural, not a heart-rate trend or easy/recovery/long classification',()=>{
  const c=context(),s=c.history.sessions[0];
  const first=plain(analyzeSession(s));
  assert.equal(first.classification,'sustained');
  s.averageHeartRate=180;s.evidence.laps.forEach(l=>l.averageHeartRate=180);
  assert.deepEqual(plain(analyzeSession(s)),first);
  assert.equal('averageHeartRate' in first.work[0],false);
  s.evidence.laps.forEach(l=>l.intensity='interval');
  assert.equal(analyzeSession(s).classification,'uncertain');
});
test('review serialization receives weekly coverage, not the plan session heart-rate arrays',()=>{
  const c=context();const p=JSON.parse(reviewPrompt({limitations:[]},c).input[0].content);
  assert.deepEqual(p.history,plain(c.history.weeks));
  assert.equal(p.history.some(w=>w.coverage.heartRateCount>0),true);
  assert.equal('sessions' in p,false);
  assert.equal(JSON.stringify(p).includes('averageHeartRate'),false);
});
test('current lap sanitizer accepts zero heart rate but production FIT normalization must remove it',()=>{
  // Characterize the boundary gap, not an endorsement of zero as a valid reading.
  const c=context(rows=>rows[0].activity_training_details.evidence.laps[0].averageHeartRate=0);
  assert.equal(c.history.sessions[0].evidence.laps[0].averageHeartRate,0);
});
test('review and plan currently disagree on structured work without a cooldown lap',()=>{
  const c=context(),s=c.history.sessions[0];
  s.evidence.laps.pop();
  assert.equal(analyzeSession(s).classification,'sustained');
  const metrics=buildReviewMetrics({startsOn:'2026-10-26',endsOn:'2026-11-01',timezone:c.timezone,
    source:{timezone:c.timezone,planId:null,workouts:[],links:[],activities:[{
      id:'synthetic',startedAt:s.startedAt,distanceMeters:s.distanceMeters,timerSeconds:s.timerSeconds,
      verified:true,evidence:s.evidence,
    }]}},c);
  assert.equal(metrics.activities[0].qualityEvidence,null);
  assert.equal(metrics.structuredQualitySessions,0);
});
