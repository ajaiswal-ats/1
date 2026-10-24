/* Read-only Manatal feasibility harness (see feasibility-lib.mjs and manatal/FEASIBILITY-CHECKLIST.md).
   Without --run it only prints what it would request: nothing is read or sent.
   With --run --confirm-dummy it reads:
     manatal/.env.manatal.local     MANATAL_API_TOKEN=… (gitignored, chmod 600; created by you, never pasted in chat)
     manatal/targets.local.json     the four explicit dummy ids and the dummy tag (gitignored; template targets.example.json)
   and writes the redacted report to manatal/runs/feasibility-<time>.json (gitignored, chmod 600). The token is never printed.
   Usage: node scripts/manatal/feasibility.mjs                       (plan only)
          node scripts/manatal/feasibility.mjs --run --confirm-dummy (after approval) */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { BASE_URL, ENDPOINTS, MAX_REQUESTS, runFeasibility, validateTargets } from "./feasibility-lib.mjs";

const ROOT = path.resolve(import.meta.dirname, "../.."), DIR = path.join(ROOT, "manatal");
const TOKEN_FILE = path.join(DIR, ".env.manatal.local"), TARGETS_FILE = path.join(DIR, "targets.local.json"), RUNS = path.join(DIR, "runs");
const rel = (p) => path.relative(ROOT, p);
const ignored = (f) => spawnSync("git", ["check-ignore", "-q", f], { cwd: ROOT }).status === 0;

if (!process.argv.includes("--run")) {
  console.log(`Plan only: nothing was read or sent.

Base URL ${BASE_URL}; GET only; at most ${MAX_REQUESTS} requests, spaced out; explicit dummy ids only (no list of candidates, jobs or matches).
In order, stopping at the first problem:
  1. ${ENDPOINTS.match({ match_id: "<match_id>" })}          the match must link the configured job, candidate and organisation
  2. ${ENDPOINTS.candidate({ candidate_id: "<candidate_id>" })}  the candidate must carry the configured dummy tag, before anything about it is kept
  3. ${ENDPOINTS.job({ job_id: "<job_id>" })}  and  ${ENDPOINTS.organization({ organization_id: "<organization_id>" })}   the job must belong to that organisation
  4. ${ENDPOINTS.pipeline({}, { pipelineId: "<match.job_pipeline_stage.job_pipeline>" })}   stage names and ranks
  5. ${ENDPOINTS.matchNotes({ match_id: "<match_id>" })}, ${ENDPOINTS.matchActivities({ match_id: "<match_id>" })}, ${ENDPOINTS.candidateAttachments({ candidate_id: "<candidate_id>" })}, ${ENDPOINTS.candidateResume({ candidate_id: "<candidate_id>" })}
     counts, field names and activity types only
Kept: ids and their types, field names and types, stage, is_active, milestone and update timestamps, custom-field names,
whether external_id / a resume file exist. Never kept: names, contact details, note text, custom-field values, file links.
To run (after approval): create ${rel(TOKEN_FILE)} and ${rel(TARGETS_FILE)} (see manatal/FEASIBILITY-CHECKLIST.md), then
  node scripts/manatal/feasibility.mjs --run --confirm-dummy`);
  process.exit(0);
}
if (!process.argv.includes("--confirm-dummy")) { console.error("Stopped: add --confirm-dummy to confirm that only the admin-created dummy records are targeted."); process.exit(2); }

for (const f of [TOKEN_FILE, TARGETS_FILE]) {
  if (!fs.existsSync(f)) { console.error(`Stopped: ${rel(f)} is missing (see manatal/FEASIBILITY-CHECKLIST.md). Nothing was sent.`); process.exit(2); }
  if (!ignored(f)) { console.error(`Stopped: ${rel(f)} is not gitignored. Nothing was sent.`); process.exit(2); }
}
if (fs.statSync(TOKEN_FILE).mode & 0o077) { console.error(`Stopped: ${rel(TOKEN_FILE)} is readable by others. Run: chmod 600 ${rel(TOKEN_FILE)}`); process.exit(2); }
const token = (fs.readFileSync(TOKEN_FILE, "utf8").match(/^\s*MANATAL_API_TOKEN\s*=\s*(\S+)\s*$/m) || [])[1];
const targets = JSON.parse(fs.readFileSync(TARGETS_FILE, "utf8"));
const problems = validateTargets(targets);
if (!token || problems.length) { console.error(`Stopped: ${[!token && "no MANATAL_API_TOKEN", ...problems].filter(Boolean).join("; ")}. Nothing was sent.`); process.exit(2); }

const report = await runFeasibility({ fetch, token, targets });
fs.mkdirSync(RUNS, { recursive: true, mode: 0o700 });
const out = path.join(RUNS, `feasibility-${report.startedAt.replace(/[-:]/g, "").replace(/\..*/, "")}.json`);
fs.writeFileSync(out, JSON.stringify(report, null, 2).split(token).join("<hidden>") + "\n", { mode: 0o600 });
console.log(`${report.requests.length} GET request(s). ${report.stopped ? `Stopped: ${report.stopped}` : "Completed."}\nRedacted report: ${rel(out)}`);
process.exit(report.stopped ? 1 : 0);
