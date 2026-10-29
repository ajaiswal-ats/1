# Shared shell and Candidates review — 29 October 2026

Review URLs: updated app http://127.0.0.1:5173/#candidates (existing fictional demo mode); reference http://127.0.0.1:5181/#candidates. No environment files were changed. Local servers must remain running to use these URLs.

The reference is `../client-portal-sample-1/`, including the 29 October status-band cards and compact filter toolbar. Brand PDFs in `../brand-reference/` were read for colours, Satoshi and logo usage. This continues the existing React app and Claude's shell styling.

## Scope

- Shared shell: existing theme and sign-out actions moved into the sidebar footer; mobile drawer keyboard focus, background inertness and scroll handling improved. Existing identity, account checks, sign-out callback and mode notices retained.
- Candidates only: reference toolbar, multi-select role/stage filters, search of loaded name/employer/location, sort, removable chips, consistent declined exclusion in both views, results counts, status-band cards, separate screening/client-interview columns and stacked mobile rows.
- `CandidatesView.tsx` is presentation over separate demo/workspace adapters. Existing requirement, waiting, permission and next-step derivations remain the authority. There are no new API calls or mutation controls.
- Other page components and content styles retained. Existing scoring extensions, preview/import work, authentication/session logic and backend files retained.

## Functionality gaps identified before implementation

Read-only list filtering/sorting/chips/mobile filters were implemented using the loaded data. These remaining reference behaviours were deliberately omitted:

- Board drag-and-drop and stage menus need the existing permission, version, confirmation and retry flows. No fake grips or menus are displayed; actions remain on candidate pages.
- Supabase global search is still absent. The demo retains its existing global search.
- Help/support, demo reset and simulated sign-in/sign-out were not copied.
- Additional filters/sort use component state for the current visit. Full URL/filter/scroll restoration from the reference is not ported. The demo retains its pre-existing persistence of the legacy view, single-role, waiting and declined settings; database mode gains no browser-only data store.

Candidate facts were not changed. In particular, legacy demo feedback dates are not presented as interview-held dates, even where the newer reference displays different dates. Missing database content stays explicitly missing. Shared shell changes apply across pages; their page content remains unchanged.

## Verification

- `npm test`: 53 files, 892 tests passed.
- `npm run db:test:offline`: 15 files, 152 tests passed, using in-memory Postgres only.
- `npm run check:auth`: 93/93 browser checks passed against its offline fake service, including account isolation, session handling, version/idempotency/conflict behaviour and candidate actions. No hosted service was contacted.
- `npm run typecheck` and `npm run build`: passed.
- `npm run db:check-secrets`: passed.
- `git diff --check`: passed.
- `node scripts/compare-sample1.mjs`: 30 browser checks passed. Board/list screenshots at 1280, 1440, 1920 and 390 px; no page overflow; filters, counts, empty state, declined consistency, mobile filter sheet, drawer focus and dark theme checked. Candidate styles did not change computed content styles on Roles, Hiring progress, a role detail or a candidate detail page.

Screenshots, the self-contained `comparison.html`, and `review.json` are in `compare-output/sample1-review/` (Git-ignored). Reference left; updated app right. The report contains browser errors and blocked external requests. The reference's Google Fonts requests were blocked; Candidates uses the supplied local Satoshi fonts in both pages.

The existing test assertions/harness selectors were updated for the new Candidates markup and consistent declined behaviour. No database changes, paid AI calls, live API checks, commits, pushes or deployment were performed. Hosted signed-in behaviour remains unverified in this task. Stop for review.
