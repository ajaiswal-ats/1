# Verification record

## Recruiter workspace current local status · documentation reconciliation, 31 October 2026

Local WIP checkpoint `a7376becf6445fc5c1a230c3d3f0db83a833ffe9` exists on `wip/recruiter-workspace`. The subsequent visibility fix and this documentation update remain uncommitted. Recruiter work is unfinished, excluded from the standard production build and not released. This work has not applied M7 to a hosted database or pushed/deployed the recruiter batch. See [setup and limits](docs/recruiter-workspace.md) and [completion checklist](docs/recruiter-workspace-checklist.md).

### Current implementation, inspected from source

- Standard build entries are only `index.html` and `demo.html`. Isolation checks reject recruiter output or imports from client entries. The separate fictional preview remains available with `npm run recruiter:preview`; it uses tab-memory data, disables sharing and refuses its own production build.
- Save/share require expected revisions, reject omitted/NULL/incorrect revisions, and preserve records on rejection. Original assessments and attributed review history remain retained.
- Replacement refuses published/paused packages containing existing client facts or reviewed screening summaries. No completed replacement-review workflow exists. No automatic copy of internal answers, ratings, drafts or notes is published. Eligible replacement remains atomic and retains history.
- Any prior withdrawn package for the same submission blocks sharing under transaction locks, even if a newer package is published later. Superseded history and other submissions' withdrawals do not trigger that guard. Unpublished submissions are refused; no reinstatement workflow or permission exists.
- Both recruiter read RPCs now report visibility from the linked current assessment revision and package, matching client/submission/role, package/submission publication and current agreed requirements. The UI no longer treats a historic share as proof of current visibility. This is availability to authorised client members at the latest fetch; realtime refresh was not added. Duplicate sharing remains blocked independently through history and the server revision guard.
- A subsequent review save pauses the assessment's previously shared package if it is still published, even for internal-only edits, hiding the package and linked screening summary under client RLS. This behaviour and clearer save messaging still need acceptance.
- Assigned active recruiters can currently review and publish their own reviewed summaries. There is no separate content approver/publisher permission. The owner provisions access and imports the immutable rubric; browsers cannot approve rules. This policy and the supplied unapproved rules have not received release approval.

### Previously reported local test runs — not rerun by this documentation update

These results were reported in the preceding local implementation/review work, before this documentation-only update. Reading current code and test cases for this reconciliation is not independent execution or hosted verification.

| Run | Reported result | Limit |
|---|---|---|
| Full checkpoint audit | 974 unit tests in 66 files; 187 offline DB tests in 16 files; client browser checks 111/111; recruiter browser and fictional-preview checks passed | Predates the pending visibility fix; these are not full-suite results for that later change |
| Pending visibility fix | 197 full offline DB tests in 16 files, including 45 M7 tests; 26 relevant unit/isolation tests in 3 files; recruiter browser checks passed | No full unit-suite or client-browser rerun was reported after this fix |
| Visibility-fix validation | Typecheck, production build, privacy/isolation, secret and whitespace checks passed; output contained only client/demo HTML and no recruiter functionality | Local output and pattern checks, not hosted configuration or security proof |

The offline tests use fictional data in in-memory PGlite; browser checks intercept fictional API responses. Regression tests were reported failing before their fixes and passing afterward. No unit, database, browser, typecheck or build tests are rerun for this documentation-only update.

Documentation-update validation on 31 October: documentation diff/whitespace review, added local-link checks, `npm run scoring:check`, `npm run db:check-secrets` and credential-pattern checks of the four edited documents passed. Privacy/isolation checked the existing `dist` output; no new build was run. These checks do not change the implementation-test totals above.

### Outstanding decisions and unverified release checks

Accept or revise pause-on-review, reviewer/publisher permissions and the conservative withdrawal policy. Agree the release scope for existing-content replacement review, first candidate sharing, reassessment, owner-operated imports and account lifecycle. Candidate/role identity and quote provenance still need owner verification during import. No approval or reinstatement process is implied by these local safeguards.

Hosted security, actual grants/RLS/Auth/REST behaviour, real concurrent sessions and hosted end-to-end flows remain unverified. The M7 rollback deliberately refuses once any recruiter, assignment, assessment or review history exists. It is for empty setup only; post-launch recovery and backup/restore have not been verified. Vercel preview triggers, custom build/output settings, environment bindings and preview protection also remain unverified. Local tests do not authorise a push, migration or release.

## Historical initial recruiter preparation · 30 October 2026

At this initial preparation stage the work had not been committed, deployed or applied to the hosted database. The results below predate the checkpoint, subsequent fixes and documentation reconciliation. They are retained as historical evidence, not current test totals; use the current-status section above for the later reported runs.

- Typecheck and production build passed. Standard tests: 970 passed in 66 files (`npm test -- --reporter=dot --maxWorkers=2`). Worker count was limited after a concurrent full run hit an extraction-test timeout; no extraction behaviour was changed.
- Full offline database suite: 161 passed in 16 files. After final M7 input-validation changes, all 9 M7 tests passed again. These use real migrations in PGlite with fictional data and simulated users. They cover client denial, assigned-client restrictions, revocation, stale revisions, immutable originals, correction evidence, screening quotes, approval gates and publication through existing client RLS. New reviews pause previously shared packages from that assessment.
- Offline browser check (`npm run check:recruiter`) passed: staff sign-in/access denial, CV correction/save, screening persistence, blocked draft-rule sharing, unsaved navigation, desktop/mobile/dark layout, sign-out clearance and no outside requests. Screenshots were visually inspected; no separate approved recruiter mockup exists for pixel comparison.
- The development-only fictional preview on port 5197 renders, saves an in-memory review and shows history with no external requests or page errors. It is excluded from production entries and is not staff authentication.
- Private-content/isolation and browser/build secret checks passed. The npm dependency audit was not completed: automatic approval review rejected sending this private project's dependency metadata to the external registry. No dependencies were added or upgraded.

Still pending: review/application of M7, staff provisioning/client assignments, explicit assessment imports, hosted CV intake/AI processing, hosted end-to-end checks and true concurrent database sessions. Scoring rules remain unapproved; sharing from those test rules is rejected. No hosted database writes or deployments were performed.

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
| Local fake Manatal inbound preview (fake source and fictional records only; **not** verification of Manatal's API) | `npm test` (`scripts/manatal/import-preview.test.mjs`) | 28 passed (26 Oct) |
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
