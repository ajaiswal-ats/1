-- Undo milestone 2. One transaction. It refuses, changing nothing, while any decline or feedback exists: restore the
-- fictional baseline first (the run's cleanup SQL). Milestone 1 stays as it was. Run milestone 1's rollback only after this.
begin;

do $$
begin
  if to_regclass('public.client_notes') is null then raise exception 'milestone 2 not found: nothing changed'; end if;
  if exists (select 1 from public.client_notes) or exists (select 1 from public.submission_events where kind in ('decline', 'feedback')) then
    raise exception 'declines or feedback exist: restore the baseline first. Nothing changed.';
  end if;
  if to_regclass('public.role_requirement_sets') is not null then raise exception 'milestone 3 is applied: roll it back first. Nothing changed.'; end if;
end $$;

drop function public.client_add_feedback(uuid, text, text, integer, uuid);
drop function public.client_decline(uuid, text, text, integer, uuid);
drop table public.client_notes;
drop function app_private.notes_are_add_only();
drop function app_private.trim_ws(text);
alter table public.submission_events drop constraint submission_events_note_target_key;
alter table public.submission_events drop constraint submission_events_decline_stage_check;
alter table public.submission_events drop constraint submission_events_client_decision_check;
alter table public.submission_events drop constraint submission_events_kind_check;
alter table public.submission_events add constraint submission_events_kind_check check (kind in ('shared', 'stage_move'));

commit;
