-- Milestone 1: clients, memberships, roles, people, published/unpublished submissions, versioned stage events,
-- idempotency keys and one client action (client_move_stage). See docs/backend-plan.md, section 10.
-- Development database with fictional data only. Run it once, after approval: paste the whole file into the Supabase SQL Editor
-- (or use `npm run db:apply -- --confirm`). It is one transaction (begin … commit), so any error leaves the database unchanged.
-- Then run supabase/checks/m1_post_migration.sql. Undo: supabase/rollback/20261023120000_m1_down.sql.
--
-- Row-level security is enabled explicitly on every table below. The project's automatic-RLS helper (public.rls_auto_enable)
-- also enables it on new public tables, but it logs failures without stopping, so this migration does not rely on it.
--
-- Access model:
-- * Clients read only their own company's rows, and only published submissions (and the people and events under them).
-- * Signed-out users (anon) have no table or function privileges at all.
-- * Clients never write to tables directly; the only write is client_move_stage, a server-side function.
-- * Rows are tied to the same client by composite foreign keys, not only by row-level policies.

begin;

-- Private schema: helpers and staff-only tables. It is not exposed through the Data API.
create schema app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated;   -- needed to evaluate the policy helper below; tables stay ungranted

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

-- One client per user (brief). Login details (email) stay in auth.users; this table holds no contact data.
create table public.client_members (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  display_name text not null,
  job_title text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, client_id)
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  ref text not null,
  title text not null,
  location text not null default '',
  status text not null check (status in ('Open', 'On hold', 'Closed')),
  opened_on date not null,
  recruiter_name text not null default '',
  unique (client_id, ref),
  unique (id, client_id)
);

-- One row per person per client. Name and client-safe headline only: no candidate contact details.
create table public.people (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  ref text not null,
  name text not null,
  headline text not null default '',
  location text not null default '',
  unique (client_id, ref),
  unique (id, client_id)
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  ref text not null,
  role_id uuid not null,
  person_id uuid not null,
  stage text not null check (stage in ('To review', 'Interview', 'Offer', 'Hired', 'Declined')),
  shared_on date not null,
  publication text not null default 'unpublished' check (publication in ('published', 'unpublished')),
  -- Goes up by one with every change; client actions must send the version they saw (conflict check).
  version integer not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  unique (client_id, ref),
  unique (id, client_id),
  unique (role_id, person_id),
  foreign key (role_id, client_id) references public.roles (id, client_id) on delete cascade,
  foreign key (person_id, client_id) references public.people (id, client_id) on delete cascade
);

-- Add-only history. The current stage and version of a submission always equal its latest event.
create table public.submission_events (
  id bigint generated always as identity primary key,
  client_id uuid not null,
  submission_id uuid not null,
  submission_version integer not null check (submission_version >= 1),
  kind text not null check (kind in ('shared', 'stage_move')),
  to_stage text not null check (to_stage in ('To review', 'Interview', 'Offer', 'Hired', 'Declined')),
  occurred_on date not null,
  actor_kind text not null check (actor_kind in ('client', 'revenue_optics')),
  actor_member_id uuid,
  source text not null check (source in ('portal', 'seed')),
  created_at timestamptz not null default now(),
  unique (submission_id, submission_version),
  foreign key (submission_id, client_id) references public.submissions (id, client_id) on delete cascade,
  foreign key (actor_member_id, client_id) references public.client_members (id, client_id),
  check (kind <> 'shared' or (to_stage = 'To review' and submission_version = 1)),
  check (actor_member_id is null or actor_kind = 'client')
);
create index submission_events_submission on public.submission_events (submission_id, submission_version);

create function app_private.events_are_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'PT403', message = 'events_are_append_only';
end $$;
create trigger submission_events_no_update before update on public.submission_events
  for each row execute function app_private.events_are_append_only();

-- Staff-only: idempotency keys, scoped to member, action and submission, with a fingerprint of the request.
create table app_private.idempotency_keys (
  member_id uuid not null references public.client_members (id) on delete cascade,
  action text not null,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  key uuid not null,
  fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (member_id, action, submission_id, key)
);

-- The signed-in user's client, or null (signed out, no membership, or inactive membership).
create function app_private.my_client_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.client_id from public.client_members m where m.user_id = auth.uid() and m.active
$$;

-- Privileges: Supabase grants new tables and functions to anon and authenticated by default, so revoke first.
revoke all on table public.clients, public.client_members, public.roles, public.people, public.submissions, public.submission_events
  from public, anon, authenticated;
revoke all on sequence public.submission_events_id_seq from public, anon, authenticated;
revoke all on table app_private.idempotency_keys from public, anon, authenticated;
revoke all on function app_private.my_client_id() from public, anon;
revoke all on function app_private.events_are_append_only() from public, anon, authenticated;
grant execute on function app_private.my_client_id() to authenticated;
grant select on table public.clients, public.client_members, public.roles, public.people, public.submissions, public.submission_events
  to authenticated;

