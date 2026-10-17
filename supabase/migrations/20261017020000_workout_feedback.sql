begin;
alter table public.workouts
 add column feedback_version integer not null default 0 check(feedback_version>=0),
 add column feedback_reported_at timestamptz,
 add column workout_assessment jsonb,
 add column skip_reason text check(skip_reason is null or length(btrim(skip_reason)) between 1 and 120);

create function public.valid_workout_assessment(v jsonb) returns boolean
language sql immutable set search_path='' as $$
 select v is null or (jsonb_typeof(v)='object' and v ?& array['rpe','fatigue','pain','memo'] and
 v-array['rpe','fatigue','pain','memo']='{}'::jsonb and
 (v->'rpe'='null'::jsonb or (jsonb_typeof(v->'rpe')='number' and (v->>'rpe')::numeric between 1 and 10 and (v->>'rpe')::numeric=trunc((v->>'rpe')::numeric))) and
 (v->'fatigue'='null'::jsonb or v->>'fatigue' in ('low','moderate','high')) and
 (v->'pain'='null'::jsonb or v->>'pain' in ('none','discomfort','pain')) and
 (v->'memo'='null'::jsonb or (jsonb_typeof(v->'memo')='string' and length(btrim(v->>'memo')) between 1 and 200)));
$$;
alter table public.workouts add constraint workout_assessment_valid check(public.valid_workout_assessment(workout_assessment));
create table public.workout_feedback_events (
 id uuid primary key,
 user_id uuid not null references public.profiles(id) on delete cascade,
 workout_id uuid not null references public.workouts(id) on delete cascade,
 request_hash text not null,
 previous_value jsonb not null,
 saved_value jsonb not null,
 created_at timestamptz not null default now()
);
create index workout_feedback_events_owner on public.workout_feedback_events(user_id,created_at);
alter table public.workout_feedback_events enable row level security;
revoke all on public.workout_feedback_events from public,anon,authenticated;
grant select on public.workout_feedback_events to authenticated;
grant all on public.workout_feedback_events to service_role;
create policy "admin reads own workout feedback" on public.workout_feedback_events for select to authenticated
 using(user_id=(select auth.uid()) and (select public.is_traini_admin()));

-- Include subjective reports in matching/review snapshots, preserving the existing bounded projection.
alter function public.workout_match_snapshot(uuid,uuid) rename to workout_match_snapshot_pre_feedback;
create function public.workout_match_snapshot(p_user_id uuid,p_plan_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s jsonb;
begin
 s:=public.workout_match_snapshot_pre_feedback(p_user_id,p_plan_id);
 s:=jsonb_set(s,'{workouts}',(select coalesce(jsonb_agg(value || jsonb_build_object('feedback',jsonb_build_object(
 'version',w.feedback_version,'reportedAt',w.feedback_reported_at,'assessment',w.workout_assessment,'skipReason',w.skip_reason)) order by value->>'date',value->>'id'),'[]'::jsonb)
 from jsonb_array_elements(s->'workouts') value join public.workouts w on w.id=(value->>'id')::uuid));
 return (s-'revision') || jsonb_build_object('revision',md5((s-'revision')::text));
end $$;

create function public.save_workout_feedback(p_user_id uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.workouts; p public.training_plans; outcome text; assessment jsonb; reason text; event public.workout_feedback_events; saved jsonb; previous jsonb; linked boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,917));
 if jsonb_typeof(p_input) is distinct from 'object' or not p_input ?& array['workoutId','requestId','revision','version','outcome','assessment','skipReason'] or
 p_input-array['workoutId','requestId','revision','version','outcome','assessment','skipReason']<>'{}'::jsonb then raise exception 'feedback_input'; end if;
 select * into event from public.workout_feedback_events where id=(p_input->>'requestId')::uuid;
 if found then
   if event.user_id<>p_user_id or event.request_hash<>md5(p_input::text) then raise exception 'feedback_changed'; end if;
   return event.saved_value;
 end if;
 select w1.* into w from public.workouts w1 join public.training_plans t on t.id=w1.plan_id
 where w1.id=(p_input->>'workoutId')::uuid and t.user_id=p_user_id and t.source_version=1 for update of w1;
 if not found then raise exception 'feedback_workout'; end if;
 select * into p from public.training_plans where id=w.plan_id;
 if w.kind='rest' or w.scheduled_on>(now() at time zone p.timezone)::date then raise exception 'feedback_workout'; end if;
 if jsonb_typeof(p_input->'version') is distinct from 'number' or (p_input->>'version')::numeric<>w.feedback_version or
 p_input->>'revision' is distinct from (public.workout_match_snapshot(p_user_id,p.id)->>'revision') then raise exception 'feedback_changed'; end if;
 outcome:=p_input->>'outcome'; assessment:=nullif(p_input->'assessment','null'::jsonb); reason:=p_input->>'skipReason';
 if outcome is null or outcome not in ('completed','skipped','unconfirmed') or not coalesce(public.valid_workout_assessment(assessment),false) or
 (reason is not null and (jsonb_typeof(p_input->'skipReason')<>'string' or length(btrim(reason)) not between 1 and 120)) or
 (outcome='skipped' and (reason is null or assessment->>'rpe' is not null)) or (outcome<>'skipped' and reason is not null) or
 (outcome='unconfirmed' and assessment is not null) then raise exception 'feedback_input'; end if;
 select exists(select 1 from public.workout_activity_matches where workout_id=w.id and active) into linked;
 if outcome<>'completed' and linked then raise exception 'feedback_linked'; end if;
 previous:=jsonb_build_object('status',w.status,'assessment',w.workout_assessment,'skipReason',w.skip_reason,'version',w.feedback_version,'reportedAt',w.feedback_reported_at);
 update public.workouts set
 status=case when outcome='completed' then 'completed' when outcome='skipped' then 'skipped' else 'scheduled' end,
 manual_completed_at=case when outcome='completed' then case when linked then manual_completed_at else coalesce(manual_completed_at,now()) end else null end,
 completed_at=case when outcome='completed' then coalesce(completed_at,now()) else null end,
 completed_activity_id=case when outcome='completed' then completed_activity_id else null end,
 garmin_match_dismissed=case when outcome='skipped' then true else garmin_match_dismissed end,
 workout_assessment=assessment, skip_reason=reason,feedback_reported_at=now(),feedback_version=feedback_version+1
 where id=w.id returning jsonb_build_object('version',feedback_version,'reportedAt',feedback_reported_at,'assessment',workout_assessment,'skipReason',skip_reason) into saved;
 insert into public.workout_feedback_events(id,user_id,workout_id,request_hash,previous_value,saved_value)
 values((p_input->>'requestId')::uuid,p_user_id,w.id,md5(p_input::text),previous,saved);
 return saved;
