# Revenue Optics Talent Solutions: Client Portal V1

## 1. Project purpose
A client workspace for Revenue Optics Talent Solutions. Hiring managers at a client company see only their own company's roles and the candidates Revenue Optics has shared with them, read the reviewed evidence behind each candidate, record decisions and interview feedback, and follow hiring progress. Recruiters continue to work in Manatal; the portal is the client-facing side.

The portal runs in two modes:
- **Demo mode** (default): the approved workspace design with fictional local data. Client actions are saved only in the browser; nothing is sent anywhere.
- **Supabase mode**: the same screens backed by a Supabase (Postgres) development database with fictional test accounts and fictional data.

All data in this repository and in the development database is fictional. No real candidate data has been loaded.

## 2. Current capabilities and implementation status

### Implemented (Supabase mode, fictional data)
- **Sign-in and access:** email and password sign-in for accounts created by the database owner (the portal has no sign-up or password-reset screens; server-side sign-up restrictions are not verified, see section 6), session restore and refresh, sign-out (including in other tabs), and a single "No workspace access" state for inactive or unassigned accounts. Each member sees only their own client's data, enforced by row-level security in the database.
- **Roles and candidates:** role list and role pages (descriptions, agreed requirements), candidate pipeline and list, and candidate pages with the Summary tab (why shared, requirement check, strengths, points to clarify, key facts), Notes and history, and the Screening interview tab (client-safe reviewed summary and key moments as text; no recording or player).
- **Client actions:** stage changes, decline with a note, general interview feedback, and feedback linked to a specific interview round. Every action sends the version the user saw and an idempotency key; conflicts are reported, unanswered requests are retried with the same key, and success is shown only after the server confirms it.
- **Next steps and "Waiting on you":** derived in the portal from recorded facts (interview rounds, recorded offer outcomes, linked feedback, published summaries) and the same permission rules as the action controls. Missing information is shown as missing, never filled in.
- **Hiring progress:** the four approved charts (Pipeline, Candidates by role, Time in stage, Weekly movement) computed from the same loaded data as the Candidates and Roles pages.

### Provisional (development rules, not approved for production)
- Which client actions are allowed, and when (for example client moves to Offer and Hired, and actions on on-hold or closed roles).
- Role descriptions are not versioned, and who approved or published a candidate summary is not recorded.
- Hiring progress uses UTC calendar days; the reporting time zone is undecided.

### Not implemented
- **Notifications and Manatal:** saving a stage change, decline or feedback records it in the portal database only. Nobody is notified and Manatal is not updated. Manatal integration has a prepared, unrun read-only feasibility harness (see section 7).
- **Staff tools:** there is no staff interface for user administration or for writing, approving and publishing candidate content; development content is loaded by the database owner through reviewed seed scripts.
- **Documents and recordings:** resumes, documents, transcripts and recording playback.
- **Search in Supabase mode**, and Revenue Optics' internal search records (the Sourced and Screened steps are shown as "Not available").
- **Scoring:** no scores, ratings or automated assessments exist in the portal or database.

## 3. Architecture and data flow
- **Frontend:** a single-page app (React, TypeScript, Vite) with hash routing. Demo mode reads the fictional dataset in `src/data/` through a provider that replays demo changes saved in the browser. Supabase mode uses `@supabase/supabase-js` with the project's **public key only**.
- **Database:** Postgres on Supabase. Tables live in `public`; internal helpers and idempotency records in `app_private`. Row-level security limits every read to the signed-in member's active client and to published submissions. Clients write only through database functions (`client_move_stage`, `client_decline`, `client_add_feedback`, `client_add_interview_feedback`), which check membership, the submission version and the idempotency key in one transaction. Reviewed content (requirement sets, candidate summaries, evidence, screening summaries) is frozen once agreed or published, enforced by database triggers.
- **Loading:** after sign-in the portal reads the member's account, then the workspace tables in keyset-paginated requests. Rows from another client, inconsistent rows or a partly applied database milestone stop the load with an error instead of showing partial data.
- **Derived views:** next steps, "Waiting on you", interview status and Hiring progress are computed in the browser from the loaded rows (`src/workspace/next.ts`, `src/reporting/`), so every page's counts come from the same loaded workspace data.
- **Hosting:** an internal Vercel deployment builds from `main` in Supabase mode against the development database. There is no server-side application code beyond the database functions.
- **Database changes:** applied as reviewed SQL files in milestones (see `supabase/README.md`), each with a rollback, read-only checks and access tests.

