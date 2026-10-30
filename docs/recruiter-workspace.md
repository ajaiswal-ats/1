# Recruiter workspace: prepared locally, not deployed

Completion work is tracked in the [prioritised recruiter workspace checklist](recruiter-workspace-checklist.md).

The separate `/recruiter.html` entry uses the existing CV calculator. It supports staff sign-in, a queue limited to assigned clients, CV evidence and rating corrections, screening answers and individual ratings, a recruiter decision, client-summary preparation, and review history. Client sign-in and pages retain their existing flow. Recruiter sessions use a separate browser storage key.

This change has not been committed, pushed, deployed or applied to the hosted database. Opening the page against the current hosted database reports that access/setup could not be checked; it does not fall back to local or fictional assessments.

## What is prepared

- The frontend builds with the portal as a separate entry; it imports the pure calculator, never the local scoring server, local CV data or preview export.
- M7 stores original assessment records, imported inputs and evidence, reviews and history in `app_private`. No table grants are given to client or recruiter browsers. Staff-only RPCs check active staff membership and explicit client assignment on every call.
- Reviews use optimistic revision checks. Each correction needs evidence, a reason and its source. Call evidence cannot raise a CV rating. Screening ratings need a quote actually present in the recorded answer and a reason. The imported core questions and candidate-specific follow-ups are preserved; fact checks cannot be rated.
- Every save records the signed-in staff user and the server timestamp, retains earlier snapshots, and pauses any client package previously shared from that assessment. The client loader then hides that outdated package and its linked screening summary until a new summary is explicitly shared.
- Sharing is a separate, confirmed action. The server requires approved scoring rules, a current saved review, a decision to put forward, no failed essential or conflicting CV criterion, the current agreed requirement set, and explicit reviewed evidence for every agreed requirement. Existing client publication rules remain in force.
- Sharing copies only why shared, strengths, points to clarify, and the reviewed requirement evidence/source. Scores, weights, CV quotations, raw screening answers/ratings, internal decision reasons, private history and original documents are not copied. No notification or Manatal update occurs.
- One hosted assessment per portal submission prevents older runs from overwriting newer summaries. Local preparation retains its earlier versions in the immutable imported source record. Replacing a hosted baseline with a new AI run needs a separate versioned-import workflow; this first integration intentionally refuses duplicate imports.

## Setup steps for a later approved rollout

1. Review `supabase/migrations/20261030120000_m7_recruiter_scoring.sql`. It depends on M3 and uses the existing client package tables. Apply it separately after database approval; frontend builds do not run migrations. The rollback refuses while staff or assessment data exists.
2. The database owner provisions an existing Auth user in `app_private.recruiters` and assigns specific clients in `app_private.recruiter_clients`. No staff account, password or grant is created by the app, and client accounts do not gain staff access automatically. Deactivation is checked again on each request.
3. Export the chosen local assessment with its exact rubric and screening set into a private JSON file containing `{config, assessment, screeningSet}`. Confirm the explicit portal client and submission UUIDs. The submission's role/client and the imported assessment must refer to the same role; the import helper additionally checks rubric IDs and versions, inputs, screening rules and quote-verification flags. Review the role mapping as part of the owner import; names are never matched automatically.
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

## Current limits

Hosted CV uploads, extraction, AI assessment generation, AI-proposed screening ratings and automated comparison of call evidence with CV claims are not connected. They remain in the local tool; this integration supports recruiter review of explicitly imported inputs. No AI credentials or private files are bundled. The UI offers manual review and corrections rather than buttons that call a missing local server.

The supplied scoring rules are still unapproved. Saving internal reviews is supported; publishing from those test rules is blocked. The overall screening score and combined score remain deferred. This change neither approves the rules nor authorises any hosted data processing.

The first queue loads assigned assessments in one request; pagination is a follow-up before large-scale use. Hosted authentication/rate limits, real concurrent database sessions, operational policies, private document delivery and hosted end-to-end behaviour remain rollout checks.

## Local checks

`npm run build`, `npm test`, `npm run db:test:offline`, `npm run scoring:check`, and `npm run db:check-secrets` exercise the build, existing behaviour, private staff RPCs and publication through the existing client RLS, and separation from private local material. `npm run check:recruiter` checks the actual staff entry in a browser against an intercepted synthetic API, including access denial, correction/save, screening persistence, blocked sharing, unsaved navigation, mobile/dark layout and sign-out. No hosted credentials are needed.

For a human UI review, run `npm run recruiter:preview` and open `http://127.0.0.1:5197/recruiter-preview.html`. This development-only page uses fictional data and saves only in the tab's memory. Reloading clears changes; client sharing is disabled. It reads no `.env` files or private assessments, calls no backend/AI service, is excluded from the normal build and refuses its own production build. The real `/recruiter.html` entry still requires staff sign-in and database setup.
