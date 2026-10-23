-- Milestone 1 access tests. Run with `npm run db:test:sql` (needs the fictional seed and test users).
-- Each block switches to the anon or authenticated role with the JWT claims the Data API would set, so grants and row-level
-- security apply as for real requests. Results are NOTICE lines starting PASS or FAIL. Everything is rolled back at the end.
\set ON_ERROR_STOP 1
begin;

-- Test users and fixed ids (deterministic, from the seed).
select set_config('t.harbor', coalesce((select id::text from auth.users where email = 'portal-test-harbor@example.com'), ''), true),
       set_config('t.harbor_inactive', coalesce((select id::text from auth.users where email = 'portal-test-harbor-inactive@example.com'), ''), true),
       set_config('t.northwind', coalesce((select id::text from auth.users where email = 'portal-test-northwind@example.com'), ''), true),
       set_config('t.nomember', coalesce((select id::text from auth.users where email = 'portal-test-no-membership@example.com'), ''), true),
       set_config('t.harbor_client', md5('portal-m1:client:harbor')::text, true),
       set_config('t.northwind_client', md5('portal-m1:client:northwind')::text, true),
       set_config('t.k1', gen_random_uuid()::text, true);
do $$ begin
  if '' in (current_setting('t.harbor'), current_setting('t.harbor_inactive'), current_setting('t.northwind'), current_setting('t.nomember')) then
    raise exception 'test users missing: run npm run db:users -- --ensure';
  end if;
end $$;

-- ---------- Signed out (anon) ----------
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare t text;
begin
  foreach t in array array['clients', 'client_members', 'roles', 'people', 'submissions', 'submission_events'] loop
    begin
      execute format('select count(*) from public.%I', t);
      raise notice 'FAIL anon can read public.%', t;
    exception when insufficient_privilege then
      raise notice 'PASS anon cannot read public.%', t;
    end;
  end loop;
  begin
    perform public.client_move_stage(gen_random_uuid(), 'Offer', 1, gen_random_uuid());
    raise notice 'FAIL anon can call client_move_stage';
  exception when insufficient_privilege then
    raise notice 'PASS anon cannot call client_move_stage';
  end;
  begin
    perform 1 from app_private.idempotency_keys;
    raise notice 'FAIL anon can read app_private.idempotency_keys';
  exception when insufficient_privilege then
    raise notice 'PASS anon cannot read app_private.idempotency_keys';
  end;
end $$;
reset role;

-- ---------- Signed in, no membership ----------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.nomember'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare t text; n bigint;
begin
  foreach t in array array['clients', 'client_members', 'roles', 'people', 'submissions', 'submission_events'] loop
    execute format('select count(*) from public.%I', t) into n;
    if n = 0 then raise notice 'PASS signed-in user without a membership sees no rows in %', t;
    else raise notice 'FAIL signed-in user without a membership sees % rows in %', n, t; end if;
  end loop;
  begin
    perform public.client_move_stage(md5('portal-m1:submission:harbor:tb-isl')::uuid, 'Interview', 1, gen_random_uuid());
    raise notice 'FAIL user without a membership could move a stage';
  exception when others then
    if sqlerrm = 'not_a_client_member' then raise notice 'PASS user without a membership cannot move a stage';
    else raise notice 'FAIL user without a membership: unexpected error %', sqlerrm; end if;
  end;
end $$;
reset role;

-- ---------- Inactive Harbor member ----------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.harbor_inactive'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare t text; n bigint;
begin
  foreach t in array array['clients', 'client_members', 'roles', 'people', 'submissions', 'submission_events'] loop
    execute format('select count(*) from public.%I', t) into n;
    if n = 0 then raise notice 'PASS inactive member sees no rows in %', t;
    else raise notice 'FAIL inactive member sees % rows in %', n, t; end if;
  end loop;
  begin
    perform public.client_move_stage(md5('portal-m1:submission:harbor:tb-isl')::uuid, 'Interview', 1, gen_random_uuid());
    raise notice 'FAIL inactive member could move a stage';
  exception when others then
    if sqlerrm = 'not_a_client_member' then raise notice 'PASS inactive member cannot move a stage';
    else raise notice 'FAIL inactive member: unexpected error %', sqlerrm; end if;
  end;
end $$;
reset role;

