-- Add an AND condition to existing owner policies. No application rows are removed.
begin;
create table public.traini_admin_config (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null references auth.users(id) on delete cascade
);
alter table public.traini_admin_config enable row level security;
revoke all on public.traini_admin_config from public, anon, authenticated;
grant all on public.traini_admin_config to service_role;

create function public.is_traini_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.traini_admin_config where user_id=(select auth.uid()));
$$;
revoke all on function public.is_traini_admin() from public;
grant execute on function public.is_traini_admin() to anon, authenticated, service_role;

do $$
declare relation text;
begin
  foreach relation in array array['profiles','garmin_snapshots','activities','training_plans','workouts','training_generation_requests','activity_training_details'] loop
    execute format('create policy "administrator required" on public.%I as restrictive for all to anon, authenticated using ((select public.is_traini_admin())) with check ((select public.is_traini_admin()))', relation);
  end loop;
end $$;
-- Public avatar delivery is unchanged; only the configured admin may write.
create policy "administrator avatar insert" on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'avatars' or (select public.is_traini_admin()));
create policy "administrator avatar update" on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'avatars' or (select public.is_traini_admin()))
  with check (bucket_id <> 'avatars' or (select public.is_traini_admin()));
commit;
