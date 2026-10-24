/* Fails if a privileged Supabase value, or any SUPABASE_ setting name, appears in browser code (src/, index.html) or the
   built app (dist/), or if the browser settings (.env.local) hold anything but the public key. Values are compared but never printed. Usage: npm run db:check-secrets (after npm run build). */
import fs from "node:fs";
import path from "node:path";
import { ROOT, ENV_FILE, loadEnv } from "./env.mjs";
import { checkPublicKey } from "./api-read-lib.mjs";

const isPublicKey = (k) => checkPublicKey(k).ok;

const env = fs.existsSync(ENV_FILE) ? loadEnv([], ["SUPABASE_DB_URL", "SUPABASE_SERVICE_ROLE_KEY"]) : {};
const secrets = ["SUPABASE_DB_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => env[k]).map((k) => [k, env[k]]);
/* The Manatal feasibility token (local only) must never reach browser code, the build or the browser settings. */
const manatalFile = path.join(ROOT, "manatal/.env.manatal.local");
const manatalToken = fs.existsSync(manatalFile) ? (fs.readFileSync(manatalFile, "utf8").match(/^\s*MANATAL_API_TOKEN\s*=\s*(\S+)\s*$/m) || [])[1] : null;
if (manatalToken) secrets.push(["MANATAL_API_TOKEN", manatalToken]);
const files = [];
const walk = (d) => { if (!fs.existsSync(d)) return; for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); f.isDirectory() ? walk(p) : files.push(p); } };
walk(path.join(ROOT, "src")); walk(path.join(ROOT, "dist")); files.push(path.join(ROOT, "index.html"));
let bad = 0;
for (const f of files) {
  const text = fs.readFileSync(f, "latin1"), rel = path.relative(ROOT, f);
  for (const [k, v] of secrets) if (v && text.includes(v)) { console.log(`FAIL ${rel} contains the value of ${k}`); bad++; }
  if (/SUPABASE_(DB_URL|SERVICE_ROLE_KEY)|service_role/i.test(text) && !rel.endsWith(".test.ts")) { console.log(`FAIL ${rel} mentions a privileged Supabase setting`); bad++; }
  if (/MANATAL_API_TOKEN|api\.manatal\.com/i.test(text)) { console.log(`FAIL ${rel} mentions the Manatal API or its token (browser code must never call Manatal)`); bad++; }
}
/* Browser settings (.env.local / .env): only the public key may be given to Vite, and no privileged value at all. */
for (const name of [".env", ".env.local", ".env.development.local", ".env.production.local"]) {
  const f = path.join(ROOT, name);
  if (!fs.existsSync(f)) continue;
  const text = fs.readFileSync(f, "utf8");
  for (const [k, v] of secrets) if (v && text.includes(v)) { console.log(`FAIL ${name} contains the value of ${k}`); bad++; }
  const key = text.match(/^\s*VITE_SUPABASE_ANON_KEY\s*=\s*['"]?([^'"\s]*)/m)?.[1];
  if (key && !isPublicKey(key)) { console.log(`FAIL ${name}: VITE_SUPABASE_ANON_KEY is not a public (publishable or anon) key`); bad++; }
}
console.log(bad ? `\n${bad} problem(s) found` : `PASS no privileged Supabase value or setting in ${files.length} browser and build files${secrets.length ? "" : " (no local settings file yet: names checked only)"}`);
process.exit(bad ? 1 : 0);
