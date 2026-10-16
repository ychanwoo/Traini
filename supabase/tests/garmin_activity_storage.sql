-- Run only after the migration. All fixture data and edits are rolled back.
-- No test users, profile changes, or synthetic activities remain in the project.
begin;

create function pg_temp.assert_true(ok boolean, description text) returns void
language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'Assertion failed: %', description; end if;
end;
$$;

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'traini-storage-test-owner@example.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'traini-storage-test-other@example.invalid');
insert into public.profiles (id, display_name) values
  ('11111111-1111-4111-8111-111111111111', 'Storage test owner'),
  ('22222222-2222-4222-8222-222222222222', 'Storage test other');

create temporary table test_activity as select jsonb_build_object(
 'user_id','11111111-1111-4111-8111-111111111111', 'garmin_activity_id','101',
 'activity_type','running','source','garmin_fit','sub_sport','generic',
 'started_at','2026-10-12T06:50:00+00:00', 'training_date','2026-10-11',
 'training_timezone','America/Los_Angeles','distance_meters',5000.25,
 'duration_seconds',1800.125,'elapsed_time_seconds',2000.5,'moving_time_seconds',null,
 'average_pace_seconds_per_km',360.007,'average_heart_rate',145,
 'average_cadence_steps_per_minute',171,'source_file','101.fit',
 'source_sha256',repeat('a',64),'normalized_sha256',repeat('b',64),
 'normalized_schema_version',1,'parser_version',1,'decoder_name','garmin-fit-sdk',
 'decoder_version','21.218.0','metric_sources','{}'::jsonb,
 'warnings','["missing:moving_time_seconds"]'::jsonb
) as payload;
grant select on test_activity to service_role;

set local role service_role;
select pg_temp.assert_true(public.import_garmin_activity((select payload from test_activity)) = 'inserted', 'first import inserts');
reset role;
create temporary table before_import as select id, created_at, updated_at from public.activities
where user_id = '11111111-1111-4111-8111-111111111111' and garmin_activity_id = '101';
set local role service_role;
select pg_temp.assert_true(public.import_garmin_activity((select payload from test_activity)) = 'unchanged', 'repeat import is unchanged');
reset role;
select pg_temp.assert_true((select count(*)=1 from public.activities where user_id='11111111-1111-4111-8111-111111111111'), 'no duplicate rows');
select pg_temp.assert_true((select a.updated_at=b.updated_at from public.activities a join before_import b using(id)), 'unchanged import preserves timestamp');
select pg_temp.assert_true((select duration_seconds=1800.125 and average_pace_seconds_per_km=360.007 and moving_time_seconds is null
 from public.activities where user_id='11111111-1111-4111-8111-111111111111'), 'fractional seconds and missing moving time preserved');
select pg_temp.assert_true((select training_week_starts_on='2026-10-05' and training_week_ends_on='2026-10-11'
 from public.activities where user_id='11111111-1111-4111-8111-111111111111'), 'week generated from local Sunday');

insert into public.training_plans (id,user_id,starts_on,ends_on,target_distance_km,recovery_label)
 values ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','2026-10-05','2026-10-11',30,'test');
insert into public.workouts (plan_id,scheduled_on,kind,status,title,purpose,completed_activity_id)
 select '33333333-3333-4333-8333-333333333333','2026-10-11','easy','completed','test','test',id from before_import;
update test_activity set payload=payload || '{"distance_meters":6000,"normalized_sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}'::jsonb;
set local role service_role;
select pg_temp.assert_true(public.import_garmin_activity((select payload from test_activity)) = 'updated', 'changed content updates');
reset role;
select pg_temp.assert_true((select a.id=b.id and a.created_at=b.created_at and a.distance_meters=6000 from public.activities a join before_import b using(id)), 'update keeps UUID and created_at');
select pg_temp.assert_true((select count(*)=1 from public.workouts w join before_import b on b.id=w.completed_activity_id), 'workout reference preserved');

-- A local checkpoint/hash is not sufficient proof of the current remote values.
update public.activities set distance_meters=1 where user_id='11111111-1111-4111-8111-111111111111';
set local role service_role;
select pg_temp.assert_true(public.import_garmin_activity((select payload from test_activity)) = 'updated', 'remote drift repaired even when provenance hashes match');
reset role;

-- The same Garmin ID can belong to a different owner without collision.
update test_activity set payload=payload || '{"user_id":"22222222-2222-4222-8222-222222222222"}'::jsonb;
set local role service_role;
select pg_temp.assert_true(public.import_garmin_activity((select payload from test_activity)) = 'inserted', 'uniqueness includes owner');
reset role;

set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
select pg_temp.assert_true((select count(*)=1 from public.activities), 'owner only sees own activity');
do $$
declare affected integer;
begin
  update public.activities set distance_meters=1 where user_id='22222222-2222-4222-8222-222222222222';
  get diagnostics affected=row_count;
  perform pg_temp.assert_true(affected=0, 'cross-owner update blocked');
  begin
    insert into public.activities (user_id,garmin_activity_id,activity_type,started_at)
      values ('22222222-2222-4222-8222-222222222222','102','running',now());
    raise exception 'Cross-owner insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.activities set user_id='22222222-2222-4222-8222-222222222222';
    raise exception 'Ownership transfer unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.import_garmin_activity('{}'::jsonb);
    raise exception 'Authenticated role unexpectedly executed service RPC';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role anon;
do $$
begin
  begin
    perform count(*) from public.activities;
    raise exception 'Anonymous read unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.import_garmin_activity('{}'::jsonb);
    raise exception 'Anonymous role unexpectedly executed service RPC';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- Server writes still obey data constraints; these subtransactions roll back.
do $$
begin
  begin
    update public.activities set training_date='2026-10-12' where user_id='11111111-1111-4111-8111-111111111111';
    raise exception 'Inconsistent training date unexpectedly accepted';
  exception when check_violation then null;
  end;
  begin
    update public.activities set distance_meters='NaN'::numeric where user_id='11111111-1111-4111-8111-111111111111';
    raise exception 'NaN unexpectedly accepted';
  exception when check_violation then null;
  end;
  begin
    update public.activities set duration_seconds=-1 where user_id='11111111-1111-4111-8111-111111111111';
    raise exception 'Negative duration unexpectedly accepted';
  exception when check_violation then null;
  end;
end;
$$;
select pg_temp.assert_true(to_regclass('public.garmin_connections') is null
  and to_regclass('traini_legacy.garmin_connections') is not null, 'OAuth table archived without deletion');
select pg_temp.assert_true(not has_schema_privilege('authenticated','traini_legacy','USAGE'), 'archived credentials not exposed');
select 'PASS: idempotent import, precision, workout links, owner isolation, anonymous denial, constraints, and legacy archive' as result;
rollback;
