import test from 'node:test';
import assert from 'node:assert/strict';
import { typescriptLoader } from './helpers/load-typescript.mjs';
const load = typescriptLoader();
const { analyzeSession, measuredSessions, refinePrescription } = load('lib/training/prescription.ts');
const { buildTrainingContext } = load('lib/training/context.ts');
const { planPolicy, trainingPrompt } = load('lib/training/weekly-plan.ts');
const lap = (distanceMeters, paceSecondsPerKm, intensity) => ({ distanceMeters, paceSecondsPerKm,
  timerSeconds: distanceMeters / 1000 * paceSecondsPerKm, intensity, averageHeartRate: null });
const tempo = () => [lap(2000,330,'warmup'), ...Array.from({length:7},()=>lap(1000,260,'active')),lap(1000,330,'cooldown')];
const interval = (meters=400,reps=10) => [lap(2000,330,'warmup'), ...Array.from({length:reps},(_,i)=>[
  lap(meters,230,'active'), ...(i<reps-1?[lap(meters/2,360,'rest')]:[]) ]).flat(),lap(2000,330,'cooldown')];
const evidence = laps => ({version:1,lapsComplete:true,lapCount:laps.length,laps});
const session = laps => ({trainingDate:'2026-10-28',evidence:evidence(laps)});
const row = (day,laps,id=day.replaceAll('-','')) => ({garmin_activity_id:id, started_at:`${day}T19:00:00Z`,updated_at:'2026-10-30T19:00:00Z',
 distance_meters:10000,duration_seconds:3000,average_pace_seconds_per_km:300,average_heart_rate:140,
 activity_training_details:{evidence:evidence(laps)}});
const profile = {race_name:'Synthetic race',target_distance:'FULL',target_date:'2027-03-14',target_time_seconds:12600,
 training_days:[1,3,4,5,7],long_run_day:7,training_condition:{reportedOn:'2026-10-30',feeling:'normal'}};
const context = (closed) => buildTrainingContext(profile,[row('2026-10-23',tempo()), row('2026-10-28',interval())],
 'America/Los_Angeles',new Date('2026-10-30T20:00:00Z'),closed);

test('consecutive auto laps become a distance-weighted sustained block, not repetitions',()=>{
 const laps=tempo();laps[2]=lap(1000,250,'active');
 const result=analyzeSession(session(laps));
 assert.equal(result.classification,'sustained');assert.equal(result.work.length,1);
 assert.equal(result.qualityKm,7);assert.equal(result.work[0].paceSecondsPerKm,1810/7);
});
test('400m and 800m work retain repetition and intervening recovery measurements',()=>{
 for(const [m,n] of [[400,10],[800,5]]) {
  const result=analyzeSession(session(interval(m,n)));
  assert.equal(result.classification,'interval');assert.equal(result.work.length,n);
  assert.equal(result.recovery.length,n-1);assert.equal(result.recovery[0].distanceMeters,m/2);
  assert.equal(result.work[0].paceSecondsPerKm,230);
 }
});
test('recovery boundaries prevent separated short efforts from becoming tempo',()=>{
 const result=analyzeSession(session(interval(1000,3)));
 assert.equal(result.classification,'interval');assert.equal(result.work.length,3);
});
test('ambiguous labels, incomplete laps and whole-session pace cannot prove hard training',()=>{
 for(const change of [s=>s.evidence.lapsComplete=false,s=>s.evidence.laps.forEach(l=>l.intensity='interval'),
  s=>s.evidence.laps[3].timerSeconds=null,s=>s.evidence.laps[3].paceSecondsPerKm=120,s=>s.evidence.laps.forEach(l=>{l.paceSecondsPerKm=330;l.timerSeconds=l.distanceMeters*.33;})]) {
  const s=session(interval());s.paceSecondsPerKm=281;change(s);
  assert.equal(analyzeSession(s).classification,'uncertain');
 }
});
test('partial current week is separate from the historical baseline and reaches the prompt',()=>{
 const c=context();assert.equal(c.history.activityCount,1);assert.equal(c.currentWeek.sessions.length,1);
 assert.equal(c.history.end,'2026-10-25');assert.equal(measuredSessions(c).length,2);
 const p=planPolicy(c,'current');const refined=refinePrescription(c,p).policy;
 assert.equal(refined.prescription.tempoPaceKnown,true);
 assert.equal(refined.prescription.intervals[0].observedRepetitions,10);
 assert.equal(refined.maxHardSessions,Math.max(0,p.maxHardSessions-1));
 assert.equal(refined.maxQualityKm,Math.max(0,Math.floor((p.maxQualityKm-4)*10+1e-7)/10));
 const input=JSON.parse(trainingPrompt(c,refined).input[0].content);
 assert.equal(input.currentWeek.sessions[0].trainingDate,'2026-10-28');
 assert.equal(input.sessionAnalysis[1].classification,'interval');
 assert.equal(refined.prescription.tempoMaxWorkKm,7*1.1);
});
test('already performed quality affects remaining counts but not next-week budget twice',()=>{
 const c=context();const p=planPolicy(c,'next');const r=refinePrescription(c,p).policy;
 assert.equal(r.maxHardSessions,p.maxHardSessions);assert.equal(r.maxQualityKm,p.maxQualityKm);
});
test('a demanding activity yesterday blocks consecutive demanding prescriptions',()=>{
 const c=context();c.currentWeek.sessions[0].trainingDate='2026-10-29';
 const r=refinePrescription(c,planPolicy(c,'current')).policy;
 assert.ok(r.easyOnlyDates.includes('2026-10-30'));
});
test('Sunday closeout does not duplicate current-week evidence already in history',()=>{
 const c=buildTrainingContext(profile,[row('2026-10-28',interval())],'America/Los_Angeles',new Date('2026-11-01T20:00:00Z'),'2026-10-26');
 assert.equal(c.history.sessions.length,1);assert.equal(c.currentWeek.sessions.length,1);
 assert.equal(measuredSessions(c).length,1);
});

