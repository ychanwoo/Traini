begin;
alter table public.profiles add column race_goals jsonb not null default '[]', add column training_condition jsonb;
create function public.valid_training_preferences(races jsonb,condition jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare r jsonb; n integer;
begin
 if jsonb_typeof(races) is distinct from 'array' or jsonb_array_length(races)>8 then return false; end if;
 for r in select value from jsonb_array_elements(races) loop
  if jsonb_typeof(r) is distinct from 'object' or (select count(*) from jsonb_object_keys(r))<>6 or
   not(r ?& array['id','name','distance','date','targetTimeSeconds','priority']) or
   coalesce(r->>'id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or
   jsonb_typeof(r->'name') is distinct from 'string' or length(r->>'name')>120 or
   coalesce(r->>'distance','') not in ('5K','10K','HALF','FULL') or coalesce(r->>'priority','') not in ('primary','supporting') or
   coalesce(r->>'date','')!~'^\d{4}-\d{2}-\d{2}$' or (r->>'date')::date::text is distinct from r->>'date' or
   (r->'targetTimeSeconds'<>'null'::jsonb and (jsonb_typeof(r->'targetTimeSeconds') is distinct from 'number' or (r->>'targetTimeSeconds')::numeric<>trunc((r->>'targetTimeSeconds')::numeric) or (r->>'targetTimeSeconds')::numeric not between 1 and 359999)) then return false;end if;
 end loop;
 n:=jsonb_array_length(races);
 if n>0 and ((select count(*) from jsonb_array_elements(races) item where item->>'priority'='primary')<>1 or
  (select count(distinct item->>'id') from jsonb_array_elements(races) item)<>n or (select count(distinct item->>'date') from jsonb_array_elements(races) item)<>n) then return false;end if;
 if condition is not null then
  if jsonb_typeof(condition) is distinct from 'object' or (select count(*) from jsonb_object_keys(condition))<>2 or
   not(condition ?& array['reportedOn','feeling']) or coalesce(condition->>'feeling','') not in ('good','normal','tired','unwell','pain') or
   coalesce(condition->>'reportedOn','')!~'^\d{4}-\d{2}-\d{2}$' or (condition->>'reportedOn')::date::text is distinct from condition->>'reportedOn' then return false; end if;
 end if;
 return true;
exception when others then return false;
end $$;
alter table public.profiles add constraint training_preferences_valid check(public.valid_training_preferences(race_goals,training_condition));
create function public.training_goal_revision(p_user_id uuid) returns text language sql stable security definer set search_path='' as $$
 select md5(jsonb_build_array(race_name,target_distance,target_date,target_time_seconds,training_days,long_run_day,race_goals,training_condition)::text) from public.profiles where id=p_user_id
$$;
create function public.training_goal_snapshot(p_user_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('profile',to_jsonb(p),'revision',public.training_goal_revision(p_user_id)) from public.profiles p where id=p_user_id
$$;
revoke all on function public.training_goal_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.training_goal_snapshot(uuid) to service_role;
create function public.save_training_preferences(p_user_id uuid,p_goal jsonb,p_expected_revision text default null) returns text
language plpgsql security definer set search_path='' as $$
declare current_profile public.profiles; today date; r jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,917));
 select * into current_profile from public.profiles where id=p_user_id for update;
 if not found then raise exception 'profile_missing';end if;
 if p_expected_revision is not null and p_expected_revision is distinct from public.training_goal_revision(p_user_id) then raise exception 'goal_conflict';end if;
 if not(p_goal ? 'races') and jsonb_array_length(current_profile.race_goals)>0 then raise exception 'goal_conflict';end if;
 today:=(now() at time zone coalesce(p_goal->>'timezone','America/Los_Angeles'))::date;
 if p_goal ? 'races' then
  if not public.valid_training_preferences(p_goal->'races',nullif(p_goal->'condition','null'::jsonb)) then raise exception 'invalid_goal';end if;
  for r in select value from jsonb_array_elements(p_goal->'races') loop
   if (r->>'date')::date<=today and not exists(select 1 from jsonb_array_elements(current_profile.race_goals) old where old->>'id'=r->>'id' and old->>'date'=r->>'date') and not(current_profile.target_date=(r->>'date')::date and current_profile.target_distance=r->>'distance') then raise exception 'past_race';end if;
   if (r->>'date')::date>today+1827 then raise exception 'invalid_goal';end if;
  end loop;
  if (p_goal->'condition'->>'reportedOn')::date>today then raise exception 'invalid_goal';end if;
 end if;
 update public.profiles set race_name=p_goal->>'raceName',target_distance=p_goal->>'targetDistance',target_date=(p_goal->>'targetDate')::date,target_time_seconds=(p_goal->>'targetTimeSeconds')::integer,
 training_days=case when jsonb_typeof(p_goal->'trainingDays')='array' then array(select value::integer from jsonb_array_elements_text(p_goal->'trainingDays')) else null end,
 long_run_day=(p_goal->>'longRunDay')::integer,race_goals=coalesce(p_goal->'races',race_goals),training_condition=case when p_goal ? 'condition' then nullif(p_goal->'condition','null'::jsonb) else training_condition end,updated_at=now() where id=p_user_id;
 return public.training_goal_revision(p_user_id);
end $$;
-- Wrap existing revisions so all reservation/CAS paths include the new inputs.
alter function public.weekly_review_snapshot(uuid,date,text) rename to weekly_review_snapshot_v1;
create function public.weekly_review_snapshot(p_user_id uuid,p_starts_on date,p_timezone text) returns jsonb
language sql stable security definer set search_path='' as $$
 select s || jsonb_build_object('contextHash',md5(jsonb_build_array(s->>'contextHash',p.race_goals)::text),'revision',md5(jsonb_build_array(s->>'revision',p.race_goals)::text))
 from public.weekly_review_snapshot_v1(p_user_id,p_starts_on,p_timezone) s cross join public.profiles p where p.id=p_user_id
$$;
alter function public.training_input_revision(uuid) rename to training_input_revision_v1;
create function public.training_input_revision(p_user_id uuid) returns text language sql stable security definer set search_path='' as $$
 select md5(jsonb_build_array(public.training_input_revision_v1(p_user_id),race_goals,training_condition)::text) from public.profiles where id=p_user_id
$$;
revoke all on function public.training_goal_revision(uuid),public.save_training_preferences(uuid,jsonb,text),public.weekly_review_snapshot(uuid,date,text),public.training_input_revision(uuid) from public,anon,authenticated;
grant execute on function public.training_goal_revision(uuid),public.save_training_preferences(uuid,jsonb,text),public.weekly_review_snapshot(uuid,date,text),public.training_input_revision(uuid) to service_role;
create or replace function public.finish_training_generation(p_request_id uuid,p_content jsonb,p_model text,p_timezone text,p_usage jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare j public.training_generation_requests; v_plan uuid; w jsonb; n integer; today date;
begin
  select * into j from public.training_generation_requests where id=p_request_id for update;
  if not found or j.kind<>'plan' or j.state<>'running' or j.lease_expires_at<=now() then raise exception 'request_expired'; end if;
  perform pg_advisory_xact_lock(hashtextextended(j.user_id::text,917));
  if j.input_revision is distinct from public.training_input_revision(j.user_id) then raise exception 'input_changed'; end if;
  today := (now() at time zone p_timezone)::date;
  if jsonb_typeof(p_content->'workouts')<>'array' or jsonb_array_length(p_content->'workouts') not between 1 and 7 or
    length(p_content->>'summary') not between 1 and 1000 then raise exception 'invalid_plan'; end if;
  if (select count(distinct value->>'date') from jsonb_array_elements(p_content->'workouts')) <> jsonb_array_length(p_content->'workouts') then raise exception 'duplicate_date'; end if;
  -- Regeneration preserves completed sessions and past dates.
  insert into public.training_plans(user_id,starts_on,ends_on,target_distance_km,recovery_label,source_version,summary,model,timezone,input_revision,generation_id)
    values(j.user_id,j.starts_on,j.starts_on+6,
      (select sum((value->>'distanceKm')::numeric) from jsonb_array_elements(p_content->'workouts')),
      '회복 데이터 없음',1,p_content->>'summary',p_model,p_timezone,j.input_revision,j.id)
    on conflict(user_id,starts_on) do update set ends_on=excluded.ends_on,target_distance_km=excluded.target_distance_km,
      recovery_label=excluded.recovery_label,source_version=1,summary=excluded.summary,model=excluded.model,
      timezone=excluded.timezone,input_revision=excluded.input_revision,generation_id=excluded.generation_id,created_at=now()
    returning id into v_plan;
  delete from public.workouts where plan_id=v_plan and status<>'completed' and scheduled_on>=today;
  for w in select value from jsonb_array_elements(p_content->'workouts') loop
    if (w->>'date')::date < greatest(j.starts_on,today) or (w->>'date')::date>j.starts_on+6 or
      (w->>'date')::date >= (select greatest(target_date,(select max((r->>'date')::date) from jsonb_array_elements(race_goals) r)) from public.profiles where id=j.user_id) then raise exception 'invalid_date'; end if;
    if exists(select 1 from public.workouts where plan_id=v_plan and scheduled_on=(w->>'date')::date) then continue; end if;
    if w->>'kind'<>'rest' and exists(select 1 from public.profiles p cross join lateral jsonb_array_elements(p.race_goals) r where p.id=j.user_id and r->>'date'=w->>'date') then raise exception 'race_day';end if;
    n:=extract(isodow from (w->>'date')::date);
    if w->>'kind'<>'rest' and not exists(select 1 from public.profiles where id=j.user_id and n=any(training_days)) then raise exception 'unavailable_day'; end if;
    insert into public.workouts(plan_id,scheduled_on,kind,status,title,purpose,distance_km,target_pace,pace_seconds_per_km,effort,steps)
      values(v_plan,(w->>'date')::date,w->>'kind','scheduled',w->>'title',w->>'purpose',(w->>'distanceKm')::numeric,
        null,(w->>'paceSecondsPerKm')::integer,w->>'effort',coalesce(w->'steps','[]'::jsonb));
  end loop;
  update public.training_plans set target_distance_km=(select coalesce(sum(distance_km),0) from public.workouts where plan_id=v_plan) where id=v_plan;
  update public.training_plans set review_id=(select r.id from public.weekly_training_reviews r where r.user_id=j.user_id and r.timezone=p_timezone
    and r.starts_on=date_trunc('week',now() at time zone p_timezone)::date-7
    and r.input_revision=(public.weekly_review_snapshot(j.user_id,r.starts_on,p_timezone)->>'revision') limit 1) where id=v_plan;
  update public.training_plans p set review_context=(select jsonb_build_object('id',r.id,'startsOn',r.starts_on,'revision',r.input_revision,'summary',r.content->'summary','nextWeek',r.content->'nextWeek') from public.weekly_training_reviews r where r.id=p.review_id) where p.id=v_plan;
  update public.training_generation_requests set state='completed',finished_at=now(),model=p_model,usage=p_usage where id=j.id;
  return v_plan;
end;
$$;

commit;
