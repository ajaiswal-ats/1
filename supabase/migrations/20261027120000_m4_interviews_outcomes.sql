-- Milestone 4: client interviews (by round), recorded offer outcomes, and interview feedback linked to its round.
-- Development database with fictional data only. One transaction: any error leaves the database unchanged. Then run
-- supabase/checks/m4_post_migration.sql. Undo: supabase/rollback/20261027120000_m4_down.sql (it refuses while any
-- milestone 4 row exists: remove them first with supabase/seed/m4_remove_fictional.sql).
--
-- What this milestone is, and is not:
-- * Facts, not tasks. Revenue Optics records client interviews and offer outcomes (the owner, through the fictional seed,
--   in this milestone). Next steps and "Waiting on you" are derived from these facts in the portal, never stored.
-- * The interview is separate from the recruitment stage: a submission at Interview has no interview until one is
--   recorded, and nothing here infers one from the stage or from a date passing.
-- * Rounds: a submission's interviews are numbered 1, 2, ... in the order they are created. The current round is the
--   highest number, whatever its status: a cancelled newer round is the current round, so an older round's missing
--   feedback is not reactivated. At most one round is requested or scheduled at a time; a new round starts only after the
--   previous one is held or cancelled. Held and cancelled are final.
-- * Feedback completes a round only when it is linked to that round: either recorded by Revenue Optics on the round
--   (feedback_recorded_on), or given in the portal through client_add_interview_feedback for that round. General
--   feedback (client_add_feedback, milestone 2) stays a note and completes nothing. Feedback is never matched by date.
-- * Ordering without inventing time: every fact carries as_of_version, the submission's version when the fact was
--   recorded (set by the database, with the submission row share-locked, so a concurrent client change is either before
--   or after it, never ambiguous). A client change with a higher version happened after the fact. Recording a fact does
--   not change the submission's version, so client actions are not made stale by it.
-- * client_add_interview_feedback uses milestone 2's provisional feedback rule unchanged (development testing only, D3)
--   and, in addition, needs the round to be the current, held, not yet completed round. Its idempotency key is the same
--   as milestone 2 feedback's (same action), so recorded-run cleanup works unchanged.

begin;

-- The milestone 3 shape this migration expects. Stop, changing nothing, if it differs.
do $$
begin
  if to_regclass('public.role_requirement_sets') is null or to_regclass('public.client_notes') is null
     or to_regprocedure('public.client_add_feedback(uuid, text, text, integer, uuid)') is null then
    raise exception 'milestone 3 not found: nothing changed';
  end if;
  if to_regclass('public.client_interviews') is not null then raise exception 'client_interviews already exists: nothing changed'; end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.client_notes'::regclass and conname = 'client_notes_feedback_link_key') then
    raise exception 'client_notes_feedback_link_key already exists: nothing changed';
  end if;
end $$;

-- Lets a link point to exactly one feedback note of the same submission and client.
alter table public.client_notes add constraint client_notes_feedback_link_key unique (id, submission_id, client_id, kind);

create table public.client_interviews (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  submission_id uuid not null,
  round integer not null check (round >= 1),
  status text not null check (status in ('requested', 'scheduled', 'held', 'cancelled')),
  requested_on date,                                -- null when not recorded (never invented)
  suggested_times text check (suggested_times is null or (char_length(suggested_times) between 1 and 200 and suggested_times = app_private.trim_ws(suggested_times))),
  scheduled_on date,
  time_text text check (time_text is null or (char_length(time_text) between 1 and 80 and time_text = app_private.trim_ws(time_text))),
  interviewers text check (interviewers is null or (char_length(interviewers) between 1 and 200 and interviewers = app_private.trim_ws(interviewers))),
  held_on date,
  feedback_recorded_on date,
  as_of_version integer not null check (as_of_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'scheduled' or scheduled_on is not null),
  check ((status = 'held') = (held_on is not null)),
  check (feedback_recorded_on is null or (status = 'held' and feedback_recorded_on >= held_on)),
  unique (submission_id, round),
  unique (id, submission_id, client_id),
  foreign key (submission_id, client_id) references public.submissions (id, client_id) on delete cascade
);
create unique index client_interviews_one_open on public.client_interviews (submission_id) where status in ('requested', 'scheduled');

create table public.offer_outcomes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  submission_id uuid not null,
  status text not null check (status in ('offer_made', 'offer_accepted')),
  recorded_on date not null,
  as_of_version integer not null check (as_of_version >= 1),
  created_at timestamptz not null default now(),
  unique (submission_id, status),
  foreign key (submission_id, client_id) references public.submissions (id, client_id) on delete cascade
);

-- Feedback given in the portal for one round. One per round and one round per note.
create table public.interview_feedback (
  interview_id uuid primary key,
  note_id uuid not null unique,
  client_id uuid not null,
  submission_id uuid not null,
  note_kind text not null default 'feedback' check (note_kind = 'feedback'),
  created_at timestamptz not null default now(),
  foreign key (interview_id, submission_id, client_id) references public.client_interviews (id, submission_id, client_id) on delete cascade,
  foreign key (note_id, submission_id, client_id, note_kind) references public.client_notes (id, submission_id, client_id, kind) on delete cascade
);

