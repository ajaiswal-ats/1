-- Milestone 3: role descriptions, versioned role requirements, and published candidate packages (the Summary tab) with
-- requirement evidence. Development database with fictional data only. One transaction: any error leaves the database
-- unchanged. Then run supabase/checks/m3_post_migration.sql. Undo: supabase/rollback/20261026120000_m3_down.sql (it
-- refuses while any milestone 3 content exists: remove it first with supabase/seed/m3_remove_fictional.sql).
--
-- What this milestone is, and is not:
-- * Clients only read. There are no client functions and no client write privileges. Content is written by the project
--   owner (the fictional seed) through two owner-only functions, agree_requirement_set and publish_package.
-- * No scoring. No score, rating, weight, confidence or band is stored here. Evidence status is a reviewed label written by
--   Revenue Optics, never calculated. Requirement tiers are the portal's Must-have/Preferred, not a scoring rubric.
-- * Role descriptions are not versioned. This is for fictional development only; production approval and versioning
--   remain open. Who approved and published a package (D1, D2) is not recorded yet: published_at is a time only.
-- * Visibility, for an active member of the row's own client:
--     requirement sets and requirements: the role's agreed set only (drafts and superseded sets are hidden);
--     packages and evidence: state published, the submission published, and the package's set still the role's agreed
--       set. A package on superseded requirements is hidden until it is re-reviewed (fictional development rule).
-- * Freeze rules (triggers; they apply to every role, including the owner): an agreed or superseded set and its
--   requirements, and a non-draft package and its evidence, cannot be inserted into, changed, moved to another parent or
--   deleted. Keys and parent links never change after insert. New sets and packages start as drafts. Publishing needs an
--   agreed set and exactly one evidence row per requirement. The only way to delete frozen content is the separate
--   fictional cleanup (seed/m3_remove_fictional.sql): the table owner, the two fictional clients only, and an explicit
--   transaction-local setting. Deleting a submission, role or client does not bypass this: it is refused while frozen
--   content exists under it.
-- * Concurrency: every child write takes a share lock on its parent row, and every state change runs with the parent's row
--   lock held, so a check (completeness, draft state) cannot be overtaken by a concurrent write. The guards read parents as
--   the owner, so a writer's row-level security cannot hide a parent. Writers other than the owner need EXECUTE on the
--   guard helpers; without it every write fails (closed), which is the case for every role today. One published package per
--   submission and one agreed set per role are deferred exclusion constraints, so a replacement inside one transaction is
--   atomic; publish_package and agree_requirement_set lock the submission or role first, so concurrent replacements are
--   serialised.

begin;

-- The milestone 2 shape this migration expects. Stop, changing nothing, if it differs.
do $$
begin
  if to_regclass('public.client_notes') is null or to_regprocedure('app_private.trim_ws(text)') is null
     or to_regprocedure('public.client_decline(uuid, text, text, integer, uuid)') is null then
    raise exception 'milestone 2 not found: nothing changed';
  end if;
  if to_regclass('public.role_requirement_sets') is not null then raise exception 'role_requirement_sets already exists: nothing changed'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'roles' and column_name in ('summary', 'responsibilities', 'job_description', 'hold_note')) then
    raise exception 'roles already has milestone 3 columns: nothing changed';
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.submissions'::regclass and conname = 'submissions_package_target_key') then
    raise exception 'submissions_package_target_key already exists: nothing changed';
  end if;
end $$;

