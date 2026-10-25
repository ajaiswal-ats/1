# Hosted development database (milestone 1)

The existing, empty hosted Supabase project is the **development** database. **Fictional data only:** no real candidate data, no Manatal, no plan changes. Nothing here is used by the frontend yet. The browser app still runs on its local fictional data.

## Files
| File | What it is |
|---|---|
| `migrations/20261023120000_m1_tenancy_stage_events.sql` | the milestone 1 schema, access rules and `client_move_stage` |
| `rollback/20261023120000_m1_down.sql` | removes everything the migration created |
| `seed/m1_fictional.sql` | first-time fictional seed, inserts only; refuses to run if the tables already have rows |
| `seed/m1_reset_fictional.sql` | reset between test runs: deletes and re-inserts the two fictional clients' roles, people, submissions and history (keeps clients and memberships) |
| `seed/m1_remove_fictional.sql` | full cleanup: deletes the two fictional clients and everything under them |
| `checks/m1_post_seed.sql` | read-only counts after seeding |
| `seed/m1_memberships.sql` | insert-only: the three test memberships (guarded, one transaction) |
| `checks/m1_post_memberships.sql` | read-only: who belongs to which client after the memberships |
| `tests/m1_access_editor.sql` | access tests for the SQL Editor: one DO statement that switches roles and JWT claims per step and ends in a deliberate error, so every test change is rolled back; the error message is the PASS/FAIL report |
| `../scripts/db/api-moves.mjs` | API stage-change tests with the four test users; writes a run record and its targeted restore SQL (never runs it) |
| `../scripts/db/api-read.mjs` | read-only Auth and Data API checks with the four test users (public key and real sessions only) |
| `checks/m1_test_users.sql` | read-only: the four test users exist, are confirmed and have no membership yet |
| `tests/m1_access.sql` | database-level access tests as `anon` and `authenticated`; rolled back after running |
| `../tests/db/api.test.mjs` | the same rules through the hosted Data API and Auth, as signed-out and signed-in test users |
| `.env.example` | the setting names; copy to `.env.dev.local` (gitignored) |

## Keys and settings
- Put the values in `supabase/.env.dev.local` on this machine. **Never paste them into chat, commit them, or use a `VITE_` name.** The scripts refuse to run if a setting starts with `VITE_`.
- `SUPABASE_DB_URL` and `SUPABASE_SERVICE_ROLE_KEY` are privileged. Only the Node and psql scripts in `scripts/db` use them, and they are never printed (the database password goes to psql through environment variables, not the command line).
- `npm run db:check-secrets` (after `npm run build`) fails if a privileged value or setting name appears in `src/`, `index.html` or `dist/`.
- Use the **Session pooler** connection string. It works without the paid IPv4 add-on.

## Manual route (SQL Editor): the current approach
No connection string is stored on this machine; each step is pasted into the Supabase SQL Editor by you, after approval.
1. `checks/verify-empty-project.sql`: read-only. Every row OK. The reviewed automatic-RLS helper (`public.rls_auto_enable`) is reported on its own row and kept.
2. `migrations/20261023120000_m1_tenancy_stage_events.sql`: the whole file, run once. It is one transaction (`begin` … `commit`).
3. `checks/m1_post_migration.sql`: read-only. Every row OK, including row-level security on all 7 application tables.
4. `seed/m1_fictional.sql` (approved separately), then `checks/m1_post_seed.sql`: every row OK.
5. The four test users, created in Authentication → Users → Add user → Create new user (auto-confirm; never SQL into `auth.users`), then `checks/m1_test_users.sql`: every row OK.
6. `seed/m1_memberships.sql` (approved separately), then `checks/m1_post_memberships.sql`: every row OK. (`checks/m1_post_seed.sql` now reports 3 memberships instead of 0; that is expected.)
7. `tests/m1_access_editor.sql` (approved separately): the report should read `0 failed`. Then `checks/m1_post_memberships.sql` again: still all OK, which shows nothing was kept.
8. Read-only Auth and Data API checks with the four existing test users: `npm run db:api:read` prints the plan; `npm run db:api:read -- --confirm` runs it (after approval). See below.

**Read-only API checks (`scripts/db/api-read.mjs`).** Uses `SUPABASE_URL` and the public `SUPABASE_ANON_KEY` from `.env.dev.local` only; it refuses a secret or service-role key and never reads the database connection or service key. Passwords are typed at hidden prompts (nothing stored) or read from `supabase/.env.test-users.local` (template `supabase/.env.test-users.example`; gitignored, must be `chmod 600`). Passwords, tokens and the key are never printed. It signs in each user, makes GET requests only, and signs every session out at the end, even after a failure. It does not change application data, but Auth keeps its own records, which no rollback removes: each user's last sign-in time, the sessions (closed again by the sign-out), audit-log entries for the sign-ins, one deliberate wrong-password attempt and the sign-outs, request logs (paths, status, IP address; no passwords or tokens), and the sign-in rate-limit count (5 sign-ins per run).

