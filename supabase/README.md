# Hosted development database (milestone 1)

The existing, empty hosted Supabase project is the **development** database. **Fictional data only:** no real candidate data, no Manatal, no plan changes. Nothing here is used by the frontend yet. The browser app still runs on its local fictional data.

## Files
| File | What it is |
|---|---|
| `migrations/20261023120000_m1_tenancy_stage_events.sql` | the milestone 1 schema, access rules and `client_move_stage` |
| `rollback/20261023120000_m1_down.sql` | removes everything the migration created |
| `seed/m1_fictional.sql` | fictional rows; generated from `src/data/fixtures.ts` by `npm run db:seed:generate` |
| `tests/m1_access.sql` | database-level access tests as `anon` and `authenticated`; rolled back after running |
| `../tests/db/api.test.mjs` | the same rules through the hosted Data API and Auth, as signed-out and signed-in test users |
| `.env.example` | the setting names; copy to `.env.dev.local` (gitignored) |

## Keys and settings
- Put the values in `supabase/.env.dev.local` on this machine. **Never paste them into chat, commit them, or use a `VITE_` name.** The scripts refuse to run if a setting starts with `VITE_`.
- `SUPABASE_DB_URL` and `SUPABASE_SERVICE_ROLE_KEY` are privileged. Only the Node and psql scripts in `scripts/db` use them, and they are never printed (the database password goes to psql through environment variables, not the command line).
- `npm run db:check-secrets` (after `npm run build`) fails if a privileged value or setting name appears in `src/`, `index.html` or `dist/`.
- Use the **Session pooler** connection string. It works without the paid IPv4 add-on.

## Steps
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
