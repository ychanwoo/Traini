begin;
create or replace function public.weekly_review_snapshot_v1(p_user_id uuid,p_starts_on date,p_timezone text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare current_monday date; pid uuid; source jsonb; history jsonb; goal jsonb; result jsonb; ack jsonb;
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
 -- Matching UI state/reason may change on an ordinary read without changing
 -- execution evidence. Keep the existing review fingerprint and a separate
 -- stable acknowledgement fingerprint; actual links/outcomes still invalidate both.
 ack:=jsonb_set(result #- '{source,today}' #- '{source,revision}','{source,workouts}',
  (select coalesce(jsonb_agg(w-'state'-'reason' order by w->>'date',w->>'id'),'[]'::jsonb) from jsonb_array_elements(source->'workouts') w));
 return result || jsonb_build_object('revision',md5((result #- '{source,today}' #- '{source,revision}')::text),
 'closeoutRevision',md5(jsonb_build_array(ack,(select race_goals from public.profiles where id=p_user_id))::text));
end $$;


create or replace function public.training_week_closeout_status(p_user_id uuid,p_timezone text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare day date; start_day date; s jsonb; c public.training_week_closeouts;
begin
 if not exists(select 1 from public.profiles where id=p_user_id and training_timezone=p_timezone) then raise exception 'closeout_period'; end if;
 day:=(now() at time zone p_timezone)::date;
 start_day:=public.training_closeout_week(day);
 s:=public.weekly_review_snapshot(p_user_id,start_day,p_timezone);
 select * into c from public.training_week_closeouts where user_id=p_user_id and starts_on=start_day and timezone=p_timezone;
 return jsonb_build_object('today',day,'startsOn',start_day,'endsOn',start_day+6,'nextStartsOn',start_day+7,'timezone',p_timezone,'early',extract(isodow from day)=7,
 'revision',s->>'closeoutRevision','activityCount',jsonb_array_length(s#>'{source,activities}'),
 'unconfirmed',case when s#>>'{source,planId}' is null then null else (select count(*) from jsonb_array_elements(s#>'{source,workouts}') w where w->>'kind'<>'rest' and w->>'status' not in ('completed','skipped')) end,
 'incompleteActivities',(select count(*) from jsonb_array_elements(s#>'{source,activities}') a where a->>'distanceMeters' is null or a->>'timerSeconds' is null),
 'closeout',case when c.user_id is not null then jsonb_build_object('closedAt',c.closed_at,'revision',c.snapshot_revision,'fresh',c.snapshot_revision=s->>'closeoutRevision') else null end);
end $$;

create or replace function public.close_training_week(p_user_id uuid,p_starts_on date,p_timezone text,p_revision text) returns void
language plpgsql security definer set search_path='' as $$
declare s jsonb; day date; monday date;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,917));
 day:=(now() at time zone p_timezone)::date;monday:=date_trunc('week',day)::date;
 if not exists(select 1 from public.profiles where id=p_user_id and training_timezone=p_timezone)
 or p_starts_on is distinct from public.training_closeout_week(day) then raise exception 'closeout_period'; end if;
 s:=public.weekly_review_snapshot(p_user_id,p_starts_on,p_timezone);
 if p_revision is null or p_revision is distinct from s->>'closeoutRevision' then raise exception 'closeout_changed'; end if;
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
 if p_starts_on=date_trunc('week',now() at time zone p_timezone)::date and not exists(select 1 from public.training_week_closeouts c where c.user_id=p_user_id and c.starts_on=p_starts_on and c.timezone=p_timezone and c.snapshot_revision=(public.weekly_review_snapshot(p_user_id,p_starts_on,p_timezone)->>'closeoutRevision')) then raise exception 'closeout_changed'; end if;
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

commit;
