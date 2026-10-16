-- Run in a rollback-only transaction against a migrated database.
begin;
do $$
begin
  if not public.valid_training_days(null::smallint[]) then raise exception 'NULL availability must be supported'; end if;
  if not public.valid_training_days(array[1,3,7]::smallint[]) then raise exception 'Valid weekdays rejected'; end if;
  if public.valid_training_days(array[]::smallint[]) is distinct from false then raise exception 'Empty array accepted'; end if;
  if public.valid_training_days(array[1,1]::smallint[]) is distinct from false then raise exception 'Duplicate accepted'; end if;
  if public.valid_training_days(array[0,8]::smallint[]) is distinct from false then raise exception 'Invalid weekday accepted'; end if;
  if public.valid_training_days(array[1,null]::smallint[]) is distinct from false then raise exception 'NULL weekday accepted'; end if;
  if public.valid_training_days(array[[1,2],[3,4]]::smallint[]) is distinct from false then raise exception 'Multidimensional array accepted'; end if;
  if public.valid_training_days('[0:1]={1,2}'::smallint[]) is distinct from false then raise exception 'Nonstandard array bounds accepted'; end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='profiles' and c.relrowsecurity) then raise exception 'Profile RLS missing'; end if;
  if not exists(select 1 from public.profiles) then raise exception 'Need an existing test profile'; end if;
  begin
    update public.profiles set training_days=array[1,3]::smallint[],long_run_day=7;
    raise exception 'Unavailable long-run day accepted';
  exception when check_violation then null;
  end;
  begin
    update public.profiles set training_days=null,long_run_day=1;
    raise exception 'Long-run day without availability accepted';
  exception when check_violation then null;
  end;
  update public.profiles set training_days=array[1,3,7]::smallint[],long_run_day=7;
  update public.profiles set training_days=null,long_run_day=null;
end $$;
rollback;
