begin;
do $$
begin
 if has_table_privilege('authenticated','public.weekly_coaching_notes','insert') or has_table_privilege('anon','public.weekly_coaching_notes','select') then raise exception 'weekly notes direct access'; end if;
 if not (select relrowsecurity from pg_class where oid='public.weekly_coaching_notes'::regclass) then raise exception 'weekly notes RLS missing'; end if;
 if has_function_privilege('authenticated','public.save_weekly_coaching_note(uuid,date,text,integer,integer,text,uuid)','execute') or has_function_privilege('anon','public.save_weekly_coaching_note(uuid,date,text,integer,integer,text,uuid)','execute') then raise exception 'weekly note RPC exposure'; end if;
 if not has_function_privilege('service_role','public.save_weekly_coaching_note(uuid,date,text,integer,integer,text,uuid)','execute') then raise exception 'weekly note service access missing'; end if;
end $$;
rollback;
