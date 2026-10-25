-- Read-only check to run in the Supabase SQL Editor after seed/m3_fictional.sql (needs milestone 3 applied). One SELECT
-- statement; it changes nothing. Every row should say OK. The expected numbers are the generated seed's
-- (supabase/seed/m3_counts.json). "Visible" rows repeat the read policies' conditions as the owner sees them.
with rows_out(ord, check_name, value, ok) as (
  select 10, 'Role descriptions / sets / requirements / packages / evidence (expected 5 / 7 / 22 / 17 / 67)',
         (select count(*) from public.roles where summary is not null) || ' / ' || (select count(*) from public.role_requirement_sets) || ' / '
           || (select count(*) from public.role_requirements) || ' / ' || (select count(*) from public.submission_packages) || ' / ' || (select count(*) from public.requirement_evidence),
         (select count(*) from public.roles where summary is not null) = 5 and (select count(*) from public.role_requirement_sets) = 7
           and (select count(*) from public.role_requirements) = 22 and (select count(*) from public.submission_packages) = 17 and (select count(*) from public.requirement_evidence) = 67
  union all
  select 11, 'Set statuses: agreed / draft / superseded (expected 5 / 1 / 1)',
         (select count(*) from public.role_requirement_sets where status = 'agreed') || ' / ' || (select count(*) from public.role_requirement_sets where status = 'draft')
           || ' / ' || (select count(*) from public.role_requirement_sets where status = 'superseded'),
         (select count(*) from public.role_requirement_sets where status = 'agreed') = 5 and (select count(*) from public.role_requirement_sets where status = 'draft') = 1
           and (select count(*) from public.role_requirement_sets where status = 'superseded') = 1
  union all
  select 12, 'Package states: published / draft / paused / withdrawn (expected 14 / 1 / 1 / 1)',
         (select count(*) from public.submission_packages where state = 'published') || ' / ' || (select count(*) from public.submission_packages where state = 'draft') || ' / '
           || (select count(*) from public.submission_packages where state = 'paused') || ' / ' || (select count(*) from public.submission_packages where state = 'withdrawn'),
         (select count(*) from public.submission_packages where state = 'published') = 14 and (select count(*) from public.submission_packages where state = 'draft') = 1
           and (select count(*) from public.submission_packages where state = 'paused') = 1 and (select count(*) from public.submission_packages where state = 'withdrawn') = 1
  union all
  select 13, 'Every package that was ever published has exactly one evidence row per requirement',
         (select count(*) from public.submission_packages p where p.state <> 'draft'
            and (select count(*) from public.requirement_evidence e where e.package_id = p.id) <> (select count(*) from public.role_requirements r where r.set_id = p.requirement_set_id))::text || ' incomplete (expected 0)',
         not exists (select 1 from public.submission_packages p where p.state <> 'draft'
            and (select count(*) from public.requirement_evidence e where e.package_id = p.id) <> (select count(*) from public.role_requirements r where r.set_id = p.requirement_set_id))
  union all
  select 14, 'Sources: every evidence row except unevidenced ones has a source; unevidenced ones have none in this seed',
         (select count(*) from public.requirement_evidence where status <> 'not_evidenced' and source_label is null) || ' / ' || (select count(*) from public.requirement_evidence where status = 'not_evidenced' and source_label is not null) || ' (expected 0 / 0)',
         not exists (select 1 from public.requirement_evidence where (status <> 'not_evidenced' and source_label is null) or (status = 'not_evidenced' and source_label is not null))
  union all
  select 20, 'Would be visible to Harbor: sets / requirements / packages / evidence (expected 4 / 17 / 11 / 48)',
         v.h_sets || ' / ' || v.h_reqs || ' / ' || v.h_pkgs || ' / ' || v.h_ev, (v.h_sets, v.h_reqs, v.h_pkgs, v.h_ev) = (4, 17, 11, 48)
  from (select
    (select count(*) from public.role_requirement_sets s join public.clients c on c.id = s.client_id where c.ref = 'harbor' and s.status = 'agreed') as h_sets,
    (select count(*) from public.role_requirements r join public.role_requirement_sets s on s.id = r.set_id join public.clients c on c.id = r.client_id where c.ref = 'harbor' and s.status = 'agreed') as h_reqs,
    (select count(*) from public.submission_packages p join public.submissions sb on sb.id = p.submission_id join public.role_requirement_sets s on s.id = p.requirement_set_id
       join public.clients c on c.id = p.client_id where c.ref = 'harbor' and p.state = 'published' and sb.publication = 'published' and s.status = 'agreed') as h_pkgs,
    (select count(*) from public.requirement_evidence e join public.submission_packages p on p.id = e.package_id join public.submissions sb on sb.id = p.submission_id
       join public.role_requirement_sets s on s.id = p.requirement_set_id join public.clients c on c.id = e.client_id
       where c.ref = 'harbor' and p.state = 'published' and sb.publication = 'published' and s.status = 'agreed') as h_ev) v
  union all
  select 21, 'Would be visible to Northwind: sets / requirements / packages (expected 1 / 2 / 0)',
         v.n_sets || ' / ' || v.n_reqs || ' / ' || v.n_pkgs, (v.n_sets, v.n_reqs, v.n_pkgs) = (1, 2, 0)
  from (select
    (select count(*) from public.role_requirement_sets s join public.clients c on c.id = s.client_id where c.ref = 'northwind' and s.status = 'agreed') as n_sets,
    (select count(*) from public.role_requirements r join public.role_requirement_sets s on s.id = r.set_id join public.clients c on c.id = r.client_id where c.ref = 'northwind' and s.status = 'agreed') as n_reqs,
    (select count(*) from public.submission_packages p join public.submissions sb on sb.id = p.submission_id join public.role_requirement_sets s on s.id = p.requirement_set_id
       join public.clients c on c.id = p.client_id where c.ref = 'northwind' and p.state = 'published' and sb.publication = 'published' and s.status = 'agreed') as n_pkgs) v
  union all
  select 41, 'Fictional baseline unchanged: submissions / events / memberships (expected 15 / 26 / 3)',
         (select count(*) from public.submissions) || ' / ' || (select count(*) from public.submission_events) || ' / ' || (select count(*) from public.client_members),
         (select count(*) from public.submissions) = 15 and (select count(*) from public.submission_events) = 26 and (select count(*) from public.client_members) = 3
)
select check_name as "check", value, case when ok then 'OK' else 'STOP' end as result
from rows_out
order by ord;
