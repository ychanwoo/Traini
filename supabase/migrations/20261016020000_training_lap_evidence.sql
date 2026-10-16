begin;
create table public.activity_training_details (
 activity_id uuid primary key references public.activities(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 source_sha256 text not null,
 evidence jsonb not null,
 updated_at timestamptz not null default now(),
 check(jsonb_typeof(evidence)='object' and evidence->>'version'='1' and jsonb_typeof(evidence->'laps')='array' and jsonb_array_length(evidence->'laps')<=160)
);
create index activity_training_details_owner on public.activity_training_details(user_id);
alter table public.activity_training_details enable row level security;
revoke all on public.activity_training_details from anon,authenticated;
grant select on public.activity_training_details to authenticated;
grant all on public.activity_training_details to service_role;
create policy "training details owner read" on public.activity_training_details for select to authenticated using(auth.uid()=user_id);
create function public.import_garmin_activity_with_details(p_activity jsonb,p_details jsonb) returns text
language plpgsql security invoker set search_path='' as $$
declare outcome text; aid uuid;
begin
 if p_details - array['version','aerobicTrainingEffect','anaerobicTrainingEffect','lapCount','lapsComplete','laps','warnings']::text[] <> '{}'::jsonb or
   p_details->>'version' is distinct from '1' or jsonb_typeof(p_details->'laps') is distinct from 'array' then raise exception 'invalid_lap_evidence'; end if;
 if exists(select 1 from jsonb_array_elements(p_details->'laps') l where l - array['distanceMeters','timerSeconds','paceSecondsPerKm','averageHeartRate','intensity']::text[] <> '{}'::jsonb) then raise exception 'unexpected_lap_fields'; end if;
 outcome:=public.import_garmin_activity(p_activity);
 select id into strict aid from public.activities where user_id=(p_activity->>'user_id')::uuid and garmin_activity_id=p_activity->>'garmin_activity_id' and source_sha256=p_activity->>'source_sha256';
 insert into public.activity_training_details(activity_id,user_id,source_sha256,evidence)
   values(aid,(p_activity->>'user_id')::uuid,p_activity->>'source_sha256',p_details)
   on conflict(activity_id) do update set evidence=excluded.evidence,source_sha256=excluded.source_sha256,updated_at=now()
   where activity_training_details.evidence is distinct from excluded.evidence or activity_training_details.source_sha256 is distinct from excluded.source_sha256;
 return outcome;
end $$;
revoke all on function public.import_garmin_activity_with_details(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.import_garmin_activity_with_details(jsonb,jsonb) to service_role;
alter table public.profiles add column training_baseline jsonb;
-- Include evidence and the user's reported routine in the concurrency revision.
create or replace function public.training_input_revision(p_user_id uuid) returns text
language sql stable security definer set search_path='' as $$
 select pg_catalog.md5(jsonb_build_object(
 'goal',(select jsonb_build_array(race_name,target_distance,target_date,target_time_seconds,training_days,long_run_day,training_baseline) from public.profiles where id=p_user_id),
 'activities',(select coalesce(jsonb_agg(jsonb_build_array(a.id,a.started_at,a.updated_at,a.distance_meters,a.duration_seconds,a.average_pace_seconds_per_km,a.average_heart_rate,d.evidence) order by a.id),'[]'::jsonb)
 from public.activities a left join public.activity_training_details d on d.activity_id=a.id and d.source_sha256=a.source_sha256
 where a.user_id=p_user_id and a.source='garmin_fit' and a.activity_type='running'))::text);
$$;
revoke all on function public.training_input_revision(uuid) from public,anon,authenticated;
grant execute on function public.training_input_revision(uuid) to service_role;
commit;
