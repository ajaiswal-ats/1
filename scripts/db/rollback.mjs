/* Undoes milestone 1 on the hosted development database: first drops everything the migration created (one transaction),
   then deletes the fictional test users from Auth. See rollback-lib.mjs for why this order, and what a partial failure leaves.
   Refuses to run without --confirm. Usage: npm run db:rollback -- --confirm */
import path from "node:path";
import { ROOT, loadEnv, psql } from "./env.mjs";
import { deleteUsers } from "./users.mjs";
import { runRollback } from "./rollback-lib.mjs";

if (!process.argv.includes("--confirm")) { console.log("Not rolled back. Re-run with --confirm to remove milestone 1 from the hosted development database."); process.exit(1); }
const env = loadEnv(["SUPABASE_URL", "SUPABASE_DB_URL"], ["SUPABASE_SERVICE_ROLE_KEY"]);
const result = await runRollback({
  dropDatabaseObjects: () => {
    const r = psql(env, ["-f", path.join(ROOT, "supabase/rollback/20261023120000_m1_down.sql")]);
    if (r.status !== 0) throw new Error(r.stderr.trim() || `psql exited ${r.status}`);
  },
  deleteTestUsers: env.SUPABASE_SERVICE_ROLE_KEY ? () => deleteUsers(env) : null,
});
if (result.ok) console.log("Check with: npm run db:verify (it should report the project as empty again)");
process.exit(result.ok ? 0 : 1);
