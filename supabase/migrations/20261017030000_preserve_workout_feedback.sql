begin;
-- Regeneration preserves explicit skips and every reported workout as well as completed/past sessions.
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
    and r.starts_on=date_trunc('week',now() at time zone p_timezone)::date-7
    and r.input_revision=(public.weekly_review_snapshot(j.user_id,r.starts_on,p_timezone)->>'revision') limit 1) where id=v_plan;
  update public.training_plans p set review_context=(select jsonb_build_object('id',r.id,'startsOn',r.starts_on,'revision',r.input_revision,'summary',r.content->'summary','nextWeek',r.content->'nextWeek') from public.weekly_training_reviews r where r.id=p.review_id) where p.id=v_plan;
  update public.training_generation_requests set state='completed',finished_at=now(),model=p_model,usage=p_usage where id=j.id;
  return v_plan;
end;
$$;



commit;
