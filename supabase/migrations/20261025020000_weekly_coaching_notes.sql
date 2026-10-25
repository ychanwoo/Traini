begin;
-- Weekly self-report is separate from workout completion and closeout acknowledgement.
create table public.weekly_coaching_notes (
 user_id uuid not null references public.profiles(id) on delete cascade,
 starts_on date not null check(extract(isodow from starts_on)=1),
 timezone text not null,
 rpe integer check(rpe between 1 and 10), memo text check(length(memo)<=200),
 version integer not null check(version>0), updated_at timestamptz not null default now(),
 request_id uuid not null, request_hash text not null,
 primary key(user_id,starts_on,timezone)
);
alter table public.weekly_coaching_notes enable row level security;
revoke all on public.weekly_coaching_notes from public,anon,authenticated;
grant select on public.weekly_coaching_notes to authenticated;
grant all on public.weekly_coaching_notes to service_role;
create policy "admin reads own weekly notes" on public.weekly_coaching_notes for select to authenticated
 using(user_id=(select auth.uid()) and (select public.is_traini_admin()));

alter function public.weekly_review_snapshot(uuid,date,text) rename to weekly_review_snapshot_pre_weekly_notes;
create function public.weekly_review_snapshot(p_user_id uuid,p_starts_on date,p_timezone text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s jsonb; note jsonb;
begin
 s:=public.weekly_review_snapshot_pre_weekly_notes(p_user_id,p_starts_on,p_timezone);
 select jsonb_build_object('rpe',rpe,'memo',memo,'version',version,'updatedAt',updated_at) into note
 from public.weekly_coaching_notes where user_id=p_user_id and starts_on=p_starts_on and timezone=p_timezone;
 if note is null then return s || jsonb_build_object('weeklyFeedback',null); end if;
 return s || jsonb_build_object('weeklyFeedback',note,'revision',md5(jsonb_build_array(s->>'revision',note)::text));
end $$;

alter function public.training_input_revision(uuid) rename to training_input_revision_pre_weekly_notes;
create function public.training_input_revision(p_user_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare base text; notes jsonb;
begin
 base:=public.training_input_revision_pre_weekly_notes(p_user_id);
 select jsonb_agg(jsonb_build_array(starts_on,timezone,rpe,memo,version) order by starts_on,timezone) into notes
 from public.weekly_coaching_notes where user_id=p_user_id;
 if notes is null then return base; end if;
 return md5(jsonb_build_array(base,notes)::text);
end $$;

create function public.save_weekly_coaching_note(p_user_id uuid,p_starts_on date,p_timezone text,p_version integer,p_rpe integer,p_memo text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare note public.weekly_coaching_notes; hash text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,917));
 perform public.weekly_review_snapshot_pre_weekly_notes(p_user_id,p_starts_on,p_timezone);
 if p_version is null or p_version<0 or p_request_id is null or (p_rpe is not null and p_rpe not between 1 and 10) or
 (p_memo is not null and (length(p_memo)>200 or translate(p_memo,E'\n\r\t','') ~ '[[:cntrl:]]')) then raise exception 'weekly_note_input'; end if;
 hash:=md5(jsonb_build_array(p_starts_on,p_timezone,p_version,p_rpe,p_memo)::text);
 select * into note from public.weekly_coaching_notes where user_id=p_user_id and starts_on=p_starts_on and timezone=p_timezone for update;
 if found and note.request_id=p_request_id then
   if note.request_hash<>hash then raise exception 'weekly_note_changed'; end if;
   return jsonb_build_object('rpe',note.rpe,'memo',note.memo,'version',note.version,'updatedAt',note.updated_at);
 end if;
 if coalesce(note.version,0)<>p_version then raise exception 'weekly_note_changed'; end if;
 insert into public.weekly_coaching_notes(user_id,starts_on,timezone,rpe,memo,version,request_id,request_hash)
 values(p_user_id,p_starts_on,p_timezone,p_rpe,p_memo,p_version+1,p_request_id,hash)
 on conflict(user_id,starts_on,timezone) do update set rpe=excluded.rpe,memo=excluded.memo,version=excluded.version,updated_at=now(),request_id=excluded.request_id,request_hash=excluded.request_hash
 returning * into note;
 return jsonb_build_object('rpe',note.rpe,'memo',note.memo,'version',note.version,'updatedAt',note.updated_at);
end $$;
revoke all on function public.weekly_review_snapshot(uuid,date,text),public.weekly_review_snapshot_pre_weekly_notes(uuid,date,text),public.training_input_revision(uuid),public.training_input_revision_pre_weekly_notes(uuid),public.save_weekly_coaching_note(uuid,date,text,integer,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.weekly_review_snapshot(uuid,date,text),public.weekly_review_snapshot_pre_weekly_notes(uuid,date,text),public.training_input_revision(uuid),public.training_input_revision_pre_weekly_notes(uuid),public.save_weekly_coaching_note(uuid,date,text,integer,integer,text,uuid) to service_role;

commit;
