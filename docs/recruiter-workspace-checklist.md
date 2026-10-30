# Recruiter workspace completion checklist

Prepared 30 October 2026, following comparison of the current client portal and four recruiter-preview screenshots.

Status reconciled with source and checks on 31 October 2026. Local WIP checkpoint `a7376be` exists on `wip/recruiter-workspace`; the later visibility fix and documentation changes remain uncommitted. The standard production build includes only the client portal and fictional demo. Recruiter source is excluded, while `npm run recruiter:preview` still provides the fictional local preview.

This is a planning checklist, not authorisation to implement every item or change a hosted service. **No staging, further commits, pushes, deployments or hosted database changes are authorised by this update.** No real candidate information is needed for UI review.

The workspace covers assessment, recruiter review and controlled client sharing. It does not replace Manatal's wider recruiting operations unless that scope is explicitly agreed. Missing information must be shown as missing, never inferred from names, scores or sample data.

## Priority and status

| Priority | Meaning | Completion requirement |
|---|---|---|
| P0 | Data correctness, access and sharing blockers | Must be resolved before any hosted rollout or client sharing |
| P1 | Main UI and information gaps | First visible implementation pass, using the existing client portal design |
| P2 | Complete the recruiter's assessment workflow | Complete before describing the workspace as an end-to-end assessment tool |
| P3 | Final usability and release verification | Required checks before a separately approved rollout |
| Deferred | Business decisions or later integrations | No invented rules or automatic activation |

Checked items below mean implemented locally and covered by previously reported local checks, not live or accepted for release. This documentation reconciliation reads current code and test cases; it does not rerun implementation tests. See the [verification record](../VERIFICATION.md) for the reported runs and their limits. Every unchecked item remains open; IDs stay stable.

## Existing foundation — retain

- [x] F01 — Reuse the existing deterministic CV calculator; keep CV and screening separate.
- [x] F02 — Prepare a separate recruiter entry, staff membership/client assignments, and server-side access checks.
- [x] F03 — Require expected revisions for save/share, explicitly reject NULL and incorrect revisions with null-safe comparison, reject omitted arguments, retain originals and record author/time history. Refused requests leave relevant records unchanged.
- [x] F04 — Require evidence and reasons for rating corrections; prevent screening evidence from raising CV skill ratings.
- [x] F05 — Keep internal scores, ratings and decision reasons out of client-summary publication.
- [x] F06 — Provide a local fictional UI preview, with no hosted writes or client sharing.
- [x] F07 — Exclude recruiter HTML and functionality from standard production output and client imports; enforce this with isolation checks while retaining the fictional local preview.
- [x] F08 — Refuse replacement when published or paused packages for this submission contain key facts or reviewed screening summaries. Keep content/history/visibility unchanged on refusal; do not publish internal screening or invent replacement content. This is a safeguard, not the replacement workflow in P0-02/P0-03.
- [x] F09 — Check withdrawal under locks inside sharing. Any prior withdrawn package for this submission blocks sharing, even with a newer published package; superseded history and other submissions' withdrawals do not. Unpublished submissions are also blocked. No reinstatement workflow exists.
- [x] F10 — Derive list/detail visibility from the linked package, same client/submission/role, current published assessment revision, package/submission publication and current agreed requirements. UI wording reflects visibility at the latest fetch; history still blocks duplicate sharing. This fix is implemented locally but uncommitted after the checkpoint.

Current behaviour requiring acceptance: saving a subsequent review pauses its previously shared package if still published, including internal-only edits. Client RLS then hides the package and linked screening summary. The save message does not explain this visibility effect. Assigned active recruiters can currently review and publish their own reviews; no separate approver/publisher permission is enforced. These facts do not close P0-07 or P0-12.

## P0 — Correctness, database and access blockers

