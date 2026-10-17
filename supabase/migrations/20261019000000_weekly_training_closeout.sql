begin;
-- Explicit acknowledgement; never changes workout outcomes or reserves inference.
create table public.training_week_closeouts (
 user_id uuid not null references public.profiles(id) on delete cascade,
 starts_on date not null check(extract(isodow from starts_on)=1),
 timezone text not null,
 snapshot_revision text not null check(snapshot_revision ~ '^[0-9a-f]{32}$'),
 closed_at timestamptz not null default now(),
 primary key(user_id,starts_on,timezone)
);
alter table public.training_week_closeouts enable row level security;
revoke all on public.training_week_closeouts from public,anon,authenticated;
grant select on public.training_week_closeouts to authenticated;
grant all on public.training_week_closeouts to service_role;
create policy "admin reads own closeouts" on public.training_week_closeouts for select to authenticated
 using(user_id=(select auth.uid()) and (select public.is_traini_admin()));

create function public.training_closeout_week(p_day date) returns date
language sql immutable strict set search_path='' as $$
 select date_trunc('week',p_day)::date-case when extract(isodow from p_day)=7 then 0 else 7 end
$$;
create function public.training_review_week(p_user_id uuid,p_timezone text,p_plan_start date default null) returns date
language sql stable security definer set search_path='' as $$
 select case when extract(isodow from now() at time zone p_timezone)=7
 and (p_plan_start is null or p_plan_start>date_trunc('week',now() at time zone p_timezone)::date)
 and exists(select 1 from public.training_week_closeouts c where c.user_id=p_user_id and c.timezone=p_timezone and c.starts_on=date_trunc('week',now() at time zone p_timezone)::date)
 then date_trunc('week',now() at time zone p_timezone)::date
 else date_trunc('week',now() at time zone p_timezone)::date-7 end
