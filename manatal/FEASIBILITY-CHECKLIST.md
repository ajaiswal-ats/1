# Manatal feasibility checklist (bounded; runs alongside portal development)

**Goal:** replace the assumptions behind the portal's Manatal boundary with evidence, using **admin-created dummy records only**. No sync, outbox, webhooks, polling or portal integration code; no real candidates.

**Evidence base:** Revenue Optics' internal Manatal integration research (not part of this repository). Tags: **[Doc]** documented, **[Test]** needs a controlled test, **[Not found]** not in the public docs, **[Inf]** inference.

## Preconditions (before anything runs)
- [ ] The business owner approves these tests. All tests need that approval and must not touch real candidate data.
- [ ] A Manatal admin creates, for this test only: a dummy organisation, a dummy job in it, a dummy candidate, and the match between them. The admin adds the tag **`portal-feasibility-dummy`** (or another agreed tag) to the dummy candidate.
- [ ] The admin generates an API token (Administration > Features > Open API [Doc]; one page says to ask support [Doc, contradiction noted]). The operator saves it in `manatal/.env.manatal.local` (`chmod 600`, gitignored). **It is never shared in messages, tickets or browser code.** No scopes or read-only tokens are documented [Not found], so the harness enforces read-only use itself.
- [ ] The operator copies `manatal/targets.example.json` to `manatal/targets.local.json` and fill in the four dummy ids and the tag, then set `"confirm_all_records_are_dummy": true`.

## Step 1: read-only shape (`node scripts/manatal/feasibility.mjs --run --confirm-dummy`)
What the harness does (see `scripts/manatal/feasibility-lib.mjs`; plan without network: `node scripts/manatal/feasibility.mjs`):
- GET only, to `https://api.manatal.com/open/v3` [Doc], with `Authorization: Token …` [Doc]; at most 9 requests, spaced out (limit 100 per 60 s per token [Doc]).
- Only the configured ids: the match, then the candidate (**stops at once, keeping nothing about it, unless it carries the dummy tag**), the job and organisation (**stops unless the match links exactly these, and the job belongs to the organisation**), the job pipeline of the match's stage, and the dummy match's notes and activities and the dummy candidate's attachments and resume. No list of candidates, jobs or matches.
- The report (`manatal/runs/`, gitignored, `chmod 600`) keeps ids and their types, field names and types, the pipeline stage, `is_active`, milestone and update timestamps, custom-field names, and whether `external_id` or a resume file exists. It never keeps names, contact details, note text, custom-field values or file links, and never the token.

Questions step 1 answers:
| # | Question | Today |
|---|---|---|
| 1 | Id types of organisation, job, candidate and match (integers or strings) | [Test] |
| 2 | Does a match link job, candidate and organisation as documented, and does the job carry its organisation? | match fields [Doc]; job-organisation field [Test] |
| 3 | `job_pipeline_stage` shape and the pipeline's stage list (id, name, rank) | [Doc]; the job does not expose its pipeline [Doc] |
| 4 | Milestone fields present (`submitted_at`, `interview_at`, `offer_at`, `hired_at`, `dropped_at`) and their values on a fresh match | fields [Doc]; how they are set [Not found] |
| 5 | Is `external_id` present and empty on each record? | filter [Doc]; writability [Test] |
| 6 | Paginated list shape on the dummy match's notes and activities (`count`, `next`, `previous`, `results`) | [Doc]; maximum `page_size` [Test] |
| 7 | Rate-limit response headers | limit [Doc]; headers [Test] |

## Step 2: signals (admin changes in the Manatal UI, then re-run step 1 and compare reports)
| Change by the admin, on the dummy match only | What to compare | Today |
|---|---|---|
| Move forward one stage, then back | `job_pipeline_stage`, `updated_at`, milestone dates | whether a move bumps `updated_at` [Test]; whether milestones are stamped or cleared [Test] |
| Add an interview activity | `match_activities.activity_types`, `interview_at` | activities [Doc]; interview signal semantics [Test] |
| Drop the match (with a drop reason) | `is_active`, `dropped_at` | drop via UI [Doc]; REST has no drop reason [Doc] |
| Edit the dummy candidate; add an attachment | candidate `updated_at`, attachment count | [Test] |

