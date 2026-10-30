-- Empty-setup rollback only. Never silently discard assessment or review history.
begin;
do $$ begin
  if exists(select 1 from app_private.scoring_assessments) or exists(select 1 from app_private.scoring_review_history)
     or exists(select 1 from app_private.recruiters) or exists(select 1 from app_private.recruiter_clients) then
    raise exception 'Recruiter data exists: preserve it and review a separate removal plan before rollback';
  end if;
end $$;
drop function public.recruiter_share_summary(uuid, integer);
drop function public.recruiter_save_review(uuid, integer, jsonb, jsonb, text);
drop function public.recruiter_assessment(uuid);
drop function public.recruiter_assessments();
drop function public.recruiter_account();
drop table app_private.scoring_review_history;
drop table app_private.scoring_assessments;
drop table app_private.recruiter_clients;
drop table app_private.recruiters;
drop function app_private.scoring_assessment_guard();
drop function app_private.check_scoring_inputs(jsonb, jsonb);
drop function app_private.require_recruiter(uuid);
commit;