test('numeric tempo work pace validates from sustained evidence, while an unsupported faster pace fails',()=>{
 const { validatePrescription }=load('lib/training/prescription.ts');
 const c=context(), rules=refinePrescription(c,planPolicy(c,'current')).policy.prescription;
 const step=(kind,distanceMeters,paceSecondsPerKm)=>({kind,distanceMeters,paceSecondsPerKm,repetitions:1,recoveryMeters:0,recoverySeconds:null,recoveryAfterLast:false,recoveryPaceSecondsPerKm:null});
 const plan={workouts:[{date:'2026-10-30',kind:'threshold',distanceKm:3,paceSecondsPerKm:260,steps:[step('warmup',500,330),step('steady',2000,260),step('cooldown',500,330)]}]};
 let reason;
 assert.equal(validatePrescription(plan,rules,value=>{reason=value;}),true,reason);
 plan.workouts[0].steps[1].paceSecondsPerKm=200;
 assert.equal(validatePrescription(plan,rules),false);
});

test('storage fetches current-week detail rows through today without changing eight-week totals',async()=>{
 const queries=[];
 const rows=[row('2026-10-23',tempo()),row('2026-10-28',interval())];
 class Query {
  constructor(table){this.table=table;this.filters={};queries.push(this);}
  select(columns){this.columns=columns;return this;}
  eq(){return this;} order(){return this;} range(){return this;} limit(){return this;}
  gte(key,value){this.filters[`gte:${key}`]=value;return this;}
  lt(key,value){this.filters[`lt:${key}`]=value;return this;}
  lte(){return this;} abortSignal(){return this;}
  maybeSingle(){return Promise.resolve({data:profile,error:null});}
  then(resolve,reject){return Promise.resolve({data:this.table==='activities'?rows:[],error:null,count:this.table==='activities'?rows.length:0}).then(resolve,reject);}
 }
 const db={from:table=>new Query(table),rpc:()=>({abortSignal:async()=>({data:[],error:null})})};
 const modules=typescriptLoader({'@/lib/supabase/admin':{getSupabaseAdmin:()=>db}});
 const c=await modules('lib/training/storage.ts').readTrainingContext('synthetic',new Date('2026-10-30T20:00:00Z'));
 const query=queries.find(q=>q.table==='activities');
 assert.ok(query.filters['lt:started_at']>'2026-10-30T20:00:00Z');
 assert.match(query.columns,/activity_training_details\(evidence\)/);
 assert.equal(c.history.activityCount,1);assert.equal(c.currentWeek.sessions.length,1);
 assert.equal(c.currentWeek.sessions[0].evidence.laps.length,21);
});
