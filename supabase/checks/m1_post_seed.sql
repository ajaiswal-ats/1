-- Read-only check to run in the Supabase SQL Editor after supabase/seed/m1_fictional.sql. One SELECT; changes nothing.
-- Every row should say OK.
with c as (select id, ref from public.clients),
expected(ord, check_name, actual, wanted) as (
  values
  (1,  'Clients (Harbor Industrial Supply, Northwind Fictional Co.)', (select count(*) from public.clients), 2),
  (2,  'Harbor roles (4, including Regional Sales Manager on hold)',  (select count(*) from public.roles r join c on c.id = r.client_id where c.ref = 'harbor'), 4),
  (3,  'Harbor roles on hold',                                        (select count(*) from public.roles r join c on c.id = r.client_id where c.ref = 'harbor' and r.status = 'On hold'), 1),
  (4,  'Northwind roles',                                             (select count(*) from public.roles r join c on c.id = r.client_id where c.ref = 'northwind'), 1),
  (5,  'Harbor people (11 from the 2h fixtures + 1 unpublished test candidate)', (select count(*) from public.people p join c on c.id = p.client_id where c.ref = 'harbor'), 12),
  (6,  'Northwind people',                                            (select count(*) from public.people p join c on c.id = p.client_id where c.ref = 'northwind'), 2),
  (7,  'Harbor published submissions',                                (select count(*) from public.submissions s join c on c.id = s.client_id where c.ref = 'harbor' and s.publication = 'published'), 12),
  (8,  'Harbor unpublished submissions',                              (select count(*) from public.submissions s join c on c.id = s.client_id where c.ref = 'harbor' and s.publication = 'unpublished'), 1),
  (9,  'Northwind published submissions',                             (select count(*) from public.submissions s join c on c.id = s.client_id where c.ref = 'northwind' and s.publication = 'published'), 1),
  (10, 'Northwind unpublished submissions',                           (select count(*) from public.submissions s join c on c.id = s.client_id where c.ref = 'northwind' and s.publication = 'unpublished'), 1),
  (11, 'History events (15 "shared" + 11 seeded stage moves)',       (select count(*) from public.submission_events), 26),
  (12, 'Submissions whose stage or version does not match their history', (select count(*) from public.submissions s
         where s.version <> (select count(*) from public.submission_events e where e.submission_id = s.id)
            or s.version <> (select max(e.submission_version) from public.submission_events e where e.submission_id = s.id)
            or s.stage <> (select e.to_stage from public.submission_events e where e.submission_id = s.id order by e.submission_version desc limit 1)), 0),
  (13, 'Memberships (none yet: test users are a separate step)',      (select count(*) from public.client_members), 0),
  (14, 'Idempotency keys (none until moves are tested)',              (select count(*) from app_private.idempotency_keys), 0),
  (15, 'Rows belonging to any client other than the two fictional ones',
       (select count(*) from public.roles where client_id not in (select id from c where ref in ('harbor', 'northwind')))
     + (select count(*) from public.people where client_id not in (select id from c where ref in ('harbor', 'northwind')))
     + (select count(*) from public.submissions where client_id not in (select id from c where ref in ('harbor', 'northwind'))), 0)
)
select check_name as "check", actual::text as value, wanted::text as expected, case when actual = wanted then 'OK' else 'STOP' end as result
from expected
order by ord;
