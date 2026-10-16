begin;
do $$
declare uid uuid; d date; rev text; job uuid; plan uuid; completed uuid; content jsonb; saved uuid; claim jsonb;
begin
 select id into uid from public.profiles order by created_at limit 1;
 d:=((now() at time zone 'America/Los_Angeles')::date)-extract(isodow from (now() at time zone 'America/Los_Angeles')::date)::integer+29;
 update public.profiles set target_date=d+90,training_days=array[1,2,3,4,5,6,7],long_run_day=7 where id=uid;
 delete from public.training_plans where user_id=uid and starts_on=d;
 delete from public.training_generation_requests where user_id=uid;
 rev:=public.training_input_revision(uid);
 insert into public.training_plans(user_id,starts_on,ends_on,target_distance_km,recovery_label,source_version,summary,model,timezone,input_revision)
 values(uid,d,d+6,7,'fixture',1,'previous','test','America/Los_Angeles','older-revision') returning id into plan;
 insert into public.workouts(plan_id,scheduled_on,kind,status,title,purpose,distance_km,completed_at)
 values(plan,d+2,'easy','completed','completed fixture','preserve',7,now()) returning id into completed;
 claim:=public.begin_training_generation(uid,d,rev);job:=(claim->>'requestId')::uuid;
 if claim->>'state'<>'started' then raise exception 'updated inputs could not regenerate'; end if;
 select jsonb_build_object('summary','updated fixture','workouts',jsonb_agg(jsonb_build_object('date',(d+i)::text,'kind','easy','title','new fixture','purpose','fixture','distanceKm',1,'paceSecondsPerKm',null,'effort','conversational','steps','[]'::jsonb) order by i)) into content from generate_series(0,6) i;
 saved:=public.finish_training_generation(job,content,'test','America/Los_Angeles','{}');
 if saved<>plan or not exists(select 1 from public.workouts where id=completed and status='completed' and distance_km=7) then raise exception 'completed workout lost during regeneration'; end if;
 if (select target_distance_km from public.training_plans where id=plan)<>13 then raise exception 'preserved completion omitted from total'; end if;
 if public.begin_training_generation(uid,d,rev)->>'state'<>'existing' then raise exception 'same-revision regeneration not idempotent'; end if;
 if has_function_privilege('authenticated','public.import_garmin_activity_with_details(jsonb,jsonb)','execute') then raise exception 'lap RPC exposed'; end if;
 begin
  perform public.import_garmin_activity_with_details('{}','{"version":1,"laps":[],"gps":"private"}');
  raise exception 'private field accepted';
 exception when raise_exception then if sqlerrm<>'invalid_lap_evidence' then raise; end if; end;
 begin
  perform public.import_garmin_activity_with_details('{}','{"version":1,"laps":[{"latitude":1}]}');
  raise exception 'private lap field accepted';
 exception when raise_exception then if sqlerrm<>'unexpected_lap_fields' then raise; end if; end;
end $$;
rollback;
select 'lap evidence and regeneration: passed; fixtures rolled back' as result;
