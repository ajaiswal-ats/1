-- Read-only check to run in the Supabase SQL Editor after seed/m1_memberships.sql. One SELECT; changes nothing.
-- It reads only the four fictional test addresses (no passwords or tokens). Every row should say OK.
with wanted(ord, email, client_ref, active) as (
  values (1, 'portal-test-harbor@example.com',          'harbor',    true),
         (2, 'portal-test-harbor-inactive@example.com', 'harbor',    false),
         (3, 'portal-test-northwind@example.com',       'northwind', true),
         (4, 'portal-test-no-membership@example.com',   null,        null::boolean)
),
actual as (
  select w.ord, w.email, w.client_ref as want_client, w.active as want_active,
         (select count(*) from public.client_members m join auth.users u on u.id = m.user_id where lower(u.email) = w.email) as n,
         (select c.ref from public.client_members m join auth.users u on u.id = m.user_id join public.clients c on c.id = m.client_id
           where lower(u.email) = w.email limit 1) as got_client,
         (select m.active from public.client_members m join auth.users u on u.id = m.user_id where lower(u.email) = w.email limit 1) as got_active
  from wanted w
),
rows_out(ord, check_name, value, expected, ok) as (
  select ord, email,
         case when n = 0 then 'no membership' else n || ' × ' || got_client || case when got_active then ', active' else ', inactive' end end,
         case when want_client is null then 'no membership' else '1 × ' || want_client || case when want_active then ', active' else ', inactive' end end,
         case when want_client is null then n = 0 else n = 1 and got_client = want_client and got_active = want_active end
  from actual
  union all
  select 10, 'Memberships in total', (select count(*) from public.client_members)::text, '3',
         (select count(*) from public.client_members) = 3
  union all
  select 11, 'Memberships belonging to users other than the test accounts',
         (select count(*) from public.client_members m join auth.users u on u.id = m.user_id
           where lower(u.email) not like 'portal-test-%@example.com')::text, '0',
         not exists (select 1 from public.client_members m join auth.users u on u.id = m.user_id
                      where lower(u.email) not like 'portal-test-%@example.com')
  union all
  select 12, 'Idempotency keys (none until moves are tested)', (select count(*) from app_private.idempotency_keys)::text, '0',
         (select count(*) from app_private.idempotency_keys) = 0
  union all
  select 13, 'Seed data unchanged (submissions / events)',
         (select count(*) from public.submissions) || ' / ' || (select count(*) from public.submission_events), '15 / 26',
         (select count(*) from public.submissions) = 15 and (select count(*) from public.submission_events) = 26
)
select check_name as "check", value, expected, case when ok then 'OK' else 'STOP' end as result
from rows_out
order by ord;
