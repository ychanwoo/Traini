begin;
alter table public.workouts
 add column manual_completed_at timestamptz,
 add column garmin_match_state text not null default 'unmatched' check(garmin_match_state in ('unmatched','matched','review')),
 add column garmin_match_reason text not null default 'no_activity',
 add column garmin_match_dismissed boolean not null default false;
-- Existing completions are never silently reclassified as Garmin evidence.
update public.workouts set manual_completed_at=coalesce(completed_at,created_at) where status='completed';

create table public.workout_activity_matches (
 workout_id uuid not null references public.workouts(id) on delete cascade,
 activity_id uuid primary key references public.activities(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 method text not null check(method in ('automatic','confirmed')),
 activity_revision text not null,
 active boolean not null default true,
 linked_at timestamptz not null default now()
);
create index workout_activity_matches_workout on public.workout_activity_matches(workout_id);
alter table public.workout_activity_matches enable row level security;
revoke all on public.workout_activity_matches from public,anon,authenticated;
grant select on public.workout_activity_matches to authenticated;
grant all on public.workout_activity_matches to service_role;
create policy "admin reads own workout matches" on public.workout_activity_matches for select to authenticated
 using(user_id=(select auth.uid()) and (select public.is_traini_admin()));

-- Enforce owner consistency even if a future service-side caller has a bug.
create function public.validate_workout_match_owner() returns trigger
language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.activities a where a.id=new.activity_id and a.user_id=new.user_id)
   or not exists(select 1 from public.workouts w join public.training_plans p on p.id=w.plan_id where w.id=new.workout_id and p.user_id=new.user_id)
 then raise exception 'match_owner'; end if;
 return new;
end $$;
revoke all on function public.validate_workout_match_owner() from public,anon,authenticated;
create trigger workout_match_owner before insert or update on public.workout_activity_matches
 for each row execute function public.validate_workout_match_owner();

-- One bounded, consistent snapshot. Only fields required for matching are projected.
create function public.workout_match_snapshot(p_user_id uuid,p_plan_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.training_plans; content jsonb; activities jsonb;
begin
 select * into p from public.training_plans where id=p_plan_id and user_id=p_user_id and source_version=1;
 if not found then raise exception 'match_plan'; end if;
 select coalesce(jsonb_agg(value order by value->>'startedAt',value->>'id'),'[]'::jsonb) into activities from (
   select jsonb_build_object('id',a.id,'garminId',a.garmin_activity_id,'startedAt',a.started_at,
     'distanceMeters',a.distance_meters,'timerSeconds',a.duration_seconds,'paceSecondsPerKm',a.average_pace_seconds_per_km,
     'verified',coalesce(a.source_sha256 ~ '^[0-9a-f]{64}$' and a.normalized_sha256 ~ '^[0-9a-f]{64}$' and a.normalized_schema_version>=1,false),
     'evidence',d.evidence,
     'revision',md5(jsonb_build_array(a.started_at,a.source_sha256,a.normalized_sha256,a.distance_meters,a.duration_seconds,a.average_pace_seconds_per_km,d.evidence)::text)) value
   from public.activities a left join public.activity_training_details d on d.activity_id=a.id and d.user_id=a.user_id and d.source_sha256=a.source_sha256
   where a.user_id=p_user_id and a.source='garmin_fit' and a.activity_type='running'
     and (a.started_at at time zone p.timezone)::date between p.starts_on and p.ends_on
   order by a.started_at,a.id limit 101
 ) rows;
 if jsonb_array_length(activities)>100 then raise exception 'match_limit'; end if;
 content:=jsonb_build_object('planId',p.id,'timezone',p.timezone,'today',(now() at time zone p.timezone)::date,
   'workouts',(select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'date',w.scheduled_on,'kind',w.kind,'status',w.status,
      'distanceKm',w.distance_km,'steps',w.steps,'manualCompletedAt',w.manual_completed_at,
      'state',w.garmin_match_state,'reason',w.garmin_match_reason,'dismissed',w.garmin_match_dismissed) order by w.scheduled_on,w.id),'[]'::jsonb)
      from public.workouts w where w.plan_id=p.id),
   'activities',activities,
   'links',(select coalesce(jsonb_agg(jsonb_build_object('workoutId',m.workout_id,'activityId',m.activity_id,'method',m.method,
      'revision',m.activity_revision,'active',m.active) order by m.activity_id),'[]'::jsonb)
      from public.workout_activity_matches m where m.user_id=p_user_id and (
        m.workout_id in(select id from public.workouts where plan_id=p.id) or m.activity_id in(select (value->>'id')::uuid from jsonb_array_elements(activities)))));
 return content || jsonb_build_object('revision',md5(content::text));
