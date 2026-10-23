-- Milestone 1 test memberships: INSERTS ONLY, exactly three rows into public.client_members. One transaction.
-- Run once in the Supabase SQL Editor after the four fictional test users exist (checks/m1_test_users.sql all OK).
-- It stops without changing anything unless the expected users and clients exist and none of the four test users
-- already has a membership. No updates, deletes, seed resets or Auth changes.
-- The fourth account, portal-test-no-membership@example.com, is deliberately left without a membership.
-- Then run checks/m1_post_memberships.sql. Undo: seed/m1_remove_fictional.sql removes these with the fictional clients.
begin;

do $$
declare
  v_inserted integer;
begin
  if to_regclass('public.client_members') is null then
    raise exception 'milestone 1 migration not found: nothing inserted';
  end if;

  -- Both fictional clients exist.
  if (select count(*) from public.clients where ref in ('harbor', 'northwind')) <> 2 then
    raise exception 'fictional clients harbor and northwind not both found: nothing inserted';
  end if;

  -- All four test users exist exactly once and are confirmed (including the one that stays unassigned).
  if (select count(*) from auth.users u
       where lower(u.email) in ('portal-test-harbor@example.com', 'portal-test-harbor-inactive@example.com',
                                'portal-test-northwind@example.com', 'portal-test-no-membership@example.com')
         and u.email_confirmed_at is not null) <> 4 then
    raise exception 'the four confirmed test users were not found exactly once each: nothing inserted';
  end if;

  -- Refuse if any of the four already has a membership (no overwriting, no second client).
  if exists (select 1 from public.client_members m join auth.users u on u.id = m.user_id
              where lower(u.email) in ('portal-test-harbor@example.com', 'portal-test-harbor-inactive@example.com',
                                       'portal-test-northwind@example.com', 'portal-test-no-membership@example.com')) then
    raise exception 'a test user already has a membership: nothing inserted';
  end if;

  insert into public.client_members (client_id, user_id, display_name, job_title, active)
  select c.id, u.id, w.display_name, w.job_title, w.active
  from (values ('portal-test-harbor@example.com',          'harbor',    'Maria Alvarez (test)',   'Hiring manager',        true),
               ('portal-test-harbor-inactive@example.com', 'harbor',    'Inactive member (test)', 'Former hiring manager', false),
               ('portal-test-northwind@example.com',       'northwind', 'Northwind member (test)', 'Hiring manager',       true))
       as w(email, client_ref, display_name, job_title, active)
  join auth.users u on lower(u.email) = w.email
  join public.clients c on c.ref = w.client_ref;

  get diagnostics v_inserted = row_count;
  if v_inserted <> 3 then
    raise exception 'expected 3 memberships, would have inserted %: nothing inserted', v_inserted;
  end if;
end $$;

commit;
