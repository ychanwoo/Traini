begin;
alter table public.workouts add column steps jsonb not null default '[]'::jsonb check(jsonb_typeof(steps)='array' and jsonb_array_length(steps)<=6);
create or replace function public.begin_training_generation(p_user_id uuid,p_starts_on date,p_revision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_plan uuid; v_job uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,917));
  if extract(isodow from p_starts_on)<>1 or p_revision is distinct from public.training_input_revision(p_user_id) then
    raise exception 'input_changed';
  end if;
  select id into v_plan from public.training_plans where user_id=p_user_id and starts_on=p_starts_on and source_version=1 and input_revision=p_revision;
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
create or replace function public.finish_training_generation(p_request_id uuid,p_content jsonb,p_model text,p_timezone text,p_usage jsonb) returns uuid
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
  update public.training_generation_requests set state='completed',finished_at=now(),model=p_model,usage=p_usage where id=j.id;
  return v_plan;
end;
$$;

commit;
