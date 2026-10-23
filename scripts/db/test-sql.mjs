/* Database-level access tests (supabase/tests/m1_access.sql). They switch to the anon and authenticated roles with
   the same JWT claims the Data API sets, so row-level security and grants apply exactly as for real requests.
   Everything runs in one transaction that is rolled back: no test changes are kept.
   Usage: npm run db:test:sql */
import path from "node:path";
import { ROOT, loadEnv, psql } from "./env.mjs";
import { ensureUsers } from "./users.mjs";
import { reseed } from "./seed.mjs";

const env = loadEnv(["SUPABASE_URL", "SUPABASE_DB_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
await ensureUsers(env);
reseed(env);
const r = psql(env, ["-f", path.join(ROOT, "supabase/tests/m1_access.sql")]);
const lines = `${r.stdout}\n${r.stderr}`.split("\n").map((l) => l.replace(/^(psql:[^:]*:\d+: )?NOTICE:\s+/, "")).filter((l) => /^(PASS|FAIL) /.test(l));
lines.forEach((l) => console.log(l));
const fails = lines.filter((l) => l.startsWith("FAIL")).length, passes = lines.length - fails;
if (r.status !== 0) console.error(`\npsql stopped with an error:\n${r.stderr.split("\n").filter((l) => !/NOTICE/.test(l)).join("\n").trim()}`);
console.log(`\n${passes}/${lines.length} passed`);
process.exit(r.status === 0 && fails === 0 && passes > 0 ? 0 : 1);
