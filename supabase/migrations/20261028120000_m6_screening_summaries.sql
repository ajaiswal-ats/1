-- Milestone 6: client-safe screening interview summaries (the Screening interview tab). Development database with
-- fictional data only. One transaction: any error leaves the database unchanged. Then run
-- supabase/checks/m6_post_migration.sql. Undo: supabase/rollback/20261028120000_m6_down.sql (it refuses while any
-- screening summary exists: remove them first with supabase/seed/m6_remove_fictional.sql).
--
-- Depends on milestone 3 only (packages, their freeze rules and helpers; milestone 2's trim_ws; milestone 1's
-- my_client_id). Milestone 4 is not needed and is not touched; milestone 5 had no database part. Milestone 3's rollback
-- refuses while this milestone is applied.
--
-- What is stored, and what is not:
-- * Only client-safe content that Revenue Optics has reviewed for the client: the call date, its length, the recruiter's
--   name, a short summary, optional notes written for the client, and key moments as descriptive text with an
--   approximate minute. Each row belongs to one package version and is shown with it.
-- * NOT stored here: internal recruiter notes, transcripts, recordings, recording links or references, playback
--   settings, scores or ratings. Internal notes stay where Revenue Optics keeps them; nothing here copies them across
--   automatically. `notes_for_client` holds only notes written for the client, and may be null (none shared).
-- * Key moments are text. The minutes describe roughly where in the call something was discussed; there is no player,
--   no seeking and no recording to play.
--
-- Rules:
-- * Visibility (an active member of the row's own client): the same rule as milestone 3's evidence. The package is
--   published, the submission is published, and the package's requirement set is still the role's agreed set. A paused,
--   withdrawn or superseded package, an unpublished submission, or a package on superseded requirements hides it.
-- * Freeze: a summary can be added, changed or removed only while its package is a draft. Once the package is published
--   (or paused, withdrawn or superseded) it is frozen with the package, for every role including the owner. Keys and the
--   package link never change. The only way to delete frozen rows is milestone 3's fictional cleanup (the table owner,
--   the two fictional clients, and app.m3_fictional_cleanup = 'on' for the transaction), as for evidence.
-- * Validation: the call date is not in the future and not after the submission was shared; the length is 1-240
--   minutes; text is trimmed and non-empty; key moments are at most 20, minutes are whole numbers from 0 to less than the
--   length, strictly increasing, each with a non-empty label.
-- * Concurrency: every write takes a share lock on its package row (milestone 3's helper), so publishing waits for a
--   write in progress and a write cannot slip in after publishing.
-- * Clients only read. No client functions, no client write privileges.

begin;

-- The milestone 3 shape this migration needs. Stop, changing nothing, if it differs.
do $$
begin
  if to_regclass('public.submission_packages') is null or to_regprocedure('app_private.m3_lock_package(uuid)') is null
     or to_regprocedure('app_private.m3_fictional_cleanup(uuid)') is null or to_regprocedure('app_private.trim_ws(text)') is null
     or to_regprocedure('app_private.my_client_id()') is null then
    raise exception 'milestone 3 not found: nothing changed';
  end if;
  if to_regclass('public.screening_summaries') is not null then raise exception 'screening_summaries already exists: nothing changed'; end if;
end $$;

-- Key moments: an ordered array of {"minute": whole number, "label": text}, minutes strictly increasing and inside the call.
create function app_private.key_moments_ok(p jsonb, p_duration integer) returns boolean
language plpgsql immutable parallel safe set search_path = '' as $$
declare
  m jsonb;
  prev integer := -1;
  v integer;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 20 or p_duration is null then return false; end if;
  for m in select x from jsonb_array_elements(p) x loop
    if jsonb_typeof(m) <> 'object' or (select array_agg(k order by k) from jsonb_object_keys(m) k) is distinct from array['label', 'minute'] then return false; end if;
    if jsonb_typeof(m -> 'minute') <> 'number' or (m ->> 'minute') !~ '^[0-9]{1,4}$' then return false; end if;
    v := (m ->> 'minute')::integer;
    if v <= prev or v >= p_duration then return false; end if;
    prev := v;
    if jsonb_typeof(m -> 'label') <> 'string' or char_length(m ->> 'label') not between 1 and 160 or (m ->> 'label') <> app_private.trim_ws(m ->> 'label') then return false; end if;
  end loop;
  return true;
end $$;

create table public.screening_summaries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  package_id uuid not null,
  requirement_set_id uuid not null,
  call_on date not null check (call_on >= date '2020-01-01'),
  duration_minutes integer not null check (duration_minutes between 1 and 240),
  recruiter_name text not null check (char_length(recruiter_name) between 1 and 120 and recruiter_name = app_private.trim_ws(recruiter_name)),
  summary text not null check (char_length(summary) between 1 and 2000 and summary = app_private.trim_ws(summary)),
  notes_for_client text check (notes_for_client is null or (char_length(notes_for_client) between 1 and 2000 and notes_for_client = app_private.trim_ws(notes_for_client))),
  key_moments jsonb not null default '[]' check (app_private.key_moments_ok(key_moments, duration_minutes)),
  created_at timestamptz not null default now(),
  unique (package_id),
  foreign key (package_id, requirement_set_id, client_id) references public.submission_packages (id, requirement_set_id, client_id) on delete cascade
);