end $$;

-- Keep the most recent explicit pain response even outside eight weeks. Silence and time never clear it.
create function public.training_feedback_evidence(p_user_id uuid,p_as_of date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('workoutId',w.id,'date',w.scheduled_on,'outcome',w.status,'plannedDistanceKm',w.distance_km,
 'version',w.feedback_version,'reportedAt',w.feedback_reported_at,'assessment',w.workout_assessment,'skipReason',w.skip_reason) order by w.scheduled_on,w.id),'[]'::jsonb) into result
 from (select w.* from public.workouts w join public.training_plans p on p.id=w.plan_id
 where p.user_id=p_user_id and p.source_version=1 and w.feedback_version>0 and w.scheduled_on<=p_as_of and
 (w.scheduled_on>=p_as_of-56 or w.id=(select w2.id from public.workouts w2 join public.training_plans p2 on p2.id=w2.plan_id where p2.user_id=p_user_id and p2.source_version=1 and w2.scheduled_on<=p_as_of and w2.workout_assessment->>'pain' is not null order by w2.scheduled_on desc,w2.feedback_reported_at desc limit 1))
 order by w.scheduled_on desc limit 401) w;
 if jsonb_array_length(result)>400 then raise exception 'feedback_limit'; end if;
 return result;
end $$;

alter function public.training_input_revision(uuid) rename to training_input_revision_pre_feedback;
create function public.training_input_revision(p_user_id uuid) returns text
language sql stable security definer set search_path='' as $$
 select md5(jsonb_build_array(public.training_input_revision_pre_feedback(p_user_id),
 (select coalesce(jsonb_agg(jsonb_build_array(w.id,w.scheduled_on,w.status,w.feedback_version,w.workout_assessment,w.skip_reason,w.feedback_reported_at) order by w.id),'[]'::jsonb)
 from public.workouts w join public.training_plans p on p.id=w.plan_id where p.user_id=p_user_id and w.feedback_version>0))::text)
$$;
revoke all on function public.workout_match_snapshot(uuid,uuid),public.save_workout_feedback(uuid,jsonb),public.training_feedback_evidence(uuid,date),public.training_input_revision(uuid) from public,anon,authenticated;
grant execute on function public.workout_match_snapshot(uuid,uuid),public.save_workout_feedback(uuid,jsonb),public.training_feedback_evidence(uuid,date),public.training_input_revision(uuid) to service_role;
commit;
