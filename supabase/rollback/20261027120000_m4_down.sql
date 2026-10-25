-- Undo milestone 4. One transaction. It refuses, changing nothing, while any milestone 4 row exists: remove them first with
-- supabase/seed/m4_remove_fictional.sql. Milestones 1-3 stay as they were (feedback given through the round-linked function
-- stays as an ordinary feedback note).
begin;

do $$
begin
  if to_regclass('public.client_interviews') is null then raise exception 'milestone 4 not found: nothing changed'; end if;
  if exists (select 1 from public.interview_feedback) or exists (select 1 from public.offer_outcomes) or exists (select 1 from public.client_interviews) then
    raise exception 'milestone 4 rows exist: remove them first (seed/m4_remove_fictional.sql). Nothing changed.';
  end if;
end $$;

drop function public.client_add_interview_feedback(uuid, uuid, text, text, integer, uuid);
drop table public.interview_feedback;
drop table public.offer_outcomes;
drop table public.client_interviews;
drop function app_private.feedback_links_guard();
drop function app_private.m4_link_check(uuid, uuid);
drop function app_private.outcomes_guard();
drop function app_private.interviews_guard();
drop function app_private.m4_latest_round_status(uuid);
drop function app_private.m4_latest_round(uuid);
drop function app_private.m4_interview_has_link(uuid);
drop function app_private.m4_lock_submission_version(uuid);
drop function app_private.m4_refuse(text);
alter table public.client_notes drop constraint client_notes_feedback_link_key;

commit;