**API stage-change tests (`scripts/db/api-moves.mjs`, after separate approval).** Same settings, keys and password handling as the read-only checks. `npm run db:api:moves` prints the plan; `npm run db:api:moves -- --confirm` runs it. A pre-flight read stops it before any move unless the targets are at the seed baseline with no portal moves. The moves are real and kept: at most `ab-fsr`, `en-pa` and `pr-isl` change stage and version, with 3 portal events and 3 idempotency keys; every other request must be refused. Before the first move it writes a run record to `supabase/runs/` (gitignored; run id, request keys, target ids, baseline stage/version/updated_at, responses; no secrets), updates it after every request, and finally writes `<record>.restore.sql` beside it. It never runs the restore.

**Restoring after a run.** Review `supabase/runs/<record>.restore.sql`, then run it yourself in the SQL Editor. It deletes only the idempotency keys made by that run's request keys and the events those keys point to, and puts the affected submissions back to their recorded baseline (including updated_at). It refuses and changes nothing if anything else has changed (a later or unrelated portal move or key, an edit outside the portal action, or altered history). It works for partial runs (requests without an answer are found by their key) and is safe to run again. If it refuses, do not fall back to a reset without a separate decision. Regenerate it from a record with `npm run db:api:moves -- --restore-sql supabase/runs/<record>.json`. Offline tests of the whole flow, against an in-memory Postgres: `npm run db:test:offline`.

**Manual UI stage-change tests (Supabase mode in the browser).** Set `VITE_DEV_RECORD_MOVES=true` in `.env.local` and restart `npm run dev`; the dev server prints the run's record file (`supabase/runs/ui-moves-….json`). Before each request the browser records its exact idempotency key, submission, the version and stage the user saw, and the target stage (no passwords or tokens); if that fails, nothing is sent. Afterwards, `npm run db:ui-moves:restore-sql -- supabase/runs/ui-moves-….json` writes the cleanup SQL beside the record, with the same refusal rules as the API runs: any portal move or key not among the recorded keys, including a later move on the same candidates, makes it refuse. Review it and run it yourself. Set the flag back to `false` afterwards.

**Rollback (manual):** paste `rollback/20261023120000_m1_down.sql` (one transaction), then run `checks/verify-empty-project.sql` again: it should be back to empty, with only the helper. If fictional test users were created by then, delete them afterwards (Authentication → Users, or `npm run db:users -- --delete`). Deleting them earlier fails for members who made moves; that is the audit protection.

## Scripted route (needs a local connection string; not in use)
1. `npm run db:verify`: **read-only.**
   - Checks that the project reference in the URL and in the connection string match. Confirm it against the dashboard.
   - Checks that the project has no application schemas, tables, functions, policies, auth users, storage buckets, files or migration history.
   - All queries run in a read-only transaction.
2. **After approval:** `npm run db:apply -- --confirm`.
   - Repeats step 1.
   - Applies the migration in one transaction; any error leaves the database unchanged.
   - Loads the fictional seed.
   - Creates the four fictional test users (`portal-test-…@example.com`, marked `portal_test_user`) and their memberships.
3. `npm run db:test:sql`: the database-level tests, rolled back after running.
4. `npm run db:test:api`: the API tests. These make real moves, so they reset the fictional seed before and after.

## Rollback
```
npm run db:rollback -- --confirm    # 1) drops everything from the migration in one transaction, 2) then deletes the fictional test users from Auth
npm run db:verify                   # should report the project as empty again
```
**Why this order:** each stage event records the member who made it, and that link deliberately blocks deleting a member who has acted. Deleting an Auth user also deletes their membership, so the users must go after the tables.

**If it stops part-way:**
- Step 1 is one database transaction. If it fails, nothing changed (and no Auth user was touched); run it again.
- Step 2 is one Auth request per user, not a transaction. If it stops, the database is already clean and some test users remain. Finish with `npm run db:users -- --delete`, which deletes only the marked test users still present.
- Without a service role key, step 1 runs and step 2 is skipped with that same instruction.

- `npm run db:seed` resets only the fictional rows.
- `npm run db:users -- --delete` removes only the test users. Before rollback it fails for members who made moves; that is the audit protection.

## Not in milestone 1
- packages, evidence, documents, notes, the outbox;
- paused and withdrawn states;
- sign-in screens; the frontend data source;
- Manatal, Fireflies, scoring.

