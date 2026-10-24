-- Milestone 2: client decline and interview feedback, as portal-owned client decisions, with notes tied to their history
-- entries. Development database with fictional data only. Run once, after approval, in the Supabase SQL Editor; it is one
-- transaction, so any error leaves the database unchanged. Then run supabase/checks/m2_post_migration.sql.
-- Undo: supabase/rollback/20261025120000_m2_down.sql (it refuses while any decline or feedback exists).
--
-- What this milestone is, and is not:
-- * The portal is the record of client decisions: who declined or gave feedback, the text, and when. Notes are add-only,
--   and they carry no delivery status: whether a decision is ever sent to Manatal, and how, is undecided (D4). Saving a
--   decision does not update Manatal, and nothing here implies it.
-- * Stage ownership between Manatal and the portal is unresolved. Nothing here prevents a later, reviewed sync from adding
--   history entries from Manatal (for example with a new `source`); the rules below apply to client actions only.
-- * The action rules are PROVISIONAL, for development testing only, and are not production permission approvals (D3):
--     decline:  role Open; stage To review, Interview or Offer
--     feedback: role Open or On hold; stage Interview or Offer (a stand-in: a stage is not an interview record)
--     a Closed role, and Hired or Declined submissions: no decline or feedback
--   Any active client member may act, and notes are visible to the whole client team (prototype behaviour).
-- * The decline reason categories are 2h's list, optional, also provisional until the reason list is confirmed.

begin;

-- The M1 shape this migration expects. Stop, changing nothing, if it differs.
do $$
begin
  if to_regclass('public.submission_events') is null or to_regprocedure('public.client_move_stage(uuid, text, integer, uuid)') is null then
    raise exception 'milestone 1 not found: nothing changed';
  end if;
  if to_regclass('public.client_notes') is not null then raise exception 'client_notes already exists: nothing changed'; end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.submission_events'::regclass and conname = 'submission_events_kind_check'
                 and pg_get_constraintdef(oid) = 'CHECK ((kind = ANY (ARRAY[''shared''::text, ''stage_move''::text])))') then
    raise exception 'submission_events_kind_check is not the milestone 1 rule: nothing changed';
  end if;
end $$;

-- History entries: two new kinds. A decline always goes to Declined; a feedback entry repeats the current stage, so the
-- current stage is still the latest entry's stage. Both are client entries with a recorded member.
alter table public.submission_events drop constraint submission_events_kind_check;
alter table public.submission_events add constraint submission_events_kind_check check (kind in ('shared', 'stage_move', 'decline', 'feedback'));
alter table public.submission_events add constraint submission_events_client_decision_check
  check (kind not in ('decline', 'feedback') or (actor_kind = 'client' and actor_member_id is not null));
alter table public.submission_events add constraint submission_events_decline_stage_check check (kind <> 'decline' or to_stage = 'Declined');
-- Lets a note reference exactly one entry: the same submission, client, kind and author (see client_notes).
alter table public.submission_events add constraint submission_events_note_target_key unique (id, submission_id, client_id, kind, actor_member_id);

-- Whitespace policy for client text (the same set as JavaScript's String.prototype.trim): leading and trailing whitespace
-- is removed; internal line breaks and spacing are kept. Required text must have something left; an optional About with
-- nothing left becomes null. PostgreSQL's btrim() removes only spaces, so it is not used for this.
create function app_private.trim_ws(p text) returns text
language sql immutable strict parallel safe set search_path = '' as $$
  select regexp_replace(p, '^[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g')
$$;
revoke all on function app_private.trim_ws(text) from public, anon, authenticated;

-- Client notes: the decline note and the interview feedback, written by clients through the functions below only.
-- Each note is tied by one composite key to the history entry that created it, so the database guarantees it belongs to
-- the same submission and client, is of the same kind, and has that entry's author.
create table public.client_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  submission_id uuid not null,
  event_id bigint not null unique,
  kind text not null check (kind in ('decline', 'feedback')),
  about text check (about is null or (char_length(about) between 1 and 120 and about = app_private.trim_ws(about))),
  text text not null check (char_length(text) between 1 and 1000 and text = app_private.trim_ws(text)),
  category text check (category in ('Experience not aligned', 'Key skills gap', 'Location or work arrangement',
                                    'Compensation expectations', 'Role requirements changed', 'Other')),
  author_member_id uuid not null,
  created_at timestamptz not null default now(),
  check (kind = 'feedback' or about is null),
  check (kind = 'decline' or category is null),
  foreign key (submission_id, client_id) references public.submissions (id, client_id) on delete cascade,
  foreign key (event_id, submission_id, client_id, kind, author_member_id)
    references public.submission_events (id, submission_id, client_id, kind, actor_member_id) match full
);
create index client_notes_submission on public.client_notes (submission_id);