## 4. Local setup

Requirements: a current Node.js release (developed with Node 25) and npm.

```
npm install
npm run dev          # http://127.0.0.1:5173/ (demo mode by default)
npm run typecheck
npm run build
npm test             # unit and view tests
```

### Demo mode
No configuration is needed. Without `.env.local`, or with `VITE_PORTAL_MODE=demo`, the portal runs the fictional demo.

### Supabase mode
Copy `.env.example` to `.env.local` (Git-ignored), fill in the development project's URL and **public** key, set `VITE_PORTAL_MODE=supabase`, and restart `npm run dev`. Everything prefixed `VITE_` is built into the browser bundle, so only public values belong there; `npm run db:check-secrets` fails if a privileged value appears in browser or build files. A misconfigured Supabase mode shows a configuration error and never falls back to demo data. Test accounts are created by the database owner; their passwords are never stored in the repository.

Database scripts use `supabase/.env.dev.local` (template: `supabase/.env.example`, Git-ignored). The database runbook, including the manual SQL Editor route used for the development project, is in `supabase/README.md`.

`VITE_DEV_RECORD_MOVES` (development only, off by default, never in builds) records each client action's idempotency key before it is sent, so a manual test run can be cleaned up precisely; see `supabase/README.md`.

### Further checks
Self-contained (work from a fresh clone; no credentials or network):
```
npm run db:test:offline     # the real migrations, seeds, access rules and supabase-js, in memory (PGlite)
npm run check:auth          # Supabase-mode screens in a browser against an offline stand-in (starts its own server)
npm run db:check-secrets    # after npm run build: no privileged value in browser or build files
npm run check:persistence   # with the demo-mode dev server running: demo changes across two tabs
npm run db:api:read         # prints the read-only hosted API check plan; sends nothing without --confirm
```

Design comparisons, which need the approved design prototype (`client-workspace-v1-visual-2h`, not part of this repository, placed in a folder next to the repository) and the demo-mode dev server running:
```
npm run compare:shell       # the shell at 1440×900, light and dark
npm run compare:progress    # Hiring progress at 1280, 1440 and 1920 px, light and dark
npm run compare:candidates  # Candidates at 1280, 1440 and 1920 px, light and dark
npm run compare:candidate   # the candidate page and its actions, light and dark
npm run compare:roles       # Roles and role pages, before and after actions
```
They exit with an error on any unexpected difference and write screenshots to `compare-output/` (Git-ignored). Set `APP_URL` if the dev server is not on `http://127.0.0.1:5173/`.

## 5. Verification summary
Detailed, dated results are in [VERIFICATION.md](VERIFICATION.md). In short:

