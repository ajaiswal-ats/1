-- M7: separate recruiter access, private assessment reviews and explicit client-summary publication.
-- PREPARED ONLY. Do not apply to a hosted database as part of a frontend build.
-- The owner provisions recruiters/client assignments and imports assessed inputs; browsers cannot grant access,
-- import CVs, approve rubrics or change original evidence. No AI service is called by this migration.
begin;

create table app_private.recruiters (
  user_id uuid primary key references auth.users(id),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  active boolean not null default true
);
create table app_private.recruiter_clients (
  user_id uuid references app_private.recruiters(user_id),
  client_id uuid references public.clients(id),
  primary key (user_id, client_id)
);
create table app_private.scoring_assessments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  submission_id uuid not null unique,
  rubric jsonb not null,
  original_inputs jsonb not null,
  inputs jsonb not null,
  evidence jsonb not null default '{}' check (jsonb_typeof(evidence) = 'object'),
  source_record jsonb not null default '{}' check (jsonb_typeof(source_record) = 'object'),
  screening_questions jsonb not null default '[]' check (jsonb_typeof(screening_questions) = 'array'),
  prepared_by text not null check (char_length(btrim(prepared_by)) between 1 and 200),
  revision integer not null default 1 check (revision >= 1),
  review jsonb,
  reviewed_revision integer,
  published_revision integer,
  published_package_id uuid references public.submission_packages(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (submission_id, client_id) references public.submissions(id, client_id),
  check (reviewed_revision is null or reviewed_revision = revision),
  check (published_revision is null or published_revision <= revision)
);
create table app_private.scoring_review_history (
  id bigint generated always as identity primary key,
  assessment_id uuid not null references app_private.scoring_assessments(id),
  revision integer not null,
  actor_user_id uuid not null references auth.users(id),
  kind text not null check (kind in ('review', 'share')),
  reason text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
alter table app_private.recruiters enable row level security;
alter table app_private.recruiter_clients enable row level security;
alter table app_private.scoring_assessments enable row level security;
alter table app_private.scoring_review_history enable row level security;
revoke all on app_private.recruiters, app_private.recruiter_clients,
  app_private.scoring_assessments, app_private.scoring_review_history from public, anon, authenticated;
revoke all on sequence app_private.scoring_review_history_id_seq from public, anon, authenticated;
create index scoring_assessments_client on app_private.scoring_assessments(client_id, id);
create index scoring_review_history_assessment on app_private.scoring_review_history(assessment_id, id);

-- Called only inside owner-executed RPCs. Locks prevent access revocation racing a save/publication.
create function app_private.require_recruiter(p_client_id uuid default null) returns void
language plpgsql set search_path = '' as $$
begin
  perform 1 from app_private.recruiters where user_id = auth.uid() and active for share;
  if not found then raise exception using errcode = 'PT403', message = 'recruiter_access_required'; end if;
  if p_client_id is not null then
    perform 1 from app_private.recruiter_clients where user_id = auth.uid() and client_id = p_client_id for share;
    if not found then raise exception using errcode = 'PT403', message = 'recruiter_access_required'; end if;
  end if;
end $$;

-- Validate every edited input on the server; a manipulated browser cannot introduce unknown IDs or ratings.
create function app_private.check_scoring_inputs(p_rubric jsonb, p_inputs jsonb) returns void
language plpgsql set search_path = '' as $$
declare c jsonb; i jsonb; g jsonb; n integer;
begin
  if jsonb_typeof(p_rubric -> 'criteria') is distinct from 'array'
     or jsonb_typeof(p_rubric -> 'gates') is distinct from 'array'
     or jsonb_typeof(p_inputs -> 'criteria') is distinct from 'array'
     or jsonb_typeof(p_inputs -> 'gates') is distinct from 'array' then
    raise exception using errcode = 'PT400', message = 'invalid_assessment_inputs';
  end if;
  select count(*) into n from jsonb_array_elements(p_rubric -> 'criteria') x where (x ->> 'included')::boolean;
  if n = 0 or jsonb_array_length(p_inputs -> 'criteria') <> n
     or jsonb_array_length(p_inputs -> 'gates') <> jsonb_array_length(p_rubric -> 'gates') then
    raise exception using errcode = 'PT400', message = 'incomplete_assessment_inputs';
  end if;
  for c in select x from jsonb_array_elements(p_rubric -> 'criteria') x where (x ->> 'included')::boolean loop
    select count(*) into n from jsonb_array_elements(p_inputs -> 'criteria') x where x ->> 'id' = c ->> 'id';
    if n <> 1 then raise exception using errcode = 'PT400', message = 'invalid_criterion_id'; end if;
    select x into i from jsonb_array_elements(p_inputs -> 'criteria') x where x ->> 'id' = c ->> 'id';
    if coalesce(i ->> 'status', '') not in ('rated', 'unknown', 'disputed') then
      raise exception using errcode = 'PT400', message = 'invalid_criterion_status';
    end if;
    if i ->> 'status' = 'rated' and
       (jsonb_typeof(i -> 'rating') is distinct from 'number'
        or (i ->> 'rating') !~ '^[0-9]+$'
        or (i ->> 'rating')::integer > (c ->> 'max')::integer
        or coalesce(c -> 'unavailableLevels', '[]'::jsonb) @> jsonb_build_array(i -> 'rating')) then
      raise exception using errcode = 'PT400', message = 'invalid_rating';
    end if;
  end loop;
  for g in select x from jsonb_array_elements(p_rubric -> 'gates') x loop
    select count(*) into n from jsonb_array_elements(p_inputs -> 'gates') x where x ->> 'id' = g ->> 'id';
    if n <> 1 then raise exception using errcode = 'PT400', message = 'invalid_essential_id'; end if;
    select x into i from jsonb_array_elements(p_inputs -> 'gates') x where x ->> 'id' = g ->> 'id';
    if coalesce(i ->> 'result', '') not in ('Pass', 'Fail', 'Unknown') or i ? 'exception' then
      raise exception using errcode = 'PT400', message = 'invalid_essential_result';
    end if;
  end loop;
end $$;

create function app_private.scoring_assessment_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'assessment_history_must_be_retained'; end if;
  if tg_op = 'INSERT' then
    if new.inputs <> new.original_inputs or new.revision <> 1 or new.review is not null
       or new.reviewed_revision is not null or new.published_revision is not null then
      raise exception 'assessment_must_start_unreviewed';
    end if;
  elsif (new.id, new.client_id, new.submission_id, new.rubric, new.original_inputs, new.evidence, new.source_record, new.screening_questions, new.prepared_by, new.created_at)
    is distinct from (old.id, old.client_id, old.submission_id, old.rubric, old.original_inputs, old.evidence, old.source_record, old.screening_questions, old.prepared_by, old.created_at) then
    raise exception 'original_assessment_is_immutable';
  end if;
  perform app_private.check_scoring_inputs(new.rubric, new.inputs);
  return new;
end $$;
create trigger scoring_assessments_guard before insert or update or delete on app_private.scoring_assessments
  for each row execute function app_private.scoring_assessment_guard();
create trigger scoring_reviews_append_only before update or delete on app_private.scoring_review_history
  for each row execute function app_private.events_are_append_only();

create function public.recruiter_account() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object('userId', user_id, 'displayName', display_name) into result
    from app_private.recruiters where user_id = auth.uid() and active;
  return result;
end $$;

create function public.recruiter_assessments() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_recruiter();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'candidate', p.name, 'client', c.name, 'role', r.title,
      'revision', a.revision, 'reviewed', a.reviewed_revision = a.revision,
      -- Availability to an authorised member of this client, matching package RLS and the saved revision.
      'published', coalesce(a.published_revision = a.revision and pkg.state = 'published'
        and s.publication = 'published' and pkg.requirement_set_id = rs.id, false), 'updatedAt', a.updated_at)
      order by p.name, a.id)
    from app_private.scoring_assessments a
    join app_private.recruiter_clients access on access.client_id = a.client_id and access.user_id = auth.uid()
    join public.submissions s on s.id = a.submission_id
    join public.people p on p.id = s.person_id
    join public.roles r on r.id = s.role_id
    join public.clients c on c.id = a.client_id
    left join public.role_requirement_sets rs on rs.role_id = r.id and rs.client_id = a.client_id and rs.status = 'agreed'
    left join public.submission_packages pkg on pkg.id = a.published_package_id
      and pkg.submission_id = s.id and pkg.role_id = r.id and pkg.client_id = a.client_id), '[]'::jsonb);
