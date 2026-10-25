-- Read-only check to run in the Supabase SQL Editor straight after the milestone 3 migration (before its seed). One SELECT
-- statement; it reads system catalogues (and counts) and changes nothing. Every row should say OK. Without milestone 3 it
-- still runs and shows STOP rows.
with t as (select to_regclass('public.role_requirement_sets') as sets, to_regclass('public.role_requirements') as reqs,
                  to_regclass('public.submission_packages') as pkgs, to_regclass('public.requirement_evidence') as ev),
tabs as (select unnest(array[sets, reqs, pkgs, ev]) as oid from t),
fns as (select unnest(array['app_private.text_list_ok(text[], integer, integer)', 'app_private.key_facts_ok(jsonb)', 'app_private.m3_fictional_cleanup(uuid)',
                            'app_private.m3_refuse(text)', 'app_private.requirement_sets_guard()', 'app_private.requirements_guard()',
                            'app_private.packages_guard()', 'app_private.evidence_guard()', 'app_private.agree_requirement_set(uuid, date)',
                            'app_private.publish_package(uuid)', 'app_private.m3_lock_set(uuid)', 'app_private.m3_lock_package(uuid)',
                            'app_private.m3_requirement_count(uuid)', 'app_private.m3_evidence_count(uuid)']) as sig),
