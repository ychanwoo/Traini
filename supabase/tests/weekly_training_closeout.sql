begin;
do $$
declare day date;
begin
 foreach day in array array['2026-10-18'::date,'2026-10-19','2026-11-01','2026-11-02','2026-03-08','2026-03-09','2027-01-03','2027-01-04'] loop
  if public.training_closeout_week(day)<>(case when extract(isodow from day)=7 then day-6 else day-7 end) then raise exception 'Sunday/Monday boundary failed: %',day;end if;
 end loop;
 if public.training_closeout_week('2026-10-17')<>'2026-10-05' then raise exception 'incomplete week accepted';end if;
 if has_function_privilege('anon','public.close_training_week(uuid,date,text,text)','execute')
 or has_function_privilege('authenticated','public.close_training_week(uuid,date,text,text)','execute')
 or has_function_privilege('authenticated','public.training_week_closeout_status(uuid,text)','execute') then raise exception 'RPC exposed';end if;
 if has_table_privilege('authenticated','public.training_week_closeouts','INSERT')
 or has_table_privilege('authenticated','public.training_week_closeouts','UPDATE')
 or has_table_privilege('anon','public.training_week_closeouts','SELECT') then raise exception 'closeout write exposed';end if;
 if not (select relrowsecurity from pg_class where oid='public.training_week_closeouts'::regclass) then raise exception 'RLS disabled';end if;
end $$;
rollback;
