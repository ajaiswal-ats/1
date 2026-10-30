# Recruiter workspace: unfinished local implementation

Completion work is tracked in the [prioritised recruiter workspace checklist](recruiter-workspace-checklist.md).

The separate `/recruiter.html` entry uses the existing CV calculator. It supports staff sign-in, a queue limited to assigned clients, CV evidence and rating corrections, screening answers and individual ratings, a recruiter decision, client-summary preparation, and review history. Client sign-in and pages retain their existing flow. Recruiter sessions use a separate browser storage key.

Updated 31 October 2026 from the current source and checks. Local WIP checkpoint `a7376becf6445fc5c1a230c3d3f0db83a833ffe9` exists on `wip/recruiter-workspace`; the subsequent visibility fix and this documentation update remain uncommitted. This is not a release-ready implementation. The recruiter work has not been pushed or deployed, and M7 has not been applied to a hosted database in this work.

The standard production build includes only `index.html` and `demo.html`. It excludes `recruiter.html`, the fictional recruiter preview and recruiter-only code. The staff entry remains source code for local testing; adding a link does not make it a production entry. If M7 is missing, its RPC calls fail closed with a setup error rather than substituting fictional assessments. Hosted configuration was not inspected for this documentation update.

## What is prepared

- Recruiter source reuses the pure calculator without importing the local scoring server, local CV data or preview export. Production isolation checks require its exclusion from both the build output and the client entries' imports.
- M7 stores original assessment records, imported inputs and evidence, reviews and history in `app_private`. No table grants are given to client or recruiter browsers. Staff-only RPCs check active staff membership and explicit client assignment on every call.
- Save and share require an expected revision. Omitted arguments are not accepted; explicit NULL, stale and incorrect revisions are rejected without changing assessments, history or client records. Each correction needs evidence, a reason and its source. Call evidence cannot raise a CV rating. Screening ratings need a quote actually present in the recorded answer and a reason. The imported core questions and candidate-specific follow-ups are preserved; fact checks cannot be rated.
- Every save records the signed-in staff user and server time and retains earlier snapshots. Saving a subsequent review pauses the package previously shared from that assessment if it is still published, including when only internal notes or decision reasons changed. Existing client RLS then hides that package and its linked screening summary. Saving is therefore not neutral to client visibility, even though the save confirmation says nothing was shared. Acceptance of this behaviour and clearer save messaging remain product decisions; no automatic restoration is provided.
- Sharing is a separate, confirmed action. The server requires approved scoring rules, a current saved review, a decision to put forward, no failed essential or conflicting CV criterion, the current agreed requirement set, and explicit reviewed evidence for every agreed requirement. Existing client publication rules remain in force.
- Sharing copies only why shared, strengths, points to clarify, and the reviewed requirement evidence/source. Scores, weights, CV quotations, raw screening answers/ratings, internal decision reasons, private history and original documents are not copied. No notification or Manatal update occurs.
- Before replacement, the sharing transaction locks and checks the same submission's published and paused packages. Existing key facts or any reviewed screening summary block replacement with an explanation. They are not silently emptied, copied or revalidated. Existing records and visibility remain unchanged on refusal; eligible replacements remain atomic and retain superseded history. There is no completed workflow to review and preserve or replace that existing content. Same submission/requirement IDs alone do not establish continued validity.
- Any prior package in the `withdrawn` state for this submission blocks recruiter sharing, even if an owner has subsequently published a newer package. The check runs under locks inside the transaction; an old page or a correct assessment revision cannot bypass it. Superseded history and withdrawals belonging to other submissions do not trigger this guard. An unpublished submission is also refused. No recruiter reinstatement workflow or permission exists.
- Both recruiter read RPCs derive `published` from the linked package, matching client/submission/role, the current assessment's published revision, package and submission publication, and the current agreed requirement set. Missing, withdrawn, paused, superseded or incompatible packages return false. The UI describes current visibility rather than treating a past share as proof of access. This means availability to authorised client members at the latest fetch, not realtime confirmation or permission for every account. An older package may be visible while the current saved review is not. Sharing history still blocks a duplicate share of the same revision.
- One hosted assessment per portal submission prevents older runs from overwriting newer summaries. Local preparation retains its earlier versions in the immutable imported source record. Replacing a hosted baseline with a new AI run needs a separate versioned-import workflow; this first integration intentionally refuses duplicate imports.

## Permission policy and outstanding decisions

Currently, any active recruiter assigned to a client can review and publish their own reviewed summary for that client. There is no separate content approver or publisher role. The database owner provisions staff and client assignments and imports the exact rubric; browsers cannot approve or modify that immutable imported rubric. The supplied draft rules remain unapproved and cannot be used to publish.