end $$;

create function public.apply_workout_matches(p_user_id uuid,p_plan_id uuid,p_revision text,p_decisions jsonb,p_confirmation uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; decision jsonb; item jsonb; wid uuid; aid uuid; previous public.workout_activity_matches; w public.workouts;
 ids uuid[]; first_id uuid; total integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,917));
 snapshot:=public.workout_match_snapshot(p_user_id,p_plan_id);
 if snapshot->>'revision' is distinct from p_revision then raise exception 'match_changed'; end if;
 if jsonb_typeof(p_decisions) is distinct from 'array' or jsonb_array_length(p_decisions)<>(select count(*) from public.workouts where plan_id=p_plan_id)
   or (select count(distinct value->>'workoutId') from jsonb_array_elements(p_decisions))<>jsonb_array_length(p_decisions) then raise exception 'match_input'; end if;
 for decision in select value from jsonb_array_elements(p_decisions) loop
   wid:=(decision->>'workoutId')::uuid;
   select * into w from public.workouts where id=wid and plan_id=p_plan_id for update;
   if not found or decision->>'state' not in ('unmatched','matched','review') or decision->>'reason' not in
     ('no_activity','future','multiple_activities','distance_mismatch','session_unverified','missing_metrics','already_linked','activity_changed','automatic','confirmed','user_unlinked','not_running','skipped')
     or jsonb_typeof(decision->'links') is distinct from 'array' or jsonb_array_length(decision->'links')>12 then raise exception 'match_input'; end if;
   if decision->'dismissed' is distinct from to_jsonb(w.garmin_match_dismissed) and p_confirmation is distinct from wid then raise exception 'match_confirmation'; end if;
   ids:='{}'::uuid[];
   for item in select value from jsonb_array_elements(decision->'links') loop
     aid:=(item->>'activityId')::uuid;
     if aid=any(ids) then raise exception 'match_input'; end if;
     ids:=array_append(ids,aid);
     if w.kind='rest' or w.status='skipped' or w.scheduled_on>(snapshot->>'today')::date or not exists(
       select 1 from jsonb_array_elements(snapshot->'activities') a where (a->>'id')::uuid=aid and a->>'revision'=item->>'revision'
       and (a->>'verified')::boolean and (a->>'distanceMeters')::numeric>0 and (a->>'timerSeconds')::numeric>0
       and ((a->>'startedAt')::timestamptz at time zone (snapshot->>'timezone'))::date=w.scheduled_on
       and (a->>'startedAt')::timestamptz<=now()
     ) then raise exception 'match_activity'; end if;
     select * into previous from public.workout_activity_matches where activity_id=aid;
     if found and previous.workout_id<>wid and (previous.active or p_confirmation is distinct from wid or item->>'method'<>'confirmed') then raise exception 'match_conflict'; end if;
     if item->>'method' not in ('automatic','confirmed') then raise exception 'match_input'; end if;
     if item->>'method'='confirmed' and p_confirmation is distinct from wid and not coalesce(
       previous.workout_id=wid and previous.method='confirmed' and previous.active and previous.activity_revision=item->>'revision',false) then raise exception 'match_confirmation'; end if;
   end loop;
   if (decision->>'state'='matched') is distinct from (cardinality(ids)>0) then raise exception 'match_input'; end if;
   update public.workout_activity_matches set active=false where workout_id=wid and active and not(activity_id=any(ids));
   for item in select value from jsonb_array_elements(decision->'links') loop
     insert into public.workout_activity_matches(workout_id,activity_id,user_id,method,activity_revision,active)
       values(wid,(item->>'activityId')::uuid,p_user_id,item->>'method',item->>'revision',true)
       on conflict(activity_id) do update set workout_id=excluded.workout_id,user_id=excluded.user_id,method=excluded.method,activity_revision=excluded.activity_revision,active=true,
         linked_at=case when workout_activity_matches.workout_id<>excluded.workout_id then now() else workout_activity_matches.linked_at end
       where workout_activity_matches.workout_id is distinct from excluded.workout_id or workout_activity_matches.method is distinct from excluded.method or workout_activity_matches.activity_revision is distinct from excluded.activity_revision or not workout_activity_matches.active;
   end loop;
   total:=cardinality(ids); first_id:=case when total=1 then ids[1] else null end;
   update public.workouts set garmin_match_state=decision->>'state',garmin_match_reason=decision->>'reason',garmin_match_dismissed=(decision->>'dismissed')::boolean,
     status=case when total>0 or manual_completed_at is not null then 'completed' when status='completed' then 'scheduled' else status end,
     completed_at=case when total>0 or manual_completed_at is not null then coalesce(completed_at,now()) else null end,
     completed_activity_id=first_id
   where id=wid and (garmin_match_state is distinct from decision->>'state' or garmin_match_reason is distinct from decision->>'reason'
     or garmin_match_dismissed is distinct from (decision->>'dismissed')::boolean or completed_activity_id is distinct from first_id
     or (status='completed') is distinct from (total>0 or manual_completed_at is not null));
 end loop;
 return public.workout_match_snapshot(p_user_id,p_plan_id);