- [ ] P0-01 — Agree the source of truth for candidate, role and submission records: identify what stays in Manatal and what this workspace may create or update.
- [ ] P0-02 — Complete or explicitly exclude from the release scope a workflow to review/edit/preserve existing client key facts during replacement. The implemented fallback refuses replacement when facts exist; it does not validate or copy them.
- [ ] P0-03 — Complete or explicitly exclude from the release scope the reviewed screening-summary handoff: call date, interviewer, duration, approved summary and client-safe notes/key moments. The implemented fallback refuses replacement when a reviewed summary exists; raw answers, ratings and internal notes are never substitutes.
- [ ] P0-04 — Design and implement first sharing of a candidate submission. A recruiter must be able to prepare/review before the client can see it; summary publication must not require an already-shared candidate as its only entry path.
- [ ] P0-05 — Complete the first-share transaction design across candidate, package and reviewed screening content. Existing eligible replacement is atomic and a late failure is covered by offline rollback tests; first sharing and screening handoff are still incomplete.
- [ ] P0-06 — Handle reassessment with a new CV or AI run. Preserve old runs, identify the current run and invalidate affected reviews/client summaries without overwriting original records.
- [ ] P0-07 — Accept or revise staff permissions: currently any assigned active recruiter can review and publish their own reviewed summary. There is no separate content approver/publisher role. The owner provisions staff/assignments and imports immutable rubrics; browsers cannot approve rules. Define rule/content approval ownership without assuming two-person approval is already required or implemented.
- [ ] P0-08 — Complete the invitation/account-activation, password-recovery and access-revocation flows under the company's authentication policy. Client accounts must never gain recruiter access automatically.
- [ ] P0-09 — Review M7 against the agreed release scope and prepare recovery for populated installations. Its rollback refuses once any staff, assignment, assessment or review-history data exists. Post-launch rollback, backup/restore and recovery remain unverified; the empty-setup rollback is not a launch recovery plan.
- [ ] P0-10 — Verify explicit client/role/candidate/submission mappings on the server and during import. Reject mismatches; never match candidates by name or silently select another rubric version.
- [ ] P0-11 — Close hosted security and genuinely concurrent-session checks for access/revocation, retries, publication failure and stale data. These cases have substantial reported offline coverage, including all four local fixes; neither source review nor PGlite/intercepted browser tests prove hosted behaviour.
- [ ] P0-12 — Accept or revise pause-on-review and make the effect clear before saving: subsequent internal-only edits can remove previously shared content from client visibility. No automatic restoration exists.
- [ ] P0-13 — Accept the conservative any-prior-withdrawal policy. If reinstatement is needed, agree a separately authorised workflow and permissions before implementing it; do not bypass or weaken the current refusal.

Acceptance: no silent fact loss; no internal data exposed to clients; no partial first-share state; no stale review can publish; no cross-client access.

## P1 — Match the client portal and restore candidate context

- [ ] P1-01 — Agree a recruiter navigation map using the existing blue sidebar and top-bar structure: assessment queue, assigned clients/roles, and help. Add only working destinations.
- [ ] P1-02 — Reuse the client portal's typography, spacing, cards, fields, status pills, buttons and responsive navigation instead of maintaining a separate approximate shell.
- [ ] P1-03 — Fix theme consistency: warning banners, fields, surfaces and text must all follow the selected light/dark theme, including the fictional preview.
- [ ] P1-04 — Build the richer candidate header: current position/employer, location, applied role, assigned recruiter, assessment version/date and review status. Display absent values honestly.
- [ ] P1-05 — Add a compact candidate-facts section: relevant experience, notice/availability and work arrangement; decide whether salary expectations and other practical facts belong here and where they come from.
- [ ] P1-06 — Move decision, outstanding blockers and save/share actions into an accessible persistent panel consistent with the client's Next step panel; use a suitable mobile layout.
- [ ] P1-07 — Tighten the long forms with clearer grouping, readable summaries and expansion for evidence detail. Keep the current state understandable without opening every section.
- [ ] P1-08 — Add previous/next assessment navigation that preserves the queue's filters and return position; protect unsaved changes.
- [ ] P1-09 — Add queue search, client/role/owner/status filters, result counts, sorting and pagination. Keep hiring stage distinct from assessment-review status.
- [ ] P1-10 — Add role context: job description, agreed requirements, scoring rubric/version and approval status, with a clear route back to the candidate.
- [ ] P1-11 — Add a concise assessment overview: key experience, evidence-backed strengths, gaps, essential checks and evidence coverage. Clearly label the draft score and its limits.
- [ ] P1-12 — Match recruiter sign-in to the client portal's branded sign-in layout, with staff-specific wording, password visibility, recovery/help and appropriate no-access/error states.
- [ ] P1-13 — Complete saved/unsaved and last-review information, explain save side effects and sharing blockers. Current visibility and already-shared history are now distinguished locally; visibility does not update in realtime without a fresh fetch.
- [ ] P1-14 — Replace developer wording such as “the starter” in normal product screens. Keep sample labels only in the explicitly fictional preview.
- [ ] P1-15 — Present a representative fictional role with a complete rubric/question set, realistic candidate facts, quotes, saved history and empty/error examples. Do not mistake the current tiny fixture for the actual role configuration.

Acceptance: a side-by-side review shows the same product design; the recruiter can identify the candidate, role, current review state and next action on the first screen. No separately approved recruiter mockup is assumed.

## P2 — Finish the assessment and sharing workflow

