begin;
alter table public.training_plans
  add column source_version integer not null default 0,
  add column summary text,
  add column model text,
  add column timezone text,
  add column input_revision text,
  add column generation_id uuid;
alter table public.workouts
  add column pace_seconds_per_km integer,
  add column effort text,
  add column completed_at timestamptz;
create unique index workouts_plan_date_unique on public.workouts(plan_id, scheduled_on);
alter table public.training_plans add constraint generated_plan_shape check (
  source_version <> 1 or (extract(isodow from starts_on)=1 and ends_on=starts_on+6
    and summary is not null and model is not null and timezone is not null and input_revision is not null));
alter table public.workouts add constraint generated_workout_metrics check (
  effort is null or (effort in ('rest','conversational','controlled') and distance_km >= 0
  and (pace_seconds_per_km is null or pace_seconds_per_km between 120 and 1800)));

create table public.training_generation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  starts_on date not null,
  state text not null check(state in ('running','completed','failed')),
  input_revision text not null,
  started_at timestamptz not null default now(),
  lease_expires_at timestamptz not null default(now()+interval '6 minutes'),
  finished_at timestamptz,
  failure_code text,
  model text,
  usage jsonb,
  billing_source text not null default 'chatgpt_subscription',
  cost_usd numeric check(cost_usd >= 0)
);
create unique index training_one_running_request on public.training_generation_requests(user_id) where state='running';
create index training_request_history on public.training_generation_requests(user_id,started_at desc);
alter table public.training_generation_requests enable row level security;
-- Read-only ownership policies; generation and completion write through service-only RPCs.
drop policy if exists "plan owner access" on public.training_plans;
create policy "plan owner read" on public.training_plans for select to authenticated using(auth.uid()=user_id);
create policy "generation owner read" on public.training_generation_requests for select to authenticated using(auth.uid()=user_id);
revoke all on public.training_generation_requests from anon, authenticated;
grant select on public.training_generation_requests to authenticated;
grant all on public.training_generation_requests to service_role;

create function public.training_input_revision(p_user_id uuid) returns text
language sql stable security definer set search_path='' as $$
  select pg_catalog.md5(jsonb_build_object(
    'goal',(select jsonb_build_array(race_name,target_distance,target_date,target_time_seconds,training_days,long_run_day) from public.profiles where id=p_user_id),
    'activities',(select coalesce(jsonb_agg(jsonb_build_array(id,started_at,updated_at,distance_meters,duration_seconds,average_pace_seconds_per_km,average_heart_rate) order by id),'[]'::jsonb)
      from public.activities where user_id=p_user_id and source='garmin_fit' and activity_type='running')
  )::text);
$$;
create function public.begin_training_generation(p_user_id uuid,p_starts_on date,p_revision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_plan uuid; v_job uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,917));
  if extract(isodow from p_starts_on)<>1 or p_revision is distinct from public.training_input_revision(p_user_id) then
    raise exception 'input_changed';
  end if;
  select id into v_plan from public.training_plans where user_id=p_user_id and starts_on=p_starts_on and source_version=1;
  if v_plan is not null then return jsonb_build_object('state','existing','planId',v_plan); end if;
  update public.training_generation_requests set state='failed',failure_code='interrupted',finished_at=now()
    where user_id=p_user_id and state='running' and lease_expires_at<=now();
  if exists(select 1 from public.training_generation_requests where user_id=p_user_id and state='running') then
    return jsonb_build_object('state','busy');
  end if;
  if exists(select 1 from public.training_generation_requests where user_id=p_user_id and started_at>now()-interval '60 seconds') or
    (select count(*) from public.training_generation_requests where user_id=p_user_id and started_at>now()-interval '24 hours')>=5 then
    return jsonb_build_object('state','limited');
  end if;
  insert into public.training_generation_requests(user_id,starts_on,state,input_revision)
    values(p_user_id,p_starts_on,'running',p_revision) returning id into v_job;
  return jsonb_build_object('state','started','requestId',v_job);