end $$;

create function public.recruiter_assessment(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a app_private.scoring_assessments; result jsonb;
begin
  perform app_private.require_recruiter();
  select * into a from app_private.scoring_assessments where id = p_id;
  if not found then raise exception using errcode = 'PT403', message = 'assessment_unavailable'; end if;
  perform app_private.require_recruiter(a.client_id);
  select jsonb_build_object('id', a.id, 'submissionId', a.submission_id,
    'candidate', p.name, 'client', c.name, 'role', r.title, 'revision', a.revision,
    'rubric', a.rubric, 'inputs', a.inputs, 'originalInputs', a.original_inputs, 'evidence', a.evidence,
    'preparedBy', a.prepared_by, 'screeningQuestions', a.screening_questions, 'review', a.review, 'reviewed', a.reviewed_revision = a.revision,
    'published', coalesce(a.published_revision = a.revision and pkg.state = 'published'
      and s.publication = 'published' and pkg.requirement_set_id = rs.id, false),
    'setId', rs.id, 'requirements', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'text', q.text, 'tier', q.tier) order by q.position)
      from public.role_requirements q where q.set_id = rs.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('revision', h.revision, 'kind', h.kind,
      'reviewer', staff.display_name, 'reason', h.reason, 'at', h.created_at, 'changes', h.snapshot -> 'review' -> 'changes') order by h.id desc)
      from app_private.scoring_review_history h join app_private.recruiters staff on staff.user_id = h.actor_user_id
      where h.assessment_id = a.id), '[]'::jsonb)) into result
    from public.submissions s join public.people p on p.id = s.person_id
    join public.roles r on r.id = s.role_id join public.clients c on c.id = s.client_id
    left join public.role_requirement_sets rs on rs.role_id = r.id and rs.client_id = a.client_id and rs.status = 'agreed'
    left join public.submission_packages pkg on pkg.id = a.published_package_id
      and pkg.submission_id = s.id and pkg.role_id = r.id and pkg.client_id = a.client_id
    where s.id = a.submission_id;
  return result;
