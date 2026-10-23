/* Read-only Auth and Data API checks with the four existing test users (see api-read-lib.mjs).
   Without --confirm it only prints the planned requests: no settings or passwords are read and nothing is sent.
   Settings: SUPABASE_URL and SUPABASE_ANON_KEY (the public key) from supabase/.env.dev.local. Nothing privileged is read.
   Passwords: typed at hidden prompts (default; never stored), or from supabase/.env.test-users.local if that file exists
   (it must be gitignored and readable only by you, chmod 600). They are never printed.
   Usage: npm run db:api:read                (print the plan)
          npm run db:api:read -- --confirm   (sign in, read, sign out) */
import { loadEnv } from "./env.mjs";
import { READS, USERS, checkPublicKey, checkUrl, runChecks } from "./api-read-lib.mjs";
import { readPasswords } from "./passwords.mjs";

if (!process.argv.includes("--confirm")) {
  console.log(`Plan only: nothing was read or sent. Re-run with --confirm after approval.

1. Sign in (POST /auth/v1/token?grant_type=password, public key), expecting HTTP 200 and a session for role authenticated:
${USERS.map((u) => `   - ${u.email} (${u.label})`).join("\n")}
   Then one sign-in with a random wrong password for ${USERS[3].email}, expecting HTTP 400.
   Then GET /auth/v1/user with each session, expecting HTTP 200 and the same user.
2. ${READS.length} Data API reads, all GET (no writes, no stage moves):
${READS.map((q) => `   - [${q.who}] GET ${q.profile ? `${q.profile}.` : ""}${q.path}${q.note ? `  (${q.note})` : ""}`).join("\n")}
3. Sign out each session (POST /auth/v1/logout?scope=local), even if a check fails.`);
  process.exit(0);
}

const env = loadEnv(["SUPABASE_URL", "SUPABASE_ANON_KEY"]);
if (!checkUrl(env.SUPABASE_URL)) { console.error("Stopped: SUPABASE_URL should be https://<project-ref>.supabase.co. Nothing was sent."); process.exit(2); }
const k = checkPublicKey(env.SUPABASE_ANON_KEY);
if (!k.ok) { console.error(`Stopped: ${k.why}. Nothing was sent.`); process.exit(2); }

const passwords = await readPasswords();
console.log(`Project ${new URL(env.SUPABASE_URL).hostname.split(".")[0]}, ${k.kind}. Sending read-only requests…\n`);
const fails = await runChecks({ fetch, url: env.SUPABASE_URL, key: env.SUPABASE_ANON_KEY, passwords, log: console.log });
console.log(fails ? `\n${fails} check(s) failed.` : "\nAll checks passed.");
process.exit(fails ? 1 : 0);
