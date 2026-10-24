# Client Portal V1

The Talent Solutions client portal, rebuilt from the `client-workspace-v1-visual-2h` prototype. It runs in two separate modes: the **demo** (default), the reviewed workspace with fictional local data, where client actions are demo changes saved in this browser and nothing is sent anywhere; and **Supabase mode**, which signs in to the development Supabase project with fictional test accounts. There are no integrations and no deployment.

## Status (checkpoint, 24 Oct 2026)
**Complete and verified on the hosted development project** (fictional data only; baseline restored afterwards: 15 submissions, 26 events, 3 memberships, no portal moves or idempotency keys)
- Demo workspace: shell, Candidates, candidate page with actions, Roles, Hiring progress, persistence. Matches 2h pixel for pixel (`compare:*`). Unchanged by Supabase mode.
- Database milestone 1: tenancy, published/unpublished submissions, versioned stage history, idempotent `client_move_stage`. SQL Editor access tests 123/123, read-only Auth and Data API checks, API stage-change tests with targeted restore. See `supabase/README.md`.
- Supabase mode, sign-in and session (`src/auth/`): invitation-only email and password sign-in, session restore and refresh, sign-out, account changes in other tabs, and the no-access state for the inactive and unassigned accounts. Checked by hand with all four test accounts.
- Supabase mode, database-backed lists (`src/workspace/`): Roles, role pages, Candidates (pipeline and list) and candidate pages read the signed-in member's own data through row-level security. Harbor and Northwind isolation checked by hand, including account switching.
- Supabase mode, stage changes through `client_move_stage`: version sent with each move, one idempotency key per intended move (reused for retries), success only on the server's confirmation followed by a refresh, stale versions reported as conflicts (no silent retry), no answer treated as uncertain with an automatic retry and "Check again" using the same key, and late answers ignored after sign-out or an account change. Checked by hand: a normal move, a two-tab conflict, a provisional Offer, isolation, and Priya Raman's uncertain → Check again → saved path (request blocked in DevTools). Each manual run was recorded by the development test-run recorder and cleaned up with SQL generated from its exact keys.

- Supabase mode, candidate history (read-only): the candidate page's Notes and history tab lists the submission's history from the database, in version order (shown newest first) with dates. "You" only for the signed-in member's own recorded changes; "Client team" for another member or a client change recorded without who made it; "Revenue Optics" for its entries. Missing entries are reported, not invented. Checked by hand: Taylor Brooks, Regional Sales Manager (both entries, their order, the current stage and the on-hold restriction).
- Workspace reads are paginated (keyset by id, until an empty page), so the API's per-request row cap cannot silently truncate lists, counts or history; a page out of order, a failed page or the 200-page safety limit stops the load with an error instead of showing part of it. Pages are separate requests, not one snapshot: a row added during a load may be missed until the next load. Tested offline, including caps below the page size.
- Sign-in: a pending sign-in superseded by another tab's sign-in (or a sign-out) can no longer overwrite the current account; storage-quota failures get their own message. Tested offline, including with the pinned supabase-js.

**Provisional, for development testing only**
- Client moves to Offer and Hired, and the rule behind them (open roles only; no moves out of Offer, Hired or Declined). Not approved for production (decision D3).

**Not connected yet (Supabase mode)**
- Candidate details: summary and "why shared", requirement evidence, strengths and points to clarify, key facts, screening interview, resume, and client notes (history is connected). Role descriptions and requirements. "Waiting on you" and next steps. Hiring progress.
- Decline and interview feedback: shown disabled (no database functions yet).
- Notifications and Manatal: saving a stage notifies nobody and does not update Manatal.

**Development tools**
- `npm run check:auth`: offline browser check of sign-in, lists and stage changes (stand-in Supabase, no network).
- `npm run db:test:offline`: the real migration, seed, row-level security and supabase-js, in memory.
- Development test-run recorder: with `VITE_DEV_RECORD_MOVES=true` in `.env.local`, `npm run dev` records each stage-change request's key, submission, seen version and stage before sending it (`supabase/runs/`, gitignored; no passwords or tokens). `npm run db:ui-moves:restore-sql -- <record>` writes the matching cleanup SQL; it is never run automatically. Off by default and absent from builds.

```
npm install
npm run dev               # http://127.0.0.1:5173/
npm run typecheck
npm run build
npm test                  # reporting and candidate rules, views and empty states
npm run compare:shell     # with the dev server running: the shell vs 2h at 1440×900, light and dark
npm run compare:progress  # with the dev server running: Hiring progress vs 2h at 1280/1440/1920, light and dark
npm run compare:candidates  # with the dev server running: Candidates vs 2h at 1280/1440/1920, light and dark
npm run compare:candidate   # with the dev server running: candidate page and its actions vs 2h, light and dark
npm run compare:roles       # with the dev server running: Roles and role pages vs 2h, before and after actions
npm run check:persistence   # with the dev server running: demo changes across two tabs, and malformed saved data
npm run check:auth          # Supabase sign-in and session states in a browser, fully offline (starts its own server on 5174)
```

The comparisons exit with an error on any unexpected difference. They open 2h read-only from `../client-workspace-v1-visual-2h` and write screenshots and diffs to `compare-output/`. See `ASSUMPTIONS.md` for the decisions made where 2h or the scope documents leave behaviour open.

## Demo mode and Supabase mode
By default the portal is the **demo**: the reviewed fictional workspace, unchanged. Supabase mode is chosen in `.env.local` (copy `.env.example`; gitignored) and needs a restart of `npm run dev`:

```
VITE_PORTAL_MODE=supabase
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<the public key: publishable or legacy anon>
# optional, development only: VITE_DEV_RECORD_MOVES=true (test-run recorder; see Status)
```

Only the public key may go there (everything prefixed `VITE_` is built into the browser bundle; `npm run db:check-secrets` fails on a secret key). In Supabase mode (`src/auth/`):
- Sign-in with email and password, by invitation only: no sign-up and no password reset. The session is saved in this browser, restored on reload and refreshed automatically.
- After sign-in, the user's own membership and client are read (row-level security). An inactive or unassigned account gets one "No workspace access" state: the database deliberately does not tell the browser which of the two it is.
- An active member gets the reviewed shell with the client's name and the member's name and job title, the database-backed Roles and Candidates pages, and stage changes on the candidate page (see Status). Unconnected details are marked as such, never filled in.
- Errors are shown as errors. Nothing ever falls back to the demo's fictional data; a misconfigured Supabase mode shows a configuration error.
- Sign-out, or a different user signing in (including in another tab), clears the account from the screen at once.

## Layout
- `src/styles/`: 2h's colours, base, shell, Hiring progress, Candidates, candidate page and Roles styles, copied verbatim
- `src/components/`: sidebar, top bar, tooltip, toast, icons
- `src/reporting/`: Hiring progress calculations (no React), with tests against 2h's reference numbers and stage-move scenarios
- `src/progress/`: the Hiring progress page and its four charts
- `src/data/`: the fictional dataset from 2h, and the provider every page reads it through (it replays the demo changes saved in this browser)
- `src/domain/`: candidate rules and client actions shared by every page (no React)
- `src/candidates/`: the Candidates page (Pipeline, List) and the candidate page with its actions
- `src/roles/`: the Roles page and role pages
- `src/auth/`: Supabase mode: configuration, session handling (no React), the account read, sign-in and account-state screens
- `src/workspace/`: Supabase mode: workspace data and its state, stage changes (no React), and the database-backed pages
- `scripts/dev/`: the development-only test-run recorder (a Vite dev-server plugin)
- `src/lib/`: dates, hash routing, theme and remembered page controls
