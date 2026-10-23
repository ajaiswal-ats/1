-- Read-only: shows the public.rls_auto_enable function and every event trigger that calls it, for review before the
-- verification check recognises it. One SELECT statement; it reads system catalogues only and changes nothing.
select
  p.oid::regprocedure::text                                   as function,
  pg_get_userbyid(p.proowner)                                 as owner,
  l.lanname                                                   as language,
  p.prorettype::regtype::text                                 as returns,
  p.prosecdef                                                 as security_definer,
  coalesce(array_to_string(p.proconfig, ', '), 'none')        as settings,
  coalesce((select string_agg(format('%s · event %s · tags %s · enabled %s · owner %s',
                                     e.evtname, e.evtevent, coalesce(array_to_string(e.evttags, ', '), 'all'),
                                     e.evtenabled::text, pg_get_userbyid(e.evtowner)), '; ' order by e.evtname)
            from pg_event_trigger e where e.evtfoid = p.oid), 'no event trigger calls it') as event_triggers,
  coalesce((select string_agg(r.rolname, ', ' order by r.rolname)
            from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role')
              and has_function_privilege(r.oid, p.oid, 'EXECUTE')), 'none of anon, authenticated, service_role') as executable_by,
  pg_get_functiondef(p.oid)                                   as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname = 'public' and p.proname = 'rls_auto_enable';