-- Text rules: client-visible text has no leading or trailing whitespace (milestone 2's trim_ws) and is not empty.
create function app_private.text_list_ok(p text[], p_max_items integer, p_max_len integer) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select p is not null and cardinality(p) <= p_max_items and array_position(p, null) is null
     and coalesce((select bool_and(char_length(x) between 1 and p_max_len and x = app_private.trim_ws(x)) from unnest(p) x), true)
$$;

-- Key facts: an ordered array of {"label": ..., "value": ...}, both non-empty trimmed text, labels unique.
create function app_private.key_facts_ok(p jsonb) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select p is not null and jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 20
     and coalesce((select bool_and(jsonb_typeof(f) = 'object'
                                   and (select array_agg(k order by k) from jsonb_object_keys(f) k) = array['label', 'value']
                                   and jsonb_typeof(f -> 'label') = 'string' and jsonb_typeof(f -> 'value') = 'string'
                                   and char_length(f ->> 'label') between 1 and 60 and (f ->> 'label') = app_private.trim_ws(f ->> 'label')
                                   and char_length(f ->> 'value') between 1 and 300 and (f ->> 'value') = app_private.trim_ws(f ->> 'value'))
                   from jsonb_array_elements(p) f), true)
     and (select count(distinct f ->> 'label') = count(*) from jsonb_array_elements(p) f)
$$;

-- Role descriptions (unversioned; see the header). Null means not provided; nothing is filled in.
alter table public.roles
  add column summary text check (summary is null or (char_length(summary) between 1 and 600 and summary = app_private.trim_ws(summary))),
  add column responsibilities text[] check (responsibilities is null or (cardinality(responsibilities) >= 1 and app_private.text_list_ok(responsibilities, 20, 300))),
  add column job_description text check (job_description is null or (char_length(job_description) between 1 and 6000 and job_description = app_private.trim_ws(job_description))),
  add column hold_note text check (hold_note is null or (char_length(hold_note) between 1 and 400 and hold_note = app_private.trim_ws(hold_note)));

-- Lets a package point to its submission and that submission's role together (same role as its requirement set).
alter table public.submissions add constraint submissions_package_target_key unique (id, role_id, client_id);

create table public.role_requirement_sets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  role_id uuid not null,
  version integer not null check (version >= 1),
  label text not null check (char_length(label) between 1 and 80 and label = app_private.trim_ws(label)),
  status text not null default 'draft' check (status in ('draft', 'agreed', 'superseded')),
  agreed_on date,
  created_at timestamptz not null default now(),
  check ((status = 'draft') = (agreed_on is null)),
  unique (role_id, version),
  unique (id, client_id),
  unique (id, role_id, client_id),
  foreign key (role_id, client_id) references public.roles (id, client_id) on delete cascade,
  constraint role_requirement_sets_one_agreed exclude using btree (role_id with =) where (status = 'agreed') deferrable initially deferred
);

create table public.role_requirements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  set_id uuid not null,
  position integer not null check (position >= 1),
  text text not null check (char_length(text) between 1 and 300 and text = app_private.trim_ws(text)),
  tier text not null check (tier in ('must', 'pref')),
  unique (set_id, position),
  unique (id, set_id, client_id),
  foreign key (set_id, client_id) references public.role_requirement_sets (id, client_id) on delete cascade
);

create table public.submission_packages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  submission_id uuid not null,
  role_id uuid not null,
  requirement_set_id uuid not null,
  version integer not null check (version >= 1),
  state text not null default 'draft' check (state in ('draft', 'published', 'paused', 'withdrawn', 'superseded')),
  why_shared text not null check (char_length(why_shared) between 1 and 2000 and why_shared = app_private.trim_ws(why_shared)),
  strengths text[] not null default '{}' check (app_private.text_list_ok(strengths, 20, 300)),
  points_to_clarify text[] not null default '{}' check (app_private.text_list_ok(points_to_clarify, 20, 300)),
  key_facts jsonb not null default '[]' check (app_private.key_facts_ok(key_facts)),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  check ((state = 'draft') = (published_at is null)),
  unique (submission_id, version),
  unique (id, requirement_set_id, client_id),
  foreign key (submission_id, role_id, client_id) references public.submissions (id, role_id, client_id) on delete cascade,
  foreign key (requirement_set_id, role_id, client_id) references public.role_requirement_sets (id, role_id, client_id),
  constraint submission_packages_one_published exclude using btree (submission_id with =) where (state = 'published') deferrable initially deferred
);
create index submission_packages_set on public.submission_packages (requirement_set_id);