end;
$$;
create function public.finish_training_generation(p_request_id uuid,p_content jsonb,p_model text,p_timezone text,p_usage jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare j public.training_generation_requests; v_plan uuid; w jsonb; n integer; today date;
begin
  select * into j from public.training_generation_requests where id=p_request_id for update;
  if not found or j.state<>'running' or j.lease_expires_at<=now() then raise exception 'request_expired'; end if;
  perform pg_advisory_xact_lock(hashtextextended(j.user_id::text,917));
  if j.input_revision is distinct from public.training_input_revision(j.user_id) then raise exception 'input_changed'; end if;
  today := (now() at time zone p_timezone)::date;
  if jsonb_typeof(p_content->'workouts')<>'array' or jsonb_array_length(p_content->'workouts') not between 1 and 7 or
    length(p_content->>'summary') not between 1 and 1000 then raise exception 'invalid_plan'; end if;
  if (select count(distinct value->>'date') from jsonb_array_elements(p_content->'workouts')) <> jsonb_array_length(p_content->'workouts') then raise exception 'duplicate_date'; end if;
  -- Existing plans are immutable for this MVP: repeat requests cannot overwrite them.
  if exists(select 1 from public.training_plans where user_id=j.user_id and starts_on=j.starts_on and source_version=1) then raise exception 'already_saved'; end if;
  if exists(select 1 from public.workouts w join public.training_plans p on p.id=w.plan_id where p.user_id=j.user_id and p.starts_on=j.starts_on and w.status='completed') then raise exception 'completed_plan'; end if;
  insert into public.training_plans(user_id,starts_on,ends_on,target_distance_km,recovery_label,source_version,summary,model,timezone,input_revision,generation_id)
    values(j.user_id,j.starts_on,j.starts_on+6,
      (select sum((value->>'distanceKm')::numeric) from jsonb_array_elements(p_content->'workouts')),
      '회복 데이터 없음',1,p_content->>'summary',p_model,p_timezone,j.input_revision,j.id)
    on conflict(user_id,starts_on) do update set ends_on=excluded.ends_on,target_distance_km=excluded.target_distance_km,
      recovery_label=excluded.recovery_label,source_version=1,summary=excluded.summary,model=excluded.model,
      timezone=excluded.timezone,input_revision=excluded.input_revision,generation_id=excluded.generation_id,created_at=now()
    returning id into v_plan;
  delete from public.workouts where plan_id=v_plan;
  for w in select value from jsonb_array_elements(p_content->'workouts') loop
    if (w->>'date')::date < greatest(j.starts_on,today) or (w->>'date')::date>j.starts_on+6 or
      (w->>'date')::date >= (select target_date from public.profiles where id=j.user_id) then raise exception 'invalid_date'; end if;
    n:=extract(isodow from (w->>'date')::date);
    if w->>'kind'<>'rest' and not exists(select 1 from public.profiles where id=j.user_id and n=any(training_days)) then raise exception 'unavailable_day'; end if;
    insert into public.workouts(plan_id,scheduled_on,kind,status,title,purpose,distance_km,target_pace,pace_seconds_per_km,effort)
      values(v_plan,(w->>'date')::date,w->>'kind','scheduled',w->>'title',w->>'purpose',(w->>'distanceKm')::numeric,
        null,(w->>'paceSecondsPerKm')::integer,w->>'effort');
  end loop;
  update public.training_generation_requests set state='completed',finished_at=now(),model=p_model,usage=p_usage where id=j.id;
  return v_plan;
end;
$$;
create function public.fail_training_generation(p_request_id uuid,p_code text,p_usage jsonb) returns void
language sql security definer set search_path='' as $$
  update public.training_generation_requests set state='failed',failure_code=left(p_code,40),finished_at=now(),usage=p_usage
    where id=p_request_id and state='running';
$$;
create function public.complete_training_workout(p_user_id uuid,p_workout_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  update public.workouts w set status='completed',completed_at=coalesce(completed_at,now())
    from public.training_plans p where p.id=w.plan_id and p.user_id=p_user_id and p.source_version=1 and w.id=p_workout_id
    and w.kind<>'rest' and w.scheduled_on=(now() at time zone p.timezone)::date and w.status in ('scheduled','today','completed');
  get diagnostics n=row_count;
  return n=1;
end;
$$;
revoke all on function public.training_input_revision(uuid), public.begin_training_generation(uuid,date,text),
  public.finish_training_generation(uuid,jsonb,text,text,jsonb), public.fail_training_generation(uuid,text,jsonb),
  public.complete_training_workout(uuid,uuid) from public,anon,authenticated;
grant execute on function public.training_input_revision(uuid), public.begin_training_generation(uuid,date,text),
  public.finish_training_generation(uuid,jsonb,text,text,jsonb), public.fail_training_generation(uuid,text,jsonb),
  public.complete_training_workout(uuid,uuid) to service_role;
commit;
