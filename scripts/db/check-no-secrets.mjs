/* Fails if a privileged Supabase value, or any SUPABASE_ setting name, appears in browser code (src/, index.html) or the
   built app (dist/). Values are compared but never printed. Usage: npm run db:check-secrets (after npm run build). */
import fs from "node:fs";
import path from "node:path";
import { ROOT, ENV_FILE, loadEnv } from "./env.mjs";

const env = fs.existsSync(ENV_FILE) ? loadEnv([], ["SUPABASE_DB_URL", "SUPABASE_SERVICE_ROLE_KEY"]) : {};
const secrets = ["SUPABASE_DB_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => env[k]).map((k) => [k, env[k]]);
const files = [];
const walk = (d) => { if (!fs.existsSync(d)) return; for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); f.isDirectory() ? walk(p) : files.push(p); } };
walk(path.join(ROOT, "src")); walk(path.join(ROOT, "dist")); files.push(path.join(ROOT, "index.html"));
let bad = 0;
for (const f of files) {
  const text = fs.readFileSync(f, "latin1"), rel = path.relative(ROOT, f);
  for (const [k, v] of secrets) if (v && text.includes(v)) { console.log(`FAIL ${rel} contains the value of ${k}`); bad++; }
  if (/SUPABASE_(DB_URL|SERVICE_ROLE_KEY)|service_role/i.test(text) && !rel.endsWith(".test.ts")) { console.log(`FAIL ${rel} mentions a privileged Supabase setting`); bad++; }
}
console.log(bad ? `\n${bad} problem(s) found` : `PASS no privileged Supabase value or setting in ${files.length} browser and build files${secrets.length ? "" : " (no local settings file yet: names checked only)"}`);
process.exit(bad ? 1 : 0);
