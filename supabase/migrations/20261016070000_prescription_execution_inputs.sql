begin;
alter table public.workouts drop constraint workouts_kind_check;
alter table public.workouts add constraint workouts_kind_check check(kind in ('rest','recovery','easy','long','threshold','interval'));
-- Newly generated, uncompleted workouts do not alter the input fingerprint. Confirmed
-- execution changes do, so a match/completion changed during inference cannot be saved.
create or replace function public.training_input_revision(p_user_id uuid) returns text language sql stable security definer set search_path='' as $$
 select md5(jsonb_build_array(public.training_input_revision_v1(p_user_id),p.race_goals,p.training_condition,
 (select coalesce(jsonb_agg(jsonb_build_array(w.id,w.scheduled_on,w.kind,w.distance_km,w.steps,w.manual_completed_at,
  (select coalesce(jsonb_agg(jsonb_build_array(m.activity_id,m.activity_revision,m.method) order by m.activity_id),'[]'::jsonb) from public.workout_activity_matches m where m.workout_id=w.id and m.active)) order by w.id),'[]'::jsonb)
 from public.workouts w join public.training_plans t on t.id=w.plan_id where t.user_id=p_user_id and (w.manual_completed_at is not null or exists(select 1 from public.workout_activity_matches m where m.workout_id=w.id and m.active))))::text)
 from public.profiles p where p.id=p_user_id
$$;
commit;
