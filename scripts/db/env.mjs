/* Local settings for the hosted development database. Values are read from supabase/.env.dev.local and never printed.
   Privileged values are used only by these scripts (Node and psql), never by browser code. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const ENV_FILE = path.join(ROOT, "supabase/.env.dev.local");
const PRIVILEGED = ["SUPABASE_DB_URL", "SUPABASE_SERVICE_ROLE_KEY"];

/** Reads only the named settings (required, then optional); anything else in the file is ignored, not kept in memory. */
export function loadEnv(required, optional = []) {
  if (!fs.existsSync(ENV_FILE)) {
    console.error(`Missing ${path.relative(ROOT, ENV_FILE)}. Copy supabase/.env.example to it and fill it in on this machine (never in chat).`);
    process.exit(2);
  }
  const env = {};
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    env[m[1]] = /^(['"]).*\1$/.test(m[2]) ? m[2].slice(1, -1) : m[2];
  }
  const exposed = Object.keys(env).filter((k) => k.startsWith("VITE_"));
  if (exposed.length) { console.error(`Refusing to run: ${exposed.join(", ")} would be exposed to browser code by Vite. Use the names in supabase/.env.example.`); process.exit(2); }
  const missing = required.filter((k) => !env[k]);
  if (missing.length) { console.error(`Missing in ${path.relative(ROOT, ENV_FILE)}: ${missing.join(", ")}`); process.exit(2); }
  return Object.fromEntries([...required, ...optional].filter((k) => env[k]).map((k) => [k, env[k]]));
}

/* New-style keys (sb_publishable_…, sb_secret_…) go in the apikey header only; legacy JWT keys also go in Authorization. [Test] */
export const keyHeaders = (key) => ({ apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}) });

/** The project reference in each setting (not secret), so they can be checked against each other and the dashboard. */
export function projectRefs(env) {
  const refs = {};
  if (env.SUPABASE_URL) refs.url = new URL(env.SUPABASE_URL).hostname.split(".")[0];
  if (env.SUPABASE_DB_URL) {
    const u = new URL(env.SUPABASE_DB_URL), user = decodeURIComponent(u.username);
    refs.db = user.includes(".") ? user.split(".").slice(1).join(".") : u.hostname.match(/^db\.([^.]+)\.supabase\.co$/)?.[1] ?? "(not found in connection string)";
    /* Session pooler hosts name the region, e.g. aws-0-ap-south-1.pooler.supabase.com (not secret). */
    refs.region = u.hostname.match(/^aws-\d+-([a-z0-9-]+)\.pooler\.supabase\.com$/)?.[1] ?? "(not a Session pooler host)";
  }
  return refs;
}

/** Runs psql against the database, passing the connection as environment variables so no secret appears in the command line. */
export function psql(env, args, { input } = {}) {
  const u = new URL(env.SUPABASE_DB_URL);
  const r = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8", input,
    env: { ...process.env, PGHOST: u.hostname, PGPORT: u.port || "5432", PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password),
      PGDATABASE: u.pathname.slice(1) || "postgres", PGSSLMODE: "require", PGAPPNAME: "client-portal-v1-dev-scripts" },
  });
  const scrub = (s) => PRIVILEGED.reduce((t, k) => (env[k] ? t.split(env[k]).join("<hidden>") : t), s || "");
  return { status: r.status, stdout: scrub(r.stdout), stderr: scrub(r.stderr) };
}