rows_out(ord, check_name, value, ok) as (
  select 10, 'Four new tables exist, each with row-level security on',
         (select count(*) from tabs where oid is not null)::text || ' exist, ' || (select count(*) from tabs join pg_class c on c.oid = tabs.oid where c.relrowsecurity)::text || ' with RLS (expected 4, 4)',
         (select count(*) from tabs join pg_class c on c.oid = tabs.oid where c.relrowsecurity) = 4
  union all
  select 11, 'Each new table has exactly one policy, a read policy',
         coalesce((select string_agg(c.relname || ' ' || (select count(*) from pg_policy p where p.polrelid = c.oid)::text, ', ' order by c.relname) from tabs join pg_class c on c.oid = tabs.oid), 'MISSING'),
         (select count(*) from tabs where oid is not null) = 4
           and not exists (select 1 from tabs where (select count(*) from pg_policy p where p.polrelid = tabs.oid) <> 1
                                                  or (select count(*) from pg_policy p where p.polrelid = tabs.oid and p.polcmd = 'r') <> 1)
  union all
  select 12, 'Signed-out (anon): no privileges on the new tables',
         (select count(*) from tabs where oid is not null and has_table_privilege('anon', oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))::text || ' with privileges (expected 0)',
         (select count(*) from tabs where oid is not null) = 4
           and not exists (select 1 from tabs where has_table_privilege('anon', oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
  union all
  select 13, 'Signed-in (authenticated): read only on the new tables',
         (select count(*) from tabs where oid is not null and has_table_privilege('authenticated', oid, 'SELECT')
            and not has_table_privilege('authenticated', oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))::text || ' read only (expected 4)',
         (select count(*) from tabs where oid is not null and has_table_privilege('authenticated', oid, 'SELECT')
            and not has_table_privilege('authenticated', oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')) = 4
  union all
  select 14, 'Freeze guards: one enabled insert/update/delete trigger on each new table',
         (select count(*) from pg_trigger g join tabs on tabs.oid = g.tgrelid where not g.tgisinternal and g.tgenabled <> 'D' and g.tgname like '%_guard')::text || ' (expected 4)',
         (select count(*) from pg_trigger g join tabs on tabs.oid = g.tgrelid where not g.tgisinternal and g.tgenabled <> 'D' and g.tgname like '%_guard'
            and (g.tgtype::int & 28) = 28) = 4
  union all
  select 15, 'One published package per submission and one agreed set per role (deferred exclusion constraints)',
         coalesce((select string_agg(conname || case when condeferrable and condeferred then ' (deferred)' else ' (NOT deferred)' end, ', ' order by conname)
                   from pg_constraint where conname in ('submission_packages_one_published', 'role_requirement_sets_one_agreed')), 'MISSING'),
         (select count(*) from pg_constraint where conname in ('submission_packages_one_published', 'role_requirement_sets_one_agreed') and contype = 'x' and condeferrable and condeferred) = 2
  union all
  select 16, 'Same-client and same-role links: composite foreign keys (package to submission and set; evidence to package and requirement)',
         (select count(*) from pg_constraint c join tabs on tabs.oid = c.conrelid where c.contype = 'f' and array_length(c.conkey, 1) = 3)::text || ' three-column foreign keys (expected 4)',
         (select count(*) from pg_constraint c join tabs on tabs.oid = c.conrelid where c.contype = 'f' and array_length(c.conkey, 1) = 3) = 4
           and exists (select 1 from pg_constraint where conrelid = 'public.submissions'::regclass and conname = 'submissions_package_target_key')
  union all
  select 17, 'Role descriptions: four new columns on roles',
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'roles' and column_name in ('summary', 'responsibilities', 'job_description', 'hold_note'))::text || ' (expected 4)',
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'roles' and column_name in ('summary', 'responsibilities', 'job_description', 'hold_note')) = 4
  union all
  select 20, 'New functions: fixed search_path; none executable by anon or authenticated',
         (select count(*) from fns where to_regprocedure(sig) is not null)::text || ' exist, '
           || (select count(*) from fns join pg_proc p on p.oid = to_regprocedure(fns.sig) where has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))::text || ' callable by clients (expected 14, 0)',
         (select count(*) from fns where to_regprocedure(sig) is not null) = 14
           and not exists (select 1 from fns join pg_proc p on p.oid = to_regprocedure(fns.sig)
                           where has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
                              or not coalesce(p.proconfig @> array['search_path=""'], false))
  union all
  select 21, 'Scoring stays separate: no score, rating, weight, confidence, band or percentage column in client-readable tables',
         (select count(*) from information_schema.columns where table_schema = 'public'
            and table_name in ('roles', 'role_requirement_sets', 'role_requirements', 'submission_packages', 'requirement_evidence')
            and column_name ~ '(score|rating|weight|confidence|band|percent)')::text || ' (expected 0)',
         not exists (select 1 from information_schema.columns where table_schema = 'public'
            and table_name in ('roles', 'role_requirement_sets', 'role_requirements', 'submission_packages', 'requirement_evidence')
            and column_name ~ '(score|rating|weight|confidence|band|percent)')
  union all
  select 30, 'Every table in public and app_private has row-level security on',
         coalesce((select string_agg(n.nspname || '.' || c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname in ('public', 'app_private') and c.relkind in ('r', 'p') and not c.relrowsecurity), 'yes, all of them'),
         not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname in ('public', 'app_private') and c.relkind in ('r', 'p') and not c.relrowsecurity)
  union all
  select 40, 'No milestone 3 content yet: sets / requirements / packages / evidence / role descriptions (expected 0 / 0 / 0 / 0 / 0)',
         case when (select count(*) from tabs where oid is not null) < 4 then 'MISSING' else
           (xpath('/row/n/text()', query_to_xml('select (select count(*) from public.role_requirement_sets) || '' / '' || (select count(*) from public.role_requirements) || '' / ''
              || (select count(*) from public.submission_packages) || '' / '' || (select count(*) from public.requirement_evidence) || '' / ''
              || (select count(*) from public.roles where summary is not null or responsibilities is not null or job_description is not null or hold_note is not null) as n', false, true, '')))[1]::text end,
         case when (select count(*) from tabs where oid is not null) < 4 then false else
           (xpath('/row/n/text()', query_to_xml('select (select count(*) from public.role_requirement_sets) + (select count(*) from public.role_requirements)
              + (select count(*) from public.submission_packages) + (select count(*) from public.requirement_evidence)
              + (select count(*) from public.roles where summary is not null or responsibilities is not null or job_description is not null or hold_note is not null) as n', false, true, '')))[1]::text = '0' end
  union all
  select 41, 'Fictional baseline unchanged: submissions / events / memberships (expected 15 / 26 / 3)',
         (select count(*) from public.submissions) || ' / ' || (select count(*) from public.submission_events) || ' / ' || (select count(*) from public.client_members),
         (select count(*) from public.submissions) = 15 and (select count(*) from public.submission_events) = 26 and (select count(*) from public.client_members) = 3
)
select check_name as "check", value, case when ok then 'OK' else 'STOP' end as result
from rows_out
order by ord;
