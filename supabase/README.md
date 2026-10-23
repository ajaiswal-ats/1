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
