-- Milestone 6 access tests for the Supabase SQL Editor: client-safe screening summaries.
-- Needs milestones 1-3 with their fictional seeds, the four test users and their memberships, milestone 6 applied and its
-- fictional seed loaded (checks/m6_post_seed.sql all OK). Milestone 4 may be applied or not. Fictional data only. Leave
-- the editor's role selector on its default (postgres). GENERATED; see the step list for what each test checks.
--
-- How it works (as in m1-m4_access_editor.sql): one DO statement; each step switches to the anon or authenticated role
-- with the JWT claims the Data API would set, checks the switch took effect, and runs one query, so grants and row-level
-- security apply as for real requests. The last statement raises an error on purpose: everything the tests changed is
-- rolled back. The error message is the report. Afterwards, checks/m6_post_seed.sql should still be all OK.
do $test$
declare
  -- Step: who runs it, what it checks, the query (returns one value), and the expected value or 'ERR <sqlstate or message>'.
  steps text[] := array[
    ['owner', 'Milestone 6 is applied: screening_summaries with row-level security on', $q$select relrowsecurity from pg_class where oid = 'public.screening_summaries'::regclass$q$, 'true'],
    ['owner', 'Client-safe columns only: no internal notes, transcript, recording, link or score column', $q$select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'screening_summaries' and column_name ~ '(internal|transcript|record|url|link|score|rating|play)'$q$, '0'],
    ['anon', 'Signed out: cannot read summaries', $q$select count(*) from public.screening_summaries$q$, 'ERR 42501'],
    ['nomember', 'No membership: sees no summaries', $q$select count(*) from public.screening_summaries$q$, '0'],
    ['harbor_inactive', 'Inactive member: sees no summaries', $q$select count(*) from public.screening_summaries$q$, '0'],
    ['harbor', 'Harbor: 9 summaries, one per visible package', $q$select count(*) from public.screening_summaries s where exists (select 1 from public.submission_packages p where p.id = s.package_id)$q$, '9'],
    ['harbor', 'Harbor: no Northwind summaries', $q$select count(*) from public.screening_summaries where client_id <> md5('portal-m1:client:harbor')::uuid$q$, '0'],
    ['northwind', 'Northwind: none (its only published package is on superseded requirements)', $q$select count(*) from public.screening_summaries$q$, '0'],
    ['harbor', 'Taylor Brooks (Inside Sales Leader): the reviewed summary, length and moments', $q$select duration_minutes || ' min, ' || jsonb_array_length(key_moments) || ' moments, notes ' || (notes_for_client is not null)::text from public.screening_summaries where package_id = md5('portal-m6:package:harbor:tb-isl')::uuid$q$, '32 min, 4 moments, notes true'],
    ['harbor', 'Read only: cannot add a summary', $q$insert into public.screening_summaries (client_id, package_id, requirement_set_id, call_on, duration_minutes, recruiter_name, summary, key_moments) select p.client_id, p.id, p.requirement_set_id, '2026-09-20', 30, 'Fictional Recruiter', 'Fictional summary.', '[{"minute": 3, "label": "Fictional moment"}]'::jsonb from public.submission_packages p where p.id = md5('portal-m3:package:harbor:je-isl:2')::uuid returning 'saved'$q$, 'ERR 42501'],
    ['harbor', 'Read only: cannot change a summary', $q$update public.screening_summaries set summary = 'Edited.'$q$, 'ERR 42501'],
    ['harbor', 'Read only: cannot delete a summary', $q$delete from public.screening_summaries$q$, 'ERR 42501'],
    ['owner', 'Frozen: a published package''s summary cannot change', $q$update public.screening_summaries set summary = 'Edited.' where package_id = md5('portal-m6:package:harbor:ab-fsr')::uuid$q$, 'ERR package_frozen'],
    ['owner', 'Frozen: a summary cannot be added to a published package (Ben Carter''s, which has none)', $q$insert into public.screening_summaries (client_id, package_id, requirement_set_id, call_on, duration_minutes, recruiter_name, summary, key_moments) select p.client_id, p.id, p.requirement_set_id, '2026-09-20', 30, 'Fictional Recruiter', 'Fictional summary.', '[{"minute": 3, "label": "Fictional moment"}]'::jsonb from public.submission_packages p where p.id = md5('portal-m3:package:harbor:bc-pa:1')::uuid returning 'saved'$q$, 'ERR package_frozen'],
    ['owner', 'One summary per package version', $q$insert into public.screening_summaries (client_id, package_id, requirement_set_id, call_on, duration_minutes, recruiter_name, summary, key_moments) select p.client_id, p.id, p.requirement_set_id, '2026-10-09', 30, 'Fictional Recruiter', 'Fictional summary.', '[{"minute": 3, "label": "Fictional moment"}]'::jsonb from public.submission_packages p where p.id = md5('portal-m6:package:harbor:ab-fsr')::uuid returning 'saved'$q$, 'ERR package_frozen'],
    ['owner', 'Frozen: a summary cannot be added to a superseded package', $q$insert into public.screening_summaries (client_id, package_id, requirement_set_id, call_on, duration_minutes, recruiter_name, summary, key_moments) select p.client_id, p.id, p.requirement_set_id, '2026-10-09', 30, 'Fictional Recruiter', 'Fictional summary.', '[{"minute": 3, "label": "Fictional moment"}]'::jsonb from public.submission_packages p where p.id = md5('portal-m3:package:harbor:ab-fsr:1')::uuid returning 'saved'$q$, 'ERR package_frozen'],
    ['owner', 'Frozen: a published package''s summary cannot be deleted', $q$delete from public.screening_summaries where package_id = md5('portal-m6:package:harbor:ab-fsr')::uuid$q$, 'ERR package_frozen'],
    ['owner', 'Frozen: a summary cannot be moved to another package', $q$update public.screening_summaries set package_id = md5('portal-m3:package:harbor:je-isl:2')::uuid where package_id = md5('portal-m6:package:harbor:je-isl')::uuid$q$, 'ERR screening_keys_are_fixed'],
    ['owner', 'Fictional cleanup without its setting: refused', $q$delete from public.screening_summaries where package_id = md5('portal-m6:package:harbor:cm-rsm')::uuid$q$, 'ERR package_frozen'],
    ['owner', 'Tenant isolation: a summary cannot point to another client''s package', $q$insert into public.screening_summaries (client_id, package_id, requirement_set_id, call_on, duration_minutes, recruiter_name, summary, key_moments) select md5('portal-m1:client:northwind')::uuid, p.id, p.requirement_set_id, '2026-09-20', 30, 'Fictional Recruiter', 'Fictional summary.', '[{"minute": 3, "label": "Fictional moment"}]'::jsonb from public.submission_packages p where p.id = md5('portal-m3:package:harbor:je-isl:2')::uuid returning 'saved'$q$, 'ERR 23503'],
    ['owner', 'Draft package (Jordan Ellis version 2): a summary can be added', $q$insert into public.screening_summaries (client_id, package_id, requirement_set_id, call_on, duration_minutes, recruiter_name, summary, key_moments) select p.client_id, p.id, p.requirement_set_id, '2026-09-20', 30, 'Fictional Recruiter', 'Fictional summary.', '[{"minute": 3, "label": "Fictional moment"}]'::jsonb from public.submission_packages p where p.id = md5('portal-m3:package:harbor:je-isl:2')::uuid returning 'saved'$q$, 'saved'],
    ['owner', 'Draft package: the summary can still be edited', $q$update public.screening_summaries set summary = 'Edited while draft.' where package_id = md5('portal-m3:package:harbor:je-isl:2')::uuid returning summary$q$, 'Edited while draft.'],
    ['harbor', 'A draft package''s summary is not visible', $q$select count(*) from public.screening_summaries where package_id = md5('portal-m3:package:harbor:je-isl:2')::uuid$q$, '0'],
    ['owner', 'Validation: a key moment at or past the end of the call is refused', $q$insert into public.screening_summaries (client_id, package_id, requirement_set_id, call_on, duration_minutes, recruiter_name, summary, key_moments) select p.client_id, p.id, p.requirement_set_id, '2026-09-20', 3, 'Fictional Recruiter', 'Fictional summary.', '[{"minute": 3, "label": "Fictional moment"}]'::jsonb from public.submission_packages p where p.id = md5('portal-m3:package:harbor:je-isl:2')::uuid returning 'saved'$q$, 'ERR 23514'],
    ['owner', 'Validation: key moments must be in increasing order', $q$update public.screening_summaries set key_moments = '[{"minute": 5, "label": "B"}, {"minute": 5, "label": "C"}]' where package_id = md5('portal-m3:package:harbor:je-isl:2')::uuid$q$, 'ERR 23514'],
    ['owner', 'Validation: a minute must be a whole number', $q$update public.screening_summaries set key_moments = '[{"minute": 2.5, "label": "B"}]' where package_id = md5('portal-m3:package:harbor:je-isl:2')::uuid$q$, 'ERR 23514'],
    ['owner', 'Validation: a key moment needs a label, and nothing else', $q$update public.screening_summaries set key_moments = '[{"minute": 2, "label": " "}]' where package_id = md5('portal-m3:package:harbor:je-isl:2')::uuid$q$, 'ERR 23514'],
    ['owner', 'Validation: no extra fields (for example a recording link) in a key moment', $q$update public.screening_summaries set key_moments = '[{"minute": 2, "label": "B", "url": "https://example.com"}]' where package_id = md5('portal-m3:package:harbor:je-isl:2')::uuid$q$, 'ERR 23514'],
    ['owner', 'Validation: a whitespace-only summary is refused', $q$update public.screening_summaries set summary = '   ' where package_id = md5('portal-m3:package:harbor:je-isl:2')::uuid$q$, 'ERR 23514'],
    ['owner', 'Validation: blank notes for the client are refused (null means none shared)', $q$update public.screening_summaries set notes_for_client = '' where package_id = md5('portal-m3:package:harbor:je-isl:2')::uuid$q$, 'ERR 23514'],
    ['owner', 'Validation: the length must be 1-240 minutes', $q$update public.screening_summaries set duration_minutes = 0 where package_id = md5('portal-m3:package:harbor:je-isl:2')::uuid$q$, 'ERR 23514'],
    ['owner', 'Validation: a call date in the future is refused', $q$update public.screening_summaries set call_on = current_date + 1 where package_id = md5('portal-m3:package:harbor:je-isl:2')::uuid$q$, 'ERR screening_call_in_future'],
    ['owner', 'Validation: a call after the candidate was shared is refused', $q$update public.screening_summaries set call_on = (select shared_on + 1 from public.submissions where id = md5('portal-m1:submission:harbor:je-isl')::uuid) where package_id = md5('portal-m3:package:harbor:je-isl:2')::uuid$q$, 'ERR screening_call_after_shared'],
    ['owner', '(setup, rolled back) pause Taylor Brooks'' Inside Sales Leader package', $q$update public.submission_packages set state = 'paused' where id = md5('portal-m6:package:harbor:tb-isl')::uuid returning state$q$, 'paused'],
    ['harbor', 'Paused package: its summary is hidden', $q$select count(*) from public.screening_summaries$q$, '8'],
    ['owner', '(setup, rolled back) withdraw Grace Liu''s package', $q$update public.submission_packages set state = 'withdrawn' where id = md5('portal-m6:package:harbor:gl-rsm')::uuid returning state$q$, 'withdrawn'],
    ['harbor', 'Withdrawn package: its summary is hidden', $q$select count(*) from public.screening_summaries$q$, '7'],
    ['owner', '(setup, rolled back) unpublish Samuel Ortiz''s submission', $q$update public.submissions set publication = 'unpublished' where id = md5('portal-m1:submission:harbor:so-pa')::uuid returning publication$q$, 'unpublished'],
    ['harbor', 'Unpublished submission: its summary is hidden', $q$select count(*) from public.screening_summaries$q$, '6'],
    ['owner', '(setup, rolled back) agree Inside Sales Leader requirements version 2: version 1 is superseded', $q$select 'done' from (select app_private.agree_requirement_set(md5('portal-m3:set:harbor:isl:2')::uuid, current_date)) x$q$, 'done'],
    ['harbor', 'Packages on superseded requirements: their summaries are hidden (Jordan Ellis, Priya Raman)', $q$select count(*) from public.screening_summaries$q$, '4'],
    ['owner', 'Fictional cleanup with its setting (last step, rolled back): a frozen summary can be removed', $q$with d as (delete from public.screening_summaries where package_id = md5('portal-m6:package:harbor:cm-rsm')::uuid and (select set_config('app.m3_fictional_cleanup', 'on', true)) = 'on' returning 1) select count(*) from d$q$, '1']
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
