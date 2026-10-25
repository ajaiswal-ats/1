# Client Portal V1

**Delivery checklist (25 Oct 2026):** `../akansha-task-checklist.md` is the single active queue for portal delivery, Manatal integration and internal scoring. It is local project context and is not included in a fresh repository clone. This README records implementation and verification evidence, not a competing task list. Private scoring inputs are local under `docs/reference/scoring-inputs/` and excluded from Git in their entirety; do not copy their contents into code, issues or deployments.

The Talent Solutions client portal, rebuilt from the `client-workspace-v1-visual-2h` prototype. It runs in two separate modes: the **demo** (default), the reviewed workspace with fictional local data, where client actions are demo changes saved in this browser and nothing is sent anywhere; and **Supabase mode**, which signs in to the development Supabase project with fictional test accounts. It has an internal Vercel test deployment (below); Manatal and notifications are not integrated.

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
- Database milestone 2, decline and interview feedback (`client_notes`, `client_decline`, `client_add_feedback`; `supabase/README.md`): applied to the hosted project. Post-migration check all OK; SQL Editor access tests 65/65 (rolled back). Their rules are development-only (D3); saving a decision notifies nobody and does not update Manatal.
- Supabase mode, decline and feedback on the candidate page: checked by hand in one recorded run (24 Oct 2026): Aisha Bello, Field Sales Representative, declined from To review (saved); feedback for Jordan Ellis, Inside Sales Leader, saved with the stage unchanged at Interview; a move sent with the version from before that feedback refused as a version conflict, nothing saved. Cleaned up with SQL generated from the run's exact keys: all OK, baseline 15 / 26 / 3, no notes, portal decisions or run keys left.
  A second recorded run: Taylor Brooks, Regional Sales Manager (on-hold role at Interview) shows stage changes paused, Decline disabled and interview feedback available, nothing sent; and one more normal decline for Aisha Bello (saved, not interrupted). Cleaned up the same way: all OK, Aisha back at To review v1, baseline 15 / 26 / 3, no notes, portal decisions or run keys left.
- Database milestone 3, role descriptions, versioned requirement sets and published candidate summaries (`supabase/README.md`): applied and seeded on the hosted project (fictional data). SQL Editor access tests 63/63 (rolled back); the post-seed check all OK afterwards. Clients read only; no scores of any kind.
- Supabase mode, role pages and the Summary tab (milestone 3): checked by hand on the hosted development data, with the local build of this checkpoint: Taylor Brooks' Summary (why shared, requirement check, strengths, points to clarify, key facts); the job descriptions on two Harbor role pages; Daniel Okafor's Summary hidden ("No summary is currently shared for this candidate.": his packages are withdrawn and paused); Northwind's role showing only its Version 2 requirements, with Robin Hale's package on the superseded Version 1 hidden. Tested offline in addition: the role pages and all 11 visible Summary tabs match the demo's text.
- **Pending (not yet verified on the hosted project):** a decision request with no answer (same-key automatic retry, "Check again", saved once). Tested offline only; the hosted check was the stage-move version (Priya Raman).
- **Pending for milestone 3:** read-only Data API checks against the hosted project (no milestone 3 API script has been run; access was checked in the SQL Editor and through supabase-js offline), and a test with two real concurrent database sessions (the locks are in place and every ordering is tested one after the other offline; actual lock waits are not exercised).

