/* The four test users' passwords, for the scripts that sign in as them. Typed at hidden prompts (default; never stored),
   or read from supabase/.env.test-users.local if that file exists: it must be gitignored and readable only by you (chmod 600).
   Passwords are returned in memory only and never printed. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./env.mjs";
import { USERS } from "./api-read-lib.mjs";

const PASSWORD_FILE = path.join(ROOT, "supabase/.env.test-users.local");
const rel = (p) => path.relative(ROOT, p);

export async function readPasswords() {
  if (fs.existsSync(PASSWORD_FILE)) {
    const mode = fs.statSync(PASSWORD_FILE).mode & 0o777;
    if (mode & 0o077) { console.error(`Stopped: ${rel(PASSWORD_FILE)} is readable by others (mode ${mode.toString(8)}). Run: chmod 600 ${rel(PASSWORD_FILE)}`); process.exit(2); }
    const ignored = spawnSync("git", ["check-ignore", "-q", PASSWORD_FILE], { cwd: ROOT }).status === 0;
    if (!ignored) { console.error(`Stopped: ${rel(PASSWORD_FILE)} is not gitignored.`); process.exit(2); }
    const values = {};
    for (const line of fs.readFileSync(PASSWORD_FILE, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith("#")) values[m[1]] = /^(['"]).*\1$/.test(m[2]) ? m[2].slice(1, -1) : m[2];
    }
    const missing = USERS.filter((u) => !values[u.passwordName]).map((u) => u.passwordName);
    if (missing.length) { console.error(`Stopped: missing in ${rel(PASSWORD_FILE)}: ${missing.join(", ")}`); process.exit(2); }
    console.log(`Passwords: read from ${rel(PASSWORD_FILE)} (not printed).`);
    return Object.fromEntries(USERS.map((u) => [u.key, values[u.passwordName]]));
  }
  if (!process.stdin.isTTY) { console.error(`Stopped: no terminal for hidden password prompts, and no ${rel(PASSWORD_FILE)}.`); process.exit(2); }
  console.log("Passwords: type each one at the prompt. Nothing is shown as you type, and nothing is stored.");
  const out = {};
  for (const u of USERS) out[u.key] = await hiddenPrompt(`  Password for ${u.email}: `);
  return out;
}

/** Reads one line from the terminal without echoing it. */
function hiddenPrompt(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    let value = "";
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") { stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData); process.stdout.write("\n"); resolve(value); return; }
        if (ch === "\u0003") { stdin.setRawMode(false); process.stdout.write("\nCancelled. Nothing was sent.\n"); process.exit(130); }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1); else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

