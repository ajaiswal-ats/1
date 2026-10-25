-- Milestone 4 access tests for the Supabase SQL Editor: client interviews, offer outcomes and round-linked interview feedback.
-- Needs milestones 1-3 with their fictional seeds, the four test users and their memberships, milestone 4 applied and its
-- fictional seed loaded (checks/m4_post_seed.sql all OK). Fictional data only. Leave the editor's role selector on its
-- default (postgres). GENERATED; see the step list for what each test checks.
--
-- How it works (as in m1/m2/m3_access_editor.sql): one DO statement; each step switches to the anon or authenticated role
-- with the JWT claims the Data API would set, checks the switch took effect, and runs one query, so grants and row-level
-- security apply as for real requests. The last statement raises an error on purpose: everything the tests changed is
-- rolled back. The error message is the report. Afterwards, checks/m4_post_seed.sql should still be all OK.
do $test$
declare
  -- Step: who runs it, what it checks, the query (returns one value), and the expected value or 'ERR <sqlstate or message>'.
  steps text[] := array[
    ['owner', 'Milestone 4 is applied: three tables with row-level security on', $q$select count(*) from pg_class where oid in ('public.client_interviews'::regclass, 'public.offer_outcomes'::regclass, 'public.interview_feedback'::regclass) and relrowsecurity$q$, '3'],
    ['anon', 'Signed out: cannot read client_interviews', $q$select count(*) from public.client_interviews$q$, 'ERR 42501'],
    ['anon', 'Signed out: cannot read offer_outcomes', $q$select count(*) from public.offer_outcomes$q$, 'ERR 42501'],
    ['anon', 'Signed out: cannot read interview_feedback', $q$select count(*) from public.interview_feedback$q$, 'ERR 42501'],
    ['anon', 'Signed out: cannot give interview feedback', $q$select public.client_add_interview_feedback(md5('portal-m1:submission:harbor:tb-rsm')::uuid, md5('portal-m4:interview:harbor:tb-rsm:1')::uuid, null, 'x', 2, '00000000-0000-4000-8000-000000000499')$q$, 'ERR 42501'],
    ['nomember', 'No membership: sees no client_interviews', $q$select count(*) from public.client_interviews$q$, '0'],
    ['nomember', 'No membership: sees no offer_outcomes', $q$select count(*) from public.offer_outcomes$q$, '0'],
    ['nomember', 'No membership: sees no interview_feedback', $q$select count(*) from public.interview_feedback$q$, '0'],
    ['nomember', 'No membership: cannot give interview feedback', $q$select public.client_add_interview_feedback(md5('portal-m1:submission:harbor:tb-rsm')::uuid, md5('portal-m4:interview:harbor:tb-rsm:1')::uuid, null, 'x', 2, '00000000-0000-4000-8000-000000000499')$q$, 'ERR not_a_client_member'],
    ['harbor_inactive', 'Inactive member: sees no interviews', $q$select count(*) from public.client_interviews$q$, '0'],
    ['harbor', 'Harbor: 6 interview rounds and 2 recorded outcomes; no feedback links yet', $q$select (select count(*) from public.client_interviews) || ' / ' || (select count(*) from public.offer_outcomes) || ' / ' || (select count(*) from public.interview_feedback)$q$, '6 / 2 / 0'],
    ['harbor', 'Harbor: no Northwind interviews', $q$select count(*) from public.client_interviews where client_id <> md5('portal-m1:client:harbor')::uuid$q$, '0'],
    ['harbor', 'Harbor: Taylor Brooks (Regional Sales Manager) has one held round without feedback', $q$select string_agg(round || ' ' || status || ' ' || coalesce(feedback_recorded_on::text, 'no feedback'), ',') from public.client_interviews where submission_id = md5('portal-m1:submission:harbor:tb-rsm')::uuid$q$, '1 held no feedback'],
    ['northwind', 'Northwind: round 1 held, round 2 cancelled (the current round)', $q$select string_agg(round || ' ' || status, ',' order by round) from public.client_interviews where submission_id = md5('portal-m1:submission:northwind:n1-ops')::uuid$q$, '1 held,2 cancelled'],
    ['northwind', 'Northwind: no Harbor interviews or outcomes', $q$select (select count(*) from public.client_interviews where client_id = md5('portal-m1:client:harbor')::uuid) + (select count(*) from public.offer_outcomes)$q$, '0'],
    ['harbor', 'Read only: cannot add an interview', $q$insert into public.client_interviews (client_id, submission_id, round, status, as_of_version) values (md5('portal-m1:client:harbor')::uuid, md5('portal-m1:submission:harbor:ab-fsr')::uuid, 1, 'requested', 1)$q$, 'ERR 42501'],
    ['harbor', 'Read only: cannot change an interview', $q$update public.client_interviews set status = 'held'$q$, 'ERR 42501'],
    ['harbor', 'Read only: cannot add an outcome', $q$insert into public.offer_outcomes (client_id, submission_id, status, recorded_on, as_of_version) values (md5('portal-m1:client:harbor')::uuid, md5('portal-m1:submission:harbor:ab-fsr')::uuid, 'offer_made', current_date, 1)$q$, 'ERR 42501'],
    ['harbor', 'Read only: cannot link feedback directly', $q$insert into public.interview_feedback (interview_id, note_id, client_id, submission_id) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid())$q$, 'ERR 42501'],
    ['owner', 'Rounds: a round number must follow the last one', $q$insert into public.client_interviews (client_id, submission_id, round, status, as_of_version) values (md5('portal-m1:client:harbor')::uuid, md5('portal-m1:submission:harbor:tb-rsm')::uuid, 3, 'requested', 1)$q$, 'ERR interview_round_out_of_order'],
    ['owner', 'Rounds: a round cannot start cancelled', $q$insert into public.client_interviews (client_id, submission_id, round, status, as_of_version) values (md5('portal-m1:client:harbor')::uuid, md5('portal-m1:submission:harbor:ab-fsr')::uuid, 1, 'cancelled', 1)$q$, 'ERR interview_must_start_open_or_held'],
    ['owner', 'Rounds: no new round while the current one is open (Samuel Ortiz has round 1 requested)', $q$insert into public.client_interviews (client_id, submission_id, round, status, requested_on, as_of_version) values (md5('portal-m1:client:harbor')::uuid, md5('portal-m1:submission:harbor:so-pa')::uuid, 2, 'requested', current_date, 1)$q$, 'ERR interview_previous_round_open'],
    ['owner', 'Rounds: not even a round added directly as held (Samuel Ortiz, round 1 requested)', $q$insert into public.client_interviews (client_id, submission_id, round, status, held_on, as_of_version) values (md5('portal-m1:client:harbor')::uuid, md5('portal-m1:submission:harbor:so-pa')::uuid, 2, 'held', current_date, 1)$q$, 'ERR interview_previous_round_open'],
    ['owner', 'Rounds: nor after a scheduled round (Jordan Ellis, round 1 scheduled)', $q$insert into public.client_interviews (client_id, submission_id, round, status, held_on, as_of_version) values (md5('portal-m1:client:harbor')::uuid, md5('portal-m1:submission:harbor:je-isl')::uuid, 2, 'held', current_date, 1)$q$, 'ERR interview_previous_round_open'],
    ['owner', 'Rounds: a cancelled round is final', $q$update public.client_interviews set status = 'requested' where id = md5('portal-m4:interview:northwind:n1-ops:2')::uuid$q$, 'ERR interview_cancelled_is_final'],
    ['owner', 'Rounds: a held round''s facts are final', $q$update public.client_interviews set held_on = held_on - 1 where id = md5('portal-m4:interview:harbor:tb-rsm:1')::uuid$q$, 'ERR interview_held_is_final'],
    ['owner', 'Ordering: the database sets as_of_version to the submission''s version (a supplied value is ignored)', $q$with u as (update public.client_interviews set time_text = '10:00 CT', as_of_version = 99 where id = md5('portal-m4:interview:harbor:je-isl:1')::uuid returning as_of_version) select (select as_of_version from u) = (select version from public.submissions where id = md5('portal-m1:submission:harbor:je-isl')::uuid)$q$, 'true'],
    ['owner', 'Outcomes are fixed once recorded', $q$update public.offer_outcomes set recorded_on = recorded_on + 1 where submission_id = md5('portal-m1:submission:harbor:gl-rsm')::uuid$q$, 'ERR outcome_is_fixed'],
    ['harbor', 'General feedback (milestone 2) on Taylor Brooks: saved as a note', $q$select r->>'stage' || ' v' || (r->>'version') from public.client_add_feedback(md5('portal-m1:submission:harbor:tb-rsm')::uuid, null, 'General thoughts.', 2, '00000000-0000-4000-8000-000000000401') r$q$, 'Interview v3'],
    ['harbor', 'General feedback does not complete the round: no link, no recorded feedback', $q$select (select count(*) from public.interview_feedback) || ' / ' || coalesce((select feedback_recorded_on::text from public.client_interviews where id = md5('portal-m4:interview:harbor:tb-rsm:1')::uuid), 'none')$q$, '0 / none'],
    ['harbor', 'Interview feedback for round 1: saved and linked to that round', $q$select r->>'stage' || ' v' || (r->>'version') || ' ' || coalesce((r->>'interview_id' = (md5('portal-m4:interview:harbor:tb-rsm:1')::uuid)::text)::text, 'no round') from public.client_add_interview_feedback(md5('portal-m1:submission:harbor:tb-rsm')::uuid, md5('portal-m4:interview:harbor:tb-rsm:1')::uuid, null, 'Strong on territory planning.', 3, '00000000-0000-4000-8000-000000000402') r$q$, 'Interview v4 true'],
    ['harbor', 'The round now has exactly one linked feedback note', $q$select count(*) from public.interview_feedback where interview_id = md5('portal-m4:interview:harbor:tb-rsm:1')::uuid$q$, '1'],
    ['harbor', 'Repeated request (same key, same feedback): the first result, still one link', $q$select r->>'stage' || ' v' || (r->>'version') || ' ' || coalesce((r->>'interview_id' = (md5('portal-m4:interview:harbor:tb-rsm:1')::uuid)::text)::text, 'no round') from public.client_add_interview_feedback(md5('portal-m1:submission:harbor:tb-rsm')::uuid, md5('portal-m4:interview:harbor:tb-rsm:1')::uuid, null, 'Strong on territory planning.', 3, '00000000-0000-4000-8000-000000000402') r$q$, 'Interview v4 true'],
    ['harbor', 'Repeated key with different feedback is refused', $q$select r->>'stage' || ' v' || (r->>'version') || ' ' || coalesce((r->>'interview_id' = (md5('portal-m4:interview:harbor:tb-rsm:1')::uuid)::text)::text, 'no round') from public.client_add_interview_feedback(md5('portal-m1:submission:harbor:tb-rsm')::uuid, md5('portal-m4:interview:harbor:tb-rsm:1')::uuid, null, 'Different.', 3, '00000000-0000-4000-8000-000000000402') r$q$, 'ERR idempotency_key_reused'],
    ['harbor', 'A general-feedback key cannot be reused to link a round', $q$select r->>'stage' || ' v' || (r->>'version') || ' ' || coalesce((r->>'interview_id' = (md5('portal-m4:interview:harbor:tb-rsm:1')::uuid)::text)::text, 'no round') from public.client_add_interview_feedback(md5('portal-m1:submission:harbor:tb-rsm')::uuid, md5('portal-m4:interview:harbor:tb-rsm:1')::uuid, null, 'General thoughts.', 2, '00000000-0000-4000-8000-000000000401') r$q$, 'ERR idempotency_key_reused'],
    ['harbor', 'A completed round takes no more interview feedback', $q$select r->>'stage' || ' v' || (r->>'version') || ' ' || coalesce((r->>'interview_id' = (md5('portal-m4:interview:harbor:tb-rsm:1')::uuid)::text)::text, 'no round') from public.client_add_interview_feedback(md5('portal-m1:submission:harbor:tb-rsm')::uuid, md5('portal-m4:interview:harbor:tb-rsm:1')::uuid, null, 'Strong on territory planning.', 4, '00000000-0000-4000-8000-000000000403') r$q$, 'ERR action_not_permitted'],
    ['owner', 'A linked round cannot also get recorded feedback', $q$update public.client_interviews set feedback_recorded_on = held_on where id = md5('portal-m4:interview:harbor:tb-rsm:1')::uuid$q$, 'ERR interview_feedback_already_linked'],
    ['harbor', 'A scheduled round takes no interview feedback (Jordan Ellis)', $q$select r->>'stage' || ' v' || (r->>'version') || ' ' || coalesce((r->>'interview_id' = (md5('portal-m4:interview:harbor:je-isl:1')::uuid)::text)::text, 'no round') from public.client_add_interview_feedback(md5('portal-m1:submission:harbor:je-isl')::uuid, md5('portal-m4:interview:harbor:je-isl:1')::uuid, null, 'Strong on territory planning.', 2, '00000000-0000-4000-8000-000000000404') r$q$, 'ERR action_not_permitted'],
    ['harbor', 'A round with feedback recorded by Revenue Optics takes no more (Chris Morgan)', $q$select r->>'stage' || ' v' || (r->>'version') || ' ' || coalesce((r->>'interview_id' = (md5('portal-m4:interview:harbor:cm-rsm:1')::uuid)::text)::text, 'no round') from public.client_add_interview_feedback(md5('portal-m1:submission:harbor:cm-rsm')::uuid, md5('portal-m4:interview:harbor:cm-rsm:1')::uuid, null, 'Strong on territory planning.', 2, '00000000-0000-4000-8000-000000000405') r$q$, 'ERR action_not_permitted'],
    ['harbor', 'Cross-client: a Northwind round cannot be used (reported as not found)', $q$select r->>'stage' || ' v' || (r->>'version') || ' ' || coalesce((r->>'interview_id' = (md5('portal-m4:interview:northwind:n1-ops:1')::uuid)::text)::text, 'no round') from public.client_add_interview_feedback(md5('portal-m1:submission:northwind:n1-ops')::uuid, md5('portal-m4:interview:northwind:n1-ops:1')::uuid, null, 'Strong on territory planning.', 1, '00000000-0000-4000-8000-000000000406') r$q$, 'ERR submission_not_found'],
    ['harbor', 'A round of another submission cannot be used (not found)', $q$select r->>'stage' || ' v' || (r->>'version') || ' ' || coalesce((r->>'interview_id' = (md5('portal-m4:interview:harbor:tb-rsm:1')::uuid)::text)::text, 'no round') from public.client_add_interview_feedback(md5('portal-m1:submission:harbor:tb-isl')::uuid, md5('portal-m4:interview:harbor:tb-rsm:1')::uuid, null, 'Strong on territory planning.', 1, '00000000-0000-4000-8000-000000000407') r$q$, 'ERR submission_not_found'],
    ['northwind', 'Cancelled newer round: the older held round''s feedback is not reactivated', $q$select r->>'stage' || ' v' || (r->>'version') || ' ' || coalesce((r->>'interview_id' = (md5('portal-m4:interview:northwind:n1-ops:1')::uuid)::text)::text, 'no round') from public.client_add_interview_feedback(md5('portal-m1:submission:northwind:n1-ops')::uuid, md5('portal-m4:interview:northwind:n1-ops:1')::uuid, null, 'Strong on territory planning.', 1, '00000000-0000-4000-8000-000000000408') r$q$, 'ERR action_not_permitted'],
    ['owner', '(setup, rolled back) Chris Morgan: round 2 requested', $q$insert into public.client_interviews (id, client_id, submission_id, round, status, requested_on, as_of_version) values (md5('m4-test:cm:2')::uuid, md5('portal-m1:client:harbor')::uuid, md5('portal-m1:submission:harbor:cm-rsm')::uuid, 2, 'requested', current_date, 1) returning round$q$, '2'],
    ['owner', '(setup, rolled back) round 2 held', $q$update public.client_interviews set status = 'held', held_on = current_date where id = md5('m4-test:cm:2')::uuid returning status$q$, 'held'],
    ['harbor', 'Interview feedback for the new round 2 is linked to round 2, not round 1', $q$select r->>'stage' || ' v' || (r->>'version') || ' ' || coalesce((r->>'interview_id' = (md5('m4-test:cm:2')::uuid)::text)::text, 'no round') from public.client_add_interview_feedback(md5('portal-m1:submission:harbor:cm-rsm')::uuid, md5('m4-test:cm:2')::uuid, null, 'Strong on territory planning.', 2, '00000000-0000-4000-8000-000000000409') r$q$, 'Interview v3 true'],
    ['owner', '(setup, rolled back) Priya Raman (To review): a held round 1', $q$insert into public.client_interviews (id, client_id, submission_id, round, status, held_on, as_of_version) values (md5('m4-test:pr:1')::uuid, md5('portal-m1:client:harbor')::uuid, md5('portal-m1:submission:harbor:pr-isl')::uuid, 1, 'held', current_date, 1) returning status$q$, 'held'],
    ['harbor', '[provisional] milestone 2''s feedback rule still applies on top of the round: no feedback at To review', $q$select r->>'stage' || ' v' || (r->>'version') || ' ' || coalesce((r->>'interview_id' = (md5('m4-test:pr:1')::uuid)::text)::text, 'no round') from public.client_add_interview_feedback(md5('portal-m1:submission:harbor:pr-isl')::uuid, md5('m4-test:pr:1')::uuid, null, 'Strong on territory planning.', 1, '00000000-0000-4000-8000-000000000410') r$q$, 'ERR action_not_permitted'],
    ['harbor', 'The refused request left nothing: Priya Raman still To review v1, no link', $q$select (select stage || ' v' || version from public.submissions where id = md5('portal-m1:submission:harbor:pr-isl')::uuid) || ' / ' || (select count(*) from public.interview_feedback where interview_id = md5('m4-test:pr:1')::uuid)$q$, 'To review v1 / 0']
  ];
  s text[];
  who text := '';
  want_role text;
  want_sub uuid;
  users jsonb;
  got text;
  results text[] := '{}';
  fails text[] := '{}';
  n_pass int := 0;
