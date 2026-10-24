-- Milestone 2 access tests for the Supabase SQL Editor: decline and interview feedback.
-- Needs milestone 1 with the fictional seed, the four test users and their memberships, and milestone 2 applied
-- (checks/m2_post_migration.sql all OK). Fictional data only. Leave the editor's role selector on its default (postgres).
--
-- How it works (as in m1_access_editor.sql): one DO statement; each step switches to the anon or authenticated role with
-- the JWT claims the Data API would set, checks the switch took effect, and runs one query, so grants and row-level
-- security apply as for real requests. The last statement raises an error on purpose: everything the tests wrote
-- (declines, feedback, notes, history, keys, and two role-status changes) is rolled back. The error message is the report.
-- [provisional] marks the development-only action rules (D3), which are test behaviour, not production permissions.
-- Afterwards, checks/m1_post_memberships.sql should still be all OK and client_notes empty.
do $test$
declare
  -- Step: who runs it, what it checks, the query (returns one value), and the expected value or 'ERR <sqlstate or message>'.
  steps text[] := array[
    ['owner', 'Milestone 2 is applied: client_notes exists with row-level security on', $q$select (to_regclass('public.client_notes') is not null and (select relrowsecurity from pg_class where oid = 'public.client_notes'::regclass))::text$q$, 'true'],
    ['anon', 'Signed out: cannot read client notes', $q$select count(*) from public.client_notes$q$, 'ERR 42501'],
    ['anon', 'Signed out: cannot decline', $q$select public.client_decline(md5('portal-m1:submission:harbor:ab-fsr')::uuid, 'x', null, 1, '00000000-0000-4000-8000-000000000099')$q$, 'ERR 42501'],
    ['anon', 'Signed out: cannot give feedback', $q$select public.client_add_feedback(md5('portal-m1:submission:harbor:je-isl')::uuid, null, 'x', 2, '00000000-0000-4000-8000-000000000099')$q$, 'ERR 42501'],
    ['nomember', 'No membership: sees no notes', $q$select count(*) from public.client_notes$q$, '0'],
    ['nomember', 'No membership: cannot decline', $q$select public.client_decline(md5('portal-m1:submission:harbor:ab-fsr')::uuid, 'x', null, 1, '00000000-0000-4000-8000-000000000099')$q$, 'ERR not_a_client_member'],
    ['harbor_inactive', 'Inactive member: cannot decline', $q$select public.client_decline(md5('portal-m1:submission:harbor:ab-fsr')::uuid, 'x', null, 1, '00000000-0000-4000-8000-000000000099')$q$, 'ERR not_a_client_member'],
    ['harbor_inactive', 'Inactive member: cannot give feedback', $q$select public.client_add_feedback(md5('portal-m1:submission:harbor:je-isl')::uuid, null, 'x', 2, '00000000-0000-4000-8000-000000000099')$q$, 'ERR not_a_client_member'],
    ['harbor', 'Validation: a decline needs a note (blank is refused)', $q$select public.client_decline(md5('portal-m1:submission:harbor:ab-fsr')::uuid, '   ', null, 1, '00000000-0000-4000-8000-000000000099')$q$, 'ERR invalid_request'],
    ['harbor', 'Validation: a decline note of more than 1,000 characters is refused', $q$select public.client_decline(md5('portal-m1:submission:harbor:ab-fsr')::uuid, repeat('x', 1001), null, 1, '00000000-0000-4000-8000-000000000099')$q$, 'ERR invalid_request'],
    ['harbor', 'Validation: an unknown reason category is refused', $q$select public.client_decline(md5('portal-m1:submission:harbor:ab-fsr')::uuid, 'x', 'Too expensive', 1, '00000000-0000-4000-8000-000000000099')$q$, 'ERR invalid_request'],
    ['harbor', 'Validation: a request without an idempotency key is refused', $q$select public.client_decline(md5('portal-m1:submission:harbor:ab-fsr')::uuid, 'x', null, 1, null)$q$, 'ERR invalid_request'],
    ['harbor', 'Validation: feedback needs text', $q$select public.client_add_feedback(md5('portal-m1:submission:harbor:je-isl')::uuid, null, '', 2, '00000000-0000-4000-8000-000000000099')$q$, 'ERR invalid_request'],
    ['harbor', 'Validation: an About of more than 120 characters is refused', $q$select public.client_add_feedback(md5('portal-m1:submission:harbor:je-isl')::uuid, repeat('a', 121), 'x', 2, '00000000-0000-4000-8000-000000000099')$q$, 'ERR invalid_request'],
    ['harbor', 'Whitespace: a decline note of only tabs and newlines is refused', $q$select public.client_decline(md5('portal-m1:submission:harbor:ab-fsr')::uuid, E'\t\n', null, 1, '00000000-0000-4000-8000-000000000099')$q$, 'ERR invalid_request'],
    ['harbor', 'Whitespace: a decline note of mixed and Unicode whitespace is refused', $q$select public.client_decline(md5('portal-m1:submission:harbor:ab-fsr')::uuid, E' \t \r\n ' || chr(160) || chr(12288), null, 1, '00000000-0000-4000-8000-000000000099')$q$, 'ERR invalid_request'],
    ['harbor', 'Whitespace: feedback of only whitespace is refused', $q$select public.client_add_feedback(md5('portal-m1:submission:harbor:je-isl')::uuid, null, E'\n\t ', 2, '00000000-0000-4000-8000-000000000099')$q$, 'ERR invalid_request'],
    ['owner', 'Refused requests left nothing: Aisha Bello still To review v1; no notes; no idempotency keys', $q$select (select stage || ' v' || version from public.submissions where id = md5('portal-m1:submission:harbor:ab-fsr')::uuid) || ' / ' || (select count(*) from public.client_notes) || ' / ' || (select count(*) from app_private.idempotency_keys)$q$, 'To review v1 / 0 / 0'],
    ['harbor', 'Unpublished: cannot be declined (reported as not found)', $q$select public.client_decline(md5('portal-m1:submission:harbor:zz-isl')::uuid, 'x', null, 1, '00000000-0000-4000-8000-000000000099')$q$, 'ERR submission_not_found'],
    ['harbor', 'Cross-client: a Northwind submission cannot be declined (not found)', $q$select public.client_decline(md5('portal-m1:submission:northwind:n1-ops')::uuid, 'x', null, 1, '00000000-0000-4000-8000-000000000099')$q$, 'ERR submission_not_found'],
    ['harbor', '[provisional] no decline on an on-hold role (Taylor Brooks, Regional Sales Manager)', $q$select public.client_decline(md5('portal-m1:submission:harbor:tb-rsm')::uuid, 'x', null, 2, '00000000-0000-4000-8000-000000000099')$q$, 'ERR action_not_permitted'],
    ['harbor', '[provisional] no decline once Declined (Marcus Webb)', $q$select public.client_decline(md5('portal-m1:submission:harbor:mw-isl')::uuid, 'x', null, 2, '00000000-0000-4000-8000-000000000099')$q$, 'ERR action_not_permitted'],
    ['harbor', '[provisional] no decline once Hired (Daniel Okafor)', $q$select public.client_decline(md5('portal-m1:submission:harbor:do-rsm')::uuid, 'x', null, 4, '00000000-0000-4000-8000-000000000099')$q$, 'ERR action_not_permitted'],
    ['harbor', '[provisional] no feedback at To review (Aisha Bello)', $q$select public.client_add_feedback(md5('portal-m1:submission:harbor:ab-fsr')::uuid, null, 'x', 1, '00000000-0000-4000-8000-000000000099')$q$, 'ERR action_not_permitted'],
    ['harbor', '[provisional] no feedback once Declined', $q$select public.client_add_feedback(md5('portal-m1:submission:harbor:mw-isl')::uuid, null, 'x', 2, '00000000-0000-4000-8000-000000000099')$q$, 'ERR action_not_permitted'],
    ['harbor', '[provisional] feedback allowed on an on-hold role at Interview; the stage stays, the version goes up', $q$select r->>'stage' || ' v' || (r->>'version') from public.client_add_feedback(md5('portal-m1:submission:harbor:tb-rsm')::uuid, E' \t\n ', 'Regional scope is the open question.', 2, '00000000-0000-4000-8000-0000000000a1') r$q$, 'Interview v3'],
    ['harbor', 'Whitespace: an About of only whitespace is stored as empty (null)', $q$select coalesce(about, 'null') from public.client_notes where submission_id = md5('portal-m1:submission:harbor:tb-rsm')::uuid$q$, 'null'],
    ['owner', '(setup, rolled back) Pricing Analyst set to Closed', $q$update public.roles set status = 'Closed' where id = md5('portal-m1:role:harbor:pa')::uuid returning status$q$, 'Closed'],
    ['harbor', '[provisional] closed role: no decline', $q$select public.client_decline(md5('portal-m1:submission:harbor:so-pa')::uuid, 'x', null, 2, '00000000-0000-4000-8000-000000000099')$q$, 'ERR action_not_permitted'],
    ['harbor', '[provisional] closed role: no feedback (read-only)', $q$select public.client_add_feedback(md5('portal-m1:submission:harbor:so-pa')::uuid, null, 'x', 2, '00000000-0000-4000-8000-000000000099')$q$, 'ERR action_not_permitted'],
    ['owner', '(setup, rolled back) Pricing Analyst open again', $q$update public.roles set status = 'Open' where id = md5('portal-m1:role:harbor:pa')::uuid returning status$q$, 'Open'],
    ['harbor', 'Decline from To review: Declined, version 2', $q$select r->>'stage' || ' v' || (r->>'version') from public.client_decline(md5('portal-m1:submission:harbor:ab-fsr')::uuid, '  Not enough CRM depth.  ', 'Key skills gap', 1, '00000000-0000-4000-8000-0000000000b1') r$q$, 'Declined v2'],
    ['harbor', 'Decline: the note is stored trimmed, with its category', $q$select text || '|' || category from public.client_notes where submission_id = md5('portal-m1:submission:harbor:ab-fsr')::uuid$q$, 'Not enough CRM depth.|Key skills gap'],
    ['harbor', 'Decline: its history entry is a decline to Declined at version 2', $q$select kind || ' ' || to_stage from public.submission_events where submission_id = md5('portal-m1:submission:harbor:ab-fsr')::uuid and submission_version = 2$q$, 'decline Declined'],
    ['harbor', 'Duplicate request: the same key and note return the first result', $q$select r->>'stage' || ' v' || (r->>'version') from public.client_decline(md5('portal-m1:submission:harbor:ab-fsr')::uuid, 'Not enough CRM depth.', 'Key skills gap', 1, '00000000-0000-4000-8000-0000000000b1') r$q$, 'Declined v2'],
    ['harbor', 'Duplicate request: still one note', $q$select count(*) from public.client_notes where submission_id = md5('portal-m1:submission:harbor:ab-fsr')::uuid$q$, '1'],
    ['harbor', 'Duplicate request: the same key with a different note is refused', $q$select public.client_decline(md5('portal-m1:submission:harbor:ab-fsr')::uuid, 'Another reason.', 'Key skills gap', 1, '00000000-0000-4000-8000-0000000000b1')$q$, 'ERR idempotency_key_reused'],
    ['harbor', '[provisional] a second decline is refused (already Declined)', $q$select public.client_decline(md5('portal-m1:submission:harbor:ab-fsr')::uuid, 'x', null, 2, '00000000-0000-4000-8000-0000000000b2')$q$, 'ERR action_not_permitted'],
    ['harbor', 'Stale version: feedback based on version 1 of Jordan Ellis (now 2) is refused', $q$select public.client_add_feedback(md5('portal-m1:submission:harbor:je-isl')::uuid, null, 'x', 1, '00000000-0000-4000-8000-0000000000c1')$q$, 'ERR version_conflict'],
    ['harbor', 'Feedback at Interview: stage unchanged, version 3', $q$select r->>'stage' || ' v' || (r->>'version') from public.client_add_feedback(md5('portal-m1:submission:harbor:je-isl')::uuid, ' General feedback ', E'\n\tStrong on process.\n\nAsk about weekends.  \n', 2, '00000000-0000-4000-8000-0000000000c1') r$q$, 'Interview v3'],
    ['harbor', 'Whitespace: multiline feedback keeps its internal line breaks; only the ends are trimmed; About trimmed', $q$select (text = E'Strong on process.\n\nAsk about weekends.' and about = 'General feedback')::text from public.client_notes where submission_id = md5('portal-m1:submission:harbor:je-isl')::uuid$q$, 'true'],
    ['harbor', 'A stage move based on the version before the feedback is a conflict', $q$select public.client_move_stage(md5('portal-m1:submission:harbor:je-isl')::uuid, 'Offer', 2, '00000000-0000-4000-8000-0000000000c2')$q$, 'ERR version_conflict'],
    ['harbor', '[provisional] the move with the current version works', $q$select r->>'stage' || ' v' || (r->>'version') from public.client_move_stage(md5('portal-m1:submission:harbor:je-isl')::uuid, 'Offer', 3, '00000000-0000-4000-8000-0000000000c2') r$q$, 'Offer v4'],
    ['harbor', '[provisional] decline from Offer', $q$select r->>'stage' || ' v' || (r->>'version') from public.client_decline(md5('portal-m1:submission:harbor:je-isl')::uuid, 'Accepted another offer.', null, 4, '00000000-0000-4000-8000-0000000000c3') r$q$, 'Declined v5'],
    ['harbor', 'Keys are scoped by submission: the decline key works for a move on another submission', $q$select r->>'stage' || ' v' || (r->>'version') from public.client_move_stage(md5('portal-m1:submission:harbor:pr-isl')::uuid, 'Interview', 1, '00000000-0000-4000-8000-0000000000b1') r$q$, 'Interview v2'],
    ['harbor', 'Keys are scoped by action: feedback then decline with the same key on one submission are separate', $q$select r->>'stage' || ' v' || (r->>'version') from public.client_add_feedback(md5('portal-m1:submission:harbor:pr-isl')::uuid, null, 'Good call.', 2, '00000000-0000-4000-8000-0000000000d1') r$q$, 'Interview v3'],
    ['harbor', '... and the decline with that key is its own request', $q$select r->>'stage' || ' v' || (r->>'version') from public.client_decline(md5('portal-m1:submission:harbor:pr-isl')::uuid, 'Role changed.', 'Role requirements changed', 3, '00000000-0000-4000-8000-0000000000d1') r$q$, 'Declined v4'],
    ['owner', '(setup, rolled back) a decline note on the unpublished submission', $q$with u as (update public.submissions set stage = 'Declined', version = 2 where id = md5('portal-m1:submission:harbor:zz-isl')::uuid returning id), e as (insert into public.submission_events (client_id, submission_id, submission_version, kind, to_stage, occurred_on, actor_kind, actor_member_id, source) select md5('portal-m1:client:harbor')::uuid, id, 2, 'decline', 'Declined', current_date, 'client', (select m.id from public.client_members m join auth.users u on u.id = m.user_id where lower(u.email) = 'portal-test-harbor@example.com'), 'portal' from u returning id, submission_id, client_id, actor_member_id) insert into public.client_notes (client_id, submission_id, event_id, kind, text, author_member_id) select client_id, submission_id, id, 'decline', 'Hidden note.', actor_member_id from e returning kind$q$, 'decline'],
    ['harbor', 'Harbor sees its 6 notes on published submissions, not the unpublished one', $q$select count(*) from public.client_notes$q$, '6'],
    ['harbor', 'Direct write: cannot insert notes', $q$insert into public.client_notes default values$q$, 'ERR 42501'],
    ['harbor', 'Direct write: cannot edit notes', $q$update public.client_notes set text = 'changed'$q$, 'ERR 42501'],
    ['harbor', 'Direct write: cannot delete notes', $q$delete from public.client_notes$q$, 'ERR 42501'],
    ['northwind', 'Cross-client: Northwind sees no Harbor notes', $q$select count(*) from public.client_notes$q$, '0'],
    ['northwind', 'Cross-client: Northwind cannot decline a Harbor submission', $q$select public.client_decline(md5('portal-m1:submission:harbor:je-isl')::uuid, 'x', null, 5, '00000000-0000-4000-8000-0000000000e1')$q$, 'ERR submission_not_found'],
    ['northwind', 'Northwind can decline its own (Robin Hale, To review)', $q$select r->>'stage' || ' v' || (r->>'version') from public.client_decline(md5('portal-m1:submission:northwind:n1-ops')::uuid, 'Location does not work.', 'Location or work arrangement', 1, '00000000-0000-4000-8000-0000000000e1') r$q$, 'Declined v2'],
    ['harbor', 'Harbor still sees only its own 6 notes', $q$select count(*) from public.client_notes$q$, '6'],
    ['owner', 'Every submission: version = number of history entries, stage = latest entry''s stage', $q$select count(*) from public.submissions s where s.version <> (select count(*) from public.submission_events e where e.submission_id = s.id) or s.stage <> (select e.to_stage from public.submission_events e where e.submission_id = s.id order by e.submission_version desc limit 1)$q$, '0'],
    ['owner', 'Add-only: notes cannot be edited, even by the owner', $q$update public.client_notes set text = text$q$, 'ERR notes_are_add_only'],
    ['owner', 'One note per history entry', $q$insert into public.client_notes (client_id, submission_id, event_id, kind, text, author_member_id) select client_id, submission_id, event_id, kind, 'Second.', author_member_id from public.client_notes where submission_id = md5('portal-m1:submission:harbor:ab-fsr')::uuid$q$, 'ERR 23505'],
    ['owner', 'Note link: a note cannot point at another submission''s history entry (its own note removed first, inside this step)', $q$delete from public.client_notes where submission_id = md5('portal-m1:submission:harbor:ab-fsr')::uuid; insert into public.client_notes (client_id, submission_id, event_id, kind, text, author_member_id) values (md5('portal-m1:client:harbor')::uuid, md5('portal-m1:submission:harbor:tb-isl')::uuid, (select id from public.submission_events where submission_id = md5('portal-m1:submission:harbor:ab-fsr')::uuid and kind = 'decline'), 'decline', 'x', (select m.id from public.client_members m join auth.users u on u.id = m.user_id where lower(u.email) = 'portal-test-harbor@example.com'))$q$, 'ERR 23503'],
    ['owner', 'Note link: a note cannot have a different kind from its entry', $q$insert into public.client_notes (client_id, submission_id, event_id, kind, text, author_member_id) values (md5('portal-m1:client:harbor')::uuid, md5('portal-m1:submission:harbor:ab-fsr')::uuid, (select id from public.submission_events where submission_id = md5('portal-m1:submission:harbor:ab-fsr')::uuid and submission_version = 1), 'feedback', 'x', (select m.id from public.client_members m join auth.users u on u.id = m.user_id where lower(u.email) = 'portal-test-harbor@example.com'))$q$, 'ERR 23503'],
    ['owner', 'Note link: a note cannot have a different author from its entry (the existing note removed first, inside this step)', $q$delete from public.client_notes where submission_id = md5('portal-m1:submission:harbor:ab-fsr')::uuid; insert into public.client_notes (client_id, submission_id, event_id, kind, text, author_member_id) values (md5('portal-m1:client:harbor')::uuid, md5('portal-m1:submission:harbor:ab-fsr')::uuid, (select id from public.submission_events where submission_id = md5('portal-m1:submission:harbor:ab-fsr')::uuid and kind = 'decline'), 'decline', 'x', (select m.id from public.client_members m join auth.users u on u.id = m.user_id where lower(u.email) = 'portal-test-northwind@example.com'))$q$, 'ERR 23503'],
    ['owner', 'Note link: a note cannot point at another client''s history entry (its own note removed first, inside this step)', $q$delete from public.client_notes where submission_id = md5('portal-m1:submission:harbor:ab-fsr')::uuid; insert into public.client_notes (client_id, submission_id, event_id, kind, text, author_member_id) values (md5('portal-m1:client:northwind')::uuid, md5('portal-m1:submission:harbor:ab-fsr')::uuid, (select id from public.submission_events where submission_id = md5('portal-m1:submission:harbor:ab-fsr')::uuid and kind = 'decline'), 'decline', 'x', (select m.id from public.client_members m join auth.users u on u.id = m.user_id where lower(u.email) = 'portal-test-northwind@example.com'))$q$, 'ERR 23503'],
    ['owner', 'A decline entry must go to Declined', $q$insert into public.submission_events (client_id, submission_id, submission_version, kind, to_stage, occurred_on, actor_kind, actor_member_id, source) values (md5('portal-m1:client:harbor')::uuid, md5('portal-m1:submission:harbor:tb-isl')::uuid, 2, 'decline', 'Offer', current_date, 'client', (select m.id from public.client_members m join auth.users u on u.id = m.user_id where lower(u.email) = 'portal-test-harbor@example.com'), 'portal')$q$, 'ERR 23514'],
    ['owner', 'A decision entry must be a client entry with its member', $q$insert into public.submission_events (client_id, submission_id, submission_version, kind, to_stage, occurred_on, actor_kind, source) values (md5('portal-m1:client:harbor')::uuid, md5('portal-m1:submission:harbor:tb-isl')::uuid, 2, 'feedback', 'To review', current_date, 'revenue_optics', 'portal')$q$, 'ERR 23514']
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