create function app_private.m4_refuse(p_code text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'PT409', message = p_code;
end $$;

-- The submission's version, with its row share-locked until the end of the transaction: a client change (which updates the
-- row) waits for this write, or this write waits for it, so as_of_version is exact. Runs as the owner so row-level
-- security can never hide the submission.
create function app_private.m4_lock_submission_version(p_submission_id uuid) returns integer
language sql security definer set search_path = '' as $$
  select version from public.submissions where id = p_submission_id for share
$$;
create function app_private.m4_interview_has_link(p_interview_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.interview_feedback where interview_id = p_interview_id)
$$;
create function app_private.m4_latest_round(p_submission_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(max(round), 0) from public.client_interviews where submission_id = p_submission_id
$$;
-- The current (highest) round's status, or null when there is no round yet.
create function app_private.m4_latest_round_status(p_submission_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select status from public.client_interviews where submission_id = p_submission_id order by round desc limit 1
$$;

create function app_private.interviews_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v integer;
begin
  v := app_private.m4_lock_submission_version(new.submission_id);
  if v is null then return new; end if;                           -- the foreign key refuses it
  if tg_op = 'INSERT' then
    if new.status = 'cancelled' then perform app_private.m4_refuse('interview_must_start_open_or_held'); end if;
    if new.round <> app_private.m4_latest_round(new.submission_id) + 1 then perform app_private.m4_refuse('interview_round_out_of_order'); end if;
    -- A new round, whatever its status (held included), only once the current round is held or cancelled.
    if app_private.m4_latest_round_status(new.submission_id) in ('requested', 'scheduled') then perform app_private.m4_refuse('interview_previous_round_open'); end if;
    if new.feedback_recorded_on is not null then perform app_private.m4_refuse('interview_feedback_recorded_separately'); end if;
    new.as_of_version := v;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  if (new.id, new.client_id, new.submission_id, new.round, new.requested_on, new.created_at)
     is distinct from (old.id, old.client_id, old.submission_id, old.round, old.requested_on, old.created_at) then
    perform app_private.m4_refuse('interview_keys_are_fixed');
  end if;
  if old.status = 'cancelled' then perform app_private.m4_refuse('interview_cancelled_is_final'); end if;
  if old.status = 'held' then
    -- A held round changes only once more: Revenue Optics records that feedback was given (if none is linked yet).
    if (new.status, new.held_on, new.scheduled_on, new.time_text, new.interviewers, new.suggested_times)
       is distinct from (old.status, old.held_on, old.scheduled_on, old.time_text, old.interviewers, old.suggested_times)
       or old.feedback_recorded_on is not null or new.feedback_recorded_on is null then
      perform app_private.m4_refuse('interview_held_is_final');
    end if;
    if app_private.m4_interview_has_link(new.id) then perform app_private.m4_refuse('interview_feedback_already_linked'); end if;
  elsif new.feedback_recorded_on is not null then
    perform app_private.m4_refuse('interview_not_held');
  end if;
  if new is not distinct from old then return new; end if;
  new.as_of_version := v;
  new.updated_at := now();
  return new;
end $$;
create trigger client_interviews_guard before insert or update on public.client_interviews
  for each row execute function app_private.interviews_guard();

create function app_private.outcomes_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v integer;
begin
  if tg_op = 'UPDATE' then perform app_private.m4_refuse('outcome_is_fixed'); end if;
  v := app_private.m4_lock_submission_version(new.submission_id);
  if v is null then return new; end if;
  new.as_of_version := v;
  new.created_at := now();
  return new;
end $$;
create trigger offer_outcomes_guard before insert or update on public.offer_outcomes
  for each row execute function app_private.outcomes_guard();

-- A link needs the current, held round with no recorded feedback, and a feedback note given after the round was held
-- (its history entry has a higher version than the round's held record). Links do not change.
create function app_private.m4_link_check(p_interview_id uuid, p_note_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  i public.client_interviews;
  ev_version integer;
begin
  select * into i from public.client_interviews where id = p_interview_id for update;
  if not found then return 'interview_not_found'; end if;
  if i.status <> 'held' then return 'interview_not_held'; end if;
  if i.feedback_recorded_on is not null then return 'interview_feedback_already_recorded'; end if;
  if i.round <> (select max(round) from public.client_interviews where submission_id = i.submission_id) then return 'interview_not_current'; end if;
  select e.submission_version into ev_version from public.client_notes n join public.submission_events e on e.id = n.event_id where n.id = p_note_id;
  if ev_version is null or ev_version <= i.as_of_version then return 'feedback_before_interview_held'; end if;
  return null;
end $$;

create function app_private.feedback_links_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  problem text;
begin
  if tg_op = 'UPDATE' then perform app_private.m4_refuse('feedback_link_is_fixed'); end if;
  problem := app_private.m4_link_check(new.interview_id, new.note_id);
  if problem is not null and problem <> 'interview_not_found' then perform app_private.m4_refuse(problem); end if;
  new.created_at := now();
  return new;
end $$;
create trigger interview_feedback_guard before insert or update on public.interview_feedback
  for each row execute function app_private.feedback_links_guard();

-- Interview feedback for one round, given in the portal. The same validation, membership, version, idempotency and
-- PROVISIONAL permission rule as client_add_feedback (which it calls), plus: the round must be the submission's current
-- round, held, and not yet completed. Errors (message codes) as client_add_feedback, plus action_not_permitted when the
-- round does not qualify, and submission_not_found for another client's, an unpublished or an unknown round.
create function public.client_add_interview_feedback(p_submission_id uuid, p_interview_id uuid, p_about text, p_text text,
                                                     p_expected_version integer, p_idempotency_key uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_member public.client_members;
  v_iv public.client_interviews;
  v_prev app_private.idempotency_keys;
  v_result jsonb;
  v_problem text;
begin
  if p_submission_id is null or p_interview_id is null or p_idempotency_key is null then
    raise exception using errcode = 'PT400', message = 'invalid_request';
  end if;
  select m.* into v_member from public.client_members m where m.user_id = auth.uid() and m.active;
  if not found then raise exception using errcode = 'PT403', message = 'not_a_client_member'; end if;

  -- Lock the round first (owner writes to it lock it too), then client_add_feedback locks the submission.
  select i.* into v_iv from public.client_interviews i
    join public.submissions s on s.id = i.submission_id and s.client_id = i.client_id
   where i.id = p_interview_id and i.submission_id = p_submission_id and i.client_id = v_member.client_id and s.publication = 'published'
   for update of i;
  if not found then raise exception using errcode = 'PT404', message = 'submission_not_found'; end if;

  -- A repeated request: the stored result if it was linked to this round; any other use of the key is refused.
  select k.* into v_prev from app_private.idempotency_keys k
   where k.member_id = v_member.id and k.action = 'feedback' and k.submission_id = p_submission_id and k.key = p_idempotency_key;
  if found then
    if exists (select 1 from public.interview_feedback f where f.interview_id = p_interview_id and f.note_id = (v_prev.result ->> 'note_id')::uuid) then
      v_result := public.client_add_feedback(p_submission_id, p_about, p_text, p_expected_version, p_idempotency_key);   -- checks the payload
      return v_result || jsonb_build_object('interview_id', p_interview_id);
    end if;
    raise exception using errcode = 'PT409', message = 'idempotency_key_reused';
  end if;

  if v_iv.status <> 'held' or v_iv.feedback_recorded_on is not null or app_private.m4_interview_has_link(v_iv.id)
     or v_iv.round <> app_private.m4_latest_round(v_iv.submission_id) then
    raise exception using errcode = 'PT403', message = 'action_not_permitted';
  end if;

  v_result := public.client_add_feedback(p_submission_id, p_about, p_text, p_expected_version, p_idempotency_key);
  insert into public.interview_feedback (interview_id, note_id, client_id, submission_id)
  values (v_iv.id, (v_result ->> 'note_id')::uuid, v_iv.client_id, v_iv.submission_id);
  return v_result || jsonb_build_object('interview_id', p_interview_id);
end $$;

-- Privileges: Supabase grants new tables and functions to anon and authenticated by default, so revoke first.
revoke all on table public.client_interviews, public.offer_outcomes, public.interview_feedback from public, anon, authenticated;
revoke all on function app_private.m4_refuse(text), app_private.m4_lock_submission_version(uuid), app_private.m4_interview_has_link(uuid),
  app_private.m4_latest_round(uuid), app_private.m4_latest_round_status(uuid), app_private.interviews_guard(), app_private.outcomes_guard(), app_private.m4_link_check(uuid, uuid),
  app_private.feedback_links_guard()
  from public, anon, authenticated;
revoke all on function public.client_add_interview_feedback(uuid, uuid, text, text, integer, uuid) from public, anon;
grant execute on function public.client_add_interview_feedback(uuid, uuid, text, text, integer, uuid) to authenticated;
grant select on table public.client_interviews, public.offer_outcomes, public.interview_feedback to authenticated;

alter table public.client_interviews enable row level security;
alter table public.offer_outcomes enable row level security;
alter table public.interview_feedback enable row level security;

-- As for history: the member's own client, published submissions only.
create policy interviews_read_published on public.client_interviews for select to authenticated
  using (client_id = (select app_private.my_client_id())
         and exists (select 1 from public.submissions s
                     where s.id = client_interviews.submission_id and s.client_id = client_interviews.client_id and s.publication = 'published'));
create policy outcomes_read_published on public.offer_outcomes for select to authenticated
  using (client_id = (select app_private.my_client_id())
         and exists (select 1 from public.submissions s
                     where s.id = offer_outcomes.submission_id and s.client_id = offer_outcomes.client_id and s.publication = 'published'));
create policy interview_feedback_read_published on public.interview_feedback for select to authenticated
  using (client_id = (select app_private.my_client_id())
         and exists (select 1 from public.submissions s
                     where s.id = interview_feedback.submission_id and s.client_id = interview_feedback.client_id and s.publication = 'published'));

commit;
