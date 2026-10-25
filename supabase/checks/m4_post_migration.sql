-- Read-only check to run in the Supabase SQL Editor straight after the milestone 4 migration (before its seed). One SELECT
-- statement; it reads system catalogues (and counts) and changes nothing. Every row should say OK. Without milestone 4 it
-- still runs and shows STOP rows.
with t as (select to_regclass('public.client_interviews') as iv, to_regclass('public.offer_outcomes') as oo, to_regclass('public.interview_feedback') as fl),
tabs as (select unnest(array[iv, oo, fl]) as oid from t),
fns as (select unnest(array['app_private.m4_refuse(text)', 'app_private.m4_lock_submission_version(uuid)', 'app_private.m4_interview_has_link(uuid)',
                            'app_private.m4_latest_round(uuid)', 'app_private.m4_latest_round_status(uuid)', 'app_private.interviews_guard()', 'app_private.outcomes_guard()',
                            'app_private.m4_link_check(uuid, uuid)', 'app_private.feedback_links_guard()']) as sig),
rpc as (select to_regprocedure('public.client_add_interview_feedback(uuid, uuid, text, text, integer, uuid)') as oid),
rows_out(ord, check_name, value, ok) as (
  select 10, 'Three new tables exist, each with row-level security on',
         (select count(*) from tabs where oid is not null)::text || ' exist, ' || (select count(*) from tabs join pg_class c on c.oid = tabs.oid where c.relrowsecurity)::text || ' with RLS (expected 3, 3)',
         (select count(*) from tabs join pg_class c on c.oid = tabs.oid where c.relrowsecurity) = 3
  union all
  select 11, 'Each new table has exactly one policy, a read policy',
         coalesce((select string_agg(c.relname || ' ' || (select count(*) from pg_policy p where p.polrelid = c.oid)::text, ', ' order by c.relname) from tabs join pg_class c on c.oid = tabs.oid), 'MISSING'),
         (select count(*) from tabs where oid is not null) = 3
           and not exists (select 1 from tabs where (select count(*) from pg_policy p where p.polrelid = tabs.oid) <> 1
                                                  or (select count(*) from pg_policy p where p.polrelid = tabs.oid and p.polcmd = 'r') <> 1)
  union all
  select 12, 'Signed-out (anon): no privileges on the new tables',
         (select count(*) from tabs where oid is not null and has_table_privilege('anon', oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))::text || ' with privileges (expected 0)',
         (select count(*) from tabs where oid is not null) = 3 and not exists (select 1 from tabs where has_table_privilege('anon', oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
  union all
  select 13, 'Signed-in (authenticated): read only on the new tables',
         (select count(*) from tabs where oid is not null and has_table_privilege('authenticated', oid, 'SELECT')
            and not has_table_privilege('authenticated', oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))::text || ' read only (expected 3)',
         (select count(*) from tabs where oid is not null and has_table_privilege('authenticated', oid, 'SELECT')
            and not has_table_privilege('authenticated', oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')) = 3
  union all
  select 14, 'Guards: one enabled insert/update trigger on each new table',
         (select count(*) from pg_trigger g join tabs on tabs.oid = g.tgrelid where not g.tgisinternal and g.tgenabled <> 'D' and g.tgname like '%_guard' and (g.tgtype::int & 20) = 20)::text || ' (expected 3)',
         (select count(*) from pg_trigger g join tabs on tabs.oid = g.tgrelid where not g.tgisinternal and g.tgenabled <> 'D' and g.tgname like '%_guard' and (g.tgtype::int & 20) = 20) = 3
  union all
  select 15, 'Rounds: unique per submission, and at most one requested or scheduled round per submission',
         coalesce((select string_agg(c.relname, ', ' order by c.relname) from pg_index i join pg_class c on c.oid = i.indexrelid
                   where i.indrelid = (select iv from t) and i.indisunique and c.relname in ('client_interviews_one_open', 'client_interviews_submission_id_round_key')), 'MISSING'),
         (select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid
           where i.indrelid = (select iv from t) and i.indisunique and c.relname in ('client_interviews_one_open', 'client_interviews_submission_id_round_key')) = 2
  union all
  select 16, 'Same-client links: interview to submission; feedback link to its interview and to a feedback note of the same submission',
         (select count(*) from pg_constraint c join tabs on tabs.oid = c.conrelid where c.contype = 'f')::text || ' foreign keys (expected 4)',
         (select count(*) from pg_constraint c join tabs on tabs.oid = c.conrelid where c.contype = 'f') = 4
           and exists (select 1 from pg_constraint where conrelid = 'public.client_notes'::regclass and conname = 'client_notes_feedback_link_key')
  union all
  select 20, 'Internal functions: fixed search_path; none executable by anon or authenticated',
         (select count(*) from fns where to_regprocedure(sig) is not null)::text || ' exist, '
           || (select count(*) from fns join pg_proc p on p.oid = to_regprocedure(fns.sig) where has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))::text || ' callable by clients (expected 9, 0)',
         (select count(*) from fns where to_regprocedure(sig) is not null) = 9
           and not exists (select 1 from fns join pg_proc p on p.oid = to_regprocedure(fns.sig)
                           where has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
                              or not coalesce(p.proconfig @> array['search_path=""'], false))
  union all
  select 21, 'client_add_interview_feedback: runs as owner with a fixed search_path; authenticated only',
         case when (select oid from rpc) is null then 'MISSING' else 'security definer ' || p.prosecdef::text || ', anon ' || has_function_privilege('anon', p.oid, 'EXECUTE')::text
           || ', authenticated ' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text end,
         coalesce(p.prosecdef and p.proconfig @> array['search_path=""'] and not has_function_privilege('anon', p.oid, 'EXECUTE') and has_function_privilege('authenticated', p.oid, 'EXECUTE'), false)
  from rpc left join pg_proc p on p.oid = rpc.oid
  union all
  select 30, 'Every table in public and app_private has row-level security on',
         coalesce((select string_agg(n.nspname || '.' || c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname in ('public', 'app_private') and c.relkind in ('r', 'p') and not c.relrowsecurity), 'yes, all of them'),
         not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'app_private') and c.relkind in ('r', 'p') and not c.relrowsecurity)
  union all
  select 40, 'No milestone 4 rows yet: interviews / outcomes / feedback links (expected 0 / 0 / 0)',
         case when (select count(*) from tabs where oid is not null) < 3 then 'MISSING' else
           (xpath('/row/n/text()', query_to_xml('select (select count(*) from public.client_interviews) || '' / '' || (select count(*) from public.offer_outcomes) || '' / '' || (select count(*) from public.interview_feedback) as n', false, true, '')))[1]::text end,
         case when (select count(*) from tabs where oid is not null) < 3 then false else
           (xpath('/row/n/text()', query_to_xml('select (select count(*) from public.client_interviews) + (select count(*) from public.offer_outcomes) + (select count(*) from public.interview_feedback) as n', false, true, '')))[1]::text = '0' end
  union all
  select 41, 'Fictional baseline unchanged: submissions / events / memberships (expected 15 / 26 / 3)',
         (select count(*) from public.submissions) || ' / ' || (select count(*) from public.submission_events) || ' / ' || (select count(*) from public.client_members),
         (select count(*) from public.submissions) = 15 and (select count(*) from public.submission_events) = 26 and (select count(*) from public.client_members) = 3
)
select check_name as "check", value, case when ok then 'OK' else 'STOP' end as result
from rows_out
order by ord;
