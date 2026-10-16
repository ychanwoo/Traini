-- Exercise real Postgres roles and owner policies; every fixture is rolled back.
begin;
create temporary table admin_test_state(admin_id uuid, outsider_id uuid);
insert into admin_test_state select user_id, gen_random_uuid() from public.traini_admin_config;
do $$ begin
  if (select count(*) from admin_test_state) <> 1 then raise exception 'Configure the administrator first'; end if;
end $$;
insert into auth.users(id,aud,role,email) select outsider_id,'authenticated','authenticated','traini-rls-fixture@example.invalid' from admin_test_state;
insert into public.profiles(id,display_name) select outsider_id,'RLS fixture' from admin_test_state;
grant select on admin_test_state to authenticated,anon;

set local role authenticated;
select set_config('request.jwt.claim.sub',(select outsider_id::text from admin_test_state),true);
do $$ begin
  if public.is_traini_admin() then raise exception 'Outsider considered admin'; end if;
  if exists(select 1 from public.profiles) then raise exception 'Outsider read profiles'; end if;
  if exists(select 1 from public.activities) then raise exception 'Outsider read activities'; end if;
  if exists(select 1 from public.training_plans) then raise exception 'Outsider read plans'; end if;
  if exists(select 1 from public.workouts) then raise exception 'Outsider read workouts'; end if;
  if exists(select 1 from public.training_generation_requests) then raise exception 'Outsider read jobs'; end if;
  begin
    insert into public.profiles(id,display_name) values(auth.uid(),'blocked') on conflict(id) do update set display_name='blocked';
    raise exception 'Outsider wrote own profile';
  exception when insufficient_privilege then null; end;
  begin
    update public.traini_admin_config set user_id=auth.uid();
    raise exception 'Outsider changed admin';
  exception when insufficient_privilege then null; end;
  if has_function_privilege(current_user,'public.begin_training_generation(uuid,date,text)','execute') then raise exception 'Outsider may generate through RPC'; end if;
end $$;

select set_config('request.jwt.claim.sub',(select admin_id::text from admin_test_state),true);
do $$ begin
  if not public.is_traini_admin() then raise exception 'Admin denied'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Admin profile missing'; end if;
  if exists(select 1 from public.profiles where id<>auth.uid()) then raise exception 'Owner isolation lost'; end if;
  update public.profiles set display_name=display_name where id=auth.uid();
  if not found then raise exception 'Admin cannot update profile'; end if;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  if public.is_traini_admin() then raise exception 'Anonymous admin'; end if;
  if exists(select 1 from public.profiles) then raise exception 'Anonymous profiles'; end if;
end $$;
reset role;
rollback;
