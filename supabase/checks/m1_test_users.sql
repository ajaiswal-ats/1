-- Read-only check to run in the Supabase SQL Editor after creating the four fictional test users in
-- Authentication → Users. One SELECT; changes nothing. It reads only these four addresses (no passwords or tokens).
-- Every row should say OK.
with wanted(ord, email, purpose) as (
  values (1, 'portal-test-harbor@example.com',          'Harbor member (active)'),
         (2, 'portal-test-harbor-inactive@example.com', 'Harbor member (inactive)'),
         (3, 'portal-test-northwind@example.com',       'Northwind member (active)'),
         (4, 'portal-test-no-membership@example.com',   'Signed in, no membership')
),
found as (
  select w.ord, w.email, w.purpose,
         (select count(*) from auth.users u where lower(u.email) = w.email) as accounts,
         (select bool_and(u.email_confirmed_at is not null) from auth.users u where lower(u.email) = w.email) as confirmed,
         (select count(*) from public.client_members m join auth.users u on u.id = m.user_id where lower(u.email) = w.email) as memberships
  from wanted w
)
select ord, email, purpose,
       case when accounts = 0 then 'missing' when accounts > 1 then accounts || ' accounts' else 'exists' end as account,
       case when confirmed then 'confirmed' else 'NOT confirmed' end as email_status,
       memberships::text as memberships_so_far,
       case when accounts = 1 and confirmed and memberships = 0 then 'OK' else 'STOP' end as result
from found
order by ord;
