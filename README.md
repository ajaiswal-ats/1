# Client Portal V1

The Talent Solutions client portal, rebuilt from the `client-workspace-v1-visual-2h` prototype. It uses **fictional local data only**: there is no back end, no sign-in, no integrations and no deployment yet. Client actions on the candidate page are demo changes saved in this browser (clear the site's data to start again); nothing is sent anywhere.

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
```

The comparisons exit with an error on any unexpected difference. They open 2h read-only from `../client-workspace-v1-visual-2h` and write screenshots and diffs to `compare-output/`. See `ASSUMPTIONS.md` for the decisions made where 2h or the scope documents leave behaviour open.

## Layout
- `src/styles/`: 2h's colours, base, shell, Hiring progress, Candidates, candidate page and Roles styles, copied verbatim
- `src/components/`: sidebar, top bar, tooltip, toast, icons
- `src/reporting/`: Hiring progress calculations (no React), with tests against 2h's reference numbers and stage-move scenarios
- `src/progress/`: the Hiring progress page and its four charts
- `src/data/`: the fictional dataset from 2h, and the provider every page reads it through (it replays the demo changes saved in this browser)
- `src/domain/`: candidate rules and client actions shared by every page (no React)
- `src/candidates/`: the Candidates page (Pipeline, List) and the candidate page with its actions
- `src/roles/`: the Roles page and role pages
- `src/lib/`: dates, hash routing, theme and remembered page controls
