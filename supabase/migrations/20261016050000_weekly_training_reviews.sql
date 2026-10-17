begin;
alter table public.training_generation_requests add column kind text not null default 'plan' check(kind in ('plan','review'));
create table public.weekly_training_reviews (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 starts_on date not null check(extract(isodow from starts_on)=1),
 timezone text not null,
 input_revision text not null,
 metrics jsonb not null check(jsonb_typeof(metrics)='object'),
 content jsonb not null check(jsonb_typeof(content)='object'),
 model text not null,
 generation_id uuid references public.training_generation_requests(id) on delete set null,
 created_at timestamptz not null default now(),
 unique(user_id,starts_on,timezone)
);
alter table public.weekly_training_reviews enable row level security;
revoke all on public.weekly_training_reviews from public,anon,authenticated;
grant select on public.weekly_training_reviews to authenticated;
grant all on public.weekly_training_reviews to service_role;
create policy "admin reads own reviews" on public.weekly_training_reviews for select to authenticated
 using(user_id=(select auth.uid()) and (select public.is_traini_admin()));
alter table public.training_plans add column review_context jsonb;
alter table public.training_plans add column review_id uuid references public.weekly_training_reviews(id) on delete set null;

-- Snapshot contains no GPS, raw FIT, credentials or profile contact information.
create function public.weekly_review_snapshot(p_user_id uuid,p_starts_on date,p_timezone text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare current_monday date; pid uuid; source jsonb; history jsonb; goal jsonb; result jsonb;
begin
 current_monday:=date_trunc('week',now() at time zone p_timezone)::date;
 if extract(isodow from p_starts_on)<>1 or p_starts_on>=current_monday or p_starts_on<current_monday-56 then raise exception 'review_period'; end if;
 select jsonb_build_array(race_name,target_distance,target_date,target_time_seconds,training_days,long_run_day,training_baseline)
 into goal from public.profiles where id=p_user_id;
 if not found then raise exception 'review_profile'; end if;
 select id into pid from public.training_plans where user_id=p_user_id and starts_on=p_starts_on and source_version=1 and timezone=p_timezone;
 if pid is not null then
   source:=public.workout_match_snapshot(p_user_id,pid);
 else
   source:=jsonb_build_object('planId',null,'timezone',p_timezone,'today',(now() at time zone p_timezone)::date,'revision',repeat('0',32),'workouts','[]'::jsonb,'links','[]'::jsonb,
     'activities',(select coalesce(jsonb_agg(value order by value->>'startedAt',value->>'id'),'[]'::jsonb) from (
       select jsonb_build_object('id',a.id,'garminId',a.garmin_activity_id,'startedAt',a.started_at,'distanceMeters',a.distance_meters,
        'timerSeconds',a.duration_seconds,'paceSecondsPerKm',a.average_pace_seconds_per_km,'evidence',d.evidence,
        'verified',coalesce(a.source_sha256 ~ '^[0-9a-f]{64}$' and a.normalized_sha256 ~ '^[0-9a-f]{64}$' and a.normalized_schema_version=1,false),
        'revision',md5(jsonb_build_array(a.started_at,a.source_sha256,a.normalized_sha256,a.distance_meters,a.duration_seconds,a.average_pace_seconds_per_km,d.evidence)::text)) value
       from public.activities a left join public.activity_training_details d on d.activity_id=a.id and d.user_id=a.user_id and d.source_sha256=a.source_sha256
       where a.user_id=p_user_id and a.source='garmin_fit' and a.activity_type='running'
       and (a.started_at at time zone p_timezone)::date between p_starts_on and p_starts_on+6 order by a.started_at,a.id limit 101
     ) records));
 end if;
 if jsonb_array_length(source->'activities')>100 then raise exception 'review_limit'; end if;
 select coalesce(jsonb_agg(value order by value->>0),'[]'::jsonb) into history from (
  select jsonb_build_array(a.id,a.started_at,a.distance_meters,a.duration_seconds,a.average_pace_seconds_per_km,a.average_heart_rate,a.source_sha256,a.normalized_sha256,d.evidence) value
  from public.activities a left join public.activity_training_details d on d.activity_id=a.id and d.user_id=a.user_id and d.source_sha256=a.source_sha256
  where a.user_id=p_user_id and a.source='garmin_fit' and a.activity_type='running'
   and (a.started_at at time zone p_timezone)::date between p_starts_on-49 and p_starts_on+6 order by a.id limit 801
 ) records;
 if jsonb_array_length(history)>800 then raise exception 'review_limit'; end if;
 result:=jsonb_build_object('startsOn',p_starts_on,'endsOn',p_starts_on+6,'timezone',p_timezone,
   'source',source,'contextHash',md5(jsonb_build_array(goal,history)::text));
 return result || jsonb_build_object('revision',md5((result #- '{source,today}' #- '{source,revision}')::text));
end $$;

create function public.begin_weekly_review(p_user_id uuid,p_starts_on date,p_timezone text,p_revision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing uuid; job uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,917));
 if p_revision is distinct from (public.weekly_review_snapshot(p_user_id,p_starts_on,p_timezone)->>'revision') then raise exception 'review_changed'; end if;
 select id into existing from public.weekly_training_reviews where user_id=p_user_id and starts_on=p_starts_on and timezone=p_timezone and input_revision=p_revision;
 if found then return jsonb_build_object('state','existing','reviewId',existing); end if;
 update public.training_generation_requests set state='failed',failure_code='interrupted',finished_at=now() where user_id=p_user_id and state='running' and lease_expires_at<=now();
 if exists(select 1 from public.training_generation_requests where user_id=p_user_id and state='running') then return jsonb_build_object('state','busy'); end if;
 if exists(select 1 from public.training_generation_requests where user_id=p_user_id and started_at>now()-interval '60 seconds') or
   (select count(*) from public.training_generation_requests where user_id=p_user_id and started_at>now()-interval '24 hours')>=5 then return jsonb_build_object('state','limited'); end if;
 insert into public.training_generation_requests(user_id,starts_on,state,input_revision,kind) values(p_user_id,p_starts_on,'running',p_revision,'review') returning id into job;
 return jsonb_build_object('state','started','requestId',job);
end $$;

create function public.finish_weekly_review(p_request_id uuid,p_timezone text,p_metrics jsonb,p_content jsonb,p_model text,p_usage jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare j public.training_generation_requests; rid uuid;
begin
 select * into j from public.training_generation_requests where id=p_request_id;
 if not found then raise exception 'request_expired'; end if;
 perform pg_advisory_xact_lock(hashtextextended(j.user_id::text,917));
 select * into j from public.training_generation_requests where id=p_request_id for update;
 if j.kind<>'review' or j.state<>'running' or j.lease_expires_at<=now() then raise exception 'request_expired'; end if;
 if j.input_revision is distinct from (public.weekly_review_snapshot(j.user_id,j.starts_on,p_timezone)->>'revision') then raise exception 'review_changed'; end if;
 if jsonb_typeof(p_metrics) is distinct from 'object' or jsonb_typeof(p_content) is distinct from 'object'
   or coalesce(length(p_content->>'summary'),0) not between 1 and 1000 or jsonb_typeof(p_content->'observations') is distinct from 'array'
   or coalesce((p_content->'nextWeek'->>'volumeChangePercent')::integer,999) not between -15 and 5
   or coalesce((p_content->'nextWeek'->>'maxQualitySessions')::integer,999) not between 0 and 2
   or p_metrics->>'startsOn' is distinct from j.starts_on::text or p_metrics->>'timezone' is distinct from p_timezone then raise exception 'invalid_review'; end if;
 insert into public.weekly_training_reviews(user_id,starts_on,timezone,input_revision,metrics,content,model,generation_id)
 values(j.user_id,j.starts_on,p_timezone,j.input_revision,p_metrics,p_content,p_model,j.id)
 on conflict(user_id,starts_on,timezone) do update set input_revision=excluded.input_revision,metrics=excluded.metrics,content=excluded.content,model=excluded.model,generation_id=excluded.generation_id,created_at=now()
 returning id into rid;
 update public.training_generation_requests set state='completed',finished_at=now(),model=p_model,usage=p_usage where id=j.id;
 return rid;
end $$;
revoke all on function public.weekly_review_snapshot(uuid,date,text),public.begin_weekly_review(uuid,date,text,text),public.finish_weekly_review(uuid,text,jsonb,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.weekly_review_snapshot(uuid,date,text),public.begin_weekly_review(uuid,date,text,text),public.finish_weekly_review(uuid,text,jsonb,jsonb,text,jsonb) to service_role;

-- A fresh latest completed-week review participates in the existing CAS protocol.
create or replace function public.training_input_revision(p_user_id uuid) returns text
language sql stable security definer set search_path='' as $$
 select md5(jsonb_build_object(
 'goal',(select jsonb_build_array(race_name,target_distance,target_date,target_time_seconds,training_days,long_run_day,training_baseline) from public.profiles where id=p_user_id),
 'activities',(select coalesce(jsonb_agg(jsonb_build_array(a.id,a.started_at,a.updated_at,a.distance_meters,a.duration_seconds,a.average_pace_seconds_per_km,a.average_heart_rate,d.evidence) order by a.id),'[]'::jsonb)
 from public.activities a left join public.activity_training_details d on d.activity_id=a.id and d.source_sha256=a.source_sha256
 where a.user_id=p_user_id and a.source='garmin_fit' and a.activity_type='running'),
 'review',(select jsonb_build_array(r.id,r.input_revision,r.content) from public.weekly_training_reviews r where r.user_id=p_user_id
 and r.starts_on=date_trunc('week',now() at time zone r.timezone)::date-7
 and r.input_revision=(public.weekly_review_snapshot(p_user_id,r.starts_on,r.timezone)->>'revision') order by r.created_at desc limit 1)
 )::text);
$$;
-- Keep completed workouts intact while recording which review informed a plan.
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
      (w->>'date')::date >= (select target_date from public.profiles where id=j.user_id) then raise exception 'invalid_date'; end if;
    if exists(select 1 from public.workouts where plan_id=v_plan and scheduled_on=(w->>'date')::date) then continue; end if;
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
