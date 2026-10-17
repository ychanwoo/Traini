begin;
do $$
begin
 if has_function_privilege('anon','public.save_workout_feedback(uuid,jsonb)','execute') or
 has_function_privilege('authenticated','public.save_workout_feedback(uuid,jsonb)','execute') or
 has_function_privilege('authenticated','public.training_feedback_evidence(uuid,date)','execute') or
 has_function_privilege('anon','public.workout_match_snapshot(uuid,uuid)','execute') then raise exception 'feedback RPC must remain service-only'; end if;
 if not has_function_privilege('service_role','public.save_workout_feedback(uuid,jsonb)','execute') then raise exception 'service role cannot save'; end if;
 if has_table_privilege('authenticated','public.workout_feedback_events','insert') or has_table_privilege('authenticated','public.workout_feedback_events','update') or has_table_privilege('anon','public.workout_feedback_events','select') then raise exception 'feedback direct writes/exposure'; end if;
 if not (select relrowsecurity from pg_class where oid='public.workout_feedback_events'::regclass) then raise exception 'feedback RLS missing'; end if;
 if not public.valid_workout_assessment('{"rpe":7,"fatigue":"moderate","pain":null,"memo":null}') then raise exception 'valid assessment rejected'; end if;
 if public.valid_workout_assessment('{"rpe":11,"fatigue":null,"pain":null,"memo":null}') or public.valid_workout_assessment('{"rpe":3.5,"fatigue":null,"pain":null,"memo":null}') or public.valid_workout_assessment('{"rpe":5}') then raise exception 'invalid assessment accepted'; end if;
end $$;
rollback;
