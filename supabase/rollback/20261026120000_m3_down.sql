-- Undo milestone 3. One transaction. It refuses, changing nothing, while any milestone 3 content exists: remove it first
-- with supabase/seed/m3_remove_fictional.sql (the explicit fictional cleanup). Milestones 1 and 2 stay as they were.
begin;

do $$
begin
  if to_regclass('public.role_requirement_sets') is null then raise exception 'milestone 3 not found: nothing changed'; end if;
  if to_regclass('public.client_interviews') is not null then raise exception 'milestone 4 is applied: roll it back first. Nothing changed.'; end if;
  if to_regclass('public.screening_summaries') is not null then raise exception 'milestone 6 is applied: roll it back first. Nothing changed.'; end if;
  if exists (select 1 from public.requirement_evidence) or exists (select 1 from public.submission_packages)
     or exists (select 1 from public.role_requirements) or exists (select 1 from public.role_requirement_sets)
     or exists (select 1 from public.roles where summary is not null or responsibilities is not null or job_description is not null or hold_note is not null) then
    raise exception 'milestone 3 content exists: remove it first (seed/m3_remove_fictional.sql). Nothing changed.';
  end if;
end $$;

drop table public.requirement_evidence;
drop table public.submission_packages;
drop table public.role_requirements;
drop table public.role_requirement_sets;
drop function app_private.publish_package(uuid);
drop function app_private.agree_requirement_set(uuid, date);
drop function app_private.evidence_guard();
drop function app_private.packages_guard();
drop function app_private.requirements_guard();
drop function app_private.requirement_sets_guard();
drop function app_private.m3_refuse(text);
drop function app_private.m3_evidence_count(uuid);
drop function app_private.m3_requirement_count(uuid);
drop function app_private.m3_lock_package(uuid);
drop function app_private.m3_lock_set(uuid);
drop function app_private.m3_fictional_cleanup(uuid);
alter table public.submissions drop constraint submissions_package_target_key;
alter table public.roles drop column summary, drop column responsibilities, drop column job_description, drop column hold_note;
drop function app_private.key_facts_ok(jsonb);
drop function app_private.text_list_ok(text[], integer, integer);

commit;
