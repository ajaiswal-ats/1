-- Milestone 3 access tests for the Supabase SQL Editor: role descriptions, requirement sets, packages and evidence.
-- Needs milestones 1 and 2 with the fictional seed, the four test users and their memberships, milestone 3 applied and
-- its fictional seed loaded (checks/m3_post_seed.sql all OK). Fictional data only. Leave the editor's role selector on its
-- default (postgres). GENERATED; see the step list for what each test checks.
--
-- How it works (as in m1/m2_access_editor.sql): one DO statement; each step switches to the anon or authenticated role
-- with the JWT claims the Data API would set, checks the switch took effect, and runs one query, so grants and row-level
-- security apply as for real requests. Owner steps check the freeze and publication rules. The last statement raises an
-- error on purpose: everything the tests changed is rolled back. The error message is the report.
-- Afterwards, checks/m3_post_seed.sql should still be all OK.
do $test$
declare
  -- Step: who runs it, what it checks, the query (returns one value), and the expected value or 'ERR <sqlstate or message>'.
  steps text[] := array[
    ['owner', 'Milestone 3 is applied: four tables with row-level security on', $q$select (select count(*) from pg_class where oid in ('public.role_requirement_sets'::regclass, 'public.role_requirements'::regclass, 'public.submission_packages'::regclass, 'public.requirement_evidence'::regclass) and relrowsecurity)::text$q$, '4'],
    ['anon', 'Signed out: cannot read role_requirement_sets', $q$select count(*) from public.role_requirement_sets$q$, 'ERR 42501'],
    ['anon', 'Signed out: cannot read role_requirements', $q$select count(*) from public.role_requirements$q$, 'ERR 42501'],
    ['anon', 'Signed out: cannot read submission_packages', $q$select count(*) from public.submission_packages$q$, 'ERR 42501'],
    ['anon', 'Signed out: cannot read requirement_evidence', $q$select count(*) from public.requirement_evidence$q$, 'ERR 42501'],
    ['anon', 'Signed out: cannot read role descriptions', $q$select count(summary) from public.roles$q$, 'ERR 42501'],
    ['nomember', 'No membership: sees no role_requirement_sets', $q$select count(*) from public.role_requirement_sets$q$, '0'],
    ['nomember', 'No membership: sees no role_requirements', $q$select count(*) from public.role_requirements$q$, '0'],
    ['nomember', 'No membership: sees no submission_packages', $q$select count(*) from public.submission_packages$q$, '0'],
    ['nomember', 'No membership: sees no requirement_evidence', $q$select count(*) from public.requirement_evidence$q$, '0'],
    ['harbor_inactive', 'Inactive member: sees no packages', $q$select count(*) from public.submission_packages$q$, '0'],
    ['harbor_inactive', 'Inactive member: sees no requirement sets', $q$select count(*) from public.role_requirement_sets$q$, '0'],
    ['harbor', 'Harbor: 4 agreed requirement sets, one per role', $q$select count(*) || ' / ' || count(distinct role_id) from public.role_requirement_sets$q$, '4 / 4'],
    ['harbor', 'Harbor: no draft or superseded set (Inside Sales Leader''s draft version 2 is hidden)', $q$select count(*) from public.role_requirement_sets where status <> 'agreed' or version <> 1$q$, '0'],
    ['harbor', 'Harbor: 17 requirements, all of agreed sets', $q$select count(*) from public.role_requirements$q$, '17'],
    ['harbor', 'Harbor: 11 published packages (Daniel Okafor''s withdrawn and paused versions and the unpublished submission''s package are hidden)', $q$select count(*) from public.submission_packages$q$, '11'],
    ['harbor', 'Harbor: 48 evidence rows, all of visible packages', $q$select count(*) from public.requirement_evidence$q$, '48'],
    ['harbor', 'Harbor: Jordan Ellis shows only the published version 1 (the draft version 2 is hidden)', $q$select string_agg(version::text, ',') from public.submission_packages where submission_id = md5('portal-m1:submission:harbor:je-isl')::uuid$q$, '1'],
    ['harbor', 'Harbor: Daniel Okafor has no visible package (withdrawn, then paused)', $q$select count(*) from public.submission_packages where submission_id = md5('portal-m1:submission:harbor:do-rsm')::uuid$q$, '0'],
    ['harbor', 'Harbor: the unpublished submission''s package is hidden', $q$select count(*) from public.submission_packages where submission_id = md5('portal-m1:submission:harbor:zz-isl')::uuid$q$, '0'],
    ['harbor', 'Harbor: an unevidenced row has no source; it is not invented', $q$select count(*) from public.requirement_evidence where status = 'not_evidenced' and source_label is not null$q$, '0'],
    ['harbor', 'Harbor: role description of Inside Sales Leader (summary, 4 responsibilities, job description)', $q$select (summary is not null and cardinality(responsibilities) = 4 and job_description is not null and hold_note is null)::text from public.roles where id = md5('portal-m1:role:harbor:isl')::uuid$q$, 'true'],
    ['harbor', 'Harbor: the on-hold Regional Sales Manager has its hold note', $q$select (hold_note is not null)::text from public.roles where id = md5('portal-m1:role:harbor:rsm')::uuid$q$, 'true'],
    ['harbor', 'Cross-client: Harbor sees no Northwind sets, requirements, packages or evidence', $q$select (select count(*) from public.role_requirement_sets where client_id = md5('portal-m1:client:northwind')::uuid) + (select count(*) from public.role_requirements where client_id = md5('portal-m1:client:northwind')::uuid) + (select count(*) from public.submission_packages where client_id = md5('portal-m1:client:northwind')::uuid) + (select count(*) from public.requirement_evidence where client_id = md5('portal-m1:client:northwind')::uuid)$q$, '0'],
    ['northwind', 'Northwind: only its agreed version 2 (version 1 is superseded)', $q$select string_agg(version::text, ',') from public.role_requirement_sets$q$, '2'],
    ['northwind', 'Northwind: 2 requirements', $q$select count(*) from public.role_requirements$q$, '2'],
    ['northwind', 'Northwind: no visible package (one on superseded requirements, one of an unpublished submission)', $q$select count(*) from public.submission_packages$q$, '0'],
    ['northwind', 'Cross-client: Northwind sees no Harbor content', $q$select (select count(*) from public.role_requirement_sets where client_id = md5('portal-m1:client:harbor')::uuid) + (select count(*) from public.submission_packages where client_id = md5('portal-m1:client:harbor')::uuid) + (select count(*) from public.requirement_evidence where client_id = md5('portal-m1:client:harbor')::uuid)$q$, '0'],
    ['harbor', 'Read only: cannot add a requirement set', $q$insert into public.role_requirement_sets (client_id, role_id, version, label) values (md5('portal-m1:client:harbor')::uuid, md5('portal-m1:role:harbor:isl')::uuid, 9, 'x')$q$, 'ERR 42501'],
    ['harbor', 'Read only: cannot change a package', $q$update public.submission_packages set why_shared = 'x'$q$, 'ERR 42501'],
    ['harbor', 'Read only: cannot delete evidence', $q$delete from public.requirement_evidence$q$, 'ERR 42501'],
    ['harbor', 'Read only: cannot change a role description', $q$update public.roles set summary = 'x'$q$, 'ERR 42501'],
    ['harbor', 'Owner-only: cannot publish a package', $q$select app_private.publish_package(md5('portal-m3:package:harbor:je-isl:2')::uuid)$q$, 'ERR 42501'],
    ['harbor', 'Owner-only: cannot agree requirements', $q$select app_private.agree_requirement_set(md5('portal-m3:set:harbor:isl:2')::uuid, current_date)$q$, 'ERR 42501'],
    ['owner', 'Frozen: a published package''s text cannot change', $q$update public.submission_packages set why_shared = 'Edited.' where id = md5('portal-m3:package:harbor:ab-fsr:1')::uuid$q$, 'ERR package_frozen'],
    ['owner', 'Frozen: a published package''s evidence cannot change', $q$update public.requirement_evidence set evidence = 'Edited.' where package_id = md5('portal-m3:package:harbor:ab-fsr:1')::uuid$q$, 'ERR package_frozen'],
    ['owner', 'Frozen: evidence cannot be added to a published package', $q$insert into public.requirement_evidence (client_id, package_id, requirement_set_id, requirement_id, status, evidence) values (md5('portal-m1:client:harbor')::uuid, md5('portal-m3:package:harbor:ab-fsr:1')::uuid, md5('portal-m3:set:harbor:fsr:1')::uuid, md5('portal-m3:req:harbor:fsr:1:1')::uuid, 'not_evidenced', 'x')$q$, 'ERR package_frozen'],
    ['owner', 'Frozen: a published package''s evidence cannot be deleted', $q$delete from public.requirement_evidence where package_id = md5('portal-m3:package:harbor:ab-fsr:1')::uuid$q$, 'ERR package_frozen'],
    ['owner', 'Frozen: evidence cannot be moved to another package', $q$update public.requirement_evidence set package_id = md5('portal-m3:package:harbor:je-isl:2')::uuid where package_id = md5('portal-m3:package:harbor:tb-isl:1')::uuid$q$, 'ERR evidence_keys_are_fixed'],
    ['owner', 'Frozen: a published package cannot be deleted', $q$delete from public.submission_packages where id = md5('portal-m3:package:harbor:ab-fsr:1')::uuid$q$, 'ERR package_frozen'],
    ['owner', 'Frozen: deleting the submission does not bypass it', $q$delete from public.submissions where id = md5('portal-m1:submission:harbor:ab-fsr')::uuid$q$, 'ERR package_frozen'],
    ['owner', 'Frozen: an agreed requirement cannot change', $q$update public.role_requirements set text = 'Edited' where id = md5('portal-m3:req:harbor:fsr:1:1')::uuid$q$, 'ERR requirements_frozen'],
    ['owner', 'Frozen: a requirement cannot be added to an agreed set', $q$insert into public.role_requirements (client_id, set_id, position, text, tier) values (md5('portal-m1:client:harbor')::uuid, md5('portal-m3:set:harbor:fsr:1')::uuid, 9, 'Extra', 'pref')$q$, 'ERR requirements_frozen'],
    ['owner', 'Frozen: a requirement cannot be moved to another set', $q$update public.role_requirements set set_id = md5('portal-m3:set:harbor:isl:2')::uuid where id = md5('portal-m3:req:harbor:fsr:1:4')::uuid$q$, 'ERR requirement_keys_are_fixed'],
    ['owner', 'Frozen: an agreed set cannot be deleted', $q$delete from public.role_requirement_sets where id = md5('portal-m3:set:harbor:fsr:1')::uuid$q$, 'ERR requirements_frozen'],
    ['owner', 'Rules: a package cannot be created as published', $q$insert into public.submission_packages (client_id, submission_id, role_id, requirement_set_id, version, state, why_shared, published_at) values (md5('portal-m1:client:harbor')::uuid, md5('portal-m1:submission:harbor:ab-fsr')::uuid, md5('portal-m1:role:harbor:fsr')::uuid, md5('portal-m3:set:harbor:fsr:1')::uuid, 9, 'published', 'x', now())$q$, 'ERR package_must_start_as_draft'],
    ['owner', 'Rules: a withdrawn package cannot be published again', $q$select app_private.publish_package(md5('portal-m3:package:harbor:do-rsm:1')::uuid)$q$, 'ERR package_not_publishable'],
    ['owner', 'Rules: a package with incomplete evidence cannot be published (Jordan Ellis draft version 2: 2 of 5)', $q$select app_private.publish_package(md5('portal-m3:package:harbor:je-isl:2')::uuid)$q$, 'ERR evidence_incomplete'],
    ['owner', 'Rules: a package cannot use another role''s requirements', $q$insert into public.submission_packages (client_id, submission_id, role_id, requirement_set_id, version, why_shared) values (md5('portal-m1:client:harbor')::uuid, md5('portal-m1:submission:harbor:ab-fsr')::uuid, md5('portal-m1:role:harbor:fsr')::uuid, md5('portal-m3:set:harbor:isl:1')::uuid, 9, 'x')$q$, 'ERR 23503'],
    ['owner', 'Rules: evidence cannot cite a requirement of another set', $q$insert into public.requirement_evidence (client_id, package_id, requirement_set_id, requirement_id, status, evidence) values (md5('portal-m1:client:harbor')::uuid, md5('portal-m3:package:harbor:je-isl:2')::uuid, md5('portal-m3:set:harbor:isl:1')::uuid, md5('portal-m3:req:harbor:fsr:1:1')::uuid, 'not_evidenced', 'x')$q$, 'ERR 23503'],
    ['owner', 'Rules: a source is required unless the row is unevidenced', $q$insert into public.requirement_evidence (client_id, package_id, requirement_set_id, requirement_id, status, evidence) values (md5('portal-m1:client:harbor')::uuid, md5('portal-m3:package:harbor:je-isl:2')::uuid, md5('portal-m3:set:harbor:isl:1')::uuid, md5('portal-m3:req:harbor:isl:1:3')::uuid, 'supported', 'x')$q$, 'ERR 23514'],
    ['owner', 'Rules: whitespace-only evidence is refused', $q$insert into public.requirement_evidence (client_id, package_id, requirement_set_id, requirement_id, status, evidence) values (md5('portal-m1:client:harbor')::uuid, md5('portal-m3:package:harbor:je-isl:2')::uuid, md5('portal-m3:set:harbor:isl:1')::uuid, md5('portal-m3:req:harbor:isl:1:3')::uuid, 'not_evidenced', E'\t\n')$q$, 'ERR 23514'],
    ['owner', '(setup, rolled back) complete Jordan Ellis'' draft version 2: 3 more evidence rows', $q$with i as (insert into public.requirement_evidence (client_id, package_id, requirement_set_id, requirement_id, status, evidence, source_label) select md5('portal-m1:client:harbor')::uuid, md5('portal-m3:package:harbor:je-isl:2')::uuid, md5('portal-m3:set:harbor:isl:1')::uuid, r.id, 'not_evidenced', 'Not mentioned.', null from public.role_requirements r where r.set_id = md5('portal-m3:set:harbor:isl:1')::uuid and r.position in (3, 4, 5) returning 1) select count(*) from i$q$, '3'],
    ['owner', 'Atomic replacement: publishing version 2 supersedes version 1 in the same transaction', $q$select 'done' from (select app_private.publish_package(md5('portal-m3:package:harbor:je-isl:2')::uuid)) x$q$, 'done'],
    ['harbor', 'Atomic replacement: Harbor now sees exactly one package for Jordan Ellis, version 2', $q$select string_agg(version::text, ',') from public.submission_packages where submission_id = md5('portal-m1:submission:harbor:je-isl')::uuid$q$, '2'],
    ['owner', 'Atomic replacement: version 1 is superseded, not deleted', $q$select state from public.submission_packages where id = md5('portal-m3:package:harbor:je-isl:1')::uuid$q$, 'superseded'],
    ['owner', '(setup, rolled back) a new draft requirement set for Field Sales Representative', $q$with s as (insert into public.role_requirement_sets (id, client_id, role_id, version, label) values (md5('m3-test:set:fsr:2')::uuid, md5('portal-m1:client:harbor')::uuid, md5('portal-m1:role:harbor:fsr')::uuid, 2, 'Version 2 · test') returning id), r as (insert into public.role_requirements (client_id, set_id, position, text, tier) select md5('portal-m1:client:harbor')::uuid, id, 1, 'Test requirement', 'must' from s returning 1) select count(*) from r$q$, '1'],
    ['owner', 'Superseding requirements: agreeing version 2 supersedes version 1', $q$select 'done' from (select app_private.agree_requirement_set(md5('m3-test:set:fsr:2')::uuid, current_date)) x$q$, 'done'],
    ['harbor', 'Superseded requirements hide the package assessed against them (Aisha Bello)', $q$select count(*) from public.submission_packages where submission_id = md5('portal-m1:submission:harbor:ab-fsr')::uuid$q$, '0'],
    ['harbor', 'Superseded requirements: the role shows version 2 only', $q$select string_agg(version::text, ',') from public.role_requirement_sets where role_id = md5('portal-m1:role:harbor:fsr')::uuid$q$, '2'],
    ['owner', '(setup, rolled back) Taylor Brooks, Inside Sales Leader, unpublished', $q$update public.submissions set publication = 'unpublished' where id = md5('portal-m1:submission:harbor:tb-isl')::uuid returning publication$q$, 'unpublished'],
    ['harbor', 'Unpublished submission: its package and evidence are hidden', $q$select (select count(*) from public.submission_packages where submission_id = md5('portal-m1:submission:harbor:tb-isl')::uuid) + (select count(*) from public.requirement_evidence where package_id = md5('portal-m3:package:harbor:tb-isl:1')::uuid)$q$, '0'],
    ['owner', 'Scoring stays separate: no score, rating, weight, confidence, band or percentage column in client-readable tables', $q$select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('roles', 'role_requirement_sets', 'role_requirements', 'submission_packages', 'requirement_evidence') and column_name ~ '(score|rating|weight|confidence|band|percent)'$q$, '0']
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