end $$;

create function public.recruiter_save_review(p_id uuid, p_expected_revision integer, p_inputs jsonb, p_review jsonb, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare a app_private.scoring_assessments; answer jsonb; question jsonb; item jsonb; previous jsonb; change jsonb; n integer;
begin
  perform app_private.require_recruiter();
  select * into a from app_private.scoring_assessments where id = p_id for update;
  if not found then raise exception using errcode = 'PT403', message = 'assessment_unavailable'; end if;
  perform app_private.require_recruiter(a.client_id);
  if p_expected_revision is null or a.revision is distinct from p_expected_revision then raise exception using errcode = 'PT409', message = 'assessment_changed_reload'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 10 and 2000
     or jsonb_typeof(p_review) is distinct from 'object'
     or coalesce(p_review ->> 'decision', '') not in ('forward', 'hold', 'decline')
     or char_length(btrim(coalesce(p_review ->> 'decisionReason', ''))) not between 10 and 2000
     or jsonb_typeof(p_review -> 'screening') is distinct from 'array' then
    raise exception using errcode = 'PT400', message = 'review_reason_and_decision_required';
  end if;
  if jsonb_typeof(p_review -> 'whyShared') is distinct from 'string'
     or char_length(p_review ->> 'whyShared') > 2000
     or jsonb_typeof(p_review -> 'strengths') is distinct from 'array'
     or jsonb_typeof(p_review -> 'pointsToClarify') is distinct from 'array'
     or jsonb_typeof(p_review -> 'evidence') is distinct from 'array'
     or jsonb_typeof(p_review -> 'changes') is distinct from 'array' then
    raise exception using errcode = 'PT400', message = 'invalid_review_fields';
  end if;
  if jsonb_array_length(p_review -> 'strengths') > 20 or jsonb_array_length(p_review -> 'pointsToClarify') > 20
     or exists (select 1 from (select x from jsonb_array_elements(p_review -> 'strengths') x union all
       select x from jsonb_array_elements(p_review -> 'pointsToClarify') x) items
       where jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') not between 1 and 300) then
    raise exception using errcode = 'PT400', message = 'invalid_summary_items';
  end if;
  for item in select x from jsonb_array_elements(p_review -> 'evidence') x loop
    if jsonb_typeof(item -> 'requirementId') is distinct from 'string'
       or coalesce(item ->> 'status', 'invalid') not in ('', 'supported', 'partly_supported', 'not_evidenced', 'confirmed_not_met')
       or jsonb_typeof(item -> 'evidence') is distinct from 'string' or char_length(item ->> 'evidence') > 1000
       or jsonb_typeof(item -> 'source') is distinct from 'string' or char_length(item ->> 'source') > 120 then
      raise exception using errcode = 'PT400', message = 'invalid_requirement_evidence';
    end if;
  end loop;
  perform app_private.check_scoring_inputs(a.rubric, p_inputs);
  for item in select x from jsonb_array_elements(p_inputs -> 'criteria') x union all
    select x from jsonb_array_elements(p_inputs -> 'gates') x loop
    select x into previous from (select x from jsonb_array_elements(a.inputs -> 'criteria') x union all
      select x from jsonb_array_elements(a.inputs -> 'gates') x) current_inputs where x ->> 'id' = item ->> 'id';
    if item <> previous then
      select x into change from jsonb_array_elements(coalesce(p_review -> 'changes', '[]')) x where x ->> 'id' = item ->> 'id';
      if change is null or coalesce(change ->> 'source', '') not in ('cv', 'screening')
         or char_length(btrim(coalesce(change ->> 'evidence', ''))) < 5
         or char_length(btrim(coalesce(change ->> 'reason', ''))) < 5 then
        raise exception using errcode = 'PT400', message = 'each_correction_needs_evidence_and_reason';
      end if;
      if change ->> 'source' = 'screening' and item ->> 'status' = 'rated'
         and (previous ->> 'status' <> 'rated' or (item ->> 'rating')::integer > (previous ->> 'rating')::integer) then
        raise exception using errcode = 'PT400', message = 'screening_cannot_raise_cv_rating';
      end if;
    end if;
  end loop;
  if p_review ->> 'decision' = 'forward' and exists
    (select 1 from jsonb_array_elements(p_inputs -> 'gates') x where x ->> 'result' = 'Fail') then
    raise exception using errcode = 'PT400', message = 'essential_not_met';
  end if;
  if p_review ->> 'decision' = 'forward' and exists
    (select 1 from jsonb_array_elements(p_inputs -> 'criteria') x where x ->> 'status' = 'disputed') then
    raise exception using errcode = 'PT400', message = 'resolve_conflicting_evidence';
  end if;
  if jsonb_array_length(p_review -> 'screening') <> jsonb_array_length(a.screening_questions) then
    raise exception using errcode = 'PT400', message = 'record_each_screening_question';
  end if;
  for question in select x from jsonb_array_elements(a.screening_questions) x loop
    select count(*) into n from jsonb_array_elements(p_review -> 'screening') x where x ->> 'id' = question ->> 'id';
    if n <> 1 then raise exception using errcode = 'PT400', message = 'record_each_screening_question'; end if;
    select x into answer from jsonb_array_elements(p_review -> 'screening') x where x ->> 'id' = question ->> 'id';
    if answer ->> 'question' is distinct from question ->> 'text' then
      raise exception using errcode = 'PT400', message = 'screening_question_changed';
    end if;
    if jsonb_typeof(answer -> 'answer') is distinct from 'string'
       or jsonb_typeof(answer -> 'quote') is distinct from 'string'
       or jsonb_typeof(answer -> 'reason') is distinct from 'string' then
      raise exception using errcode = 'PT400', message = 'invalid_screening_answer';
    end if;
    if char_length(btrim(coalesce(answer ->> 'question', ''))) not between 1 and 1000
       or char_length(coalesce(answer ->> 'answer', '')) > 10000 then
      raise exception using errcode = 'PT400', message = 'invalid_screening_answer';
    end if;
    if answer -> 'rating' is not null and answer -> 'rating' <> 'null'::jsonb then
      if question ->> 'use' <> 'scored' or jsonb_typeof(answer -> 'rating') is distinct from 'number' or (answer ->> 'rating') !~ '^[1-5]$'
         or char_length(btrim(coalesce(answer ->> 'quote', ''))) = 0
         or char_length(btrim(coalesce(answer ->> 'reason', ''))) = 0
         or position((answer ->> 'quote') in coalesce(answer ->> 'answer', '')) = 0 then
        raise exception using errcode = 'PT400', message = 'screening_rating_needs_answer_quote_and_reason';
      end if;
    end if;
  end loop;
  n := a.revision + 1;
  -- A new review invalidates the summary previously published from this assessment, including any linked screening
  -- summary. The existing client RLS hides paused packages until a recruiter explicitly shares the new reviewed version.
  update public.submission_packages set state = 'paused' where id = a.published_package_id and state = 'published';
  update app_private.scoring_assessments set inputs = p_inputs, review = p_review,
    revision = n, reviewed_revision = n, updated_at = now() where id = a.id;
  insert into app_private.scoring_review_history(assessment_id, revision, actor_user_id, kind, reason, snapshot)
    values (a.id, n, auth.uid(), 'review', btrim(p_reason), jsonb_build_object('inputs', p_inputs, 'review', p_review));
  return n;
end $$;

-- Copies only explicitly reviewed client fields to the portal's existing package/evidence tables.
-- No scores, rubric, screening ratings, internal reasons, CV quotes or original files are exposed to clients.
create function public.recruiter_share_summary(p_id uuid, p_expected_revision integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a app_private.scoring_assessments; s public.submissions; rs public.role_requirement_sets; prior public.submission_packages;
  package_id uuid; next_version integer; row jsonb; mapped jsonb; count_requirements integer;
begin
  perform app_private.require_recruiter();
  select * into a from app_private.scoring_assessments where id = p_id for update;
  if not found then raise exception using errcode = 'PT403', message = 'assessment_unavailable'; end if;
  perform app_private.require_recruiter(a.client_id);
  if p_expected_revision is null or a.revision is distinct from p_expected_revision or a.reviewed_revision is distinct from a.revision then
    raise exception using errcode = 'PT409', message = 'assessment_changed_reload';
  end if;
  if a.published_revision = a.revision then
    raise exception using errcode = 'PT409', message = 'summary_already_shared';
  end if;
  if a.rubric -> 'approved' is distinct from 'true'::jsonb then
    raise exception using errcode = 'PT400', message = 'scoring_rules_await_approval';
  end if;
  if a.review ->> 'decision' is distinct from 'forward'
     or exists (select 1 from jsonb_array_elements(a.inputs -> 'gates') x where x ->> 'result' = 'Fail')
     or exists (select 1 from jsonb_array_elements(a.inputs -> 'criteria') x where x ->> 'status' = 'disputed') then
    raise exception using errcode = 'PT400', message = 'candidate_not_ready_to_share';
  end if;
  select * into s from public.submissions where id = a.submission_id for no key update;
  if s.publication <> 'published' then
    raise exception using errcode = 'PT400', message = 'submission_not_shared';
  end if;
  -- Lock this submission's package history before checking withdrawal, including packages whose state could
  -- change while a recruiter page is open. No recruiter reinstatement workflow or permission exists.
  perform 1 from public.submission_packages p
    where p.submission_id = s.id and p.client_id = a.client_id order by p.version, p.id for update;
  if exists (select 1 from public.submission_packages p
    where p.submission_id = s.id and p.client_id = a.client_id and p.state = 'withdrawn') then
    raise exception using errcode = 'PT409', message = 'client_package_withdrawn';
  end if;
  select * into rs from public.role_requirement_sets where role_id = s.role_id and status = 'agreed' for share;
  if not found or coalesce(a.review ->> 'setId', '') <> rs.id::text then
    raise exception using errcode = 'PT409', message = 'agreed_requirements_changed';
  end if;
  if jsonb_typeof(a.review -> 'evidence') is distinct from 'array' then
    raise exception using errcode = 'PT400', message = 'map_every_agreed_requirement';
  end if;
  select count(*) into count_requirements from public.role_requirements where set_id = rs.id;
  if jsonb_array_length(a.review -> 'evidence') <> count_requirements then
    raise exception using errcode = 'PT400', message = 'map_every_agreed_requirement';
  end if;
  for row in select to_jsonb(q) from public.role_requirements q where q.set_id = rs.id loop
    if (select count(*) from jsonb_array_elements(a.review -> 'evidence') e where e ->> 'requirementId' = row ->> 'id') <> 1 then
      raise exception using errcode = 'PT400', message = 'map_every_agreed_requirement';
    end if;
    select e into mapped from jsonb_array_elements(a.review -> 'evidence') e where e ->> 'requirementId' = row ->> 'id';
    if coalesce(mapped ->> 'status', '') not in ('supported', 'partly_supported', 'not_evidenced', 'confirmed_not_met')
       or char_length(btrim(coalesce(mapped ->> 'evidence', ''))) not between 1 and 1000
       or (mapped ->> 'status' <> 'not_evidenced' and char_length(btrim(coalesce(mapped ->> 'source', ''))) = 0) then
      raise exception using errcode = 'PT400', message = 'review_evidence_and_source_required';
    end if;
  end loop;
  if char_length(btrim(coalesce(a.review ->> 'whyShared', ''))) not between 1 and 2000
     or jsonb_typeof(a.review -> 'strengths') is distinct from 'array'
     or jsonb_typeof(a.review -> 'pointsToClarify') is distinct from 'array' then
    raise exception using errcode = 'PT400', message = 'client_summary_required';
  end if;
  -- These are exactly the packages publish_package would supersede. Identity and requirement-set links alone
  -- cannot establish that their facts/screening remain valid for this review. Refuse before any replacement;
  -- never copy old content or internal screening into a newly published package without that review.
  for prior in select * from public.submission_packages
    where submission_id = s.id and client_id = a.client_id and state in ('published', 'paused')
    order by version, id for update loop
    if prior.key_facts <> '[]'::jsonb then
      raise exception using errcode = 'PT409', message = 'existing_client_content_needs_review';
    end if;
    -- M7 still supports the M3 baseline without the optional M6 screening table.
    if to_regclass('public.screening_summaries') is not null then
      if exists (select 1 from public.screening_summaries ss where ss.package_id = prior.id) then
        raise exception using errcode = 'PT409', message = 'existing_client_content_needs_review';
      end if;
    end if;
  end loop;
  select coalesce(max(version), 0) + 1 into next_version from public.submission_packages where submission_id = s.id;
  insert into public.submission_packages(client_id, submission_id, role_id, requirement_set_id, version, why_shared, strengths, points_to_clarify, key_facts)
    values(a.client_id, s.id, s.role_id, rs.id, next_version, btrim(a.review ->> 'whyShared'),
      array(select jsonb_array_elements_text(a.review -> 'strengths')),
      array(select jsonb_array_elements_text(a.review -> 'pointsToClarify')), '[]') returning id into package_id;
  for mapped in select e from jsonb_array_elements(a.review -> 'evidence') e loop
    insert into public.requirement_evidence(client_id, package_id, requirement_set_id, requirement_id, status, evidence, source_label)
      values(a.client_id, package_id, rs.id, (mapped ->> 'requirementId')::uuid, mapped ->> 'status',
        btrim(mapped ->> 'evidence'), nullif(btrim(mapped ->> 'source'), ''));
  end loop;
  perform app_private.publish_package(package_id);
  update app_private.scoring_assessments set published_revision = revision, published_package_id = package_id where id = a.id;
  insert into app_private.scoring_review_history(assessment_id, revision, actor_user_id, kind, reason, snapshot)
    values(a.id, a.revision, auth.uid(), 'share', 'Explicitly shared the reviewed client summary.',
      jsonb_build_object('packageId', package_id, 'review', a.review));
  return package_id;
end $$;

revoke all on function app_private.require_recruiter(uuid), app_private.check_scoring_inputs(jsonb, jsonb),
  app_private.scoring_assessment_guard(), public.recruiter_account(), public.recruiter_assessments(),
  public.recruiter_assessment(uuid), public.recruiter_save_review(uuid, integer, jsonb, jsonb, text),
  public.recruiter_share_summary(uuid, integer) from public, anon, authenticated;
grant execute on function public.recruiter_account(), public.recruiter_assessments(), public.recruiter_assessment(uuid),
  public.recruiter_save_review(uuid, integer, jsonb, jsonb, text), public.recruiter_share_summary(uuid, integer) to authenticated;
commit;