-- ---------- Harbor member: reads ----------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.harbor'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare n bigint; other uuid := current_setting('t.northwind_client')::uuid;
begin
  select count(*) into n from public.clients;            if n = 1 then raise notice 'PASS Harbor member sees 1 client'; else raise notice 'FAIL Harbor member sees % clients', n; end if;
  select count(*) into n from public.client_members;     if n = 1 then raise notice 'PASS Harbor member sees only their own membership'; else raise notice 'FAIL Harbor member sees % memberships', n; end if;
  select count(*) into n from public.roles;              if n = 4 then raise notice 'PASS Harbor member sees its 4 roles, including the on-hold role'; else raise notice 'FAIL Harbor member sees % roles', n; end if;
  select count(*) into n from public.submissions;        if n = 12 then raise notice 'PASS Harbor member sees the 12 published submissions'; else raise notice 'FAIL Harbor member sees % submissions', n; end if;
  select count(*) into n from public.submissions where publication <> 'published';
  if n = 0 then raise notice 'PASS no unpublished submission is visible'; else raise notice 'FAIL % unpublished submissions visible', n; end if;
  select count(*) into n from public.submissions where ref = 'zz-isl';
  if n = 0 then raise notice 'PASS the unpublished Harbor submission is hidden from a Harbor member'; else raise notice 'FAIL the unpublished Harbor submission is visible'; end if;
  select count(*) into n from public.people;             if n = 11 then raise notice 'PASS Harbor member sees 11 people (the person with only an unpublished submission is hidden)'; else raise notice 'FAIL Harbor member sees % people', n; end if;
  select count(*) into n from public.people where ref = 'zz';
  if n = 0 then raise notice 'PASS the person behind the unpublished submission is hidden'; else raise notice 'FAIL the unpublished person is visible'; end if;
  select count(*) into n from public.submission_events;  if n = 23 then raise notice 'PASS Harbor member sees the 23 events of published submissions'; else raise notice 'FAIL Harbor member sees % events', n; end if;
  select count(*) into n from public.submission_events e where e.submission_id = md5('portal-m1:submission:harbor:zz-isl')::uuid;
  if n = 0 then raise notice 'PASS events of the unpublished submission are hidden'; else raise notice 'FAIL % events of the unpublished submission visible', n; end if;
  select (select count(*) from public.clients where id = other) + (select count(*) from public.roles where client_id = other) + (select count(*) from public.people where client_id = other)
       + (select count(*) from public.submissions where client_id = other) + (select count(*) from public.submission_events where client_id = other) into n;
  if n = 0 then raise notice 'PASS Harbor member sees no Northwind rows in any table'; else raise notice 'FAIL Harbor member sees % Northwind rows', n; end if;
end $$;

-- ---------- Harbor member: no direct writes ----------
do $$
begin
  begin insert into public.clients (ref, name) values ('x', 'x'); raise notice 'FAIL client can insert clients';
  exception when insufficient_privilege then raise notice 'PASS client cannot insert into clients'; end;
  begin update public.submissions set stage = 'Hired'; raise notice 'FAIL client can update submissions';
  exception when insufficient_privilege then raise notice 'PASS client cannot update submissions directly'; end;
  begin insert into public.submission_events (client_id, submission_id, submission_version, kind, to_stage, occurred_on, actor_kind, source)
        values (current_setting('t.harbor_client')::uuid, md5('portal-m1:submission:harbor:tb-isl')::uuid, 99, 'stage_move', 'Hired', current_date, 'client', 'portal');
        raise notice 'FAIL client can insert events';
  exception when insufficient_privilege then raise notice 'PASS client cannot insert events directly'; end;
  begin delete from public.submission_events; raise notice 'FAIL client can delete events';
  exception when insufficient_privilege then raise notice 'PASS client cannot delete events'; end;
  begin update public.client_members set active = true; raise notice 'FAIL client can update memberships';
  exception when insufficient_privilege then raise notice 'PASS client cannot update memberships'; end;
  begin perform 1 from app_private.idempotency_keys; raise notice 'FAIL client can read idempotency keys';
  exception when insufficient_privilege then raise notice 'PASS client cannot read idempotency keys'; end;
end $$;

-- ---------- Harbor member: client_move_stage ----------
do $$
declare
  tb uuid := md5('portal-m1:submission:harbor:tb-isl')::uuid;
  k1 uuid := current_setting('t.k1')::uuid;
  r jsonb; r2 jsonb; n bigint; v int;