create function app_private.notes_are_add_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'PT403', message = 'notes_are_add_only';
end $$;
create trigger client_notes_no_update before update on public.client_notes
  for each row execute function app_private.notes_are_add_only();

revoke all on table public.client_notes from public, anon, authenticated;
revoke all on function app_private.notes_are_add_only() from public, anon, authenticated;
grant select on table public.client_notes to authenticated;
alter table public.client_notes enable row level security;

-- Notes of published submissions of the member's own client, as for the history.
create policy notes_read_published on public.client_notes for select to authenticated
  using (client_id = (select app_private.my_client_id())
         and exists (select 1 from public.submissions s
                     where s.id = client_notes.submission_id and s.client_id = client_notes.client_id and s.publication = 'published'));

-- Decline. Errors (message codes): invalid_request, not_a_client_member, submission_not_found (also for other clients' and
-- unpublished submissions), idempotency_key_reused, version_conflict, action_not_permitted.
create function public.client_decline(p_submission_id uuid, p_note text, p_category text, p_expected_version integer, p_idempotency_key uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_member public.client_members;
  v_sub public.submissions;
  v_role_status text;
  v_note text := app_private.trim_ws(coalesce(p_note, ''));
  v_category text := nullif(app_private.trim_ws(coalesce(p_category, '')), '');
  v_fingerprint text;
  v_prev app_private.idempotency_keys;
  v_event_id bigint;
  v_note_id uuid;
  v_result jsonb;
begin
  if p_submission_id is null or p_expected_version is null or p_idempotency_key is null
     or char_length(v_note) not between 1 and 1000
     or (v_category is not null and v_category not in ('Experience not aligned', 'Key skills gap', 'Location or work arrangement',
                                                       'Compensation expectations', 'Role requirements changed', 'Other')) then
    raise exception using errcode = 'PT400', message = 'invalid_request';
  end if;

  select m.* into v_member from public.client_members m where m.user_id = auth.uid() and m.active;
  if not found then raise exception using errcode = 'PT403', message = 'not_a_client_member'; end if;

  select s.* into v_sub from public.submissions s
   where s.id = p_submission_id and s.client_id = v_member.client_id and s.publication = 'published'
   for update;
  if not found then raise exception using errcode = 'PT404', message = 'submission_not_found'; end if;

  v_fingerprint := encode(sha256(convert_to(jsonb_build_object('note', v_note, 'category', v_category, 'expected_version', p_expected_version)::text, 'UTF8')), 'hex');
  select k.* into v_prev from app_private.idempotency_keys k
   where k.member_id = v_member.id and k.action = 'decline' and k.submission_id = v_sub.id and k.key = p_idempotency_key;
  if found then
    if v_prev.fingerprint = v_fingerprint then return v_prev.result; end if;
    raise exception using errcode = 'PT409', message = 'idempotency_key_reused';
  end if;

  if v_sub.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'version_conflict', detail = format('current version %s', v_sub.version);
  end if;

  -- PROVISIONAL, development testing only (D3): open roles; from To review, Interview or Offer.
  select r.status into v_role_status from public.roles r where r.id = v_sub.role_id and r.client_id = v_sub.client_id;
  if v_role_status <> 'Open' or v_sub.stage not in ('To review', 'Interview', 'Offer') then
    raise exception using errcode = 'PT403', message = 'action_not_permitted';
  end if;

  update public.submissions set stage = 'Declined', version = version + 1, updated_at = now()
   where id = v_sub.id returning * into v_sub;
  insert into public.submission_events (client_id, submission_id, submission_version, kind, to_stage, occurred_on, actor_kind, actor_member_id, source)
  values (v_sub.client_id, v_sub.id, v_sub.version, 'decline', 'Declined', (now() at time zone 'utc')::date, 'client', v_member.id, 'portal')
  returning id into v_event_id;
  insert into public.client_notes (client_id, submission_id, event_id, kind, text, category, author_member_id)
  values (v_sub.client_id, v_sub.id, v_event_id, 'decline', v_note, v_category, v_member.id)
  returning id into v_note_id;

  v_result := jsonb_build_object('submission_id', v_sub.id, 'stage', v_sub.stage, 'version', v_sub.version, 'event_id', v_event_id, 'note_id', v_note_id);
  insert into app_private.idempotency_keys (member_id, action, submission_id, key, fingerprint, result)
  values (v_member.id, 'decline', v_sub.id, p_idempotency_key, v_fingerprint, v_result);
  return v_result;
end $$;

-- Interview feedback. Does not change the stage; raises the version (it changes what the submission holds) and adds a
-- feedback entry that repeats the current stage. Errors as for client_decline.
create function public.client_add_feedback(p_submission_id uuid, p_about text, p_text text, p_expected_version integer, p_idempotency_key uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_member public.client_members;
  v_sub public.submissions;
  v_role_status text;
  v_text text := app_private.trim_ws(coalesce(p_text, ''));
  v_about text := nullif(app_private.trim_ws(coalesce(p_about, '')), '');
  v_fingerprint text;
  v_prev app_private.idempotency_keys;
  v_event_id bigint;
  v_note_id uuid;
  v_result jsonb;
begin
  if p_submission_id is null or p_expected_version is null or p_idempotency_key is null
     or char_length(v_text) not between 1 and 1000 or char_length(coalesce(v_about, '')) > 120 then
    raise exception using errcode = 'PT400', message = 'invalid_request';
  end if;

  select m.* into v_member from public.client_members m where m.user_id = auth.uid() and m.active;
  if not found then raise exception using errcode = 'PT403', message = 'not_a_client_member'; end if;

  select s.* into v_sub from public.submissions s
   where s.id = p_submission_id and s.client_id = v_member.client_id and s.publication = 'published'
   for update;
  if not found then raise exception using errcode = 'PT404', message = 'submission_not_found'; end if;

  v_fingerprint := encode(sha256(convert_to(jsonb_build_object('about', v_about, 'text', v_text, 'expected_version', p_expected_version)::text, 'UTF8')), 'hex');
  select k.* into v_prev from app_private.idempotency_keys k
   where k.member_id = v_member.id and k.action = 'feedback' and k.submission_id = v_sub.id and k.key = p_idempotency_key;
  if found then
    if v_prev.fingerprint = v_fingerprint then return v_prev.result; end if;
    raise exception using errcode = 'PT409', message = 'idempotency_key_reused';
  end if;

  if v_sub.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'version_conflict', detail = format('current version %s', v_sub.version);
  end if;

  -- PROVISIONAL, development testing only (D3): open or on-hold roles; at Interview or Offer (not an interview record).
  select r.status into v_role_status from public.roles r where r.id = v_sub.role_id and r.client_id = v_sub.client_id;
  if v_role_status not in ('Open', 'On hold') or v_sub.stage not in ('Interview', 'Offer') then
    raise exception using errcode = 'PT403', message = 'action_not_permitted';
  end if;

  update public.submissions set version = version + 1, updated_at = now()
   where id = v_sub.id returning * into v_sub;
  insert into public.submission_events (client_id, submission_id, submission_version, kind, to_stage, occurred_on, actor_kind, actor_member_id, source)
  values (v_sub.client_id, v_sub.id, v_sub.version, 'feedback', v_sub.stage, (now() at time zone 'utc')::date, 'client', v_member.id, 'portal')
  returning id into v_event_id;
  insert into public.client_notes (client_id, submission_id, event_id, kind, about, text, author_member_id)
  values (v_sub.client_id, v_sub.id, v_event_id, 'feedback', v_about, v_text, v_member.id)
  returning id into v_note_id;

  v_result := jsonb_build_object('submission_id', v_sub.id, 'stage', v_sub.stage, 'version', v_sub.version, 'event_id', v_event_id, 'note_id', v_note_id);
  insert into app_private.idempotency_keys (member_id, action, submission_id, key, fingerprint, result)
  values (v_member.id, 'feedback', v_sub.id, p_idempotency_key, v_fingerprint, v_result);
  return v_result;
end $$;

revoke all on function public.client_decline(uuid, text, text, integer, uuid) from public, anon;
revoke all on function public.client_add_feedback(uuid, text, text, integer, uuid) from public, anon;
grant execute on function public.client_decline(uuid, text, text, integer, uuid) to authenticated;
grant execute on function public.client_add_feedback(uuid, text, text, integer, uuid) to authenticated;

commit;
