-- Milestone 1 access tests for the Supabase SQL Editor (the psql route is m1_access.sql).
-- Needs the fictional seed, the four test users and their three memberships (checks/m1_post_memberships.sql all OK).
-- Fictional data only. Leave the editor's role selector on its default (postgres).
--
-- How it works:
-- * One DO statement, so Postgres runs it as one transaction. Each step switches to the anon or authenticated role with the
--   JWT claims the Data API would set (request.jwt.claims), checks that the switch took effect, then runs one query, so
--   grants and row-level security apply as for real requests.
-- * The last statement raises an error on purpose. That ends the transaction in a rollback: every row the tests wrote
--   (moves, events, idempotency keys) is discarded. An unexpected error rolls back the same way.
-- * The error message is the report: a summary line, then any FAIL lines, then the PASS lines.
-- * [provisional] marks the 2h prototype's stage rules (D3), which are test behaviour, not production approval.
-- Afterwards, checks/m1_post_memberships.sql should still be all OK (15 submissions / 26 events, 0 idempotency keys).
do $test$
declare
  -- Step: who runs it, what it checks, the query (returns one value), and the expected value or 'ERR <sqlstate or message>'.
  -- Fixed ids are the seed's (md5 of a label). Idempotency keys are fixed test values.
  steps text[] := array[
    -- ---------- Before the tests, as the database owner ----------
    ['owner', 'Only the add-only trigger is attached to the application tables (no webhooks or other triggers)',
      $q$select count(*) from pg_trigger t where not t.tgisinternal and t.tgrelid in ('public.clients'::regclass, 'public.client_members'::regclass, 'public.roles'::regclass, 'public.people'::regclass, 'public.submissions'::regclass, 'public.submission_events'::regclass, 'app_private.idempotency_keys'::regclass)$q$, '1'],
    ['owner', 'Row-level security is on for the 7 milestone 1 tables and on every table in public and app_private (later milestones add tables)',
      $q$select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'app_private') and c.relkind in ('r', 'p') and not c.relrowsecurity)
              || '/' || (select count(*) from pg_class c where c.oid in ('public.clients'::regclass, 'public.client_members'::regclass, 'public.roles'::regclass, 'public.people'::regclass,
                         'public.submissions'::regclass, 'public.submission_events'::regclass, 'app_private.idempotency_keys'::regclass) and c.relrowsecurity)$q$, '0/7'],

    -- ---------- Signed out (anon) ----------
    ['anon', 'Signed out: cannot read clients',            $q$select count(*) from public.clients$q$, 'ERR 42501'],
    ['anon', 'Signed out: cannot read memberships',        $q$select count(*) from public.client_members$q$, 'ERR 42501'],
    ['anon', 'Signed out: cannot read roles',              $q$select count(*) from public.roles$q$, 'ERR 42501'],
    ['anon', 'Signed out: cannot read people',             $q$select count(*) from public.people$q$, 'ERR 42501'],
    ['anon', 'Signed out: cannot read submissions',        $q$select count(*) from public.submissions$q$, 'ERR 42501'],
    ['anon', 'Signed out: cannot read history events',     $q$select count(*) from public.submission_events$q$, 'ERR 42501'],
    ['anon', 'Signed out: cannot read idempotency keys',   $q$select count(*) from app_private.idempotency_keys$q$, 'ERR 42501'],
    ['anon', 'Signed out: cannot call the membership helper', $q$select app_private.my_client_id()$q$, 'ERR 42501'],
    ['anon', 'Signed out: cannot write submissions',       $q$insert into public.submissions default values$q$, 'ERR 42501'],
    ['anon', 'Signed out: cannot call client_move_stage',
      $q$select public.client_move_stage(md5('portal-m1:submission:harbor:tb-isl')::uuid, 'Interview', 1, '00000000-0000-4000-8000-000000000099')$q$, 'ERR 42501'],
    ['anon_forged', 'Signed out with a Harbor user id in the claims: still cannot read submissions', $q$select count(*) from public.submissions$q$, 'ERR 42501'],
    ['anon_forged', 'Signed out with a Harbor user id in the claims: still cannot move a stage',
      $q$select public.client_move_stage(md5('portal-m1:submission:harbor:tb-isl')::uuid, 'Interview', 1, '00000000-0000-4000-8000-000000000099')$q$, 'ERR 42501'],

    -- ---------- Signed in but no user id in the claims ----------
    ['auth_no_sub', 'Signed-in role without a user id: sees no clients',     $q$select count(*) from public.clients$q$, '0'],
    ['auth_no_sub', 'Signed-in role without a user id: sees no submissions', $q$select count(*) from public.submissions$q$, '0'],
    ['auth_no_sub', 'Signed-in role without a user id: cannot move a stage',
      $q$select public.client_move_stage(md5('portal-m1:submission:harbor:tb-isl')::uuid, 'Interview', 1, '00000000-0000-4000-8000-000000000099')$q$, 'ERR not_a_client_member'],

    -- ---------- Signed in, no membership ----------
    ['nomember', 'No membership: sees no clients',          $q$select count(*) from public.clients$q$, '0'],
    ['nomember', 'No membership: sees no memberships',      $q$select count(*) from public.client_members$q$, '0'],
    ['nomember', 'No membership: sees no roles',            $q$select count(*) from public.roles$q$, '0'],
    ['nomember', 'No membership: sees no people',           $q$select count(*) from public.people$q$, '0'],
    ['nomember', 'No membership: sees no submissions',      $q$select count(*) from public.submissions$q$, '0'],
    ['nomember', 'No membership: sees no history events',   $q$select count(*) from public.submission_events$q$, '0'],
    ['nomember', 'No membership: belongs to no client',     $q$select coalesce(app_private.my_client_id()::text, 'none')$q$, 'none'],
    ['nomember', 'No membership: cannot read idempotency keys', $q$select count(*) from app_private.idempotency_keys$q$, 'ERR 42501'],
    ['nomember', 'No membership: cannot move a Harbor stage',
      $q$select public.client_move_stage(md5('portal-m1:submission:harbor:tb-isl')::uuid, 'Interview', 1, '00000000-0000-4000-8000-000000000099')$q$, 'ERR not_a_client_member'],
    ['nomember', 'No membership: cannot move a Northwind stage',
      $q$select public.client_move_stage(md5('portal-m1:submission:northwind:n1-ops')::uuid, 'Interview', 1, '00000000-0000-4000-8000-000000000099')$q$, 'ERR not_a_client_member'],

    -- ---------- Inactive Harbor member ----------
    ['harbor_inactive', 'Inactive member: sees no clients',        $q$select count(*) from public.clients$q$, '0'],
    ['harbor_inactive', 'Inactive member: does not see even their own membership', $q$select count(*) from public.client_members$q$, '0'],
    ['harbor_inactive', 'Inactive member: sees no roles',          $q$select count(*) from public.roles$q$, '0'],
    ['harbor_inactive', 'Inactive member: sees no people',         $q$select count(*) from public.people$q$, '0'],
    ['harbor_inactive', 'Inactive member: sees no submissions',    $q$select count(*) from public.submissions$q$, '0'],
    ['harbor_inactive', 'Inactive member: sees no history events', $q$select count(*) from public.submission_events$q$, '0'],
    ['harbor_inactive', 'Inactive member: belongs to no client',   $q$select coalesce(app_private.my_client_id()::text, 'none')$q$, 'none'],
    ['harbor_inactive', 'Inactive member: cannot move a stage',
      $q$select public.client_move_stage(md5('portal-m1:submission:harbor:tb-isl')::uuid, 'Interview', 1, '00000000-0000-4000-8000-000000000099')$q$, 'ERR not_a_client_member'],

    -- ---------- Active Harbor member: reads ----------
    ['harbor', 'Harbor member: belongs to Harbor',          $q$select (app_private.my_client_id() = md5('portal-m1:client:harbor')::uuid)::text$q$, 'true'],
    ['harbor', 'Harbor member: sees only Harbor',           $q$select string_agg(ref, ',') from public.clients$q$, 'harbor'],
    ['harbor', 'Harbor member: sees only their own membership (not the inactive colleague)', $q$select string_agg(display_name, ',') from public.client_members$q$, 'Maria Alvarez (test)'],
    ['harbor', 'Harbor member: sees Harbor''s 4 roles',     $q$select count(*) from public.roles$q$, '4'],
    ['harbor', 'Harbor member: including the on-hold role', $q$select count(*) from public.roles where status = 'On hold'$q$, '1'],
    ['harbor', 'Harbor member: sees the 12 published submissions', $q$select count(*) from public.submissions$q$, '12'],
    ['harbor', 'Unpublished: no unpublished submission is visible', $q$select count(*) from public.submissions where publication <> 'published'$q$, '0'],
    ['harbor', 'Unpublished: Harbor''s unpublished submission is hidden, even by id', $q$select count(*) from public.submissions where id = md5('portal-m1:submission:harbor:zz-isl')::uuid$q$, '0'],
    ['harbor', 'Unpublished: 11 people visible (the one with only an unpublished submission is hidden)', $q$select count(*) from public.people$q$, '11'],
    ['harbor', 'Unpublished: that person is hidden, even by id', $q$select count(*) from public.people where id = md5('portal-m1:person:harbor:zz')::uuid$q$, '0'],
    ['harbor', 'Harbor member: sees the 23 events of published submissions', $q$select count(*) from public.submission_events$q$, '23'],
    ['harbor', 'Unpublished: events of the unpublished submission are hidden', $q$select count(*) from public.submission_events where submission_id = md5('portal-m1:submission:harbor:zz-isl')::uuid$q$, '0'],
    ['harbor', 'Cross-client: Harbor member sees no Northwind rows in any table',
      $q$select (select count(*) from public.clients where id = md5('portal-m1:client:northwind')::uuid)
              + (select count(*) from public.client_members where client_id = md5('portal-m1:client:northwind')::uuid)
              + (select count(*) from public.roles where client_id = md5('portal-m1:client:northwind')::uuid)
              + (select count(*) from public.people where client_id = md5('portal-m1:client:northwind')::uuid)
              + (select count(*) from public.submissions where client_id = md5('portal-m1:client:northwind')::uuid)
              + (select count(*) from public.submission_events where client_id = md5('portal-m1:client:northwind')::uuid)$q$, '0'],
    ['harbor', 'Cross-client: a Northwind submission is hidden, even by id', $q$select count(*) from public.submissions where id = md5('portal-m1:submission:northwind:n1-ops')::uuid$q$, '0'],

    -- ---------- Active Harbor member: no direct writes ----------
    ['harbor', 'Direct write: cannot insert clients',            $q$insert into public.clients default values$q$, 'ERR 42501'],
    ['harbor', 'Direct write: cannot update clients',            $q$update public.clients set name = name$q$, 'ERR 42501'],
    ['harbor', 'Direct write: cannot insert memberships',        $q$insert into public.client_members default values$q$, 'ERR 42501'],
    ['harbor', 'Direct write: cannot reactivate memberships',    $q$update public.client_members set active = true$q$, 'ERR 42501'],
    ['harbor', 'Direct write: cannot delete memberships',        $q$delete from public.client_members$q$, 'ERR 42501'],
    ['harbor', 'Direct write: cannot insert roles',              $q$insert into public.roles default values$q$, 'ERR 42501'],
    ['harbor', 'Direct write: cannot change role status',        $q$update public.roles set status = 'Open'$q$, 'ERR 42501'],
    ['harbor', 'Direct write: cannot insert people',             $q$insert into public.people default values$q$, 'ERR 42501'],
    ['harbor', 'Direct write: cannot delete people',             $q$delete from public.people$q$, 'ERR 42501'],
    ['harbor', 'Direct write: cannot insert submissions',        $q$insert into public.submissions default values$q$, 'ERR 42501'],
    ['harbor', 'Direct write: cannot set a stage directly',      $q$update public.submissions set stage = 'Hired'$q$, 'ERR 42501'],
    ['harbor', 'Direct write: cannot publish submissions',       $q$update public.submissions set publication = 'published'$q$, 'ERR 42501'],
    ['harbor', 'Direct write: cannot delete submissions',        $q$delete from public.submissions$q$, 'ERR 42501'],
    ['harbor', 'Direct write: cannot insert history events',     $q$insert into public.submission_events default values$q$, 'ERR 42501'],
    ['harbor', 'Direct write: cannot edit history events',       $q$update public.submission_events set to_stage = 'Hired'$q$, 'ERR 42501'],
    ['harbor', 'Direct write: cannot delete history events',     $q$delete from public.submission_events$q$, 'ERR 42501'],
    ['harbor', 'Direct write: cannot truncate history events',   $q$truncate public.submission_events$q$, 'ERR 42501'],
    ['harbor', 'Direct write: cannot read idempotency keys',     $q$select count(*) from app_private.idempotency_keys$q$, 'ERR 42501'],
    ['harbor', 'Direct write: cannot insert idempotency keys',   $q$insert into app_private.idempotency_keys default values$q$, 'ERR 42501'],

    -- ---------- Active Harbor member: stage moves (tb-isl starts at To review, version 1) ----------
    ['harbor', 'Move: To review → Interview with the version seen saves the stage and version 2',
      $q$select r->>'stage' || ' v' || (r->>'version') from public.client_move_stage(md5('portal-m1:submission:harbor:tb-isl')::uuid, 'Interview', 1, '00000000-0000-4000-8000-000000000001') r$q$, 'Interview v2'],
    ['harbor', 'Move: it added exactly one history event', $q$select count(*) from public.submission_events where submission_id = md5('portal-m1:submission:harbor:tb-isl')::uuid$q$, '2'],
    ['harbor', 'Duplicate request: same key and request returns the first result',
      $q$select r->>'stage' || ' v' || (r->>'version') from public.client_move_stage(md5('portal-m1:submission:harbor:tb-isl')::uuid, 'Interview', 1, '00000000-0000-4000-8000-000000000001') r$q$, 'Interview v2'],
    ['harbor', 'Duplicate request: and adds no event', $q$select count(*) from public.submission_events where submission_id = md5('portal-m1:submission:harbor:tb-isl')::uuid$q$, '2'],
    ['harbor', 'Duplicate request: same key, different stage is refused',
      $q$select public.client_move_stage(md5('portal-m1:submission:harbor:tb-isl')::uuid, 'Offer', 1, '00000000-0000-4000-8000-000000000001')$q$, 'ERR idempotency_key_reused'],
    ['harbor', 'Duplicate request: same key, same stage but different version is refused',
      $q$select public.client_move_stage(md5('portal-m1:submission:harbor:tb-isl')::uuid, 'Interview', 2, '00000000-0000-4000-8000-000000000001')$q$, 'ERR idempotency_key_reused'],
    ['harbor', 'Stale version: a new request with the old version 1 is refused',
      $q$select public.client_move_stage(md5('portal-m1:submission:harbor:tb-isl')::uuid, 'Offer', 1, '00000000-0000-4000-8000-000000000002')$q$, 'ERR version_conflict'],
    ['harbor', 'Stale version: a version ahead of the current one is refused',
      $q$select public.client_move_stage(md5('portal-m1:submission:harbor:tb-isl')::uuid, 'Offer', 9, '00000000-0000-4000-8000-000000000002')$q$, 'ERR version_conflict'],
    ['harbor', 'Stale version: the refused requests left the stage unchanged', $q$select stage || ' v' || version from public.submissions where id = md5('portal-m1:submission:harbor:tb-isl')::uuid$q$, 'Interview v2'],
    ['harbor', '[provisional] Interview → Offer allowed; a refused request does not use up its key',
      $q$select r->>'stage' || ' v' || (r->>'version') from public.client_move_stage(md5('portal-m1:submission:harbor:tb-isl')::uuid, 'Offer', 2, '00000000-0000-4000-8000-000000000002') r$q$, 'Offer v3'],
    ['harbor', 'Duplicate request: retrying the first request after a later move returns its stored result',
      $q$select r->>'stage' || ' v' || (r->>'version') from public.client_move_stage(md5('portal-m1:submission:harbor:tb-isl')::uuid, 'Interview', 1, '00000000-0000-4000-8000-000000000001') r$q$, 'Interview v2'],
    ['harbor', 'Duplicate request: and does not undo the later move', $q$select stage || ' v' || version from public.submissions where id = md5('portal-m1:submission:harbor:tb-isl')::uuid$q$, 'Offer v3'],
    ['harbor', '[provisional] no move out of Offer (to Hired)',
      $q$select public.client_move_stage(md5('portal-m1:submission:harbor:tb-isl')::uuid, 'Hired', 3, '00000000-0000-4000-8000-000000000003')$q$, 'ERR move_not_permitted'],
    ['harbor', '[provisional] no move out of Offer (back to To review)',
      $q$select public.client_move_stage(md5('portal-m1:submission:harbor:tb-isl')::uuid, 'To review', 3, '00000000-0000-4000-8000-000000000003')$q$, 'ERR move_not_permitted'],
    ['harbor', 'Duplicate request: a key is scoped to its submission (key 1 works on Priya Raman''s submission)',
      $q$select r->>'stage' || ' v' || (r->>'version') from public.client_move_stage(md5('portal-m1:submission:harbor:pr-isl')::uuid, 'Interview', 1, '00000000-0000-4000-8000-000000000001') r$q$, 'Interview v2'],
    ['harbor', '[provisional] Interview → Hired allowed on an open role',
      $q$select r->>'stage' || ' v' || (r->>'version') from public.client_move_stage(md5('portal-m1:submission:harbor:pr-isl')::uuid, 'Hired', 2, '00000000-0000-4000-8000-000000000004') r$q$, 'Hired v3'],
    ['harbor', '[provisional] no move out of Hired',
      $q$select public.client_move_stage(md5('portal-m1:submission:harbor:pr-isl')::uuid, 'Interview', 3, '00000000-0000-4000-8000-000000000005')$q$, 'ERR move_not_permitted'],
    ['harbor', '[provisional] Interview → To review allowed (Samuel Ortiz)',
      $q$select r->>'stage' || ' v' || (r->>'version') from public.client_move_stage(md5('portal-m1:submission:harbor:so-pa')::uuid, 'To review', 2, '00000000-0000-4000-8000-000000000006') r$q$, 'To review v3'],
    ['harbor', '[provisional] To review → Hired allowed directly (Aisha Bello)',
      $q$select r->>'stage' || ' v' || (r->>'version') from public.client_move_stage(md5('portal-m1:submission:harbor:ab-fsr')::uuid, 'Hired', 1, '00000000-0000-4000-8000-000000000007') r$q$, 'Hired v2'],
    ['harbor', '[provisional] To review → Offer allowed directly (Elena Novak)',
      $q$select r->>'stage' || ' v' || (r->>'version') from public.client_move_stage(md5('portal-m1:submission:harbor:en-pa')::uuid, 'Offer', 1, '00000000-0000-4000-8000-000000000008') r$q$, 'Offer v2'],
    ['harbor', 'Not permitted: moving to the current stage (Jordan Ellis, Interview)',
      $q$select public.client_move_stage(md5('portal-m1:submission:harbor:je-isl')::uuid, 'Interview', 2, '00000000-0000-4000-8000-000000000010')$q$, 'ERR move_not_permitted'],
    ['harbor', 'Not permitted: Declined is not a stage move (decline is its own action)',
      $q$select public.client_move_stage(md5('portal-m1:submission:harbor:je-isl')::uuid, 'Declined', 2, '00000000-0000-4000-8000-000000000010')$q$, 'ERR move_not_permitted'],
    ['harbor', 'Not permitted: an unknown stage',
      $q$select public.client_move_stage(md5('portal-m1:submission:harbor:je-isl')::uuid, 'Nope', 2, '00000000-0000-4000-8000-000000000010')$q$, 'ERR move_not_permitted'],
    ['harbor', 'Not permitted: a move from Declined (Marcus Webb)',
      $q$select public.client_move_stage(md5('portal-m1:submission:harbor:mw-isl')::uuid, 'Interview', 2, '00000000-0000-4000-8000-000000000010')$q$, 'ERR move_not_permitted'],
    ['harbor', 'Not permitted: a move on an on-hold role (Taylor Brooks, Regional Sales Manager)',
      $q$select public.client_move_stage(md5('portal-m1:submission:harbor:tb-rsm')::uuid, 'Offer', 2, '00000000-0000-4000-8000-000000000010')$q$, 'ERR move_not_permitted'],
    ['harbor', 'Invalid request: no expected version',
      $q$select public.client_move_stage(md5('portal-m1:submission:harbor:je-isl')::uuid, 'Offer', null, '00000000-0000-4000-8000-000000000010')$q$, 'ERR invalid_request'],
    ['harbor', 'Invalid request: no idempotency key',
      $q$select public.client_move_stage(md5('portal-m1:submission:harbor:je-isl')::uuid, 'Offer', 2, null)$q$, 'ERR invalid_request'],
    ['harbor', 'Unpublished: Harbor''s unpublished submission cannot be moved (reported as not found)',
      $q$select public.client_move_stage(md5('portal-m1:submission:harbor:zz-isl')::uuid, 'Interview', 1, '00000000-0000-4000-8000-000000000010')$q$, 'ERR submission_not_found'],
    ['harbor', 'Cross-client: a Northwind submission cannot be moved (reported as not found)',
      $q$select public.client_move_stage(md5('portal-m1:submission:northwind:n1-ops')::uuid, 'Interview', 1, '00000000-0000-4000-8000-000000000010')$q$, 'ERR submission_not_found'],
    ['harbor', 'A submission id that does not exist is reported the same way',
      $q$select public.client_move_stage('00000000-0000-4000-8000-0000000000ff', 'Interview', 1, '00000000-0000-4000-8000-000000000010')$q$, 'ERR submission_not_found'],
    ['harbor', 'Taylor Brooks''s other submission is unchanged by moves on Inside Sales Leader',
      $q$select stage || ' v' || version from public.submissions where id = md5('portal-m1:submission:harbor:tb-rsm')::uuid$q$, 'Interview v2'],
    ['harbor', 'Harbor member now sees 30 events (23 + 7 moves)', $q$select count(*) from public.submission_events$q$, '30'],

    -- ---------- Active Northwind member ----------
    ['northwind', 'Northwind member: sees only Northwind',           $q$select string_agg(ref, ',') from public.clients$q$, 'northwind'],
    ['northwind', 'Northwind member: sees only their own membership', $q$select string_agg(display_name, ',') from public.client_members$q$, 'Northwind member (test)'],
    ['northwind', 'Northwind member: sees its 1 role',               $q$select count(*) from public.roles$q$, '1'],
    ['northwind', 'Northwind member: sees its 1 published submission', $q$select string_agg(ref, ',') from public.submissions$q$, 'n1-ops'],
    ['northwind', 'Unpublished: Northwind sees 1 person (Casey Lund is hidden)', $q$select string_agg(name, ',') from public.people$q$, 'Robin Hale'],
    ['northwind', 'Unpublished: Northwind sees 1 event (not the unpublished submission''s)', $q$select count(*) from public.submission_events$q$, '1'],
    ['northwind', 'Cross-client: Northwind sees no Harbor rows, including Harbor''s new moves',
      $q$select (select count(*) from public.clients where id = md5('portal-m1:client:harbor')::uuid)
              + (select count(*) from public.client_members where client_id = md5('portal-m1:client:harbor')::uuid)
              + (select count(*) from public.roles where client_id = md5('portal-m1:client:harbor')::uuid)
              + (select count(*) from public.people where client_id = md5('portal-m1:client:harbor')::uuid)
              + (select count(*) from public.submissions where client_id = md5('portal-m1:client:harbor')::uuid)
              + (select count(*) from public.submission_events where client_id = md5('portal-m1:client:harbor')::uuid)$q$, '0'],
    ['northwind', 'Unpublished: Northwind''s unpublished submission cannot be moved',
      $q$select public.client_move_stage(md5('portal-m1:submission:northwind:n2-ops')::uuid, 'Interview', 1, '00000000-0000-4000-8000-000000000020')$q$, 'ERR submission_not_found'],
    ['northwind', 'Cross-client: a Harbor submission cannot be moved, even with its current version',
      $q$select public.client_move_stage(md5('portal-m1:submission:harbor:tb-isl')::uuid, 'To review', 3, '00000000-0000-4000-8000-000000000020')$q$, 'ERR submission_not_found'],
    ['northwind', 'Duplicate request: a key is scoped to its member (Harbor''s key 1 works for Northwind)',
      $q$select r->>'stage' || ' v' || (r->>'version') from public.client_move_stage(md5('portal-m1:submission:northwind:n1-ops')::uuid, 'Interview', 1, '00000000-0000-4000-8000-000000000001') r$q$, 'Interview v2'],
    ['northwind', 'Duplicate request: Northwind''s retry returns its own first result',
      $q$select r->>'stage' || ' v' || (r->>'version') from public.client_move_stage(md5('portal-m1:submission:northwind:n1-ops')::uuid, 'Interview', 1, '00000000-0000-4000-8000-000000000001') r$q$, 'Interview v2'],

    -- ---------- Inactive member again, after the moves ----------
    ['harbor_inactive', 'Inactive member: still sees no events after the moves', $q$select count(*) from public.submission_events$q$, '0'],

    -- ---------- As the database owner: what the moves recorded, and the structural protections ----------
    ['owner', 'Idempotency keys stored: one per successful move (7 Harbor + 1 Northwind)', $q$select count(*) from app_private.idempotency_keys$q$, '8'],
    ['owner', 'Each portal move records the member who made it, from the same client, as a client actor',
      $q$select count(*) filter (where e.actor_kind = 'client' and m.client_id = e.client_id
                                   and m.user_id in (select id from auth.users where lower(email) in ('portal-test-harbor@example.com', 'portal-test-northwind@example.com')))
              || '/' || count(*)
         from public.submission_events e left join public.client_members m on m.id = e.actor_member_id where e.source = 'portal'$q$, '8/8'],
    ['owner', 'Portal moves are dated today (UTC)', $q$select count(*) from public.submission_events where source = 'portal' and occurred_on <> (now() at time zone 'utc')::date$q$, '0'],
    ['owner', 'Every submission''s stage and version equal its latest event, with one event per version',
      $q$select count(*) from public.submissions s
          where s.version <> (select max(e.submission_version) from public.submission_events e where e.submission_id = s.id)
             or s.version <> (select count(*) from public.submission_events e where e.submission_id = s.id)
             or s.stage <> (select e.to_stage from public.submission_events e where e.submission_id = s.id order by e.submission_version desc limit 1)$q$, '0'],
    ['owner', 'Add-only history: events cannot be edited, even by the owner',
      $q$update public.submission_events set to_stage = to_stage where submission_id = md5('portal-m1:submission:harbor:tb-isl')::uuid$q$, 'ERR events_are_append_only'],
    ['owner', 'Audit protection: a member who made moves cannot be deleted while their events exist',
      $q$delete from public.client_members where user_id in (select id from auth.users where lower(email) = 'portal-test-harbor@example.com')$q$, 'ERR 23503'],
    ['owner', 'Cross-client: a submission cannot link to another client''s role',
      $q$insert into public.submissions (client_id, ref, role_id, person_id, stage, shared_on, publication)
         values (md5('portal-m1:client:harbor')::uuid, 'x1', md5('portal-m1:role:northwind:ops')::uuid, md5('portal-m1:person:harbor:zz')::uuid, 'To review', current_date, 'unpublished')$q$, 'ERR 23503'],
    ['owner', 'Cross-client: a submission cannot link to another client''s person',
      $q$insert into public.submissions (client_id, ref, role_id, person_id, stage, shared_on, publication)
         values (md5('portal-m1:client:harbor')::uuid, 'x2', md5('portal-m1:role:harbor:isl')::uuid, md5('portal-m1:person:northwind:n2')::uuid, 'To review', current_date, 'unpublished')$q$, 'ERR 23503'],
    ['owner', 'Cross-client: an event cannot be filed under another client',
      $q$insert into public.submission_events (client_id, submission_id, submission_version, kind, to_stage, occurred_on, actor_kind, source)
         values (md5('portal-m1:client:northwind')::uuid, md5('portal-m1:submission:harbor:tb-isl')::uuid, 50, 'stage_move', 'Hired', current_date, 'revenue_optics', 'seed')$q$, 'ERR 23503'],
    ['owner', 'Cross-client: an event''s actor must be a member of the same client',
      $q$insert into public.submission_events (client_id, submission_id, submission_version, kind, to_stage, occurred_on, actor_kind, actor_member_id, source)
         values (md5('portal-m1:client:harbor')::uuid, md5('portal-m1:submission:harbor:tb-isl')::uuid, 51, 'stage_move', 'Hired', current_date, 'client',
                 (select m.id from public.client_members m join auth.users u on u.id = m.user_id where lower(u.email) = 'portal-test-northwind@example.com'), 'portal')$q$, 'ERR 23503'],
    ['owner', 'Two events cannot share a submission version',
      $q$insert into public.submission_events (client_id, submission_id, submission_version, kind, to_stage, occurred_on, actor_kind, source)
         values (md5('portal-m1:client:harbor')::uuid, md5('portal-m1:submission:harbor:tb-isl')::uuid, 2, 'stage_move', 'Hired', current_date, 'revenue_optics', 'seed')$q$, 'ERR 23505']
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