Offer and Hired moves follow the 2h prototype rule as **provisional test behaviour**, not production approval (D3 in `docs/backend-plan.md`).

**Migration history.** The migration is applied with psql, not with `supabase db push`, so Supabase's migration history table stays empty. If the Supabase CLI is adopted later, record this migration as already applied (`supabase migration repair --status applied 20261023120000`) before pushing new ones.


## Milestone 2: decline and interview feedback (applied to the hosted development project, 24 Oct 2026)
Files: `migrations/20261025120000_m2_decline_feedback.sql`, `rollback/20261025120000_m2_down.sql`, `checks/m2_post_migration.sql`, `tests/m2_access_editor.sql`.

**Manual order (after approval):** run `checks/m1_post_memberships.sql` (all OK), then the migration (one transaction; it stops, changing nothing, unless milestone 1 is exactly as expected), then `checks/m2_post_migration.sql` (all OK), then `tests/m2_access_editor.sql` (rolled back; the report should read `0 failed`). `tests/m1_access_editor.sql` still passes with milestone 2 applied.

**What it adds:** history entries of kind `decline` and `feedback` (client entries with their member); `client_notes`, each tied by one composite key to its own history entry (same submission, client, kind and author), add-only, readable only within the client and on published submissions, with no direct writes; and `client_decline` / `client_add_feedback`, with the same idempotency, version and isolation rules as `client_move_stage`. Feedback keeps the stage and raises the version.

**Development-only rules (not production permissions, D3):** decline on an open role from To review, Interview or Offer; feedback on an open or on-hold role at Interview or Offer (a stand-in for an interview record); closed roles, Hired and Declined: neither. Optional decline categories (2h's list) with a mandatory note; any active client member may act; notes are visible to the whole client team.

**Rollback:** `rollback/20261025120000_m2_down.sql` refuses while any decline or feedback exists; restore the baseline first. Run milestone 1's rollback only after it.

**Cleanup after a recorded UI test:** as for stage moves (`npm run db:ui-moves:restore-sql -- <record>`). The generated SQL now also deletes the run's notes (only those linked to the run's keys) and refuses on any note or decision not made by the run, including later ones on the same candidates. The record never contains note or feedback text.

**Integration boundaries kept open (Manatal):**
- Stage ownership between Manatal and the portal is unresolved: nothing here forbids a later, reviewed sync from adding history entries (for example with a new `source`); the action rules apply to client actions only.
- A later sync's de-duplication must keep repeated legitimate transitions (Interview → To review → Interview): the match id plus a stage alone is not enough. See `manatal/FEASIBILITY-CHECKLIST.md`, step 2.
- Portal decisions are immutable and carry no delivery status; any future delivery to Manatal is tracked separately (D4). Saving a decision does not update Manatal, and the UI says so.

## Milestone 3: role descriptions, requirement sets and candidate summaries (applied and seeded on the hosted development project, 25 Oct 2026; access tests 63/63; post-seed check all OK)
Files: `migrations/20261026120000_m3_requirements_packages.sql`, `rollback/20261026120000_m3_down.sql`, `checks/m3_post_migration.sql`, `seed/m3_fictional.sql`, `checks/m3_post_seed.sql`, `tests/m3_access_editor.sql`, `seed/m3_remove_fictional.sql`. The seed files are generated (`npm run db:seed:generate:m3`, from `src/data/fixtures.ts` plus labelled fictional test text; counts in `seed/m3_counts.json`).

**Manual order (after approval):** `checks/m2_post_migration.sql` (all OK), then the migration (one transaction; it stops, changing nothing, unless milestone 2 is exactly as expected), then `checks/m3_post_migration.sql` (all OK), then `seed/m3_fictional.sql`, then `checks/m3_post_seed.sql` (all OK), then `tests/m3_access_editor.sql` (rolled back; the report should read `63 passed, 0 failed`). The milestone 1 and 2 access tests still pass with milestone 3 applied and seeded. There are no client writes in this milestone, so no recorded UI run or cleanup is needed for a read-only check.

**What it adds:** four nullable description columns on `roles` (not versioned: fictional development only; production approval and versioning remain open); `role_requirement_sets` (draft, agreed, superseded) and `role_requirements`; `submission_packages` (draft, published, paused, withdrawn, superseded) and `requirement_evidence` (one row per requirement; a source is required except for unevidenced rows and is never invented). Clients read only; no client functions. No score, rating, weight, confidence or band anywhere.

**Who sees what:** an active member of the row's client sees the role's agreed set and its requirements, and a submission's package only when it is published, the submission is published, and its set is still the role's agreed set. Agreeing a new set hides packages assessed against the old one until they are re-reviewed (fictional development rule). The Summary tab then says "No summary is currently shared for this candidate."

