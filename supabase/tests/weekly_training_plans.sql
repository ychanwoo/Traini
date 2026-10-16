-- All fixtures and writes are rolled back, including temporary changes to goals.
begin;
do $$
declare uid uuid; rev text; claim jsonb; job uuid; p uuid; old uuid; d date;
  content jsonb; bad jsonb; today date; workout uuid; answer boolean;
begin
  select id into uid from public.profiles order by created_at limit 1;
  if uid is null then raise exception 'Test requires an existing profile'; end if;
  today:=(now() at time zone 'America/Los_Angeles')::date;
  d:=today-(extract(isodow from today)::integer-1)+28;
  update public.profiles set target_date=today+90,training_days=array[1,2,3,4,5,6,7],long_run_day=7 where id=uid;
  -- Isolated future-week fixtures; no committed changes to real plans.
  delete from public.training_plans where user_id=uid and starts_on=d;
  delete from public.training_generation_requests where user_id=uid;
  rev:=public.training_input_revision(uid);
  insert into public.training_plans(user_id,starts_on,ends_on,target_distance_km,recovery_label)
    values(uid,d,d+6,1,'legacy fixture') returning id into old;
  insert into public.workouts(plan_id,scheduled_on,kind,status,title,purpose,distance_km)
    values(old,d,'easy','scheduled','preserve me','fixture',1);
  claim:=public.begin_training_generation(uid,d,rev);job:=(claim->>'requestId')::uuid;
  if claim->>'state'<>'started' then raise exception 'claim did not start'; end if;
  if public.begin_training_generation(uid,d,rev)->>'state'<>'busy' then raise exception 'concurrent claim was not blocked'; end if;
  select jsonb_build_object('summary','SQL fixture', 'workouts',jsonb_agg(jsonb_build_object(
    'date',(d+i)::text,'kind','easy','title','fixture','purpose','fixture',
    'distanceKm',1,'paceSecondsPerKm',null,'effort','conversational') order by i)) into content from generate_series(0,6) i;
  bad:=jsonb_set(content,'{workouts,1,kind}','"unsupported"');
  begin
    perform public.finish_training_generation(job,bad,'test-model','America/Los_Angeles','{}');
    raise exception 'invalid content unexpectedly saved';
  exception when check_violation then null;
  end;
  if not exists(select 1 from public.workouts where plan_id=old and title='preserve me') then raise exception 'failed transaction removed original plan'; end if;
  if (select source_version from public.training_plans where id=old)<>0 then raise exception 'failed transaction replaced original metadata'; end if;
  update public.profiles set target_time_seconds=coalesce(target_time_seconds,12000)+1 where id=uid;
  begin
    perform public.finish_training_generation(job,content,'test-model','America/Los_Angeles','{}');
    raise exception 'changed input unexpectedly saved';
  exception when raise_exception then
    if sqlerrm<>'input_changed' then raise; end if;
  end;
  update public.training_generation_requests set input_revision=public.training_input_revision(uid) where id=job;
  p:=public.finish_training_generation(job,content,'test-model','America/Los_Angeles','{"inputTokens":1,"outputTokens":2}');
  if (select count(*) from public.workouts where plan_id=p)<>7 then raise exception 'workout count incorrect'; end if;
  if public.begin_training_generation(uid,d,public.training_input_revision(uid))->>'state'<>'existing' then raise exception 'duplicate request not reused'; end if;
  if (select count(*) from public.training_generation_requests where user_id=uid)<>1 then raise exception 'duplicate request billed again'; end if;
  if public.complete_training_workout(uid,(select id from public.workouts where plan_id=p limit 1)) then raise exception 'future workout completed'; end if;
  -- A current-day fixture tests idempotent manual completion and owner filtering.
  delete from public.training_plans where user_id=uid and starts_on=today-(extract(isodow from today)::integer-1);
  insert into public.training_plans(user_id,starts_on,ends_on,target_distance_km,recovery_label,source_version,summary,model,timezone,input_revision)
    values(uid,today-(extract(isodow from today)::integer-1),today-(extract(isodow from today)::integer-1)+6,1,'fixture',1,'fixture','test','America/Los_Angeles',rev) returning id into p;
  insert into public.workouts(plan_id,scheduled_on,kind,status,title,purpose,distance_km,effort)
    values(p,today,'easy','scheduled','fixture','fixture',1,'conversational') returning id into workout;
  if not public.complete_training_workout(uid,workout) or not public.complete_training_workout(uid,workout) then raise exception 'completion not idempotent'; end if;
  if public.complete_training_workout('00000000-0000-0000-0000-000000000000',workout) then raise exception 'foreign owner completed workout'; end if;
  if not exists(select 1 from public.workouts where id=workout and status='completed' and completed_at is not null) then raise exception 'completion not saved'; end if;
  update public.workouts set kind='rest' where id=workout;
  if public.complete_training_workout(uid,workout) then raise exception 'rest day completed as running'; end if;
  if has_function_privilege('anon','public.begin_training_generation(uuid,date,text)','execute') or
     has_function_privilege('authenticated','public.finish_training_generation(uuid,jsonb,text,text,jsonb)','execute') or
     has_function_privilege('authenticated','public.complete_training_workout(uuid,uuid)','execute') then raise exception 'RPC permission leak'; end if;
  -- Crash recovery expires the lease; cooldown/rate limits remain in effect.
  update public.training_generation_requests set started_at=now()-interval '2 minutes' where id=job;
  claim:=public.begin_training_generation(uid,d+7,public.training_input_revision(uid));
  if claim->>'state'<>'started' then raise exception 'next request did not start'; end if;
  update public.training_generation_requests set lease_expires_at=now()-interval '1 second' where id=(claim->>'requestId')::uuid;
  if public.begin_training_generation(uid,d+7,public.training_input_revision(uid))->>'state'<>'limited' then raise exception 'cooldown was bypassed'; end if;
  if not exists(select 1 from public.training_generation_requests where id=(claim->>'requestId')::uuid and state='failed' and failure_code='interrupted') then raise exception 'stale lease not recovered'; end if;
  update public.training_generation_requests set started_at=now()-interval '2 minutes' where user_id=uid;
  insert into public.training_generation_requests(user_id,starts_on,state,input_revision,started_at)
    select uid,d+14,'failed',rev,now()-interval '3 minutes' from generate_series(1,3);
  if public.begin_training_generation(uid,d+14,public.training_input_revision(uid))->>'state'<>'limited' then raise exception 'daily attempt cap was bypassed'; end if;
end $$;
rollback;
select 'weekly_training_plans: all checks passed; fixtures rolled back' as result;