-- Unevidenced rows may have no source; every other status needs one. Sources are never invented.
create table public.requirement_evidence (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  package_id uuid not null,
  requirement_set_id uuid not null,
  requirement_id uuid not null,
  status text not null check (status in ('supported', 'partly_supported', 'not_evidenced', 'confirmed_not_met')),
  evidence text not null check (char_length(evidence) between 1 and 1000 and evidence = app_private.trim_ws(evidence)),
  source_label text check (source_label is null or (char_length(source_label) between 1 and 120 and source_label = app_private.trim_ws(source_label))),
  check (status = 'not_evidenced' or source_label is not null),
  unique (package_id, requirement_id),
  foreign key (package_id, requirement_set_id, client_id) references public.submission_packages (id, requirement_set_id, client_id) on delete cascade,
  foreign key (requirement_id, requirement_set_id, client_id) references public.role_requirements (id, set_id, client_id)
);
create index requirement_evidence_requirement on public.requirement_evidence (requirement_id);

-- The explicit fictional cleanup: the table owner, one of the two fictional clients, and app.m3_fictional_cleanup = 'on'
-- set for the transaction. Nothing else can delete frozen content.
create function app_private.m3_fictional_cleanup(p_client_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('app.m3_fictional_cleanup', true), '') = 'on'
     and current_user = (select r.rolname from pg_catalog.pg_class c join pg_catalog.pg_roles r on r.oid = c.relowner
                         where c.oid = 'public.submission_packages'::regclass)
     and exists (select 1 from public.clients where id = p_client_id and ref in ('harbor', 'northwind'))
$$;

-- Parent lookups for the guards. They run as the owner (security definer), so the writer's own row-level security can
-- never hide a parent and make a frozen child look orphaned. Each takes a share lock on the parent row: a concurrent state
-- change (agreeing a set, publishing a package) waits for the child write, and the reverse.
create function app_private.m3_lock_set(p_set_id uuid) returns text
language sql security definer set search_path = '' as $$
  select status from public.role_requirement_sets where id = p_set_id for share
$$;
create function app_private.m3_lock_package(p_package_id uuid) returns text
language sql security definer set search_path = '' as $$
  select state from public.submission_packages where id = p_package_id for share
$$;
-- Counts for the agree and publish checks, also as the owner. They run while the parent row is locked by the update.
create function app_private.m3_requirement_count(p_set_id uuid) returns integer
language sql security definer set search_path = '' as $$
  select count(*)::integer from public.role_requirements where set_id = p_set_id
$$;
create function app_private.m3_evidence_count(p_package_id uuid) returns integer
language sql security definer set search_path = '' as $$
  select count(*)::integer from public.requirement_evidence where package_id = p_package_id
$$;

