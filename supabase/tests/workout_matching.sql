-- Real Postgres permission/ownership checks; all fixtures and config are rolled back.
begin;
create temporary table match_test_users(owner_id uuid,other_id uuid);
insert into match_test_users values(gen_random_uuid(),gen_random_uuid());
insert into auth.users(id,email) select owner_id,'traini-match-rls-owner@example.invalid' from match_test_users
 union all select other_id,'traini-match-rls-other@example.invalid' from match_test_users;
insert into public.profiles(id,display_name) select owner_id,'Matching owner fixture' from match_test_users
 union all select other_id,'Matching other fixture' from match_test_users;
update public.traini_admin_config set user_id=(select owner_id from match_test_users);
create temporary table match_test_ids(plan_id uuid,workout_id uuid,activity_id uuid,other_activity uuid);
insert into match_test_ids values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
insert into public.training_plans(id,user_id,starts_on,ends_on,target_distance_km,recovery_label)
 select plan_id,owner_id,'2000-01-03','2000-01-09',7,'fixture' from match_test_ids cross join match_test_users;
insert into public.workouts(id,plan_id,scheduled_on,kind,status,title,purpose,distance_km)
 select workout_id,plan_id,'2000-01-03','easy','scheduled','fixture','fixture',7 from match_test_ids;
insert into public.activities(id,user_id,garmin_activity_id,activity_type,started_at)
 select activity_id,owner_id,'990001','running','2000-01-03T19:00:00Z'::timestamptz from match_test_ids cross join match_test_users
 union all select other_activity,other_id,'990002','running','2000-01-03T19:00:00Z'::timestamptz from match_test_ids cross join match_test_users;
insert into public.workout_activity_matches(workout_id,activity_id,user_id,method,activity_revision)
 select workout_id,activity_id,owner_id,'automatic',repeat('a',32) from match_test_ids cross join match_test_users;
-- Even the server cannot accidentally attach another owner's activity.
do $$ begin
 begin
  insert into public.workout_activity_matches(workout_id,activity_id,user_id,method,activity_revision)
   select workout_id,other_activity,owner_id,'confirmed',repeat('a',32) from match_test_ids cross join match_test_users;
  raise exception 'cross-owner match unexpectedly accepted';
 exception when raise_exception then if sqlerrm<>'match_owner' then raise; end if; end;
 if has_function_privilege('authenticated','public.workout_match_snapshot(uuid,uuid)','execute')
 or has_function_privilege('anon','public.apply_workout_matches(uuid,uuid,text,jsonb,uuid)','execute') then raise exception 'public matching RPC'; end if;
 if not has_function_privilege('service_role','public.apply_workout_matches(uuid,uuid,text,jsonb,uuid)','execute') then raise exception 'service RPC denied'; end if;
end $$;
grant select on match_test_users to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from match_test_users),true);
do $$ begin
 if (select count(*) from public.workout_activity_matches)<>1 then raise exception 'admin match not visible'; end if;
 begin
  delete from public.workout_activity_matches;
  raise exception 'browser deleted match';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub',(select other_id::text from match_test_users),true);
do $$ begin
 if exists(select 1 from public.workout_activity_matches) then raise exception 'non-admin read matches'; end if;
end $$;
reset role;
select 'workout matching RLS, owner integrity and service-only RPCs passed; fixtures rolled back' as result;
rollback;