**Internal test deployment** (25 Oct 2026 IST): https://client-portal-v1-taupe.vercel.app, commit `26905ec` (milestone 5 Hiring progress, `ac20318`, plus a README deployment record), Supabase mode against the hosted development project.
This is an internal test deployment using shared fictional data, not a production-ready client portal. Manatal, notifications and the remaining candidate-detail and reporting features are not connected.
- Checked from outside, read-only (no sign-in, no credentials, no data requests; 25 Oct 2026 IST): the build embeds commit `26905ec` (a production build from `main`); its sign-in code is byte for byte the local build of that commit apart from one bundle file name and includes milestone 5; Supabase mode, test-run recorder off, no secret key and no Manatal address; the public sign-in page shows sign-in only, sends no Supabase request before sign-in, and logs no console or page errors.
- Verified on this deployment (Aakash, 25 Oct 2026 IST, read-only, no candidate actions): Harbor's Hiring progress counts and wording. Northwind was checked with the local build against the same hosted data, not repeated on the deployment. Visual layout and the browser console after sign-in are not verified.
- Earlier deployment (25 Oct 2026 IST, `1e3d12b`, milestone 4, pushed together with the milestone 3 repair commit `58afff2`): checked from outside the same way; the build embedded commit `1e3d12b`. Its sign-in code was byte for byte the local tested build of `1e3d12b` apart from one bundle file name; Supabase mode, recorder off, only the public (anon) key; the public sign-in page logged no console or page errors. Milestone 4 was not checked by hand on that deployment after sign-in (it was checked with the local build against the same hosted data; see milestone 4 below).
- Earlier deployment (25 Oct, `95ba363`, milestone 3): Taylor Brooks' Summary tab and the Regional Sales Manager role page verified by hand (Aakash); checked from outside the same way: the build embeds commit `95ba363`. Its sign-in code is byte for byte the local build of `95ba363` apart from one bundle file name, and includes milestone 3. Supabase mode, with the test-run recorder off and no recorder endpoint; only the public (anon) key of the development project, with no secret key and no Manatal address. The public sign-in page shows sign-in only (no sign-up or password reset, no workspace or demo data), sends no Supabase request before sign-in, and logs no console or page errors.
- Earlier deployment (24 Oct, `d211f1a`): Harbor sign-in checked by hand (12 submissions, 11 people, 4 roles, the fictional-data notice, no test-recording banner).
- Still pending: dedicated hosted Data API checks for milestones 3 and 4, a test with two real concurrent database sessions, a hosted UI check of round-linked interview feedback, and the interrupted decline/feedback retry check (see above).

**Provisional, for development testing only**
- Client moves to Offer and Hired, and the rule behind them (open roles only; no moves out of Offer, Hired or Declined). Not approved for production (decision D3).

**Milestone 4: applied, seeded and verified on the hosted development project on 25 Oct 2026 IST (fictional data); deployed as `1e3d12b` the same day (internal test deployment)**
- Client interviews by round, recorded offer outcomes, and interview feedback linked to its round (`supabase/README.md`); in Supabase mode, next steps, "Waiting on you" (sidebar, Candidates chip and filter, Roles list, waiting-first ordering), interview status and requirement support, all from one derivation (`src/workspace/next.ts`) that uses the action controls' permission rules. Missing information is shown as missing: "Awaiting shared summary", "No client interview recorded", "Next step not recorded". Supabase-mode search is deferred.
- Hosted SQL Editor access tests 48/48 (rolled back); the post-seed check all OK afterwards (25 Oct 2026 IST).
- Checked by hand on the hosted development data with the local build (25 Oct 2026 IST): Harbor's Waiting on you count and filter (5); Taylor Brooks' interview feedback task on the on-hold Regional Sales Manager role; Northwind's cancelled newer round, with no task brought back for the older round.
- **Pending for milestone 4:** the new round-linked feedback function (`client_add_interview_feedback`) has not been tested by hand through the hosted UI (it is covered by the SQL Editor access tests and offline); dedicated hosted Data API checks; a test with two real concurrent database sessions; and the interrupted decline/feedback retry check (see above).

