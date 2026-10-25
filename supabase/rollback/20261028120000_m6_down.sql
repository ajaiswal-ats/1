-- Undo milestone 6. One transaction. It refuses, changing nothing, while any screening summary exists: remove them first
-- with supabase/seed/m6_remove_fictional.sql. Milestones 1-4 stay as they were, including the package versions the
-- milestone 6 seed published (they are milestone 3 content; see seed/m6_fictional.sql).
begin;

do $$
begin
  if to_regclass('public.screening_summaries') is null then raise exception 'milestone 6 not found: nothing changed'; end if;
  if exists (select 1 from public.screening_summaries) then
    raise exception 'screening summaries exist: remove them first (seed/m6_remove_fictional.sql). Nothing changed.';
  end if;
end $$;

drop table public.screening_summaries;
drop function app_private.screening_guard();
drop function app_private.m6_package_shared_on(uuid);
drop function app_private.key_moments_ok(jsonb, integer);

commit;
