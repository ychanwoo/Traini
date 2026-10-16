-- Reuse activities: keep UUIDs, profile relationships, and workout references.
-- duration_seconds is timer time; elapsed and moving time stay separate.
alter table public.activities
  alter column duration_seconds type numeric using duration_seconds::numeric,
  alter column average_pace_seconds_per_km type numeric using average_pace_seconds_per_km::numeric,
  add column source text not null default 'legacy',
  add column sub_sport text,
  add column elapsed_time_seconds numeric,
  add column moving_time_seconds numeric,
  add column average_cadence_steps_per_minute numeric,
  add column training_date date,
  add column training_timezone text,
  add column training_week_starts_on date generated always as
    (training_date - (extract(isodow from training_date)::integer - 1)) stored,
  add column training_week_ends_on date generated always as
    (training_date + (7 - extract(isodow from training_date)::integer)) stored,
  add column source_file text,
  add column source_sha256 text,
  add column normalized_sha256 text,
  add column normalized_schema_version integer,
  add column parser_version integer,
  add column decoder_name text,
  add column decoder_version text,
  add column metric_sources jsonb,
  add column warnings jsonb,
  add column imported_at timestamptz,
  add column updated_at timestamptz not null default now();

comment on column public.activities.duration_seconds is 'Timer-on seconds from FIT total_timer_time; not elapsed or moving time.';
comment on column public.activities.raw_payload is 'Legacy payload only. FIT imports store explicit normalized columns instead.';
comment on column public.activities.source is 'legacy preserves existing rows; garmin_fit identifies validated local FIT imports.';

alter table public.activities
  add constraint activities_source_check check (source in ('legacy', 'garmin_fit')),
  add constraint activities_fit_metadata_check check (source <> 'garmin_fit' or (
    activity_type = 'running'
    and garmin_activity_id ~ '^[1-9][0-9]{0,19}$'
    and garmin_activity_id::numeric <= 18446744073709551615
    and training_date is not null and training_timezone is not null
    and training_date = (started_at at time zone training_timezone)::date
    and source_file in (garmin_activity_id || '.fit', garmin_activity_id || '.FIT')
    and source_file is not null
    and source_sha256 is not null and source_sha256 ~ '^[a-f0-9]{64}$'
    and normalized_sha256 is not null and normalized_sha256 ~ '^[a-f0-9]{64}$'
    and normalized_schema_version is not null and normalized_schema_version > 0
    and parser_version is not null and parser_version > 0
    and decoder_name = 'garmin-fit-sdk' and decoder_name is not null
    and decoder_version is not null and length(decoder_version) between 1 and 64
    and metric_sources is not null and jsonb_typeof(metric_sources) = 'object'
    and warnings is not null and jsonb_typeof(warnings) = 'array'
    and imported_at is not null and raw_payload is null
  )),
  add constraint activities_fit_metrics_check check (source <> 'garmin_fit' or (
    (distance_meters is null or (distance_meters >= 0 and distance_meters < 'Infinity'::numeric))
    and (duration_seconds is null or (duration_seconds >= 0 and duration_seconds < 'Infinity'::numeric))
    and (elapsed_time_seconds is null or (elapsed_time_seconds >= 0 and elapsed_time_seconds < 'Infinity'::numeric))
    and (moving_time_seconds is null or (moving_time_seconds >= 0 and moving_time_seconds < 'Infinity'::numeric))
    and (average_pace_seconds_per_km is null or (average_pace_seconds_per_km > 0 and average_pace_seconds_per_km < 'Infinity'::numeric))
    and (average_heart_rate is null or average_heart_rate between 1 and 254)
    and (average_cadence_steps_per_minute is null or average_cadence_steps_per_minute between 0 and 510)
    and (duration_seconds is null or elapsed_time_seconds is null or duration_seconds <= elapsed_time_seconds + 0.01)
    and (moving_time_seconds is null or coalesce(duration_seconds, elapsed_time_seconds) is null
      or moving_time_seconds <= coalesce(duration_seconds, elapsed_time_seconds) + 0.01)
  ));

create index activities_user_training_date_idx on public.activities (user_id, training_date desc)
  where source = 'garmin_fit';

create function public.touch_activity_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.touch_activity_updated_at() from public, anon, authenticated;
create trigger activities_updated_at before update on public.activities
for each row execute function public.touch_activity_updated_at();

alter table public.activities enable row level security;
drop policy if exists "activity owner access" on public.activities;
create policy "activity owner access" on public.activities for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.activities from anon;
grant select, insert, update, delete on public.activities to authenticated, service_role;

-- The unapproved OAuth flow is retired. Keep its table recoverable, outside
-- public/Data API, instead of dropping stored credentials or recreating tables.
create schema if not exists traini_legacy;
revoke all on schema traini_legacy from public, anon, authenticated;
alter table public.garmin_connections set schema traini_legacy;
revoke all on traini_legacy.garmin_connections from public, anon, authenticated;
comment on table traini_legacy.garmin_connections is 'Archived Garmin OAuth prototype; local Garmin authentication stays on the Mac.';

-- One atomic call per activity. No caller-controlled SQL and no elevated role.
-- Repeated content is unchanged; updates keep the UUID/created_at/workout link.
create function public.import_garmin_activity(p_activity jsonb) returns text
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
revoke all on function public.import_garmin_activity(jsonb) from public, anon, authenticated;
grant execute on function public.import_garmin_activity(jsonb) to service_role;

notify pgrst, 'reload schema';