begin
  -- A valid move with the version the client saw.
  r := public.client_move_stage(tb, 'Interview', 1, k1);
  if r->>'stage' = 'Interview' and (r->>'version')::int = 2 then raise notice 'PASS move To review → Interview saves the stage and version 2';
  else raise notice 'FAIL move result %', r; end if;
  select count(*) into n from public.submission_events where submission_id = tb;
  if n = 2 then raise notice 'PASS the move added one event'; else raise notice 'FAIL tb-isl has % events', n; end if;

  -- Same key, same request: the first result, nothing new.
  r2 := public.client_move_stage(tb, 'Interview', 1, k1);
  select count(*) into n from public.submission_events where submission_id = tb;
  if r2 = r and n = 2 then raise notice 'PASS repeating the same key and request returns the first result and adds nothing';
  else raise notice 'FAIL retry gave % with % events', r2, n; end if;

  -- Same key, different request: refused.
  begin
    perform public.client_move_stage(tb, 'Offer', 1, k1);
    raise notice 'FAIL reusing a key with a different request was accepted';
  exception when others then
    if sqlerrm = 'idempotency_key_reused' then raise notice 'PASS reusing a key with a different request is refused';
    else raise notice 'FAIL key reuse: unexpected error %', sqlerrm; end if;
  end;

  -- New key, stale version: refused.
  begin
    perform public.client_move_stage(tb, 'Offer', 1, gen_random_uuid());
    raise notice 'FAIL a stale version was accepted';
  exception when others then
    if sqlerrm = 'version_conflict' then raise notice 'PASS a stale version is refused (version_conflict)';
    else raise notice 'FAIL stale version: unexpected error %', sqlerrm; end if;
  end;

  -- PROVISIONAL (2h prototype rule, not production approval): Interview → Offer allowed; no move out of Offer.
  r := public.client_move_stage(tb, 'Offer', 2, gen_random_uuid());
  if r->>'stage' = 'Offer' then raise notice 'PASS [provisional] Interview → Offer allowed'; else raise notice 'FAIL Interview → Offer gave %', r; end if;
  begin
    perform public.client_move_stage(tb, 'Hired', 3, gen_random_uuid());
    raise notice 'FAIL a move out of Offer was accepted';
  exception when others then
    if sqlerrm = 'move_not_permitted' then raise notice 'PASS [provisional] no stage move out of Offer';
    else raise notice 'FAIL move out of Offer: unexpected error %', sqlerrm; end if;
  end;

  -- The same key on a different submission is a separate request.
  r := public.client_move_stage(md5('portal-m1:submission:harbor:pr-isl')::uuid, 'Interview', 1, k1);
  if r->>'stage' = 'Interview' then raise notice 'PASS a key is scoped to its submission (same key works on another submission)';
  else raise notice 'FAIL same key on pr-isl gave %', r; end if;

  -- PROVISIONAL: Interview → Hired allowed on an open role.
  r := public.client_move_stage(md5('portal-m1:submission:harbor:pr-isl')::uuid, 'Hired', 2, gen_random_uuid());
  if r->>'stage' = 'Hired' then raise notice 'PASS [provisional] Interview → Hired allowed'; else raise notice 'FAIL Interview → Hired gave %', r; end if;

  -- Not permitted: on-hold role, ended submissions, same stage, Declined (a separate action) and unknown stages.
  select version into v from public.submissions where ref = 'tb-rsm';
  begin perform public.client_move_stage(md5('portal-m1:submission:harbor:tb-rsm')::uuid, 'Offer', v, gen_random_uuid()); raise notice 'FAIL a move on an on-hold role was accepted';
  exception when others then if sqlerrm = 'move_not_permitted' then raise notice 'PASS no stage move on an on-hold role'; else raise notice 'FAIL on-hold: %', sqlerrm; end if; end;
  select version into v from public.submissions where ref = 'mw-isl';
  begin perform public.client_move_stage(md5('portal-m1:submission:harbor:mw-isl')::uuid, 'Interview', v, gen_random_uuid()); raise notice 'FAIL a move from Declined was accepted';
  exception when others then if sqlerrm = 'move_not_permitted' then raise notice 'PASS no stage move from Declined'; else raise notice 'FAIL declined: %', sqlerrm; end if; end;
  select version into v from public.submissions where ref = 'je-isl';
  begin perform public.client_move_stage(md5('portal-m1:submission:harbor:je-isl')::uuid, 'Interview', v, gen_random_uuid()); raise notice 'FAIL a move to the same stage was accepted';
  exception when others then if sqlerrm = 'move_not_permitted' then raise notice 'PASS no move to the current stage'; else raise notice 'FAIL same stage: %', sqlerrm; end if; end;
  begin perform public.client_move_stage(md5('portal-m1:submission:harbor:je-isl')::uuid, 'Declined', v, gen_random_uuid()); raise notice 'FAIL Declined accepted as a stage move';
  exception when others then if sqlerrm = 'move_not_permitted' then raise notice 'PASS Declined is not a stage move (decline is its own action)'; else raise notice 'FAIL declined move: %', sqlerrm; end if; end;
  begin perform public.client_move_stage(md5('portal-m1:submission:harbor:je-isl')::uuid, 'Nope', v, gen_random_uuid()); raise notice 'FAIL an unknown stage was accepted';
  exception when others then if sqlerrm = 'move_not_permitted' then raise notice 'PASS an unknown stage is refused'; else raise notice 'FAIL unknown stage: %', sqlerrm; end if; end;
  begin perform public.client_move_stage(md5('portal-m1:submission:harbor:je-isl')::uuid, 'Offer', null, gen_random_uuid()); raise notice 'FAIL a request without a version was accepted';
  exception when others then if sqlerrm = 'invalid_request' then raise notice 'PASS a request without a version is refused'; else raise notice 'FAIL missing version: %', sqlerrm; end if; end;

  -- Hidden submissions look the same as missing ones.
  begin perform public.client_move_stage(md5('portal-m1:submission:harbor:zz-isl')::uuid, 'Interview', 1, gen_random_uuid()); raise notice 'FAIL an unpublished submission could be moved';
  exception when others then if sqlerrm = 'submission_not_found' then raise notice 'PASS an unpublished submission cannot be moved (reported as not found)'; else raise notice 'FAIL unpublished: %', sqlerrm; end if; end;
  begin perform public.client_move_stage(md5('portal-m1:submission:northwind:n1-ops')::uuid, 'Interview', 1, gen_random_uuid()); raise notice 'FAIL another client''s submission could be moved';
  exception when others then if sqlerrm = 'submission_not_found' then raise notice 'PASS another client''s submission cannot be moved (reported as not found)'; else raise notice 'FAIL other client: %', sqlerrm; end if; end;

  -- The same person's other submission is untouched.
  select version into v from public.submissions where ref = 'tb-rsm';
  if v = 2 and (select stage from public.submissions where ref = 'tb-rsm') = 'Interview' then raise notice 'PASS Taylor''s Regional Sales Manager submission is unchanged by moves on Inside Sales Leader';
  else raise notice 'FAIL tb-rsm changed: version %', v; end if;