**Milestone 5: Hiring progress from database rows (frontend only; counts and wording verified read-only on the hosted development data, 25 Oct 2026 IST; deployed as part of `26905ec`)**
- In Supabase mode, the four approved charts (Pipeline, Candidates by role, Time in stage, Weekly movement) use the demo's counting rules (`src/reporting/metrics.ts`) on rows built from the same loaded workspace as Candidates and Roles (`src/reporting/fromWorkspace.ts`). No migration and no new reads.
- Stage history is the recorded entries in version order: stage moves and declines are moves; feedback (general or round-linked), interviews held and recorded outcomes are not. A history that does not add up is shown as an error, never guessed.
- Sourced, Screened and "not progressed before sharing" are **Not available**, never 0: Revenue Optics' search records are not connected or fetched, and client visibility is undecided (D5).
- Wording: client moves and declines are the client team's ("by your team"), not the signed-in member's. Weekly is activity recorded in the portal, in UTC Monday-to-Sunday weeks from today's UTC date; a 0 means nothing was recorded, not that nothing happened. No coverage start date is inferred.
- Only candidates currently shared with the client are counted; withdrawn or unshared submissions are excluded by the publication rules, so earlier totals can go down. The demo is unchanged.
- Tested offline: exact parity with the demo at the fixed demo date (all roles and each role), rolling weeks at a later date, consistency with the Candidates and Roles counts, skipped/backward/repeated moves and declines through the client functions, feedback leaving every chart unchanged, client isolation and publication filtering, and no search records requested.
- Verified read-only with the local build against the hosted fictional data (Aakash, 25 Oct 2026 IST; no candidate actions, no SQL): Harbor and Northwind Hiring progress showed the expected counts and wording (Pipeline, Candidates by role, Time in stage, Weekly movement; Not available for Sourced/Screened; client-team decline wording; UTC and currently-shared scope notes; role filter and client isolation). Visual layout and the browser console were not recorded as verified on hosted data.
- On the deployment (`26905ec`): Harbor's Hiring progress counts and wording verified read-only (25 Oct 2026 IST). Northwind not repeated on the deployment.
- **Pending for milestone 5:** visual layout and browser console checks on hosted data; the reporting time zone (UTC until decided, R01); Sourced/Screened visibility (D5); whether withdrawn submissions should stay in historical reports (needs a decision and staff-side data, not a policy bypass).

**Milestone 6: client-safe screening interview summaries (applied and seeded on the hosted development project, 25 Oct 2026 IST; fictional data; not deployed)**
- The Screening interview tab in Supabase mode, from `screening_summaries` (`supabase/README.md`): reviewed, client-safe text only (date, length, recruiter, short summary, optional notes written for the client, key moments as "About N min" text). Internal recruiter notes, transcripts and recordings are not stored or shown; there is no player, seeking or link.
- Added only while a package is a draft and frozen with it; hidden by the same publication rules as Summary evidence (paused, withdrawn, unpublished, superseded requirements). The fictional seed publishes a new package version with identical content rather than editing published packages.
- Tested offline: SQL checks and access tests (42), dependency and rollback guards, the seed and cleanup paths, loader strictness, rendering with no playable elements, the browser check, and the demo's candidate page (unchanged).
- Hosted development (Aakash, 25 Oct 2026 IST, SQL Editor): post-migration and post-seed checks passed; access tests 42/42 (rolled back); the post-seed check all OK again afterwards. Read-only content check with the local build: Taylor Brooks' Inside Sales Leader Screening interview tab passed. Visual layout and the browser console were not verified.
- **Pending for milestone 6:** deployment and a check on the deployment; visual layout and console checks; the other candidates' tabs and Northwind were not checked by hand (covered offline); production decisions on which screening content clients may see (D5) and on recordings, consent and retention (P06, D6).

**Provisional, for fictional development only (milestone 3)**
- Role descriptions are not versioned; who approved and published a package is not recorded (D1, D2); packages on superseded requirements are hidden until re-reviewed. Production approval remains open.

**Not connected yet (Supabase mode)**
- Candidate details: resume (Summary, history, decision notes, next steps and interview status are connected; the Screening interview tab is connected by milestone 6 but not deployed yet). Search. Hiring progress beyond the built milestone 5 (search steps, a decided time zone). Staff tools to write, approve and publish packages (content is seeded by the owner).
- Notifications and Manatal: saving a stage notifies nobody and does not update Manatal.

**Manatal feasibility (prepared, not run)**
- `manatal/FEASIBILITY-CHECKLIST.md` and a read-only harness (`node scripts/manatal/feasibility.mjs`): explicitly selected, admin-created dummy records only; GET only; redacted report. Needs Akansha's approval, a Manatal admin and a locally stored token (never in chat).

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