This permission model still needs company acceptance; two-person approval has not been assumed or implemented. Also decide whether pause-on-review is the intended client experience, how existing client facts and screening content may be reviewed for replacement, and whether a future authorised reinstatement process is needed. The current refusal guards stay in place until such workflows are agreed and built. These documents grant no rollout or rule approval.

## Setup steps for a later approved rollout

1. Accept the intended scope and permission/publication policies, then review `supabase/migrations/20261030120000_m7_recruiter_scoring.sql` and the target environment separately. M7 depends on M3; its existing-content guard also supports databases without the optional M6 screening table. Frontend builds do not apply migrations or enable the excluded recruiter entry. A later rollout needs separate authorisation for database changes and production entry inclusion.
2. The database owner provisions an existing Auth user in `app_private.recruiters` and assigns specific clients in `app_private.recruiter_clients`. No staff account, password or grant is created by the app, and client accounts do not gain staff access automatically. Deactivation is checked again on each request.
3. Export the chosen local assessment with its exact rubric and screening set into a private JSON file containing `{config, assessment, screeningSet}`. Confirm the explicit portal client and submission UUIDs and the source candidate/role mapping. The composite foreign key checks submission/client association; it does not verify that the source assessment describes that candidate or role. The helper checks rubric IDs/versions, inputs and screening rules and rejects quotes explicitly marked unverified. Source identity and quote provenance still need owner verification; names are never matched automatically. Rule approval must be established before importing an approved rubric, not inferred from a saved recruiter review.
4. Prepare a private SQL draft (this command connects to no database):

   ```sh
   node scripts/recruiter/prepare-import.mjs \
     --input /private/tmp/assessment-source.json \
     --client-id <portal-client-uuid> \
     --submission-id <portal-submission-uuid> \
     --out /private/tmp/assessment-import.sql
   ```

   Keep both files outside Git and `public/`; they contain private candidate evidence. The output is owner-readable only and refuses to overwrite a file. It inserts an unreviewed assessment, grants no access and publishes nothing. Inspect and apply it separately after approval. Never change `approved` to bypass the business review of scoring rules.
5. Verify staff access, client isolation, review saves and sharing against the fictional development database, including two genuinely concurrent sessions. Only then consider a separate deployment request.

The prepared rollback is for empty setup only: it refuses if any recruiter, client assignment, assessment or review-history row exists. It deliberately preserves data and is not a supported post-launch rollback. Backup/restore, recovery after publication and a removal plan for populated installations remain unverified. No migration or rollback is authorised by these setup notes.

## Current limits

Hosted CV uploads, extraction, AI assessment generation, AI-proposed screening ratings and automated comparison of call evidence with CV claims are not connected. They remain in the local tool; this integration supports recruiter review of explicitly imported inputs. No AI credentials or private files are bundled. The UI offers manual review and corrections rather than buttons that call a missing local server.

The supplied scoring rules are still unapproved. Saving internal reviews is supported; publishing from those test rules is blocked. The overall screening score and combined score remain deferred. This change neither approves the rules nor authorises any hosted data processing.

First candidate sharing still requires the existing owner process: the recruiter RPC only replaces content on an already-published submission. Hosted intake, private document delivery, reassessment and account administration are incomplete. The first queue loads assigned assessments in one request; pagination is a follow-up before large-scale use. Hosted security/grants/RLS and authentication settings, real concurrency and hosted end-to-end behaviour remain unverified. Local tests do not establish hosted security. Vercel preview triggers, build/output settings, environment bindings and preview protection also need inspection before a branch push is described as backup-only.

## Local checks

The [verification record](../VERIFICATION.md) separates previously reported implementation-test results from this documentation-only update. Reading the current source and test cases is not a new test run. No unit, database, browser, typecheck or build run is claimed for this documentation update.

`npm run build`, `npm test`, `npm run db:test:offline`, `npm run scoring:check`, and `npm run db:check-secrets` exercise the build, existing behaviour, private staff RPCs and publication through the existing client RLS, and separation from private local material. `npm run check:recruiter` checks the actual staff entry in a browser against an intercepted synthetic API, including access denial, correction/save, screening persistence, blocked sharing, unsaved navigation, mobile/dark layout and sign-out. No hosted credentials are needed.

For a human UI review, run `npm run recruiter:preview` and open `http://127.0.0.1:5197/recruiter-preview.html`. This development-only page uses fictional data and saves only in the tab's memory. Reloading clears changes; client sharing is disabled. It reads no `.env` files or private assessments, calls no backend/AI service, is excluded from the normal build and refuses its own production build. It is not a hosted security test. The real `/recruiter.html` source still requires staff sign-in and database setup when tested locally and is not included in the standard production output.