| Kind | What it covers | Status |
|---|---|---|
| Offline automated, self-contained | Unit and view tests; database migrations, access rules and client functions in an in-memory Postgres; Supabase-mode screens in a browser against a stand-in; demo persistence | Passing at the latest local runs (dated in VERIFICATION.md) |
| Design comparisons (need the private prototype) | Demo pixel and text comparisons with the approved design | Passing at the latest local runs (dated in VERIFICATION.md) |
| Hosted database (SQL Editor) | Post-migration and post-seed checks and rolled-back access tests for each database milestone, run by the project owner on the development project | Passed for milestones 1-4 and 6 |
| Hosted API, read-only | Auth plus Data API reads as signed-out, inactive, unassigned and two client accounts: exact rows, client and publication links, and empty results for hidden and other-client rows | Passed for the milestone 1-6 baseline (25 Oct 2026) |
| Hosted API, writes | Stage-change requests through the Data API with targeted restore | Passed for milestone 1; not repeated for later client functions |
| Manual UI (hosted fictional data) | Selected read-only content checks and recorded action runs by the project owner | Partial; content only, not visual layout or console |
| Deployment | Read-only checks of each internal deployment: embedded commit, Supabase mode, recorder off, public key only, public sign-in page | Passed for the current deployment |

Still unverified: two real concurrent database sessions, an interrupted decline or feedback request on the hosted project, round-linked feedback through the hosted UI, and visual layout and console checks after sign-in on hosted data.

## 6. Known limitations and production readiness
This is an **internal test deployment with shared fictional data, not a production-ready client portal.** Before any real client or candidate data:
- **Decisions needed:** who may take which client actions; who approves and publishes candidate content, and where approval is recorded; which candidate fields, screening content and internal counts (Sourced and Screened) clients may see; retention and deletion periods; candidate consent and any external AI processing; document delivery; hosting and security ownership; the reporting time zone; whether withdrawn submissions stay in historical reports.
- **Sign-up and accounts:** the portal shows no sign-up or password-reset screens, but hiding them does not prevent sign-up through the Auth API. Server-side sign-up restrictions, the invitation and recovery flow, and access revocation are not yet verified.
- **Saves are not notifications:** client actions are recorded in the portal database only. Notifications, Manatal write-back and how recruiters are told about a decision are not built; the screens say so.
- **Operations:** environment separation (development versus production), monitoring and alerts, backup and restore, rollback drills and a security review are outstanding.
- **Integration:** Manatal read and write behaviour is untested; any future sync must keep repeated legitimate stage transitions and must not overwrite portal decisions.
- **Known technical limits:** workspace pages are separate requests, not one snapshot (a row added during a load can be missed until the next load); one inconsistent row stops the whole workspace load; history counts include only submissions currently shared with the client.

## 7. Repository structure and supporting documentation
| Path | Contents |
|---|---|
| `src/data/`, `src/domain/`, `src/candidates/`, `src/roles/`, `src/progress/`, `src/reporting/` | Demo dataset, shared candidate rules, pages and the Hiring progress calculations |
| `src/auth/` | Supabase mode: configuration, session handling, sign-in and account-state screens |
| `src/workspace/` | Supabase mode: data loading, client actions, derived next steps and the database-backed pages |
| `src/components/`, `src/lib/`, `src/styles/` | Shared components, helpers and the approved styles |
| `supabase/` | Migrations, rollbacks, seeds, read-only checks, SQL Editor access tests and the database runbook |
| `scripts/db/` | Database tooling: checks, seeding, read-only hosted API checks, recorded-run cleanup and the secret scan |
| `scripts/dev/` | The development-only test-run recorder |
| `scripts/manatal/`, `manatal/` | The read-only Manatal feasibility harness and its checklist (not run) |
| `tests/offline-db/` | In-memory database and end-to-end tests |
| `scripts/*.mjs` | Design comparisons and browser checks |

Supporting documentation in this repository:
- [VERIFICATION.md](VERIFICATION.md): what has been verified, how, when, and what remains open.
- [supabase/README.md](supabase/README.md): the database runbook (milestones, manual SQL Editor route, cleanup and rollback).
- [manatal/FEASIBILITY-CHECKLIST.md](manatal/FEASIBILITY-CHECKLIST.md): the planned, read-only Manatal feasibility tests.
- [.env.example](.env.example) and [supabase/.env.example](supabase/.env.example): setting names, without values.

Product decisions, planning documents and internal scoring material are maintained by Revenue Optics outside this repository and are not part of it.
