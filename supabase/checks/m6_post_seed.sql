-- Read-only check to run in the Supabase SQL Editor after seed/m6_fictional.sql (needs milestone 6 applied). One SELECT
-- statement; it changes nothing. Every row should say OK. The expected numbers are the generated seed's
-- (supabase/seed/m6_counts.json). "Visible" rows repeat the read policies' conditions as the owner sees them. After this
-- seed, checks/m3_post_seed.sql no longer matches (it describes milestone 3's seed alone); rows 11-13 below re-check
-- what it checked for packages.
with rows_out(ord, check_name, value, ok) as (
  select 10, 'Screening summaries (expected 9), each on a published package',
         (select count(*) from public.screening_summaries) || ', ' || (select count(*) from public.screening_summaries s join public.submission_packages p on p.id = s.package_id where p.state = 'published') || ' on published packages',
         (select count(*) from public.screening_summaries) = 9
           and (select count(*) from public.screening_summaries s join public.submission_packages p on p.id = s.package_id where p.state = 'published') = 9
  union all
  select 11, 'Packages / evidence (expected 26 / 106); states published / draft / paused / withdrawn / superseded (expected 14 / 1 / 1 / 1 / 9)',
         (select count(*) from public.submission_packages) || ' / ' || (select count(*) from public.requirement_evidence) || '; '
           || (select string_agg(n::text, ' / ' order by o) from (select o, (select count(*) from public.submission_packages where state = s) n
               from unnest(array['published', 'draft', 'paused', 'withdrawn', 'superseded']) with ordinality u(s, o)) x),
         (select count(*) from public.submission_packages) = 26 and (select count(*) from public.requirement_evidence) = 106
           and (select array_agg(n order by o) from (select o, (select count(*) from public.submission_packages where state = s) n
               from unnest(array['published', 'draft', 'paused', 'withdrawn', 'superseded']) with ordinality u(s, o)) x) = array[14, 1, 1, 1, 9]::bigint[]
  union all
  select 12, 'Every package that was ever published has exactly one evidence row per requirement',
         (select count(*) from public.submission_packages p where p.state <> 'draft'
            and (select count(*) from public.requirement_evidence e where e.package_id = p.id) <> (select count(*) from public.role_requirements r where r.set_id = p.requirement_set_id))::text || ' incomplete (expected 0)',
         not exists (select 1 from public.submission_packages p where p.state <> 'draft'
            and (select count(*) from public.requirement_evidence e where e.package_id = p.id) <> (select count(*) from public.role_requirements r where r.set_id = p.requirement_set_id))
  union all
  select 13, 'Each package with a summary has the same reviewed content and evidence as the version it superseded',
         (select count(*) from public.screening_summaries s join public.submission_packages n on n.id = s.package_id
            join public.submission_packages o on o.submission_id = n.submission_id and o.version = 1 and o.state = 'superseded'
          where (n.why_shared, n.strengths, n.points_to_clarify, n.key_facts, n.requirement_set_id) is not distinct from (o.why_shared, o.strengths, o.points_to_clarify, o.key_facts, o.requirement_set_id)
            and not exists ((select requirement_id, status, evidence, source_label from public.requirement_evidence where package_id = n.id)
                            except (select requirement_id, status, evidence, source_label from public.requirement_evidence where package_id = o.id))
            and not exists ((select requirement_id, status, evidence, source_label from public.requirement_evidence where package_id = o.id)
                            except (select requirement_id, status, evidence, source_label from public.requirement_evidence where package_id = n.id)))::text || ' identical (expected 9)',
         (select count(*) from public.screening_summaries s join public.submission_packages n on n.id = s.package_id
            join public.submission_packages o on o.submission_id = n.submission_id and o.version = 1 and o.state = 'superseded'
          where (n.why_shared, n.strengths, n.points_to_clarify, n.key_facts, n.requirement_set_id) is not distinct from (o.why_shared, o.strengths, o.points_to_clarify, o.key_facts, o.requirement_set_id)
            and not exists ((select requirement_id, status, evidence, source_label from public.requirement_evidence where package_id = n.id)
                            except (select requirement_id, status, evidence, source_label from public.requirement_evidence where package_id = o.id))
            and not exists ((select requirement_id, status, evidence, source_label from public.requirement_evidence where package_id = o.id)
                            except (select requirement_id, status, evidence, source_label from public.requirement_evidence where package_id = n.id))) = 9
  union all
  select 14, 'Dates: every call on or before its submission''s shared date',
         (select count(*) from public.screening_summaries s join public.submission_packages p on p.id = s.package_id join public.submissions sb on sb.id = p.submission_id
          where s.call_on > sb.shared_on)::text || ' after (expected 0)',
         not exists (select 1 from public.screening_summaries s join public.submission_packages p on p.id = s.package_id join public.submissions sb on sb.id = p.submission_id
                     where s.call_on > sb.shared_on)
  union all
  select 20, 'Would be visible to Harbor: packages / evidence / summaries (expected 11 / 48 / 9)',
         v.p || ' / ' || v.e || ' / ' || v.s, (v.p, v.e, v.s) = (11, 48, 9)
  from (select
    (select count(*) from public.submission_packages p join public.submissions sb on sb.id = p.submission_id join public.role_requirement_sets r on r.id = p.requirement_set_id
       join public.clients c on c.id = p.client_id where c.ref = 'harbor' and p.state = 'published' and sb.publication = 'published' and r.status = 'agreed') as p,
    (select count(*) from public.requirement_evidence e join public.submission_packages p on p.id = e.package_id join public.submissions sb on sb.id = p.submission_id
       join public.role_requirement_sets r on r.id = p.requirement_set_id join public.clients c on c.id = e.client_id
       where c.ref = 'harbor' and p.state = 'published' and sb.publication = 'published' and r.status = 'agreed') as e,
    (select count(*) from public.screening_summaries s join public.submission_packages p on p.id = s.package_id join public.submissions sb on sb.id = p.submission_id
       join public.role_requirement_sets r on r.id = p.requirement_set_id join public.clients c on c.id = s.client_id
       where c.ref = 'harbor' and p.state = 'published' and sb.publication = 'published' and r.status = 'agreed') as s) v
  union all
  select 21, 'Would be visible to Northwind: packages / summaries (expected 0 / 0)',
         v.p || ' / ' || v.s, (v.p, v.s) = (0, 0)
  from (select
    (select count(*) from public.submission_packages p join public.submissions sb on sb.id = p.submission_id join public.role_requirement_sets r on r.id = p.requirement_set_id
       join public.clients c on c.id = p.client_id where c.ref = 'northwind' and p.state = 'published' and sb.publication = 'published' and r.status = 'agreed') as p,
    (select count(*) from public.screening_summaries s join public.clients c on c.id = s.client_id where c.ref = 'northwind') as s) v
  union all
  select 41, 'Fictional baseline unchanged: submissions / events / memberships (expected 15 / 26 / 3)',
         (select count(*) from public.submissions) || ' / ' || (select count(*) from public.submission_events) || ' / ' || (select count(*) from public.client_members),
         (select count(*) from public.submissions) = 15 and (select count(*) from public.submission_events) = 26 and (select count(*) from public.client_members) = 3
)
select check_name as "check", value, case when ok then 'OK' else 'STOP' end as result
from rows_out
order by ord;