end $$;
reset role;

-- ---------- Northwind member ----------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.northwind'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare n bigint; r jsonb; other uuid := current_setting('t.harbor_client')::uuid;
begin
  select count(*) into n from public.submissions;  if n = 1 then raise notice 'PASS Northwind member sees its 1 published submission'; else raise notice 'FAIL Northwind member sees % submissions', n; end if;
  select count(*) into n from public.people;       if n = 1 then raise notice 'PASS Northwind member sees 1 person'; else raise notice 'FAIL Northwind member sees % people', n; end if;
  select (select count(*) from public.clients where id = other) + (select count(*) from public.roles where client_id = other) + (select count(*) from public.people where client_id = other)
       + (select count(*) from public.submissions where client_id = other) + (select count(*) from public.submission_events where client_id = other) into n;
  if n = 0 then raise notice 'PASS Northwind member sees no Harbor rows, including Harbor''s new events'; else raise notice 'FAIL Northwind member sees % Harbor rows', n; end if;
  -- The Harbor member's key, used by another member, is a separate request.
  r := public.client_move_stage(md5('portal-m1:submission:northwind:n1-ops')::uuid, 'Interview', 1, current_setting('t.k1')::uuid);
  if r->>'stage' = 'Interview' then raise notice 'PASS a key is scoped to its member (another member''s key works for them)'; else raise notice 'FAIL Northwind move gave %', r; end if;
end $$;
reset role;