begin
  -- Test users, looked up as the owner before any role switch.
  select jsonb_object_agg(lower(email), id) into users from auth.users
   where lower(email) in ('portal-test-harbor@example.com', 'portal-test-harbor-inactive@example.com',
                          'portal-test-northwind@example.com', 'portal-test-no-membership@example.com');
  if users is null or (select count(*) from jsonb_object_keys(users)) <> 4 then
    raise exception 'SETUP FAILED: the four test users were not found (nothing was changed)';
  end if;
  if current_user <> session_user then
    raise exception 'SETUP FAILED: started as % instead of the database owner; set the editor role to postgres (nothing was changed)', current_user;
  end if;

  foreach s slice 1 in array steps loop
    -- Switch role and claims when the step's user changes, then prove the switch took effect.
    if s[1] <> who then
      who := s[1];
      execute 'set local role none';
      want_role := case when who = 'owner' then session_user::text when who like 'anon%' then 'anon' else 'authenticated' end;
      want_sub := case who when 'anon_forged' then (users->>'portal-test-harbor@example.com')::uuid
                           when 'nomember' then (users->>'portal-test-no-membership@example.com')::uuid
                           when 'harbor_inactive' then (users->>'portal-test-harbor-inactive@example.com')::uuid
                           when 'harbor' then (users->>'portal-test-harbor@example.com')::uuid
                           when 'northwind' then (users->>'portal-test-northwind@example.com')::uuid end;
      if who = 'owner' then
        perform set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claim.role', '', true);
      else
        perform set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('sub', want_sub, 'role', want_role, 'aud', want_role))::text, true),
                set_config('request.jwt.claim.sub', coalesce(want_sub::text, ''), true),
                set_config('request.jwt.claim.role', want_role, true);
        execute format('set local role %I', want_role);
      end if;
      if current_user::text <> want_role or auth.uid() is distinct from want_sub then
        raise exception 'SETUP FAILED: switching to % gave role % and user id % (nothing was changed)', who, current_user, coalesce(auth.uid()::text, 'none');
      end if;
    end if;

    -- Run the step. Each step is its own savepoint: a refused request leaves nothing behind; a successful one stays
    -- until the final rollback.
    begin
      if s[4] like 'ERR %' then
        execute s[3];
        got := 'allowed';
      else
        execute s[3] into got;
        got := coalesce(got, 'null');
      end if;
    exception when others then
      got := case when substr(s[4], 5) in (sqlstate, sqlerrm) then s[4] else 'error ' || sqlstate || ' ' || sqlerrm end;
    end;

    if got = s[4] then
      n_pass := n_pass + 1;
      results := results || format('PASS  %s', s[2]);
    else
      fails := fails || format('FAIL  %s — expected %s, got %s', s[2], s[4], got);
    end if;
  end loop;

  execute 'set local role none';
  -- Deliberate error: ends the transaction in a rollback, so none of the test changes are kept.
  raise exception using message = format(E'ACCESS TESTS: %s passed, %s failed, %s total. ROLLED BACK: this error is deliberate and no test change was kept.\n%s',
      n_pass, cardinality(fails), array_length(steps, 1), array_to_string(fails || results, E'\n'));
end
$test$;
