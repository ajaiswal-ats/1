-- Read-only check that the development project is empty, for pasting into the Supabase SQL Editor.
-- One SELECT statement: it reads system catalogues and counts rows. It creates, changes and deletes nothing.
-- Tables that may not exist (or may not be readable) are counted only after checking, so a missing table cannot cause an error.
-- Recognised: Supabase's automatic-RLS helper (public.rls_auto_enable and its event trigger), created by the
-- "enable automatic RLS" option and reviewed on 23 Oct 2026. It is recognised only while it keeps that reviewed shape
-- (see auto_rls below); any other function in public is still a STOP.
with auto_rls as (
  select p.oid, md5(pg_get_functiondef(p.oid)) as fingerprint,
         (select string_agg(format('%s on %s (%s)', e.evtname, e.evtevent, array_to_string(e.evttags, ', ')), '; ') from pg_event_trigger e where e.evtfoid = p.oid) as triggers,
         p.prorettype = 'event_trigger'::regtype
         and (select count(*) from pg_event_trigger e where e.evtfoid = p.oid) = 1
         and exists (select 1 from pg_event_trigger e where e.evtfoid = p.oid and e.evtevent = 'ddl_command_end'
                     and e.evtenabled <> 'D' and 'CREATE TABLE' = any (e.evttags))
         and pg_get_functiondef(p.oid) ~* 'enable\s+row\s+level\s+security'
         and pg_get_functiondef(p.oid) !~* '\m(grant|revoke|create\s+policy|drop|delete|insert|update|truncate|copy)\M' as reviewed_shape
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'rls_auto_enable'
),
guarded(ord, label, tbl, absent_ok) as (
  values (8, 'Auth users', 'auth.users', false),
         (9, 'Storage buckets', 'storage.buckets', true),
         (10, 'Storage files', 'storage.objects', true),
         (11, 'Migration history', 'supabase_migrations.schema_migrations', true)
),
counted as (
  select ord, label, absent_ok,
         case
           when to_regclass(tbl) is null then 'absent'
           when not coalesce(has_table_privilege(to_regclass(tbl), 'SELECT'), false) then 'not readable'
           else (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %s', tbl), false, true, '')))[1]::text
         end as value
  from guarded
),
results(ord, check_name, value, ok) as (
  select 1, 'Database (information)', current_database() || ' · ' || split_part(version(), ' on ', 1), null::boolean
  union all
  select 2, 'Running as (information)', current_user::text, null
  union all
  select 3, 'Application schemas besides public', coalesce(x.v, 'none'), x.v is null
  from (select string_agg(nspname, ', ' order by nspname) as v from pg_namespace
        where nspname not like 'pg\_%'
          and nspname not in ('information_schema', 'public', 'auth', 'storage', 'extensions', 'graphql', 'graphql_public', 'realtime', '_realtime',
                              'supabase_functions', 'supabase_migrations', 'vault', 'pgsodium', 'pgsodium_masks', 'net', 'cron', 'pgbouncer',
                              '_analytics', 'pgtle', 'topology', 'tiger', 'tiger_data')) x
  union all
  select 4, 'Tables, views or sequences in public', coalesce(x.v, 'none'), x.v is null
  from (select string_agg(c.relname || ' (' || c.relkind::text || ')', ', ' order by c.relname) as v
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f', 'S')) x
  union all
  select 5, 'Functions in public (not from extensions; the reviewed automatic-RLS helper is listed separately)', coalesce(x.v, 'none'), x.v is null
  from (select string_agg(p.proname, ', ' order by p.proname) as v
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
          and p.oid not in (select oid from auto_rls where reviewed_shape)) x
  union all
  select 5, 'Automatic-RLS helper public.rls_auto_enable (reviewed)',
         coalesce((select case when reviewed_shape then 'present, reviewed shape · ' || triggers || ' · definition md5 ' || fingerprint
                               else 'present but NOT in the reviewed shape · ' || coalesce(triggers, 'no event trigger') end from auto_rls), 'not present'),
         coalesce((select reviewed_shape from auto_rls), true)
  union all
  select 6, 'Custom types in public', x.n::text, x.n = 0
  from (select count(*) as n from pg_type t join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public' and t.typtype in ('e', 'd', 'c') and t.typrelid = 0) x
  union all
  select 7, 'Row-level policies outside Supabase''s own schemas', x.n::text, x.n = 0
  from (select count(*) as n from pg_policies where schemaname not in ('auth', 'storage', 'realtime', 'supabase_functions', 'vault')) x
  union all
  select ord, label, value,
         case when value = '0' then true when value = 'absent' then absent_ok else false end
  from counted
  union all
  select 12, 'Extensions installed (information)', string_agg(extname || ' ' || extversion, ', ' order by extname), null from pg_extension
)
select check_name as "check", value,
       case when ok is null then 'INFO' when ok then 'OK' else 'STOP' end as result
from results
order by ord, check_name;