create function app_private.m3_refuse(p_code text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'PT409', message = p_code;
end $$;

create function app_private.requirement_sets_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then perform app_private.m3_refuse('set_must_start_as_draft'); end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' and not app_private.m3_fictional_cleanup(old.client_id) then perform app_private.m3_refuse('requirements_frozen'); end if;
    return old;
  end if;
  if (new.id, new.client_id, new.role_id, new.version, new.created_at) is distinct from (old.id, old.client_id, old.role_id, old.version, old.created_at) then
    perform app_private.m3_refuse('set_keys_are_fixed');
  end if;
  if old.status = 'draft' and new.status = 'draft' then return new; end if;
  if old.status = 'draft' and new.status = 'agreed' then
    -- This row is locked by the update; requirement writers lock it too (FOR SHARE), so the count below is final.
    if app_private.m3_requirement_count(new.id) = 0 then perform app_private.m3_refuse('set_has_no_requirements'); end if;
    return new;
  end if;
  if old.status = 'agreed' and new.status = 'superseded' and (new.label, new.agreed_on) is not distinct from (old.label, old.agreed_on) then return new; end if;
  perform app_private.m3_refuse('requirements_frozen');
  return null;
end $$;
create trigger role_requirement_sets_guard before insert or update or delete on public.role_requirement_sets
  for each row execute function app_private.requirement_sets_guard();

create function app_private.requirements_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  r public.role_requirements;
  st text;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if tg_op = 'UPDATE' and (new.id, new.client_id, new.set_id) is distinct from (old.id, old.client_id, old.set_id) then
    perform app_private.m3_refuse('requirement_keys_are_fixed');
  end if;
  st := app_private.m3_lock_set(r.set_id);
  if st is null then
    if tg_op = 'DELETE' then return old; end if;       -- the set's own (permitted) deletion is cascading
    return new;                                         -- the foreign key refuses it
  end if;
  if st <> 'draft' and not (tg_op = 'DELETE' and app_private.m3_fictional_cleanup(old.client_id)) then
    perform app_private.m3_refuse('requirements_frozen');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger role_requirements_guard before insert or update or delete on public.role_requirements
  for each row execute function app_private.requirements_guard();

create function app_private.packages_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  set_status text;
  n_req integer;
  n_ev integer;
begin
  if tg_op = 'INSERT' then
    if new.state <> 'draft' or new.published_at is not null then perform app_private.m3_refuse('package_must_start_as_draft'); end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.state <> 'draft' and not app_private.m3_fictional_cleanup(old.client_id) then perform app_private.m3_refuse('package_frozen'); end if;
    return old;
  end if;
  if (new.id, new.client_id, new.submission_id, new.role_id, new.requirement_set_id, new.version, new.created_at)
     is distinct from (old.id, old.client_id, old.submission_id, old.role_id, old.requirement_set_id, old.version, old.created_at) then
    perform app_private.m3_refuse('package_keys_are_fixed');
  end if;
  if old.state = 'draft' and new.state = 'draft' then
    if new.published_at is not null then perform app_private.m3_refuse('package_not_published'); end if;
    return new;
  end if;
  -- Any other change is a state change only: the content stays exactly as reviewed.
  if (new.why_shared, new.strengths, new.points_to_clarify, new.key_facts) is distinct from (old.why_shared, old.strengths, old.points_to_clarify, old.key_facts) then
    perform app_private.m3_refuse('package_frozen');
  end if;
  if new.state = 'published' and old.state in ('draft', 'paused') then
    -- This row is locked by the update; evidence writers lock it too (FOR SHARE). Lock the set so it stays agreed.
    set_status := app_private.m3_lock_set(new.requirement_set_id);
    if set_status is distinct from 'agreed' then perform app_private.m3_refuse('set_not_agreed'); end if;
    n_req := app_private.m3_requirement_count(new.requirement_set_id);
    n_ev := app_private.m3_evidence_count(new.id);
    if n_req = 0 or n_ev <> n_req then perform app_private.m3_refuse('evidence_incomplete'); end if;
    new.published_at := coalesce(old.published_at, now());
    return new;
  end if;
  if new.published_at is distinct from old.published_at then perform app_private.m3_refuse('package_frozen'); end if;
  if (old.state = 'published' and new.state in ('paused', 'withdrawn', 'superseded'))
     or (old.state = 'paused' and new.state in ('withdrawn', 'superseded')) then
    return new;
  end if;
  perform app_private.m3_refuse('package_state_change_not_allowed');
  return null;
end $$;
create trigger submission_packages_guard before insert or update or delete on public.submission_packages
  for each row execute function app_private.packages_guard();

create function app_private.evidence_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  e public.requirement_evidence;
  st text;
begin
  e := case when tg_op = 'DELETE' then old else new end;
  if tg_op = 'UPDATE' and (new.id, new.client_id, new.package_id, new.requirement_set_id, new.requirement_id)
                          is distinct from (old.id, old.client_id, old.package_id, old.requirement_set_id, old.requirement_id) then
    perform app_private.m3_refuse('evidence_keys_are_fixed');
  end if;
  st := app_private.m3_lock_package(e.package_id);
  if st is null then
    if tg_op = 'DELETE' then return old; end if;       -- the package's own (permitted) deletion is cascading
    return new;                                         -- the foreign key refuses it
  end if;
  if st <> 'draft' and not (tg_op = 'DELETE' and app_private.m3_fictional_cleanup(old.client_id)) then
    perform app_private.m3_refuse('package_frozen');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger requirement_evidence_guard before insert or update or delete on public.requirement_evidence
  for each row execute function app_private.evidence_guard();

-- Owner-only. Agrees a draft set and supersedes the role's previous agreed set, atomically. Concurrent calls for one role
-- are serialised by the role row lock.
create function app_private.agree_requirement_set(p_set_id uuid, p_agreed_on date) returns void
language plpgsql set search_path = '' as $$
declare
  s public.role_requirement_sets;
begin
  select * into s from public.role_requirement_sets where id = p_set_id;
  if not found or p_agreed_on is null then perform app_private.m3_refuse('invalid_request'); end if;
  perform 1 from public.roles where id = s.role_id for no key update;
  update public.role_requirement_sets set status = 'superseded' where role_id = s.role_id and status = 'agreed' and id <> p_set_id;
  update public.role_requirement_sets set status = 'agreed', agreed_on = p_agreed_on where id = p_set_id and status = 'draft';
  if not found then perform app_private.m3_refuse('set_not_draft'); end if;
end $$;

-- Owner-only. Publishes a draft or paused package and supersedes the submission's other published or paused package,
-- atomically. Concurrent calls for one submission are serialised by the submission row lock.
create function app_private.publish_package(p_package_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  p public.submission_packages;
begin
  select * into p from public.submission_packages where id = p_package_id;
  if not found then perform app_private.m3_refuse('invalid_request'); end if;
  perform 1 from public.submissions where id = p.submission_id for no key update;
  update public.submission_packages set state = 'superseded' where submission_id = p.submission_id and state in ('published', 'paused') and id <> p_package_id;
  update public.submission_packages set state = 'published' where id = p_package_id and state in ('draft', 'paused');
  if not found then perform app_private.m3_refuse('package_not_publishable'); end if;
end $$;

-- Privileges: Supabase grants new tables and functions to anon and authenticated by default, so revoke first.
revoke all on table public.role_requirement_sets, public.role_requirements, public.submission_packages, public.requirement_evidence
  from public, anon, authenticated;
revoke all on function app_private.text_list_ok(text[], integer, integer), app_private.key_facts_ok(jsonb),
  app_private.m3_fictional_cleanup(uuid), app_private.m3_refuse(text), app_private.m3_lock_set(uuid), app_private.m3_lock_package(uuid),
  app_private.m3_requirement_count(uuid), app_private.m3_evidence_count(uuid), app_private.requirement_sets_guard(),
  app_private.requirements_guard(), app_private.packages_guard(), app_private.evidence_guard(),
  app_private.agree_requirement_set(uuid, date), app_private.publish_package(uuid)
  from public, anon, authenticated;
grant select on table public.role_requirement_sets, public.role_requirements, public.submission_packages, public.requirement_evidence
  to authenticated;

alter table public.role_requirement_sets enable row level security;
alter table public.role_requirements enable row level security;
alter table public.submission_packages enable row level security;
alter table public.requirement_evidence enable row level security;

create policy requirement_sets_read_agreed on public.role_requirement_sets for select to authenticated
  using (client_id = (select app_private.my_client_id()) and status = 'agreed');

create policy requirements_read_agreed on public.role_requirements for select to authenticated
  using (client_id = (select app_private.my_client_id())
         and exists (select 1 from public.role_requirement_sets s
                     where s.id = role_requirements.set_id and s.client_id = role_requirements.client_id and s.status = 'agreed'));

create policy packages_read_published on public.submission_packages for select to authenticated
  using (client_id = (select app_private.my_client_id()) and state = 'published'
         and exists (select 1 from public.submissions s
                     where s.id = submission_packages.submission_id and s.client_id = submission_packages.client_id and s.publication = 'published')
         and exists (select 1 from public.role_requirement_sets r
                     where r.id = submission_packages.requirement_set_id and r.client_id = submission_packages.client_id and r.status = 'agreed'));

create policy evidence_read_published on public.requirement_evidence for select to authenticated
  using (client_id = (select app_private.my_client_id())
         and exists (select 1 from public.submission_packages p
                     join public.submissions s on s.id = p.submission_id and s.client_id = p.client_id
                     join public.role_requirement_sets r on r.id = p.requirement_set_id and r.client_id = p.client_id
                     where p.id = requirement_evidence.package_id and p.client_id = requirement_evidence.client_id
                       and p.state = 'published' and s.publication = 'published' and r.status = 'agreed'));

commit;
