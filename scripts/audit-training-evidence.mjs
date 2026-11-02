// Reads originals and DB only. No login sessions, uploads, reconciliation or AI.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync, lstatSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {typescriptLoader} from '../tests/helpers/load-typescript.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const root = process.env.TRAINI_AUDIT_DATA_DIR ?? path.join(homedir(),'Projects/Traini-data/garmin');
function localSnapshot() {
  const files = ['activities','normalized'].flatMap(dir=>readdirSync(path.join(root,dir)).sort()
    .map(name=>path.join(root,dir,name)));
  return hash(files.map(file=>{
    assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(),'Unsafe audit file');
    return [file,createHash('sha256').update(readFileSync(file)).digest('hex')];
  }));
}
try {
  const localBefore = localSnapshot();
  const child = spawnSync(process.env.TRAINI_COLLECTOR_PYTHON ?? 'collector/.venv/bin/python',
    ['-B','scripts/lib/fit-evidence-audit.py'],{
      input:JSON.stringify({dataDir:root,timezone:process.env.TRAINI_TIMEZONE ?? 'America/Los_Angeles'}),
      encoding:'utf8',maxBuffer:32*1024*1024,timeout:120000,
      env:{PATH:process.env.PATH,PYTHONDONTWRITEBYTECODE:'1'},
    });
  assert.equal(child.status,0,'Local FIT audit failed');
  const local = JSON.parse(child.stdout);
  assert.ok(local.length>0,'No local FIT files');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  assert.equal(new URL(url).hostname,'kmmutfcgshellvjgpick.supabase.co');
  const db = createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{
    auth:{persistSession:false,autoRefreshToken:false},
    global:{fetch:(input,init)=>{
      const requestUrl = new URL(input);
      assert.equal(requestUrl.origin,new URL(url).origin,'Unexpected network destination');
      const method=init?.method ?? 'GET';
      assert.ok(['GET','HEAD'].includes(method) ||
        (method==='POST' && requestUrl.pathname==='/rest/v1/rpc/training_feedback_evidence'),
      'Audit rejected a mutation');
      return fetch(input,{...init,signal:AbortSignal.timeout(20000)});
    }},
  });
  const uid=process.env.TRAINI_ADMIN_USER_ID;
  async function rows(table,columns='*') {
    const all=[];
    for(let offset=0;;offset+=500) {
      const order=table==='activity_training_details'?'activity_id':table==='weekly_coaching_notes'?'starts_on':'id';
      const {data,error}=await db.from(table).select(columns).eq(table==='profiles'?'id':'user_id',uid).order(order).range(offset,offset+499);
      assert.ok(!error && data,'Audit DB read failed');
      all.push(...data);
      if(data.length<500) return all;
      assert.ok(all.length<10000,'Audit row limit');
    }
  }
  const snapshot = async()=>{
    const result={};
    for(const table of ['profiles','activities','activity_training_details','training_plans','weekly_training_reviews','weekly_coaching_notes']) {
      result[table]=await rows(table);
    }
    return result;
  };
  const before=await snapshot();
  const byGarmin=new Map(before.activities.map(a=>[a.garmin_activity_id,a]));
  const details=new Map(before.activity_training_details.map(d=>[d.activity_id,d]));
  const counts={files:local.length,normalizedMismatch:0,missingDbActivity:0,metricMismatch:0,lapMismatch:0,sourceHashMismatch:0};
  const availability={};
  for(const item of local) {
    for(const [key,value] of Object.entries(item.capabilities)) availability[key]=(availability[key]??0)+Number(value);
    if(!item.normalizedMatches) counts.normalizedMismatch++;
    const stored=byGarmin.get(item.row.garmin_activity_id);
    if(!stored){counts.missingDbActivity++;continue;}
    for(const key of ['distance_meters','duration_seconds','elapsed_time_seconds','moving_time_seconds',
      'average_heart_rate','average_pace_seconds_per_km','average_cadence_steps_per_minute']) {
      const actual=stored[key]===null?null:Number(stored[key]);
      if(actual!==item.row[key]) counts.metricMismatch++;
    }
    if(stored.source_sha256!==item.row.source_sha256 || stored.normalized_sha256!==item.row.normalized_sha256 ||
      details.get(stored.id)?.source_sha256!==item.row.source_sha256) counts.sourceHashMismatch++;
    if(stored.training_date!==item.row.training_date || stored.training_timezone!==item.row.training_timezone ||
      Date.parse(stored.started_at)!==Date.parse(item.row.started_at)) counts.metricMismatch++;
    try{assert.deepEqual(details.get(stored.id)?.evidence,item.evidence);}catch{counts.lapMismatch++;}
  }
  const load=typescriptLoader({'@/lib/supabase/admin':{getSupabaseAdmin:()=>db}});
  const context=await load('lib/training/storage.ts').readTrainingContext(uid);
  const {planPolicy,trainingPrompt}=load('lib/training/weekly-plan.ts');
  // Exercise the actual prompt serializer, without generation/service side effects.
  const prompt=JSON.parse(trainingPrompt(context,planPolicy(context,'current')).input[0].content);
  assert.deepEqual(prompt.history,JSON.parse(JSON.stringify(context.history)));
  assert.deepEqual(prompt.currentWeek,JSON.parse(JSON.stringify(context.currentWeek)));
  const sessions=[...context.history.sessions,...context.currentWeek.sessions];
  let contextMismatch=0;
  for(const session of sessions) {
    const candidates=before.activities.filter(a=>Date.parse(a.started_at)===Date.parse(session.startedAt) &&
      (a.distance_meters===null?null:Number(a.distance_meters))===session.distanceMeters &&
      (a.duration_seconds===null?null:Number(a.duration_seconds))===session.timerSeconds);
    const stored=candidates.length===1?candidates[0]:null;
    if(!stored){contextMismatch++;continue;}
    if(session.averageHeartRate!==(stored.average_heart_rate===null?null:Number(stored.average_heart_rate))) contextMismatch++;
    const expectedPace=session.distanceMeters>0 && session.timerSeconds>0
      ? Number((session.timerSeconds/session.distanceMeters*1000).toFixed(6))
      : stored.average_pace_seconds_per_km===null?null:Number(stored.average_pace_seconds_per_km);
    if(session.paceSecondsPerKm!==expectedPace)contextMismatch++;
    const evidence=details.get(stored.id)?.evidence;
    try{assert.deepEqual(JSON.parse(JSON.stringify(session.evidence?.laps)),evidence?.laps);}catch{contextMismatch++;}
  }
  assert.equal(hash(await snapshot()),hash(before),'Database changed during audit');
  assert.equal(localSnapshot(),localBefore,'Local data changed during audit');
  console.log(JSON.stringify({counts,availability,context:{sessions:sessions.length,
    withAverageHeartRate:sessions.filter(s=>s.averageHeartRate!==null).length,
    withLapEvidence:sessions.filter(s=>s.evidence!==null).length,contextMismatch},
    classifications:Object.fromEntries(['interval','sustained','uncertain'].map(kind=>
      [kind,prompt.sessionAnalysis.filter(s=>s.classification===kind).length])),
    promptPreservesContext:true,localDataUnchanged:true,databaseUnchanged:true,aiCalls:0},null,2));
  if(Object.entries(counts).some(([key,n])=>key!=='files'&&n>0)||contextMismatch)process.exitCode=1;
} catch {
  console.error('Evidence audit stopped; no private payloads logged. Inspect configuration or audit assertions.');
  process.exitCode=1;
}