end $$;

-- Serialize manual completion with matching and plan regeneration.
create or replace function public.complete_training_workout(p_user_id uuid,p_workout_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,917));
 update public.workouts w set status='completed',completed_at=coalesce(completed_at,now()),manual_completed_at=coalesce(manual_completed_at,now())
 from public.training_plans p where p.id=w.plan_id and p.user_id=p_user_id and p.source_version=1 and w.id=p_workout_id
 and w.kind<>'rest' and w.scheduled_on=(now() at time zone p.timezone)::date and w.status in ('scheduled','today','completed');
 get diagnostics n=row_count;
 return n=1;
end $$;
revoke all on function public.workout_match_snapshot(uuid,uuid),public.apply_workout_matches(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.workout_match_snapshot(uuid,uuid),public.apply_workout_matches(uuid,uuid,text,jsonb,uuid) to service_role;
-- Ingestion, matching, manual completion and regeneration share one owner lock.
create or replace function public.import_garmin_activity(p_activity jsonb) returns text
language plpgsql security invoker set search_path = '' as $$
declare
  incoming public.activities;
  affected integer;
begin
  if jsonb_typeof(p_activity) is distinct from 'object'
    or p_activity->>'source' is distinct from 'garmin_fit'
    or p_activity - array[
      'user_id',
      'garmin_activity_id',
      'activity_type',
      'started_at',
      'distance_meters',
      'duration_seconds',
      'average_heart_rate',
      'average_pace_seconds_per_km',
      'source',
      'sub_sport',
      'elapsed_time_seconds',
      'moving_time_seconds',
      'average_cadence_steps_per_minute',
      'training_date',
      'training_timezone',
      'source_file',
      'source_sha256',
      'normalized_sha256',
      'normalized_schema_version',
      'parser_version',
      'decoder_name',
      'decoder_version',
      'metric_sources',
      'warnings'
    ]::text[] <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'Invalid Garmin activity input';
  end if;
  incoming := jsonb_populate_record(null::public.activities, p_activity);
  perform pg_advisory_xact_lock(hashtextextended(incoming.user_id::text,917));
  incoming.imported_at := clock_timestamp();
  insert into public.activities (
    user_id,
    garmin_activity_id,
    activity_type,
    started_at,
    distance_meters,
    duration_seconds,
    average_heart_rate,
    average_pace_seconds_per_km,
    source,
    sub_sport,
    elapsed_time_seconds,
    moving_time_seconds,
    average_cadence_steps_per_minute,
    training_date,
    training_timezone,
    source_file,
    source_sha256,
    normalized_sha256,
    normalized_schema_version,
    parser_version,
    decoder_name,
    decoder_version,
    metric_sources,
    warnings,
    imported_at
  ) values (
    incoming.user_id,
    incoming.garmin_activity_id,
    incoming.activity_type,
    incoming.started_at,
    incoming.distance_meters,
    incoming.duration_seconds,
    incoming.average_heart_rate,
    incoming.average_pace_seconds_per_km,
    incoming.source,
    incoming.sub_sport,
    incoming.elapsed_time_seconds,
    incoming.moving_time_seconds,
    incoming.average_cadence_steps_per_minute,
    incoming.training_date,
    incoming.training_timezone,
    incoming.source_file,
    incoming.source_sha256,
    incoming.normalized_sha256,
    incoming.normalized_schema_version,
    incoming.parser_version,
    incoming.decoder_name,
    incoming.decoder_version,
    incoming.metric_sources,
    incoming.warnings,
    incoming.imported_at
  ) on conflict (user_id, garmin_activity_id) do nothing;
  get diagnostics affected = row_count;
  if affected = 1 then return 'inserted'; end if;

  update public.activities a set
    activity_type = incoming.activity_type,
    started_at = incoming.started_at,
    distance_meters = incoming.distance_meters,
    duration_seconds = incoming.duration_seconds,
    average_heart_rate = incoming.average_heart_rate,
    average_pace_seconds_per_km = incoming.average_pace_seconds_per_km,
    source = incoming.source,
    sub_sport = incoming.sub_sport,
    elapsed_time_seconds = incoming.elapsed_time_seconds,
    moving_time_seconds = incoming.moving_time_seconds,
    average_cadence_steps_per_minute = incoming.average_cadence_steps_per_minute,
    training_date = incoming.training_date,
    training_timezone = incoming.training_timezone,
    source_file = incoming.source_file,
    source_sha256 = incoming.source_sha256,
    normalized_sha256 = incoming.normalized_sha256,
    normalized_schema_version = incoming.normalized_schema_version,
    parser_version = incoming.parser_version,
    decoder_name = incoming.decoder_name,
    decoder_version = incoming.decoder_version,
    metric_sources = incoming.metric_sources,
    warnings = incoming.warnings,
    raw_payload = null,
    imported_at = incoming.imported_at
  where a.user_id = incoming.user_id and a.garmin_activity_id = incoming.garmin_activity_id
    and (row(
      a.activity_type,
      a.started_at,
      a.distance_meters,
      a.duration_seconds,
      a.average_heart_rate,
      a.average_pace_seconds_per_km,
      a.source,
      a.sub_sport,
      a.elapsed_time_seconds,
      a.moving_time_seconds,
      a.average_cadence_steps_per_minute,
      a.training_date,
      a.training_timezone,
      a.source_file,
      a.source_sha256,
      a.normalized_sha256,
      a.normalized_schema_version,
      a.parser_version,
      a.decoder_name,
      a.decoder_version,
      a.metric_sources,
      a.warnings,
      a.raw_payload
    )
    is distinct from row(
      incoming.activity_type,
      incoming.started_at,
      incoming.distance_meters,
      incoming.duration_seconds,
      incoming.average_heart_rate,
      incoming.average_pace_seconds_per_km,
      incoming.source,
      incoming.sub_sport,
      incoming.elapsed_time_seconds,
      incoming.moving_time_seconds,
      incoming.average_cadence_steps_per_minute,
      incoming.training_date,
      incoming.training_timezone,
      incoming.source_file,
      incoming.source_sha256,
      incoming.normalized_sha256,
      incoming.normalized_schema_version,
      incoming.parser_version,
      incoming.decoder_name,
      incoming.decoder_version,
      incoming.metric_sources,
      incoming.warnings,
      null::jsonb
    ));
  get diagnostics affected = row_count;
  if affected = 1 then return 'updated'; end if;
  return 'unchanged';
end;
$$;
commit;
