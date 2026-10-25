-- Read-only check to run in the Supabase SQL Editor after seed/m4_fictional.sql (needs milestone 4 applied). One SELECT
-- statement; it changes nothing. Every row should say OK. The expected numbers are the generated seed's
-- (supabase/seed/m4_counts.json). "Visible" rows repeat the read policies' conditions as the owner sees them.
with rows_out(ord, check_name, value, ok) as (
  select 10, 'Interview rounds / held / feedback recorded / cancelled / outcomes / feedback links (expected 9 / 5 / 3 / 1 / 2 / 0)',
         (select count(*) from public.client_interviews) || ' / ' || (select count(*) from public.client_interviews where status = 'held') || ' / '
           || (select count(*) from public.client_interviews where feedback_recorded_on is not null) || ' / ' || (select count(*) from public.client_interviews where status = 'cancelled') || ' / '
           || (select count(*) from public.offer_outcomes) || ' / ' || (select count(*) from public.interview_feedback),
         (select count(*) from public.client_interviews) = 9 and (select count(*) from public.client_interviews where status = 'held') = 5
           and (select count(*) from public.client_interviews where feedback_recorded_on is not null) = 3 and (select count(*) from public.client_interviews where status = 'cancelled') = 1
           and (select count(*) from public.offer_outcomes) = 2 and not exists (select 1 from public.interview_feedback)
  union all
  select 11, 'Every fact is recorded as of its submission''s current version (the fixtures describe the state after all their history)',
         ((select count(*) from public.client_interviews i join public.submissions s on s.id = i.submission_id where i.as_of_version <> s.version)
           + (select count(*) from public.offer_outcomes o join public.submissions s on s.id = o.submission_id where o.as_of_version <> s.version))::text || ' differ (expected 0)',
         not exists (select 1 from public.client_interviews i join public.submissions s on s.id = i.submission_id where i.as_of_version <> s.version)
           and not exists (select 1 from public.offer_outcomes o join public.submissions s on s.id = o.submission_id where o.as_of_version <> s.version)
  union all
  select 12, 'Rounds are numbered 1, 2, ... per submission, with at most one requested or scheduled round',
         (select count(*) from (select submission_id from public.client_interviews group by submission_id having max(round) <> count(*)
                                 or count(*) filter (where status in ('requested', 'scheduled')) > 1) x)::text || ' submissions out of order (expected 0)',
         not exists (select 1 from public.client_interviews group by submission_id having max(round) <> count(*) or count(*) filter (where status in ('requested', 'scheduled')) > 1)
  union all
  select 20, 'Would be visible: Harbor interviews / outcomes; Northwind interviews (expected 6 / 2; 2)',
         v.h_iv || ' / ' || v.h_oo || '; ' || v.n_iv, (v.h_iv, v.h_oo, v.n_iv) = (6, 2, 2)
  from (select
    (select count(*) from public.client_interviews i join public.submissions s on s.id = i.submission_id join public.clients c on c.id = i.client_id where c.ref = 'harbor' and s.publication = 'published') as h_iv,
    (select count(*) from public.offer_outcomes o join public.submissions s on s.id = o.submission_id join public.clients c on c.id = o.client_id where c.ref = 'harbor' and s.publication = 'published') as h_oo,
    (select count(*) from public.client_interviews i join public.submissions s on s.id = i.submission_id join public.clients c on c.id = i.client_id where c.ref = 'northwind' and s.publication = 'published') as n_iv) v
  union all
  select 41, 'Fictional baseline unchanged: submissions / events / memberships (expected 15 / 26 / 3)',
         (select count(*) from public.submissions) || ' / ' || (select count(*) from public.submission_events) || ' / ' || (select count(*) from public.client_members),
         (select count(*) from public.submissions) = 15 and (select count(*) from public.submission_events) = 26 and (select count(*) from public.client_members) = 3
)
select check_name as "check", value, case when ok then 'OK' else 'STOP' end as result
from rows_out
order by ord;
