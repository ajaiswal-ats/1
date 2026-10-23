-- Read-only check to run in the Supabase SQL Editor straight after the milestone 1 migration.
-- One SELECT statement: it reads system catalogues only and changes nothing. Every row should say OK.
-- It confirms row-level security is ON for every application table (explicitly, not relying on the automatic-RLS helper),
-- the expected policies exist, signed-out users have no privileges, signed-in users can only read, and the functions are
-- locked down as designed.
with expected(ord, tbl, policies, client_can_read) as (
  values (1, 'public.clients', 1, true),
         (2, 'public.client_members', 1, true),
         (3, 'public.roles', 1, true),
         (4, 'public.people', 1, true),          (5, 'public.submissions', 1, true),
         (6, 'public.submission_events', 1, true),
         (7, 'app_private.idempotency_keys', 0, false)
),
app_tables as (
  select e.*, to_regclass(e.tbl) as rel from expected e
),
rows_out(ord, check_name, value, ok) as (
  -- Each application table: exists, RLS on, policy count, privileges.
  select ord * 10, tbl || ': exists, row-level security on',
         case when rel is null then 'MISSING' when c.relrowsecurity then 'RLS on' else 'RLS OFF' end,
         rel is not null and coalesce(c.relrowsecurity, false)
  from app_tables t left join pg_class c on c.oid = t.rel
  union all
  select ord * 10 + 1, tbl || ': policies',
         coalesce((select count(*) from pg_policy p where p.polrelid = t.rel), 0)::text || ' (expected ' || policies || ')',
         coalesce((select count(*) from pg_policy p where p.polrelid = t.rel), -1) = policies
  from app_tables t
  union all
  select ord * 10 + 2, tbl || ': signed-out (anon) privileges',
         case when rel is null then 'MISSING'
              when has_table_privilege('anon', rel, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then 'HAS PRIVILEGES' else 'none' end,
         rel is not null and not has_table_privilege('anon', rel, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  from app_tables t
  union all
  select ord * 10 + 3, tbl || ': signed-in (authenticated) privileges',
         case when rel is null then 'MISSING'
              when has_table_privilege('authenticated', rel, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then 'CAN WRITE'
              when has_table_privilege('authenticated', rel, 'SELECT') then 'read only (rows limited by policies)' else 'none' end
           || case when client_can_read then ' (expected read only)' else ' (expected none)' end,
         rel is not null
           and not has_table_privilege('authenticated', rel, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
           and has_table_privilege('authenticated', rel, 'SELECT') = client_can_read
  from app_tables t
  union all
  -- Nothing in public or app_private without RLS (catches tables added outside this migration).
  select 100, 'Every table in public and app_private has row-level security on',
         coalesce((select string_agg(n.nspname || '.' || c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname in ('public', 'app_private') and c.relkind in ('r', 'p') and not c.relrowsecurity), 'yes, all of them'),
         not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname in ('public', 'app_private') and c.relkind in ('r', 'p') and not c.relrowsecurity)
  union all
  select 101, 'The events id sequence: no privileges for anon or authenticated',
         case when to_regclass('public.submission_events_id_seq') is null then 'MISSING'
              when has_sequence_privilege('anon', 'public.submission_events_id_seq', 'USAGE, SELECT, UPDATE')
                or has_sequence_privilege('authenticated', 'public.submission_events_id_seq', 'USAGE, SELECT, UPDATE') then 'HAS PRIVILEGES' else 'none' end,
         to_regclass('public.submission_events_id_seq') is not null
           and not has_sequence_privilege('anon', 'public.submission_events_id_seq', 'USAGE, SELECT, UPDATE')
           and not has_sequence_privilege('authenticated', 'public.submission_events_id_seq', 'USAGE, SELECT, UPDATE')
  union all
  select 102, 'Schema app_private: anon has no access; authenticated may only look up the policy helper',
         case when to_regnamespace('app_private') is null then 'MISSING'
              else 'anon usage ' || has_schema_privilege('anon', 'app_private', 'USAGE')::text
                || ', authenticated usage ' || has_schema_privilege('authenticated', 'app_private', 'USAGE')::text
                || ', authenticated create ' || has_schema_privilege('authenticated', 'app_private', 'CREATE')::text end,
         to_regnamespace('app_private') is not null and not has_schema_privilege('anon', 'app_private', 'USAGE')
           and has_schema_privilege('authenticated', 'app_private', 'USAGE') and not has_schema_privilege('authenticated', 'app_private', 'CREATE')
  union all
  -- Functions: who can run them, and that they run with a fixed search_path.
  select 110, 'client_move_stage: runs as owner with a fixed search_path; authenticated only',
         case when to_regprocedure('public.client_move_stage(uuid, text, integer, uuid)') is null then 'MISSING' else
           'security definer ' || p.prosecdef::text || ', search_path ' || coalesce(array_to_string(p.proconfig, ','), 'not set')
           || ', anon ' || has_function_privilege('anon', p.oid, 'EXECUTE')::text || ', authenticated ' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text end,
         coalesce(p.prosecdef and p.proconfig @> array['search_path=""'] and not has_function_privilege('anon', p.oid, 'EXECUTE')
                  and has_function_privilege('authenticated', p.oid, 'EXECUTE'), false)
  from (select 1) one left join pg_proc p on p.oid = to_regprocedure('public.client_move_stage(uuid, text, integer, uuid)')
  union all
  select 111, 'app_private.my_client_id: runs as owner with a fixed search_path; authenticated only',
         case when to_regprocedure('app_private.my_client_id()') is null then 'MISSING' else
           'security definer ' || p.prosecdef::text || ', search_path ' || coalesce(array_to_string(p.proconfig, ','), 'not set')
           || ', anon ' || has_function_privilege('anon', p.oid, 'EXECUTE')::text || ', authenticated ' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text end,
         coalesce(p.prosecdef and p.proconfig @> array['search_path=""'] and not has_function_privilege('anon', p.oid, 'EXECUTE')
                  and has_function_privilege('authenticated', p.oid, 'EXECUTE'), false)
  from (select 1) one left join pg_proc p on p.oid = to_regprocedure('app_private.my_client_id()')
  union all
  select 112, 'Events are add-only: the update-blocking trigger is in place and enabled',
         coalesce((select tgname || ' (enabled ' || tgenabled::text || ')' from pg_trigger
                   where tgrelid = to_regclass('public.submission_events') and tgname = 'submission_events_no_update'), 'MISSING'),
         exists (select 1 from pg_trigger where tgrelid = to_regclass('public.submission_events') and tgname = 'submission_events_no_update' and tgenabled <> 'D')
  union all
  -- Before the seed, the tables are empty.
  select 120, 'Rows in the application tables (expected 0 until the fictional seed is approved)',
         coalesce((select string_agg(format('%s %s', tbl, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %s', tbl), false, true, '')))[1]::text), ', ' order by ord)
                   from app_tables where rel is not null), 'tables missing'),
         coalesce((select bool_and((xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %s', tbl), false, true, '')))[1]::text = '0')
                   from app_tables where rel is not null), false)
)
select check_name as "check", value, case when ok then 'OK' else 'STOP' end as result
from rows_out
order by ord;