**Result:** whether a Manatal interview signal can replace the portal's provisional "Interview or Offer" feedback rule, and what a later sync could use as a change identity. **Note for any later sync:** de-duplication must keep repeated legitimate transitions (for example Interview → To review → Interview); the match id plus a stage alone is not enough. A candidate identity is the observed change itself (for example the match's `updated_at` together with the previous and new stage), to be confirmed by these tests.

## Step 3: write-back (separately approved; not in the harness)
Done by hand or by a separate, reviewed script, only on the dummy match, and undone afterwards:
| Test | Endpoint | Today |
|---|---|---|
| Add a match note containing a visible `[Portal ref …]` | `POST /matches/{id}/notes/` with `{info}` | [Doc]; author is the token's user (`creator` read-only) [Doc]; notification and timeline [Test] |
| Set a test match custom field (created by the admin first) | `PATCH /matches/{id}/` with `custom_fields` | [Doc] |
| Set `is_active=false` (as a possible "drop") | `PATCH /matches/{id}/` | writable [Doc]; whether it is a drop [Test] |
| Remove the test note | `DELETE …/notes/{id}/` | documented for candidate notes; for match notes [Test] |

**Result:** evidence for the open decision on whether client decisions are written to Manatal, as what, and by whom, and for how a client decline would map: a match note, a custom field, a drop, or nothing (a recruiter acts).

## Questions for Manatal support (optional, in parallel)
From the internal research: webhook payload, signing, retries and delay; more webhook events (notes, attachments, resumes, deletions); whether file links expire or need the token; read-only or per-user tokens; a sandbox account; who issues tokens.

## Local fake inbound preview (prepared while approval is pending; not Manatal verification)
`scripts/manatal/import-preview.mjs` builds an in-memory, staff-side import preview from a **fake** Manatal (`scripts/manatal/fake-source.mjs`, fictional records in `fake-fixtures.mjs`) using the explicit, provisional mapping in `inbound-mapping.mjs`. Tests: `scripts/manatal/import-preview.test.mjs` (part of `npm test`).
- It accepts only the fake source's base URL and a passed-in fake `fetch`; it makes no network request, uses no token, writes nothing and publishes nothing. Every preview item is `unpublished` and not client-visible; stage mappings are provisional staff-side labels that never grant visibility.
- Ids stay opaque strings; only allowlisted fields are kept (no contact details, files, notes or custom fields). Organisations reach a portal client only through an explicit allowlist.
- Change detection compares every allowlisted field and link of the match, job, candidate and organisation separately, with timestamps compared as instants (ISO 8601 with an offset; a missing or invalid timestamp is rejected): a later instant is a change, an earlier one is stale, and different content at the same instant is a conflict. If any linked record is stale, conflicting or invalid, the whole item is rejected: no changes, no transitions, and its last accepted state is kept. Identical duplicates in one run collapse; the same id with different content makes the run inconsistent and non-actionable. A missing record, failed request or incomplete run never implies deletion, withdrawal or reassignment; a changed organisation or client (including a move between two organisations mapped to the same client) is flagged as reassignment and routed to neither client. Only complete, consistent runs become the next comparison baseline.
- **Limits:** fake responses test local handling only. Manatal's real field names and types, id types, pagination and ordering, change signals (`updated_at` behaviour), error bodies and rate-limit headers are unverified until step 1 above runs on approved records. Backoff is a fixed local schedule, not based on Manatal headers. Stage transitions are only those observed between two accepted runs: moves between runs that were never observed are not captured. Deletion, merges, reassignment handling and reconciliation of published records are later work.

## Out of scope here
Webhooks, polling, the outbox, any sync code, the `manatal_links` mapping table (to be added later as its own migration once step 1 confirms id types), real candidates.
