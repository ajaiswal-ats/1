/* Stage-change API tests with the four existing test users (see api-moves-lib.mjs). Public key and user sessions only.
   Without --confirm it only prints the plan: no settings or passwords are read and nothing is sent.
   With --confirm it writes a run record to supabase/runs/ (gitignored; no secrets) before the first move, updates it after
   every request, and finally writes the matching restore SQL next to it. It never runs the restore.
   Usage: npm run db:api:moves                                   (print the plan)
          npm run db:api:moves -- --confirm                      (run the tests; writes the record and restore SQL)
          npm run db:api:moves -- --restore-sql <record.json>    (write the restore SQL again from a record) */
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadEnv } from "./env.mjs";
import { checkPublicKey, checkUrl } from "./api-read-lib.mjs";
import { STEPS, TARGETS, newRecord, restoreSql, runMoves } from "./api-moves-lib.mjs";
import { readPasswords } from "./passwords.mjs";

const RUNS = path.join(ROOT, "supabase/runs");
const rel = (p) => path.relative(ROOT, p);
const writeAtomic = (file, text) => { fs.writeFileSync(`${file}.tmp`, text, { mode: 0o600 }); fs.renameSync(`${file}.tmp`, file); };

const i = process.argv.indexOf("--restore-sql");
if (i > 0) {
  const file = process.argv[i + 1];
  if (!file || !fs.existsSync(file)) { console.error("Usage: npm run db:api:moves -- --restore-sql supabase/runs/<record>.json"); process.exit(2); }
  const out = file.replace(/\.json$/, ".restore.sql");
  writeAtomic(out, restoreSql(JSON.parse(fs.readFileSync(file, "utf8"))));
  console.log(`Wrote ${rel(path.resolve(out))}. Review it, then run it yourself in the SQL Editor. Nothing was run.`);
  process.exit(0);
}

if (!process.argv.includes("--confirm")) {
  const fmt = (r) => `[${r.who}] client_move_stage(${r.ref}, ${r.to}, expected version ${r.v}, key ${r.key})`;
  console.log(`Plan only: nothing was read or sent. Re-run with --confirm after approval.

1. Sign in the four test users (public key). Stop if any sign-in fails.
2. Pre-flight, reads only: stop before any move unless ${Object.entries(TARGETS).filter(([, t]) => !t.unpublished).map(([r, t]) => `${r} is ${t.stage} v${t.version}`).join(", ")},
   Harbor has 23 events and Northwind 1, all from the seed. Record each target's id, stage, version and updated_at.
3. Requests (POST /rest/v1/rpc/client_move_stage unless noted; keys K1–K13 are new random values for this run):
${STEPS.map((s) => `   ${s.id.padEnd(5)} ${s.what}\n${s.patch ? `         [${s.patch.who}] PATCH /rest/v1/submissions?id=eq.<${s.patch.ref}> ${JSON.stringify(s.patch.body)}` : s.reqs.map((r) => `         ${fmt(r)}`).join(s.pair ? "\n         (at the same moment)\n" : "\n")}`).join("\n")}
4. Reads only: Harbor has 26 events (3 from the portal); tb-isl, tb-rsm and Northwind are unchanged.
5. Sign out every session, even after a failure.

Writes this run can make (all kept; nothing is rolled back):
   public.submissions        ab-fsr → Interview v2, en-pa → Interview or Offer v2, pr-isl → Interview v2 (stage, version, updated_at)
   public.submission_events  3 new portal events by the Harbor test member
   app_private.idempotency_keys  3 rows (K1, the winner of K3/K4, K5)
   Auth: sign-in/sign-out records for the four users (sessions, last sign-in, audit log)
Local files: supabase/runs/api-moves-<time>-<run>.json (keys, target ids, baselines, responses; no secrets) and .restore.sql`);
  process.exit(0);
}

const env = loadEnv(["SUPABASE_URL", "SUPABASE_ANON_KEY"]);
if (!checkUrl(env.SUPABASE_URL)) { console.error("Stopped: SUPABASE_URL should be https://<project-ref>.supabase.co. Nothing was sent."); process.exit(2); }
const k = checkPublicKey(env.SUPABASE_ANON_KEY);
if (!k.ok) { console.error(`Stopped: ${k.why}. Nothing was sent.`); process.exit(2); }
const passwords = await readPasswords();

const project = new URL(env.SUPABASE_URL).hostname.split(".")[0];
const record = newRecord(project);
fs.mkdirSync(RUNS, { recursive: true, mode: 0o700 });
const file = path.join(RUNS, `api-moves-${record.createdAt.replace(/[-:]/g, "").replace(/\..*/, "")}-${record.runId.slice(0, 8)}.json`);
const save = (r) => writeAtomic(file, JSON.stringify(r, null, 2) + "\n");
const writeRestore = () => { const out = file.replace(/\.json$/, ".restore.sql"); writeAtomic(out, restoreSql(record)); return out; };
save(record);
console.log(`Project ${project}, ${k.kind}. Run record: ${rel(file)}\n`);

let fails = 1;
try {
  fails = await runMoves({ fetch, url: env.SUPABASE_URL, key: env.SUPABASE_ANON_KEY, passwords, log: console.log, record, save });
} finally {
  const out = writeRestore();
  const sent = record.requests.filter((r) => !r.patch);
  console.log(`\n${fails ? `${fails} check(s) failed.` : "All checks passed."} ${sent.length} move request(s) sent, ${sent.filter((r) => r.status === 200).length} answered 200, ${sent.filter((r) => r.state !== "answered").length} unanswered.`);
  console.log(`Restore SQL (not run): ${rel(out)}\nReview it, then run it yourself in the SQL Editor to return to the fictional baseline.`);
}
process.exit(fails ? 1 : 0);
