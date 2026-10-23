/* Read-only check of the hosted development project before anything is applied.
   1. Identity: the project reference in SUPABASE_URL and in SUPABASE_DB_URL must match (confirm it against the dashboard).
   2. Empty: no application schemas, tables, views or functions; no auth users; no storage buckets or files; no migration history.
      Tables that may be missing or unreadable are checked first and reported as such (anything unreadable is a STOP).
   Needs only SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_DB_URL; the service role key is not read.
   Every database query runs inside a READ ONLY transaction. Nothing is written. No secret is printed.
   Usage: npm run db:verify */
import { keyHeaders, loadEnv, projectRefs, psql } from "./env.mjs";
import { VERIFY_SQL, assess, parseRows } from "./verify-lib.mjs";

const env = loadEnv(["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_DB_URL"]);
let ok = true;
const line = (label, value, good = true) => { if (!good) ok = false; console.log(`${good ? "OK  " : "STOP"} ${label}: ${value}`); };

const refs = projectRefs(env);
for (const [label, value, good] of assess({}, refs).slice(0, 2)) line(label, value, good);
console.log(`INFO region in the connection string: ${refs.region} (compare with the dashboard)`);

/* Public API: answers with this project's anon key (no data is read: the root only lists what is exposed). */
const api = await fetch(`${env.SUPABASE_URL}/rest/v1/`, { headers: keyHeaders(env.SUPABASE_ANON_KEY) }).catch((e) => ({ ok: false, status: String(e) }));
let exposed = [];
if (api.ok) exposed = Object.keys((await api.json()).paths || {}).filter((p) => p !== "/");
line("Data API answers with the anon key", api.ok ? `HTTP ${api.status}` : `failed (${api.status})`, api.ok);
line("tables or functions exposed by the Data API", exposed.length ? exposed.join(", ") : "none", exposed.length === 0);
const auth = await fetch(`${env.SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: env.SUPABASE_ANON_KEY } }).catch(() => null);
if (auth?.ok) { const s = await auth.json(); console.log(`INFO Auth: public sign-up ${s.disable_signup ? "disabled" : "ENABLED"}, email confirmation ${s.mailer_autoconfirm ? "off" : "on"}`); }

const r = psql(env, ["-f", "-"], { input: VERIFY_SQL });
if (r.status !== 0) { line("database connection (read-only)", r.stderr.trim() || `psql exited ${r.status}`, false); process.exit(1); }
const v = parseRows(r.stdout);
for (const [label, value, good] of assess(v, refs).slice(2)) line(label, value, good);
console.log(`INFO extensions installed: ${v.extensions}`);
console.log(ok ? "\nRESULT: the project looks empty. Confirm the reference above matches the dashboard before approving the migration."
  : "\nRESULT: STOP. Something above is not empty or does not match. Nothing was changed.");
process.exit(ok ? 0 : 1);
