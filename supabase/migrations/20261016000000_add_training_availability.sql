-- Extend the existing profile; do not invent training availability for old users.
alter table public.profiles
  add column training_days smallint[],
  add column long_run_day smallint;

create function public.valid_training_days(days smallint[]) returns boolean
language sql immutable set search_path = '' as $$
  select days is null or (
    array_ndims(days) = 1 and array_lower(days, 1) = 1
    and cardinality(days) between 1 and 7
    and not exists (select 1 from unnest(days) d where d is null or d not between 1 and 7)
    and cardinality(days) = (select count(distinct d) from unnest(days) d)
  );
$$;
alter table public.profiles
  add constraint profiles_training_days_check check (public.valid_training_days(training_days)),
  add constraint profiles_long_run_day_check check (
    long_run_day is null or (long_run_day between 1 and 7 and training_days is not null and long_run_day = any(training_days))
  );
comment on column public.profiles.training_days is 'Available training ISO weekdays: Monday=1 through Sunday=7. NULL means not supplied, not zero availability.';
comment on column public.profiles.long_run_day is 'Preferred long-run ISO weekday; must be one of training_days. NULL means not supplied.';
