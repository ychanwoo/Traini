begin;
-- Persist the configured timezone with goal updates; use calendar dates, not UTC
-- midnight, when a dated tired report stops restricting new prescriptions.
alter table public.profiles add column training_timezone text not null default 'America/Los_Angeles';
create function public.valid_training_timezone(value text) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from pg_timezone_names where name=value)
$$;
alter table public.profiles add constraint training_timezone_valid check(public.valid_training_timezone(training_timezone));
create or replace function public.training_goal_revision(p_user_id uuid) returns text language sql stable security definer set search_path='' as $$
 select md5(jsonb_build_array(race_name,target_distance,target_date,target_time_seconds,training_days,long_run_day,race_goals,training_condition,training_timezone)::text) from public.profiles where id=p_user_id
$$;
create or replace function public.save_training_preferences(p_user_id uuid,p_goal jsonb,p_expected_revision text default null) returns text
language plpgsql security definer set search_path='' as $$
declare current_profile public.profiles; today date; r jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,917));
 select * into current_profile from public.profiles where id=p_user_id for update;
 if not found then raise exception 'profile_missing';end if;
 if p_expected_revision is not null and p_expected_revision is distinct from public.training_goal_revision(p_user_id) then raise exception 'goal_conflict';end if;
 if not(p_goal ? 'races') and jsonb_array_length(current_profile.race_goals)>0 then raise exception 'goal_conflict';end if;
 today:=(now() at time zone coalesce(p_goal->>'timezone','America/Los_Angeles'))::date;
 if p_goal ? 'races' then
  if not public.valid_training_preferences(p_goal->'races',nullif(p_goal->'condition','null'::jsonb)) then raise exception 'invalid_goal';end if;
  for r in select value from jsonb_array_elements(p_goal->'races') loop
   if (r->>'date')::date<=today and not exists(select 1 from jsonb_array_elements(current_profile.race_goals) old where old->>'id'=r->>'id' and old->>'date'=r->>'date') and not(current_profile.target_date=(r->>'date')::date and current_profile.target_distance=r->>'distance') then raise exception 'past_race';end if;
   if (r->>'date')::date>today+1827 then raise exception 'invalid_goal';end if;
  end loop;
  if (p_goal->'condition'->>'reportedOn')::date>today then raise exception 'invalid_goal';end if;
 end if;
 update public.profiles set race_name=p_goal->>'raceName',target_distance=p_goal->>'targetDistance',target_date=(p_goal->>'targetDate')::date,target_time_seconds=(p_goal->>'targetTimeSeconds')::integer,
 training_days=case when jsonb_typeof(p_goal->'trainingDays')='array' then array(select value::integer from jsonb_array_elements_text(p_goal->'trainingDays')) else null end,
 training_timezone=coalesce(p_goal->>'timezone','America/Los_Angeles'),long_run_day=(p_goal->>'longRunDay')::integer,race_goals=coalesce(p_goal->'races',race_goals),training_condition=case when p_goal ? 'condition' then nullif(p_goal->'condition','null'::jsonb) else training_condition end,updated_at=now() where id=p_user_id;
 return public.training_goal_revision(p_user_id);
end $$;

create function public.training_condition_phase(condition jsonb,today date) returns text language sql immutable set search_path='' as $$
 select case when condition->>'feeling'='tired' then
  case when today<(condition->>'reportedOn')::date then 'future'
       when today<=(condition->>'reportedOn')::date+2 then 'active' else 'expired' end
 else 'unchanged' end
$$;
alter function public.training_input_revision(uuid) rename to training_input_revision_v2;
create function public.training_input_revision(p_user_id uuid) returns text language sql stable security definer set search_path='' as $$
 select md5(jsonb_build_array(public.training_input_revision_v2(p_user_id),p.training_timezone,
 public.training_condition_phase(p.training_condition,(now() at time zone p.training_timezone)::date))::text)
 from public.profiles p where p.id=p_user_id
$$;
revoke all on function public.training_input_revision(uuid) from public,anon,authenticated;
grant execute on function public.training_input_revision(uuid) to service_role;
commit;
