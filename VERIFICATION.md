# Verification record

What has been verified for the client portal, how, and when. All checks used fictional data on the development database or offline stand-ins. "Project owner" is the person responsible for the development database and deployment; hosted SQL and confirmed hosted API runs were performed by them after review. Dates are 2026, Indian Standard Time.

Kinds of evidence, kept separate below:
- **Offline automated:** runs from a fresh clone with no network or credentials, except the design comparisons, which also need the approved design prototype (not part of this repository).
- **Hosted database:** read-only checks and rolled-back access tests run in the Supabase SQL Editor on the development project.
- **Hosted API:** scripted requests to the development project's Auth and Data API with the public key and fictional test accounts.
- **Manual UI:** a person using the portal against the hosted fictional data, either with a local build or on the internal deployment.
- **Deployment:** read-only checks of the internal Vercel deployment without signing in.

## 1. Offline automated checks
| Check | Command | Latest result |
|---|---|---|
| Unit and view tests | `npm test` | 290 passed (25 Oct) |
| In-memory database tests: migrations, seeds, access rules, client functions, loaders, Hiring progress, screening summaries, the read-only API check flow | `npm run db:test:offline` | 152 passed (25 Oct) |
| Supabase-mode screens in a browser against an offline stand-in | `npm run check:auth` | 93 passed (25 Oct) |
| Typecheck, production build, secret scan of browser and build files | `npm run typecheck`, `npm run build`, `npm run db:check-secrets` | Passed (25 Oct) |
| Demo persistence across two tabs (self-contained; needs the demo-mode dev server) | `npm run check:persistence` | Passed at the last run (25 Oct) |
| Design comparisons with the approved design prototype (**not self-contained**: need the prototype, which is not in this repository) | `npm run compare:shell`, `compare:progress`, `compare:candidates`, `compare:candidate`, `compare:roles` | All passed at the last full run (25 Oct). `compare:candidate` and `compare:progress` re-run after later changes the same day: passed |

All other checks above are self-contained. The in-memory database (PGlite) runs one connection, so real lock waits between concurrent sessions are not exercised offline; every ordering is tested one after another instead.

## 2. Hosted database (development project, SQL Editor)
Each milestone was applied as one transaction and checked with its read-only post-migration check, its post-seed check (where it has a seed) and its SQL Editor access tests. Access tests run as one statement that switches between signed-out, member and owner roles and ends in a deliberate error, so every change they make is rolled back; afterwards the post-seed check is run again to confirm nothing was kept.

| Milestone | Scope | Result |
|---|---|---|
| 1 | Tenancy, published/unpublished submissions, stage history, idempotent stage changes; four fictional test accounts and three memberships | Checks all OK; access tests 123/123 (by 24 Oct) |
| 2 | Decline and interview feedback, client notes | Post-migration check OK; access tests 65/65 (24 Oct) |
| 3 | Role descriptions, requirement sets, candidate summaries and evidence | Post-seed check OK; access tests 63/63 (25 Oct) |
| 4 | Client interview rounds, recorded offer outcomes, round-linked feedback | Post-seed check OK; access tests 48/48 (25 Oct) |
| 6 | Client-safe screening summaries | Read-only baseline OK before the migration; post-migration and post-seed checks OK; access tests 42/42; post-seed check OK again (25 Oct) |

Milestone 5 (Hiring progress) changed the frontend only.

**Repository integrity note (milestone 3):** the milestone 3 migration file was committed empty in one commit and restored in the next. The restored file was checked against the offline tests, and the project owner compared the hosted function and policy definitions with it; all matched.

## 3. Hosted API
**Read-only checks** (`npm run db:api:read -- --confirm`; public key and the four fictional test accounts; passwords typed at hidden prompts, never stored or printed):
- Milestone 1 (by 24 Oct): sign-in, session and Data API reads for signed-out, member, inactive and unassigned accounts. Passed.
- Milestones 1-6 baseline (25 Oct): all checks passed. The run separates Auth requests (sign-in, session check, sign-out) from data reads, which are GET only with no RPCs. Data reads check exact row identities, client and publication links, evidence per package, and that targeted requests for hidden rows (superseded, draft, paused and withdrawn packages, draft or superseded requirement sets, unpublished submissions) and for the other client's rows come back empty. All four sign-outs returned HTTP 204.

**Write checks** (`npm run db:api:moves`): milestone 1 stage-change requests through the Data API, including refused requests, followed by a targeted restore generated from the run's own keys (by 24 Oct). Passed. The later client functions (decline, feedback, round-linked feedback) were covered by the SQL Editor access tests and recorded UI runs, not by a separate API write run.

## 4. Manual UI checks on hosted fictional data
Performed by the project owner. Recorded action runs used the development test-run recorder and were cleaned up with SQL generated from the run's exact keys; the fictional baseline was confirmed afterwards.

| Date | Build | What was checked |
|---|---|---|
| 24 Oct | Local | Sign-in states with all four test accounts; client isolation and account switching; a normal stage change, a two-tab version conflict, a provisional Offer move, and an unanswered stage-change request (retried with the same key, then confirmed saved once); candidate history order and wording |
| 24 Oct | Local | Decline from To review; general interview feedback with the stage unchanged; a stale-version move refused with nothing saved; an on-hold role showing stage changes paused, decline disabled and feedback available |
| 24 Oct | Internal deployment | Sign-in and the client's lists and counts |
| 25 Oct | Local | Summary tab content, role descriptions, a summary hidden because its packages are withdrawn and paused, and a package on superseded requirements hidden |
| 25 Oct | Internal deployment | One candidate's Summary tab and one role page |
| 25 Oct | Local | "Waiting on you" count and filter; an interview feedback task on an on-hold role; a cancelled newer interview round not reviving an older task |
| 25 Oct | Local, then deployment | Hiring progress counts and wording for both fictional clients (local), and for one client on the deployment |
| 25 Oct | Local, then deployment | One candidate's Screening interview tab content |

These were content checks. Visual layout and the browser console after sign-in were not recorded as verified on hosted data.

## 5. Internal deployment
Each internal deployment was checked without signing in: the build embeds the expected commit from `main`; Supabase mode is on and the test-run recorder off; only the public key is present (no secret key, no Manatal address); the sign-in code matches a local build of the same commit apart from bundle file names; and the public sign-in page shows sign-in only, sends no database request before sign-in, and logs no console or page errors. Latest: commit `7103872` (25 Oct), a tooling and documentation change on top of the milestone 6 application code.

## 6. Not verified, or open
- Two real concurrent database sessions (lock waits).
- An interrupted decline or feedback request on the hosted project (same-key retry, saved once); tested offline and for stage changes only.
- Round-linked interview feedback through the hosted UI (covered by the SQL Editor access tests and offline).
- Visual layout and console checks after sign-in on hosted data; screening tabs other than the one checked by hand.
- Server-side sign-up restrictions, invitation and recovery flow, and access revocation.
- Anything involving Manatal, notifications, documents, recordings or real data.
