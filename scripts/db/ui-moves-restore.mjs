/* Writes the cleanup SQL for a manual UI stage-change test run next to its development test-run record. It never runs it.
   Usage: npm run db:ui-moves:restore-sql -- supabase/runs/ui-moves-<time>-<run>.json */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";
import { uiRestoreSql } from "./ui-moves-lib.mjs";

const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error("Usage: npm run db:ui-moves:restore-sql -- supabase/runs/ui-moves-<time>-<run>.json"); process.exit(2); }
const run = JSON.parse(fs.readFileSync(file, "utf8")), out = file.replace(/\.json$/, ".restore.sql");
fs.writeFileSync(`${out}.tmp`, uiRestoreSql(run), { mode: 0o600 }); fs.renameSync(`${out}.tmp`, out);
const sent = run.entries.filter((e) => e.phase === "sent"), answered = new Set(run.entries.filter((e) => e.phase === "outcome").map((e) => e.key));
console.log(`Wrote ${path.relative(ROOT, path.resolve(out))}: ${sent.length} recorded request(s), ${new Set(sent.map((e) => e.key)).size} key(s), ${new Set(sent.map((e) => e.key)).size - answered.size} without a recorded answer.
Review it, then run it yourself in the SQL Editor. Nothing was run.`);
