-- Read-only check to run in the Supabase SQL Editor straight after the milestone 6 migration (before its seed). One SELECT
-- statement; it reads system catalogues (and counts) and changes nothing. Every row should say OK. Without milestone 6 it
-- still runs and shows STOP rows.
with t as (select to_regclass('public.screening_summaries') as ss),
fns as (select unnest(array['app_private.key_moments_ok(jsonb, integer)', 'app_private.m6_package_shared_on(uuid)', 'app_private.screening_guard()']) as sig),
rows_out(ord, check_name, value, ok) as (
  select 10, 'screening_summaries exists with row-level security on',
         case when (select ss from t) is null then 'MISSING' else 'RLS ' || (select relrowsecurity from pg_class where oid = (select ss from t))::text end,
         coalesce((select relrowsecurity from pg_class where oid = (select ss from t)), false)
  union all
  select 11, 'One policy, a read policy',
         coalesce((select count(*)::text || ' policies, ' || count(*) filter (where polcmd = 'r')::text || ' read' from pg_policy where polrelid = (select ss from t)), 'MISSING'),
         (select ss from t) is not null and (select count(*) from pg_policy where polrelid = (select ss from t)) = 1
           and (select count(*) from pg_policy where polrelid = (select ss from t) and polcmd = 'r') = 1
  union all
  select 12, 'Signed-out (anon): no privileges; signed-in (authenticated): read only',
         case when (select ss from t) is null then 'MISSING' else
           'anon ' || has_table_privilege('anon', (select ss from t), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')::text
           || ', authenticated select ' || has_table_privilege('authenticated', (select ss from t), 'SELECT')::text
           || ', authenticated write ' || has_table_privilege('authenticated', (select ss from t), 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')::text end,
         (select ss from t) is not null and not has_table_privilege('anon', (select ss from t), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
           and has_table_privilege('authenticated', (select ss from t), 'SELECT')
           and not has_table_privilege('authenticated', (select ss from t), 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  union all
  select 13, 'Freeze guard: one enabled insert/update/delete trigger',
         (select count(*) from pg_trigger g where g.tgrelid = (select ss from t) and not g.tgisinternal and g.tgenabled <> 'D' and g.tgname = 'screening_summaries_guard' and (g.tgtype::int & 28) = 28)::text || ' (expected 1)',
         (select count(*) from pg_trigger g where g.tgrelid = (select ss from t) and not g.tgisinternal and g.tgenabled <> 'D' and g.tgname = 'screening_summaries_guard' and (g.tgtype::int & 28) = 28) = 1
  union all
  select 14, 'Same-client link to one package version (composite foreign key), one summary per package',
         (select count(*) from pg_constraint where conrelid = (select ss from t) and contype = 'f')::text || ' foreign key, '
           || (select count(*) from pg_constraint where conrelid = (select ss from t) and contype = 'u')::text || ' unique (expected 1, 1)',
         (select count(*) from pg_constraint where conrelid = (select ss from t) and contype = 'f') = 1
           and (select count(*) from pg_constraint where conrelid = (select ss from t) and contype = 'u') = 1
  union all
  select 15, 'Client-safe columns only: no internal notes, transcript, recording, link or score column',
         coalesce((select string_agg(column_name, ', ') from information_schema.columns where table_schema = 'public' and table_name = 'screening_summaries'
                   and column_name ~ '(internal|transcript|record|url|link|score|rating|play)'), 'none'),
         (select ss from t) is not null and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'screening_summaries'
                   and column_name ~ '(internal|transcript|record|url|link|score|rating|play)')
  union all
  select 20, 'Internal functions: fixed search_path; none executable by anon or authenticated',
         (select count(*) from fns where to_regprocedure(sig) is not null)::text || ' exist, '
           || (select count(*) from fns join pg_proc p on p.oid = to_regprocedure(fns.sig) where has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))::text || ' callable by clients (expected 3, 0)',
         (select count(*) from fns where to_regprocedure(sig) is not null) = 3
           and not exists (select 1 from fns join pg_proc p on p.oid = to_regprocedure(fns.sig)
                           where has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
                              or not coalesce(p.proconfig @> array['search_path=""'], false))
  union all
  select 30, 'Every table in public and app_private has row-level security on',
         coalesce((select string_agg(n.nspname || '.' || c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname in ('public', 'app_private') and c.relkind in ('r', 'p') and not c.relrowsecurity), 'yes, all of them'),
         not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'app_private') and c.relkind in ('r', 'p') and not c.relrowsecurity)
  union all
  select 40, 'No screening summaries yet (expected 0)',
         case when (select ss from t) is null then 'MISSING' else
           (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.screening_summaries', false, true, '')))[1]::text end,
         case when (select ss from t) is null then false else
           (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.screening_summaries', false, true, '')))[1]::text = '0' end
  union all
  select 41, 'Fictional baseline unchanged: submissions / events / memberships / packages (expected 15 / 26 / 3 / 17)',
         (select count(*) from public.submissions) || ' / ' || (select count(*) from public.submission_events) || ' / ' || (select count(*) from public.client_members)
           || ' / ' || (select count(*) from public.submission_packages),
         (select count(*) from public.submissions) = 15 and (select count(*) from public.submission_events) = 26 and (select count(*) from public.client_members) = 3
           and (select count(*) from public.submission_packages) = 17
)
select check_name as "check", value, case when ok then 'OK' else 'STOP' end as result
from rows_out
order by ord;
