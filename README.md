# Client Portal V1

The Talent Solutions client portal, rebuilt from the `client-workspace-v1-visual-2h` prototype. It runs in two separate modes: the **demo** (default), the reviewed workspace with fictional local data, where client actions are demo changes saved in this browser and nothing is sent anywhere; and **Supabase mode**, which signs in to the development Supabase project with fictional test accounts. There are no integrations and no deployment.

## Status (checkpoint, 24 Oct 2026)
**Complete**
- Demo workspace: shell, Candidates, candidate page with actions, Roles, Hiring progress, persistence. Matches 2h pixel for pixel (`compare:*`).
- Database milestone 1 on the hosted development project (fictional data only): tenancy, published/unpublished submissions, versioned stage history, idempotent `client_move_stage`. Verified there by the SQL Editor access tests (123/123), the read-only Auth and Data API checks, and the API stage-change tests with targeted restore (database back at baseline). See `supabase/README.md`.
- Supabase mode, sign-in and session handling (`src/auth/`): invitation-only email and password sign-in, session restore and refresh, sign-out, account-change handling, and clear states for no access, load errors and misconfiguration. Tested offline (`npm test`, `npm run check:auth`).

**Not connected yet (Supabase mode)**
- Database-backed workspace pages: Candidates, candidate pages, Roles and Hiring progress show a "not connected yet" placeholder after sign-in.
- Client actions (stage moves, feedback, declines) from the UI.

**Not verified yet**
- Sign-in and session handling in the browser against the hosted project. So far they are tested only offline, against a stand-in for Supabase.

**Next step: manual hosted sign-in test with the four existing fictional accounts**
1. Copy `.env.example` to `.env.local` (gitignored) and set `VITE_PORTAL_MODE=supabase`, the project URL and the public key; restart `npm run dev`. Run `npm run db:check-secrets`.
2. Sign in as each account (passwords from your password manager, never in chat or files in the repository):
   - `portal-test-harbor@example.com`: the shell with Harbor Industrial Supply and Maria Alvarez (test).
   - `portal-test-northwind@example.com`: the shell with Northwind Fictional Co.
   - `portal-test-harbor-inactive@example.com` and `portal-test-no-membership@example.com`: "No workspace access".
3. Check reload restores the session, sign-out returns to sign-in, and switching accounts never shows the previous client.
This sends real sign-in requests only; no application data changes.

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
```

Only the public key may go there (everything prefixed `VITE_` is built into the browser bundle; `npm run db:check-secrets` fails on a secret key). In Supabase mode (`src/auth/`):
- Sign-in with email and password, by invitation only: no sign-up and no password reset. The session is saved in this browser, restored on reload and refreshed automatically.
- After sign-in, the user's own membership and client are read (row-level security). An inactive or unassigned account gets one "No workspace access" state: the database deliberately does not tell the browser which of the two it is.
- An active member gets the reviewed shell (sidebar, top bar, page) with the client's name and the member's name and job title, and a placeholder where workspace data will appear. Candidates, roles, reports and stage actions are not connected yet.
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
- `src/lib/`: dates, hash routing, theme and remembered page controls
