-- Disposable owners and all changes, including the admin allowlist, roll back.
begin;
create temporary table review_owners(owner_id uuid,other_id uuid);
insert into review_owners values(gen_random_uuid(),gen_random_uuid());
insert into auth.users(id,email) select owner_id,'review-owner@example.invalid' from review_owners union all select other_id,'review-other@example.invalid' from review_owners;
insert into public.profiles(id,display_name,target_date,training_days,long_run_day) select owner_id,'Review fixture',current_date+120,array[1,2,3,4,5,6,7],7 from review_owners union all select other_id,'Other fixture',current_date+120,array[1,2,3,4,5,6,7],7 from review_owners;
update public.traini_admin_config set user_id=(select owner_id from review_owners);
do $$
declare uid uuid; d date; snap jsonb; claim jsonb; job uuid; rid uuid; saved jsonb; metrics jsonb; content jsonb; rev text; pid uuid;
begin
 select owner_id into uid from review_owners;
 d:=date_trunc('week',now() at time zone 'America/Los_Angeles')::date-7;
 snap:=public.weekly_review_snapshot(uid,d,'America/Los_Angeles');
 if snap->'source'->>'planId' is not null or jsonb_array_length(snap->'source'->'activities')<>0 then raise exception 'empty source incorrect'; end if;
 begin perform public.weekly_review_snapshot(uid,d+7,'America/Los_Angeles');raise exception 'current week accepted';exception when raise_exception then if sqlerrm<>'review_period' then raise;end if;end;
 rev:=public.training_input_revision(uid);
 claim:=public.begin_weekly_review(uid,d,'America/Los_Angeles',snap->>'revision');job:=(claim->>'requestId')::uuid;
 if claim->>'state'<>'started' then raise exception 'reserve failed';end if;
 if public.begin_training_generation(uid,d+14,rev)->>'state'<>'busy' then raise exception 'review and plan not mutually exclusive';end if;
 metrics:=jsonb_build_object('startsOn',d,'timezone','America/Los_Angeles');
 content:='{"summary":"fixture review","observations":[{"topic":"volume","evidence":["actualKm"],"text":"fixture"}],"nextWeek":{"direction":"maintain","volumeChangePercent":0,"maxQualitySessions":2,"rationale":"fixture"},"limitations":[]}'::jsonb;
 begin perform public.finish_weekly_review(job,'America/Los_Angeles',metrics,content-'summary','fixture','{}');raise exception 'invalid review saved';exception when raise_exception then if sqlerrm<>'invalid_review' then raise;end if;end;
 rid:=public.finish_weekly_review(job,'America/Los_Angeles',metrics,content,'fixture','{}');
 if public.training_input_revision(uid)=rev then raise exception 'review missing from plan revision';end if;
 if public.begin_weekly_review(uid,d,'America/Los_Angeles',snap->>'revision')->>'state'<>'existing' then raise exception 'identical review not reused';end if;
 if (select count(*) from public.training_generation_requests where user_id=uid)<>1 then raise exception 'duplicate provider reservation';end if;
 -- A subsequent week upload does not invalidate the completed source week.
 insert into public.activities(user_id,garmin_activity_id,activity_type,started_at,source,distance_meters,duration_seconds,source_sha256,normalized_sha256,normalized_schema_version,training_date,training_timezone,source_file,parser_version,decoder_name,decoder_version,metric_sources,warnings,imported_at)
 values(uid,'99999901','running',(d+8)::timestamp at time zone 'America/Los_Angeles','garmin_fit',7000,2300,repeat('a',64),repeat('b',64),1,d+8,'America/Los_Angeles','99999901.fit',1,'garmin-fit-sdk','fixture','{}','[]',now());
 if public.weekly_review_snapshot(uid,d,'America/Los_Angeles')->>'revision'<>snap->>'revision' then raise exception 'unrelated week invalidates review';end if;
 update public.profiles set race_name='Updated fixture goal' where id=uid;
 snap:=public.weekly_review_snapshot(uid,d,'America/Los_Angeles');
 if public.begin_weekly_review(uid,d,'America/Los_Angeles',snap->>'revision')->>'state'<>'limited' then raise exception 'cooldown bypassed';end if;
 update public.training_generation_requests set started_at=now()-interval '2 minutes' where id=job;
 claim:=public.begin_weekly_review(uid,d,'America/Los_Angeles',snap->>'revision');job:=(claim->>'requestId')::uuid;
 update public.profiles set race_name='Changed during generation' where id=uid;
 begin perform public.finish_weekly_review(job,'America/Los_Angeles',metrics,content,'fixture','{}');raise exception 'stale review saved';exception when raise_exception then if sqlerrm<>'review_changed' then raise;end if;end;
 perform public.fail_training_generation(job,'review_changed','{}');
 if (select r.content from public.weekly_training_reviews r where r.id=rid)<>content then raise exception 'failure replaced prior review';end if;
 update public.training_generation_requests set started_at=now()-interval '2 minutes' where user_id=uid;
 snap:=public.weekly_review_snapshot(uid,d,'America/Los_Angeles');
 claim:=public.begin_weekly_review(uid,d,'America/Los_Angeles',snap->>'revision');job:=(claim->>'requestId')::uuid;
 update public.training_generation_requests set lease_expires_at=now()-interval '1 second' where id=job;
 if public.begin_weekly_review(uid,d,'America/Los_Angeles',snap->>'revision')->>'state'<>'limited' then raise exception 'expired lease cooldown bypassed';end if;
 if not exists(select 1 from public.training_generation_requests where id=job and failure_code='interrupted') then raise exception 'lease not recovered';end if;
 insert into public.training_generation_requests(user_id,starts_on,state,input_revision,started_at,kind) select uid,d,'failed',snap->>'revision',now()-interval '3 minutes','plan' from generate_series(1,2);
 if public.begin_weekly_review(uid,d,'America/Los_Angeles',snap->>'revision')->>'state'<>'limited' then raise exception 'shared daily cap bypassed';end if;
 if has_function_privilege('authenticated','public.finish_weekly_review(uuid,text,jsonb,jsonb,text,jsonb)','execute') or has_function_privilege('anon','public.weekly_review_snapshot(uuid,date,text)','execute') then raise exception 'RPC exposed';end if;
 if not has_function_privilege('service_role','public.begin_weekly_review(uuid,date,text,text)','execute') then raise exception 'service denied';end if;
end $$;
grant select on review_owners to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from review_owners),true);
do $$ begin
 if (select count(*) from public.weekly_training_reviews)<>1 then raise exception 'admin review hidden';end if;
 begin delete from public.weekly_training_reviews;raise exception 'browser deleted review';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub',(select other_id::text from review_owners),true);
do $$ begin if exists(select 1 from public.weekly_training_reviews) then raise exception 'other user read review';end if;end $$;
reset role;
rollback;
select 'weekly_training_reviews: permissions, CAS, reuse, preservation and shared limits passed; rolled back' as result;