alter table public.clients enable row level security;
alter table public.client_members enable row level security;
alter table public.roles enable row level security;
alter table public.people enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_events enable row level security;
alter table app_private.idempotency_keys enable row level security;   -- no policies: unreadable except by the owner

create policy clients_read_own on public.clients for select to authenticated
  using (id = (select app_private.my_client_id()));

-- Members see only their own membership row in milestone 1.
create policy members_read_self on public.client_members for select to authenticated
  using (user_id = (select auth.uid()) and active);

create policy roles_read_own_client on public.roles for select to authenticated
  using (client_id = (select app_private.my_client_id()));

-- A person is visible only through a published submission of the same client.
create policy people_read_published on public.people for select to authenticated
  using (client_id = (select app_private.my_client_id())
         and exists (select 1 from public.submissions s
                     where s.person_id = people.id and s.client_id = people.client_id and s.publication = 'published'));

create policy submissions_read_published on public.submissions for select to authenticated
  using (client_id = (select app_private.my_client_id()) and publication = 'published');

create policy events_read_published on public.submission_events for select to authenticated
  using (client_id = (select app_private.my_client_id())
         and exists (select 1 from public.submissions s
                     where s.id = submission_events.submission_id and s.client_id = submission_events.client_id and s.publication = 'published'));

-- The one client action in milestone 1. Errors (message codes): invalid_request, not_a_client_member,
-- submission_not_found (also for other clients' and unpublished submissions, so nothing leaks),
-- idempotency_key_reused, version_conflict, move_not_permitted. PTxxx codes set the HTTP status in the Data API.
create function public.client_move_stage(p_submission_id uuid, p_to_stage text, p_expected_version integer, p_idempotency_key uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_member public.client_members;
  v_sub public.submissions;
  v_role_status text;
  v_fingerprint text;
  v_prev app_private.idempotency_keys;
  v_event_id bigint;
  v_result jsonb;
begin
  if p_submission_id is null or p_to_stage is null or p_expected_version is null or p_idempotency_key is null then
    raise exception using errcode = 'PT400', message = 'invalid_request';
  end if;

  select m.* into v_member from public.client_members m where m.user_id = auth.uid() and m.active;
  if not found then
    raise exception using errcode = 'PT403', message = 'not_a_client_member';
  end if;

  -- Lock the submission: actions on it (including retries with the same key) run one at a time.
  select s.* into v_sub from public.submissions s
   where s.id = p_submission_id and s.client_id = v_member.client_id and s.publication = 'published'
   for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'submission_not_found';
  end if;

  -- Idempotency: checked before the version, so a retry of a request that succeeded returns its first result.
  v_fingerprint := encode(sha256(convert_to(jsonb_build_object('to_stage', p_to_stage, 'expected_version', p_expected_version)::text, 'UTF8')), 'hex');
  select k.* into v_prev from app_private.idempotency_keys k
   where k.member_id = v_member.id and k.action = 'move_stage' and k.submission_id = v_sub.id and k.key = p_idempotency_key;
  if found then
    if v_prev.fingerprint = v_fingerprint then
      return v_prev.result;
    end if;
    raise exception using errcode = 'PT409', message = 'idempotency_key_reused';
  end if;

  if v_sub.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'version_conflict', detail = format('current version %s', v_sub.version);
  end if;

  -- PROVISIONAL test behaviour from the 2h prototype, not production approval (D3 in docs/backend-plan.md):
  -- open roles only; no moves from Offer, Hired or Declined; any other client stage, including Offer, Hired and back to To review.
  select r.status into v_role_status from public.roles r where r.id = v_sub.role_id and r.client_id = v_sub.client_id;
  if v_role_status <> 'Open' or v_sub.stage in ('Offer', 'Hired', 'Declined')
     or p_to_stage not in ('To review', 'Interview', 'Offer', 'Hired') or p_to_stage = v_sub.stage then
    raise exception using errcode = 'PT403', message = 'move_not_permitted';
  end if;

  update public.submissions set stage = p_to_stage, version = version + 1, updated_at = now()
   where id = v_sub.id returning * into v_sub;
  -- Dated in UTC for now; the reporting time zone is still to be agreed (Central Time was proposed).
  insert into public.submission_events (client_id, submission_id, submission_version, kind, to_stage, occurred_on, actor_kind, actor_member_id, source)
  values (v_sub.client_id, v_sub.id, v_sub.version, 'stage_move', p_to_stage, (now() at time zone 'utc')::date, 'client', v_member.id, 'portal')
  returning id into v_event_id;

  v_result := jsonb_build_object('submission_id', v_sub.id, 'stage', v_sub.stage, 'version', v_sub.version, 'event_id', v_event_id);
  insert into app_private.idempotency_keys (member_id, action, submission_id, key, fingerprint, result)
  values (v_member.id, 'move_stage', v_sub.id, p_idempotency_key, v_fingerprint, v_result);
  return v_result;
end $$;

revoke all on function public.client_move_stage(uuid, text, integer, uuid) from public, anon;
grant execute on function public.client_move_stage(uuid, text, integer, uuid) to authenticated;

commit;
