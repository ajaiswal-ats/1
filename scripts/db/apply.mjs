/* Applies milestone 1 to the hosted development database: re-checks that the project is empty, applies the migration in one
   transaction, loads the fictional seed, and creates the fictional test users and their memberships.
   Refuses to run without --confirm. Usage: npm run db:apply -- --confirm */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { ROOT, loadEnv, psql } from "./env.mjs";
import { ensureUsers } from "./users.mjs";

const MIGRATION = "supabase/migrations/20261023120000_m1_tenancy_stage_events.sql", SEED = "supabase/seed/m1_fictional.sql";
if (!process.argv.includes("--confirm")) { console.log(`Not applied. This changes the hosted development database. Re-run with --confirm after approval.\n  migration: ${MIGRATION}\n  seed: ${SEED}`); process.exit(1); }
const env = loadEnv(["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_DB_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

console.log("1/4 read-only check that the project is still empty");
const v = spawnSync("node", [path.join(ROOT, "scripts/db/verify-project.mjs")], { stdio: "inherit" });
if (v.status !== 0) { console.error("Stopped: the project is not empty or the settings do not match. Nothing was applied."); process.exit(1); }

const run = (label, file) => {
  console.log(label);
  const r = psql(env, ["-f", path.join(ROOT, file)]);   /* each file is its own transaction (begin … commit) */
  if (r.status !== 0) { console.error(`Stopped: ${r.stderr.trim()}\nThe transaction was rolled back; nothing from this step was kept.`); process.exit(1); }
};
run("2/4 migration (its own transaction)", MIGRATION);
run("3/4 fictional seed", SEED);
console.log("4/4 fictional test users and memberships");
await ensureUsers(env);
console.log("Applied. Next: npm run db:test:sql and npm run db:test:api");
