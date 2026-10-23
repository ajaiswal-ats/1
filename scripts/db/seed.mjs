/* Resets the fictional seed rows (roles, people, submissions, events) to their starting state. Memberships and users are kept.
   Usage: npm run db:seed */
import path from "node:path";
import { ROOT, loadEnv, psql } from "./env.mjs";

export function reseed(env) {
  const r = psql(env, ["-f", path.join(ROOT, "supabase/seed/m1_fictional.sql")]);
  if (r.status !== 0) throw new Error(`seed: ${r.stderr.trim()}`);
}
if (import.meta.url === `file://${process.argv[1]}`) { reseed(loadEnv(["SUPABASE_DB_URL"])); console.log("fictional seed reset"); }