**Freeze rules (all roles, including the owner):** sets and packages start as drafts; an agreed set's requirements and a non-draft package's content and evidence cannot be inserted into, changed, moved to another parent or deleted, and deleting the submission, role or client does not bypass this. Publishing needs an agreed set and complete evidence. One published package per submission and one agreed set per role are deferred exclusion constraints; `app_private.publish_package` and `app_private.agree_requirement_set` (owner only) replace atomically and lock the submission or role first. The guards read parents as the owner and share-lock them, so a concurrent writer cannot overtake a check. PGlite tests every ordering one after the other; lock waits between real concurrent sessions are not exercised offline.

**Fictional cleanup (separate and explicit):** `seed/m3_remove_fictional.sql` removes all milestone 3 content of the two fictional clients and clears their role descriptions, using a transaction-local setting honoured only for the table owner and only for those two clients. Run it before `seed/m1_reset_fictional.sql`, `seed/m1_remove_fictional.sql` or the rollback: frozen content blocks them otherwise.

**Rollback:** `rollback/20261026120000_m3_down.sql` refuses while any milestone 3 content exists; after the cleanup it restores milestone 2 exactly (tested). Milestone 2's rollback now refuses while milestone 3 is applied.

**Frontend:** Supabase mode reads milestone 3 when present. Without it, the role page and Summary tab keep their "not connected" text. A partly applied milestone 3, a refused or failed read, or inconsistent rows (for example a missing evidence row) stop the load with an error. Sources are shown as plain text.

## Milestone 4: client interviews, offer outcomes and round-linked feedback (applied and seeded on the hosted development project, verified 25 Oct 2026 IST; access tests 48/48; post-seed check all OK)
Files: `migrations/20261027120000_m4_interviews_outcomes.sql`, `rollback/20261027120000_m4_down.sql`, `checks/m4_post_migration.sql`, `seed/m4_fictional.sql`, `checks/m4_post_seed.sql`, `tests/m4_access_editor.sql`, `seed/m4_remove_fictional.sql`. The seed files are generated (`npm run db:seed:generate:m4`, from `src/data/fixtures.ts` plus labelled fictional rows; counts in `seed/m4_counts.json`).

**Manual order (after approval):** `checks/m3_post_seed.sql` (all OK), then the migration, then `checks/m4_post_migration.sql` (all OK), then `seed/m4_fictional.sql`, then `checks/m4_post_seed.sql` (all OK), then `tests/m4_access_editor.sql` (rolled back; `48 passed, 0 failed`). The milestone 1-3 access tests still pass with milestone 4 applied and seeded.

**What it adds:** `client_interviews` (rounds 1, 2, ... per submission: requested, scheduled, held or cancelled; dates only when recorded), `offer_outcomes` (offer made or accepted, recorded by Revenue Optics; separate from the Offer and Hired stages), `interview_feedback` (portal feedback linked to one round), and `client_add_interview_feedback`. Clients read their own client's rows on published submissions; Revenue Optics records the facts (the owner, through the seed, in this milestone).

**Rules:**
- **The current round** is the highest round, whatever its status: a cancelled newer round is current, so an older round's missing feedback is not reactivated. One requested or scheduled round at a time, and a new round (even one added directly as held) only after the current round is held or cancelled; held and cancelled rounds are final.
- **Feedback completes a round only when linked to it:** recorded on the round by Revenue Optics, or given in the portal through `client_add_interview_feedback` for that round (current, held, not yet completed). General feedback (`client_add_feedback`) stays a note. Nothing is matched by date. The function uses milestone 2's provisional feedback rule unchanged (D3) and the same idempotency key as milestone 2 feedback, so recorded-run cleanup works unchanged.
- **Ordering without invented time:** every fact carries `as_of_version`, set by the database to the submission's version when the fact is recorded (the submission row is share-locked, so a concurrent client change is clearly before or after it). A client change with a higher version came after the fact. Recording a fact does not change the submission's version. The seed records every fact as of the current version, because the fixtures describe the state after all their history.
- **Next steps and "Waiting on you" are derived in the portal** (`src/workspace/next.ts`), never stored, with the same permission rules as the action controls.

**Fictional cleanup:** `seed/m4_remove_fictional.sql` removes all milestone 4 rows of the two fictional clients (round-linked feedback stays as an ordinary note). Milestone 4 rows are not frozen and go with their submissions.

**Rollback:** `rollback/20261027120000_m4_down.sql` refuses while rows exist; after the cleanup it restores milestone 3 exactly (tested). Milestone 3's rollback now refuses while milestone 4 is applied.