comment on table public.screening_summaries is 'Client-safe, reviewed screening interview summaries, one per package version. No internal recruiter notes, transcripts or recordings.';
comment on column public.screening_summaries.notes_for_client is 'Notes Revenue Optics wrote for the client. Never internal recruiter notes; null when none are shared.';
comment on column public.screening_summaries.key_moments is 'Descriptive text with approximate minutes. Not a recording index: nothing is playable.';

-- The submission's shared date for a package, read as the owner so the writer's row-level security cannot hide it.
create function app_private.m6_package_shared_on(p_package_id uuid) returns date
language sql stable security definer set search_path = '' as $$
  select s.shared_on from public.submission_packages p join public.submissions s on s.id = p.submission_id where p.id = p_package_id
$$;

create function app_private.screening_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  r public.screening_summaries;
  st text;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if tg_op = 'UPDATE' and (new.id, new.client_id, new.package_id, new.requirement_set_id, new.created_at)
                          is distinct from (old.id, old.client_id, old.package_id, old.requirement_set_id, old.created_at) then
    perform app_private.m3_refuse('screening_keys_are_fixed');
  end if;
  st := app_private.m3_lock_package(r.package_id);
  if st is null then
    if tg_op = 'DELETE' then return old; end if;       -- the package's own (permitted) deletion is cascading
    return new;                                         -- the foreign key refuses it
  end if;
  if st <> 'draft' and not (tg_op = 'DELETE' and app_private.m3_fictional_cleanup(old.client_id)) then
    perform app_private.m3_refuse('package_frozen');
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.call_on > current_date then perform app_private.m3_refuse('screening_call_in_future'); end if;
  if new.call_on > app_private.m6_package_shared_on(new.package_id) then perform app_private.m3_refuse('screening_call_after_shared'); end if;
  if tg_op = 'INSERT' then new.created_at := now(); end if;
  return new;
end $$;
create trigger screening_summaries_guard before insert or update or delete on public.screening_summaries
  for each row execute function app_private.screening_guard();

-- Privileges: Supabase grants new tables and functions to anon and authenticated by default, so revoke first.
revoke all on table public.screening_summaries from public, anon, authenticated;
revoke all on function app_private.key_moments_ok(jsonb, integer), app_private.m6_package_shared_on(uuid), app_private.screening_guard()
  from public, anon, authenticated;
grant select on table public.screening_summaries to authenticated;

alter table public.screening_summaries enable row level security;

create policy screening_read_published on public.screening_summaries for select to authenticated
  using (client_id = (select app_private.my_client_id())
         and exists (select 1 from public.submission_packages p
                     join public.submissions s on s.id = p.submission_id and s.client_id = p.client_id
                     join public.role_requirement_sets r on r.id = p.requirement_set_id and r.client_id = p.client_id
                     where p.id = screening_summaries.package_id and p.client_id = screening_summaries.client_id
                       and p.state = 'published' and s.publication = 'published' and r.status = 'agreed'));

commit;