- [ ] P2-01 — Add candidate intake or an explicit connection to the agreed candidate source, including correct client/role association and duplicate handling.
- [ ] P2-02 — Provide authenticated CV upload/storage and document access, with file validation and access restricted to authorised staff.
- [ ] P2-03 — Show the original CV beside evidence and open the cited page. Record extraction accuracy/reviewer checks and keep unverified quotes visibly unverified.
- [ ] P2-04 — Connect hosted extraction and AI draft assessment generation only after hosting, account and data-processing arrangements are agreed. Keep credentials server-side.
- [ ] P2-05 — Show queued, processing, failed and ready states; prevent duplicate assessment jobs and require an explicit action before a paid rerun.
- [ ] P2-06 — Load the exact versioned role rubric, core screening set and candidate-specific follow-ups. The supplied draft describes 17 core questions; never substitute the preview's two-question fixture.
- [ ] P2-07 — Complete screening scheduling/recording context, answers, proposed ratings where configured, recruiter corrections and verbatim evidence. Unanswered questions remain unrated.
- [ ] P2-08 — Restore proposed CV-versus-call differences and accept/dismiss review in the hosted workflow. Retain the current rule that call evidence does not raise CV-only skill ratings.
- [ ] P2-09 — Add assigned reviewer, review due date, tasks and outstanding checks so the queue can show what needs attention.
- [ ] P2-10 — Build the client-summary preview using the actual client candidate components: why shared, strengths, points to clarify, requirement evidence, key facts and reviewed screening content.
- [ ] P2-11 — Show the exact client, candidate, role and content in the sharing confirmation. Record who approved/shared it and when; make the resulting visibility explicit.
- [ ] P2-12 — Provide useful review history: before/after changes, source/evidence/reason, author/time, prior decisions and sharing events. Keep immutable full snapshots behind the displayed history.
- [ ] P2-13 — Add authorised staff/client-assignment administration and role/rule approval screens or define the approved owner-operated process for the first rollout; do not leave routine work dependent on ad hoc SQL.

Acceptance: an authorised recruiter can take a candidate from intake through assessment, screening, review and controlled client sharing without relying on the local scoring server. Existing local safeguards are preserved.

## P3 — Usability, verification and review handoff

- [ ] P3-01 — Complete loading, empty, missing-data, permission-denied, failure and stale-data states for every new screen.
- [ ] P3-02 — Check keyboard operation, focus after navigation/errors, field labels, validation messages, warning contrast and disabled controls.
- [ ] P3-03 — Check desktop, tablet and mobile layouts, light/dark themes, long names, long evidence and large question sets.
- [ ] P3-04 — Run meaningful unit, offline database and browser checks for the final scope, including the client portal as a regression target.
- [ ] P3-05 — Repeat private-content/build-secret checks and verify that client pages cannot load recruiter tools, source documents or private data.
- [ ] P3-06 — Reconcile final release documentation and operational checks after scope/policy acceptance. Setup, checklist and reported verification were reconciled on 31 October; hosted checks and populated-installation recovery still remain open.
- [ ] P3-07 — Present the completed flow on the local server for user review, including separate login, staff workspace and exact client output. Record design corrections before considering rollout.

Acceptance: the final UI is reviewable locally and supported by current validation evidence, with unresolved limits stated plainly.

## Deferred decisions and later work — not automatic scope

- [ ] D01 — Obtain approval for weights, coverage thresholds, score-cap triggers, recency/duration settings, rating anchors and the full screening answer points.
- [ ] D02 — Agree how 1–5 screening ratings become an overall screening score. Until then show individual ratings only.
- [ ] D03 — Keep combined CV/screening scoring deferred until the separate assessments are agreed.
- [ ] D04 — Resolve undefined scoring cases: hot-shot-delivery top level, partial education, handling scores below 50 and client exceptions. Do not invent policy in UI code.
- [ ] D05 — Decide whether notifications, interview scheduling, Manatal write-back and recordings/transcripts belong in a later integration. They are not made live by summary publication.

## Rollout gate — separate approval required later

- [ ] R01 — Review and explicitly approve the final database migration and its target environment before applying it.
- [ ] R02 — Provision approved staff/client assignments and approved fictional test imports; verify the hosted flow and genuinely concurrent sessions.
- [ ] R03 — Obtain separate authorisation for any real candidate-data import or hosted AI processing required for live use.
- [ ] R04 — Obtain separate authorisation for further commit/push/deploy actions. The local WIP checkpoint is not a release. Inspect preview-deployment triggers, build/output settings, environment bindings and protection before describing a branch push as backup-only; those settings remain unverified.

## Suggested implementation sequence

1. Resolve P0-01/P0-07 ownership and permission decisions and sketch the missing data/first-share flow.
2. Complete P1 UI and representative fictional data for review on the local server.
3. Complete P0 database/publication corrections and their offline tests.
4. Complete P2 workflow pieces in dependency order: source/intake → CV access → assessment → screening → review → client preview/sharing.
5. Complete P3 checks and local review. Keep D-items unresolved where no rule has been agreed.
6. Stop at the rollout gate until separately authorised. The checklist itself grants no deployment approval.
