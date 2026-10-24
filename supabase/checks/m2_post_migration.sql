-- Read-only check to run in the Supabase SQL Editor straight after the milestone 2 migration. One SELECT statement; it
-- reads system catalogues (and two counts) and changes nothing. Every row should say OK. Without milestone 2 it still
-- runs and shows STOP rows.
with t as (select to_regclass('public.client_notes') as notes,
                  to_regprocedure('public.client_decline(uuid, text, text, integer, uuid)') as decline,
                  to_regprocedure('public.client_add_feedback(uuid, text, text, integer, uuid)') as feedback),
rows_out(ord, check_name, value, ok) as (
  select 10, 'public.client_notes: exists, row-level security on',
         case when notes is null then 'MISSING' when (select relrowsecurity from pg_class where oid = notes) then 'RLS on' else 'RLS OFF' end,
         notes is not null and coalesce((select relrowsecurity from pg_class where oid = notes), false)
  from t
  union all
  select 11, 'public.client_notes: one read policy',
         coalesce((select count(*) from pg_policy p where p.polrelid = notes), 0)::text || ' (expected 1)',
         coalesce((select count(*) from pg_policy p where p.polrelid = notes and p.polcmd = 'r'), 0) = 1
           and coalesce((select count(*) from pg_policy p where p.polrelid = notes), 0) = 1
  from t
  union all
  select 12, 'public.client_notes: signed-out (anon) privileges',
         case when notes is null then 'MISSING' when has_table_privilege('anon', notes, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then 'HAS PRIVILEGES' else 'none' end,
         notes is not null and not has_table_privilege('anon', notes, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  from t
  union all
  select 13, 'public.client_notes: signed-in (authenticated) privileges (expected read only)',
         case when notes is null then 'MISSING'
              when has_table_privilege('authenticated', notes, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then 'CAN WRITE'
              when has_table_privilege('authenticated', notes, 'SELECT') then 'read only' else 'none' end,
         notes is not null and has_table_privilege('authenticated', notes, 'SELECT')
           and not has_table_privilege('authenticated', notes, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  from t
  union all
  select 14, 'public.client_notes: the add-only trigger is in place and enabled',
         coalesce((select tgname || ' (enabled ' || tgenabled::text || ')' from pg_trigger where tgrelid = notes and tgname = 'client_notes_no_update'), 'MISSING'),
         exists (select 1 from pg_trigger where tgrelid = notes and tgname = 'client_notes_no_update' and tgenabled <> 'D')
  from t
  union all
  select 15, 'public.client_notes: each note is tied to its own history entry (one composite key: entry, submission, client, kind, author)',
         coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = notes and c.contype = 'f' and c.confrelid = 'public.submission_events'::regclass), 'MISSING'),
         exists (select 1 from pg_constraint c where c.conrelid = notes and c.contype = 'f' and c.confrelid = 'public.submission_events'::regclass
                   and array_length(c.conkey, 1) = 5 and c.confmatchtype = 'f')
  from t
  union all
  select 16, 'public.submission_events: kinds shared, stage_move, decline, feedback; decision entries are client entries with a member',
         coalesce((select string_agg(conname, ', ' order by conname) from pg_constraint where conrelid = 'public.submission_events'::regclass
                    and conname in ('submission_events_kind_check', 'submission_events_client_decision_check', 'submission_events_decline_stage_check', 'submission_events_note_target_key')), 'MISSING'),
         (select count(*) from pg_constraint where conrelid = 'public.submission_events'::regclass
            and conname in ('submission_events_kind_check', 'submission_events_client_decision_check', 'submission_events_decline_stage_check', 'submission_events_note_target_key')) = 4
           and exists (select 1 from pg_constraint where conrelid = 'public.submission_events'::regclass and conname = 'submission_events_kind_check'
                         and pg_get_constraintdef(oid) like '%decline%' and pg_get_constraintdef(oid) like '%feedback%')
  union all
  select 20, 'client_decline: runs as owner with a fixed search_path; authenticated only',
         case when decline is null then 'MISSING' else 'security definer ' || p.prosecdef::text || ', search_path ' || coalesce(array_to_string(p.proconfig, ','), 'not set')
           || ', anon ' || has_function_privilege('anon', p.oid, 'EXECUTE')::text || ', authenticated ' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text end,
         coalesce(p.prosecdef and p.proconfig @> array['search_path=""'] and not has_function_privilege('anon', p.oid, 'EXECUTE') and has_function_privilege('authenticated', p.oid, 'EXECUTE'), false)
  from t left join pg_proc p on p.oid = t.decline
  union all
  select 21, 'client_add_feedback: runs as owner with a fixed search_path; authenticated only',
         case when feedback is null then 'MISSING' else 'security definer ' || p.prosecdef::text || ', search_path ' || coalesce(array_to_string(p.proconfig, ','), 'not set')
           || ', anon ' || has_function_privilege('anon', p.oid, 'EXECUTE')::text || ', authenticated ' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text end,
         coalesce(p.prosecdef and p.proconfig @> array['search_path=""'] and not has_function_privilege('anon', p.oid, 'EXECUTE') and has_function_privilege('authenticated', p.oid, 'EXECUTE'), false)
  from t left join pg_proc p on p.oid = t.feedback
  union all
  select 22, 'app_private.trim_ws: the whitespace rule used by the functions and the note checks (immutable; no client access; trims tabs, newlines and Unicode spaces at the ends only)',
         case when to_regprocedure('app_private.trim_ws(text)') is null then 'MISSING' else 'immutable ' || (p.provolatile = 'i')::text || ', search_path ' || coalesce(array_to_string(p.proconfig, ','), 'not set')
           || ', anon ' || has_function_privilege('anon', p.oid, 'EXECUTE')::text || ', authenticated ' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
           || ', behaves as expected ' || ((xpath('/row/t/text()', query_to_xml($p$select app_private.trim_ws(E' \t\nx\n\ty ' || chr(160)) = E'x\n\ty' and app_private.trim_ws(E'\t\n') = '' as t$p$, false, true, '')))[1]::text = 'true')::text end,
         case when to_regprocedure('app_private.trim_ws(text)') is null then false
              else p.provolatile = 'i' and p.proconfig @> array['search_path=""'] and not has_function_privilege('anon', p.oid, 'EXECUTE')
                   and not has_function_privilege('authenticated', p.oid, 'EXECUTE') and (xpath('/row/t/text()', query_to_xml($p$select app_private.trim_ws(E' \t\nx\n\ty ' || chr(160)) = E'x\n\ty' and app_private.trim_ws(E'\t\n') = '' as t$p$, false, true, '')))[1]::text = 'true' end
  from (select 1) one left join pg_proc p on p.oid = to_regprocedure('app_private.trim_ws(text)')
  union all
  select 30, 'Every table in public and app_private has row-level security on',
         coalesce((select string_agg(n.nspname || '.' || c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname in ('public', 'app_private') and c.relkind in ('r', 'p') and not c.relrowsecurity), 'yes, all of them'),
         not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname in ('public', 'app_private') and c.relkind in ('r', 'p') and not c.relrowsecurity)
  union all
  select 40, 'No decisions yet: client notes / decline and feedback entries (expected 0 / 0)',
         case when notes is null then 'MISSING' else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.client_notes', false, true, '')))[1]::text end
           || ' / ' || (select count(*) from public.submission_events where kind in ('decline', 'feedback'))::text,
         case when notes is null then false
              else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.client_notes', false, true, '')))[1]::text = '0' end
           and not exists (select 1 from public.submission_events where kind in ('decline', 'feedback'))
  from t
  union all
  select 41, 'Fictional baseline unchanged: submissions / events / memberships (expected 15 / 26 / 3)',
         (select count(*) from public.submissions) || ' / ' || (select count(*) from public.submission_events) || ' / ' || (select count(*) from public.client_members),
         (select count(*) from public.submissions) = 15 and (select count(*) from public.submission_events) = 26 and (select count(*) from public.client_members) = 3
)
select check_name as "check", value, case when ok then 'OK' else 'STOP' end as result
from rows_out
order by ord;