-- ---------- As the database owner: history, constraints, append-only ----------
do $$
declare n bigint; h uuid := current_setting('t.harbor_client')::uuid; w uuid := current_setting('t.northwind_client')::uuid;
begin
  select count(*) into n from public.submissions s
   where s.version <> (select max(e.submission_version) from public.submission_events e where e.submission_id = s.id)
      or s.version <> (select count(*) from public.submission_events e where e.submission_id = s.id)
      or s.stage <> (select e.to_stage from public.submission_events e where e.submission_id = s.id order by e.submission_version desc limit 1);
  if n = 0 then raise notice 'PASS every submission''s stage and version equal its latest event, with one event per version'; else raise notice 'FAIL % submissions out of step with their events', n; end if;

  select count(*) into n from public.submission_events e join public.client_members m on m.id = e.actor_member_id
   where e.source = 'portal' and e.actor_kind = 'client' and m.user_id::text in (current_setting('t.harbor'), current_setting('t.northwind')) and m.client_id = e.client_id;
  if n = (select count(*) from public.submission_events where source = 'portal') and n = 5 then raise notice 'PASS each portal move records the member who made it, from the same client (5 moves)';
  else raise notice 'FAIL portal moves with a recorded same-client actor: %', n; end if;

  -- Row-level security is on for every application table (set explicitly by the migration, not left to the automatic-RLS helper).
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname in ('public', 'app_private') and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if n = 0 and (select count(*) from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
                where ns.nspname in ('public', 'app_private') and c.relkind in ('r', 'p') and c.relrowsecurity) = 7
  then raise notice 'PASS row-level security is on for all 7 application tables, and no table in public or app_private is without it';
  else raise notice 'FAIL % table(s) in public or app_private without row-level security', n; end if;

  -- Audit protection (and why rollback drops tables before deleting Auth users): a member who made a move cannot be deleted.
  begin delete from public.client_members where user_id::text = current_setting('t.harbor'); raise notice 'FAIL a member who made moves was deleted';
  exception when foreign_key_violation then raise notice 'PASS a member who made moves cannot be deleted while their events exist'; end;
  begin update public.submission_events set to_stage = 'Hired'; raise notice 'FAIL events could be edited';
  exception when others then if sqlerrm = 'events_are_append_only' then raise notice 'PASS events cannot be edited, even by the owner'; else raise notice 'FAIL append-only: %', sqlerrm; end if; end;

  begin
    insert into public.submissions (client_id, ref, role_id, person_id, stage, shared_on, publication)
    values (h, 'x1', md5('portal-m1:role:northwind:ops')::uuid, md5('portal-m1:person:harbor:zz')::uuid, 'To review', current_date, 'unpublished');
    raise notice 'FAIL a Harbor submission was linked to a Northwind role';
  exception when foreign_key_violation then raise notice 'PASS a submission cannot link to another client''s role'; end;
  begin
    insert into public.submissions (client_id, ref, role_id, person_id, stage, shared_on, publication)
    values (h, 'x2', md5('portal-m1:role:harbor:isl')::uuid, md5('portal-m1:person:northwind:n2')::uuid, 'To review', current_date, 'unpublished');
    raise notice 'FAIL a Harbor submission was linked to a Northwind person';
  exception when foreign_key_violation then raise notice 'PASS a submission cannot link to another client''s person'; end;
  begin
    insert into public.submission_events (client_id, submission_id, submission_version, kind, to_stage, occurred_on, actor_kind, source)
    values (w, md5('portal-m1:submission:harbor:tb-isl')::uuid, 50, 'stage_move', 'Hired', current_date, 'revenue_optics', 'seed');
    raise notice 'FAIL an event was filed under another client';
  exception when foreign_key_violation then raise notice 'PASS an event cannot be filed under another client'; end;
  begin
    insert into public.submission_events (client_id, submission_id, submission_version, kind, to_stage, occurred_on, actor_kind, actor_member_id, source)
    values (h, md5('portal-m1:submission:harbor:tb-isl')::uuid, 51, 'stage_move', 'Hired', current_date, 'client',
            (select id from public.client_members where user_id::text = current_setting('t.northwind')), 'portal');
    raise notice 'FAIL a Northwind member was recorded as acting on a Harbor submission';
  exception when foreign_key_violation then raise notice 'PASS an event''s actor must be a member of the same client'; end;
  begin
    insert into public.submission_events (client_id, submission_id, submission_version, kind, to_stage, occurred_on, actor_kind, source)
    values (h, md5('portal-m1:submission:harbor:tb-isl')::uuid, 2, 'stage_move', 'Hired', current_date, 'revenue_optics', 'seed');
    raise notice 'FAIL two events share a version';
  exception when unique_violation then raise notice 'PASS two events cannot share a submission version'; end;
end $$;

rollback;