$$;
create or replace function public.weekly_review_snapshot_v1(p_user_id uuid,p_starts_on date,p_timezone text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare current_monday date; pid uuid; source jsonb; history jsonb; goal jsonb; result jsonb;
begin
 current_monday:=date_trunc('week',now() at time zone p_timezone)::date;
 if extract(isodow from p_starts_on)<>1 or (p_starts_on>current_monday or (p_starts_on=current_monday and extract(isodow from now() at time zone p_timezone)<>7)) or p_starts_on<current_monday-56 then raise exception 'review_period'; end if;
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
       and a.started_at<=now() and (a.started_at at time zone p_timezone)::date between p_starts_on and p_starts_on+6 order by a.started_at,a.id limit 101
     ) records));
 end if;
 source:=jsonb_set(source,'{activities}',(select coalesce(jsonb_agg(a order by a->>'startedAt',a->>'id'),'[]'::jsonb) from jsonb_array_elements(source->'activities') a where (a->>'startedAt')::timestamptz<=now()));
 if jsonb_array_length(source->'activities')>100 then raise exception 'review_limit'; end if;
 select coalesce(jsonb_agg(value order by value->>0),'[]'::jsonb) into history from (
  select jsonb_build_array(a.id,a.started_at,a.distance_meters,a.duration_seconds,a.average_pace_seconds_per_km,a.average_heart_rate,a.source_sha256,a.normalized_sha256,d.evidence) value
  from public.activities a left join public.activity_training_details d on d.activity_id=a.id and d.user_id=a.user_id and d.source_sha256=a.source_sha256
  where a.user_id=p_user_id and a.source='garmin_fit' and a.activity_type='running'
   and a.started_at<=now() and (a.started_at at time zone p_timezone)::date between p_starts_on-49 and p_starts_on+6 order by a.id limit 801
 ) records;
 if jsonb_array_length(history)>800 then raise exception 'review_limit'; end if;
 result:=jsonb_build_object('startsOn',p_starts_on,'endsOn',p_starts_on+6,'timezone',p_timezone,
   'source',source,'contextHash',md5(jsonb_build_array(goal,history)::text));
 return result || jsonb_build_object('revision',md5((result #- '{source,today}' #- '{source,revision}')::text));
end $$;


create function public.training_week_closeout_status(p_user_id uuid,p_timezone text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare day date; start_day date; s jsonb; c public.training_week_closeouts;
begin
 if not exists(select 1 from public.profiles where id=p_user_id and training_timezone=p_timezone) then raise exception 'closeout_period'; end if;
 day:=(now() at time zone p_timezone)::date;
 start_day:=public.training_closeout_week(day);
 s:=public.weekly_review_snapshot(p_user_id,start_day,p_timezone);
 select * into c from public.training_week_closeouts where user_id=p_user_id and starts_on=start_day and timezone=p_timezone;
 return jsonb_build_object('today',day,'startsOn',start_day,'endsOn',start_day+6,'nextStartsOn',start_day+7,'timezone',p_timezone,'early',extract(isodow from day)=7,
 'revision',s->>'revision','activityCount',jsonb_array_length(s#>'{source,activities}'),
 'unconfirmed',case when s#>>'{source,planId}' is null then null else (select count(*) from jsonb_array_elements(s#>'{source,workouts}') w where w->>'kind'<>'rest' and w->>'status' not in ('completed','skipped')) end,
 'incompleteActivities',(select count(*) from jsonb_array_elements(s#>'{source,activities}') a where a->>'distanceMeters' is null or a->>'timerSeconds' is null),
 'closeout',case when c.user_id is not null then jsonb_build_object('closedAt',c.closed_at,'revision',c.snapshot_revision,'fresh',c.snapshot_revision=s->>'revision') else null end);
end $$;

create function public.close_training_week(p_user_id uuid,p_starts_on date,p_timezone text,p_revision text) returns void
language plpgsql security definer set search_path='' as $$
declare s jsonb; day date; monday date;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,917));
 day:=(now() at time zone p_timezone)::date;monday:=date_trunc('week',day)::date;
 if not exists(select 1 from public.profiles where id=p_user_id and training_timezone=p_timezone)
 or p_starts_on is distinct from public.training_closeout_week(day) then raise exception 'closeout_period'; end if;
 s:=public.weekly_review_snapshot(p_user_id,p_starts_on,p_timezone);
 if p_revision is null or p_revision is distinct from s->>'revision' then raise exception 'closeout_changed'; end if;
 insert into public.training_week_closeouts(user_id,starts_on,timezone,snapshot_revision)
 values(p_user_id,p_starts_on,p_timezone,p_revision)
 on conflict(user_id,starts_on,timezone) do update set snapshot_revision=excluded.snapshot_revision,closed_at=now()
 where training_week_closeouts.snapshot_revision is distinct from excluded.snapshot_revision;
end $$;
create or replace function public.begin_weekly_review(p_user_id uuid,p_starts_on date,p_timezone text,p_revision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing uuid; job uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,917));
 if p_starts_on=date_trunc('week',now() at time zone p_timezone)::date and not exists(select 1 from public.training_week_closeouts c where c.user_id=p_user_id and c.starts_on=p_starts_on and c.timezone=p_timezone and c.snapshot_revision=p_revision) then raise exception 'closeout_changed'; end if;
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

create or replace function public.training_input_revision_v1(p_user_id uuid) returns text
language sql stable security definer set search_path='' as $$
 select md5(jsonb_build_object(
 'goal',(select jsonb_build_array(race_name,target_distance,target_date,target_time_seconds,training_days,long_run_day,training_baseline) from public.profiles where id=p_user_id),
 'activities',(select coalesce(jsonb_agg(jsonb_build_array(a.id,a.started_at,a.updated_at,a.distance_meters,a.duration_seconds,a.average_pace_seconds_per_km,a.average_heart_rate,d.evidence) order by a.id),'[]'::jsonb)
 from public.activities a left join public.activity_training_details d on d.activity_id=a.id and d.source_sha256=a.source_sha256
 where a.user_id=p_user_id and a.source='garmin_fit' and a.activity_type='running'),
 'review',(select jsonb_build_array(r.id,r.input_revision,r.content) from public.weekly_training_reviews r where r.user_id=p_user_id
 and r.starts_on=public.training_review_week(p_user_id,r.timezone)
 and r.input_revision=(public.weekly_review_snapshot(p_user_id,r.starts_on,r.timezone)->>'revision') order by r.created_at desc limit 1)
 )::text);
$$;
create or replace function public.finish_training_generation(p_request_id uuid,p_content jsonb,p_model text,p_timezone text,p_usage jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare j public.training_generation_requests; v_plan uuid; w jsonb; n integer; today date;
begin
  select * into j from public.training_generation_requests where id=p_request_id;
  if not found then raise exception 'request_expired'; end if;
  perform pg_advisory_xact_lock(hashtextextended(j.user_id::text,917));
  select * into j from public.training_generation_requests where id=p_request_id for update;
  if j.kind='plan' and j.state='completed' then
    select id into v_plan from public.training_plans where generation_id=j.id and user_id=j.user_id and timezone=p_timezone;
    if found then return v_plan; end if;
  end if;
  if j.kind<>'plan' or j.state<>'running' or j.lease_expires_at<=now() then raise exception 'request_expired'; end if;
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
  delete from public.workouts where plan_id=v_plan and status not in ('completed','skipped') and feedback_version=0 and scheduled_on>=today;
  for w in select value from jsonb_array_elements(p_content->'workouts') loop
    if (w->>'date')::date < greatest(j.starts_on,today) or (w->>'date')::date>j.starts_on+6 or
      (w->>'date')::date >= (select case when greatest(target_date,(select max((r->>'date')::date) from jsonb_array_elements(race_goals) r)) <= today and (jsonb_array_length(race_goals)>0 or (target_date is not null and target_distance in ('5K','10K','HALF','FULL'))) then greatest(target_date,(select max((r->>'date')::date) from jsonb_array_elements(race_goals) r))+57 else greatest(target_date,(select max((r->>'date')::date) from jsonb_array_elements(race_goals) r)) end from public.profiles where id=j.user_id) then raise exception 'invalid_date'; end if;
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
    and r.starts_on=public.training_review_week(j.user_id,p_timezone,j.starts_on)
    and r.input_revision=(public.weekly_review_snapshot(j.user_id,r.starts_on,p_timezone)->>'revision') limit 1) where id=v_plan;
  update public.training_plans p set review_context=(select jsonb_build_object('id',r.id,'startsOn',r.starts_on,'revision',r.input_revision,'summary',r.content->'summary','nextWeek',r.content->'nextWeek') from public.weekly_training_reviews r where r.id=p.review_id) where p.id=v_plan;
  update public.training_generation_requests set state='completed',finished_at=now(),model=p_model,usage=p_usage where id=j.id;
  return v_plan;
end;
$$;




alter function public.training_input_revision(uuid) rename to training_input_revision_pre_closeout;
create function public.training_input_revision(p_user_id uuid) returns text
language sql stable security definer set search_path='' as $$
 select md5(jsonb_build_array(public.training_input_revision_pre_closeout(p_user_id),
 (select coalesce(jsonb_agg(jsonb_build_array(starts_on,timezone,snapshot_revision) order by starts_on,timezone),'[]'::jsonb) from public.training_week_closeouts where user_id=p_user_id))::text)
$$;
revoke all on function public.training_closeout_week(date),public.training_review_week(uuid,text,date),public.training_week_closeout_status(uuid,text),public.close_training_week(uuid,date,text,text),public.training_input_revision(uuid) from public,anon,authenticated;
grant execute on function public.training_closeout_week(date),public.training_review_week(uuid,text,date),public.training_week_closeout_status(uuid,text),public.close_training_week(uuid,date,text,text),public.training_input_revision(uuid) to service_role;
commit;
