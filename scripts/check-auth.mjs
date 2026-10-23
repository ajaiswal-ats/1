/* Browser check of the Supabase portal's sign-in and session handling, fully offline. Exits 1 on any failure.
   It starts its own dev server (port 5174) in Supabase mode with a made-up project URL and public key, and answers every
   request to that made-up project inside the browser (Playwright routes): nothing reaches a real Supabase project, and any
   other outside request fails the check. Screenshots go to compare-output/auth/.
   Usage: npm run check:auth (the demo dev server on 5173 is not needed and is not affected) */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { OUT, ROOT, reporter } from "./lib/compare.mjs";

const REF = "offlinetestproject00", HOST = `${REF}.supabase.co`, PORT = 5174, APP = `http://127.0.0.1:${PORT}/`;
Object.assign(process.env, { VITE_PORTAL_MODE: "supabase", VITE_SUPABASE_URL: `https://${HOST}`, VITE_SUPABASE_ANON_KEY: "sb_publishable_offline_check_only" });
const DIR = path.join(OUT, "auth");
fs.mkdirSync(DIR, { recursive: true });

/* Fictional accounts of the made-up project. */
const USERS = {
  "active@example.com": { id: "11111111-1111-4111-8111-111111111111", member: { id: "m1", client_id: "c1", display_name: "Pat Example (test)", job_title: "Hiring manager" }, client: { id: "c1", name: "Offline Test Client" } },
  "second@example.com": { id: "22222222-2222-4222-8222-222222222222", member: { id: "m2", client_id: "c2", display_name: "Sam Second (test)", job_title: "" }, client: { id: "c2", name: "Second Test Client" } },
  "none@example.com": { id: "33333333-3333-4333-8333-333333333333", member: null },
  "broken@example.com": { id: "44444444-4444-4444-8444-444444444444", member: { id: "m4", client_id: "c4", display_name: "Bo Broken (test)", job_title: "" }, client: { id: "c4", name: "Recovered Test Client" }, failFirst: true },
};
const PASSWORD = "offline-check-password";
const DEMO_STRINGS = ["Taylor Brooks", "Maria Alvarez", "Mockup · fictional data", "Inside Sales Leader"];

const { ck, done } = reporter();
const server = await createServer({ configFile: path.join(ROOT, "vite.config.ts"), server: { port: PORT, strictPort: true, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const external = [], supabaseCalls = [], failed = new Set();

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (u, email) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: u.id, email, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, session_id: u.id })}.offline`;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS", "Access-Control-Expose-Headers": "*" };
const json = (route, status, body) => route.fulfill({ status, headers: { ...cors, "Content-Type": "application/json" }, body: body === undefined ? "" : JSON.stringify(body) });

async function handle(route) {
  const req = route.request(), u = new URL(req.url());
  if (u.protocol === "data:" || u.hostname === "127.0.0.1") return route.continue();
  if (u.hostname !== HOST) { external.push(u.href); return route.abort(); }
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  supabaseCalls.push(`${req.method()} ${u.pathname}${u.search}`);
  if (u.pathname === "/auth/v1/token") {
    const { email, password } = JSON.parse(req.postData() || "{}"), user = USERS[email];
    if (!user || password !== PASSWORD) return json(route, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
    return json(route, 200, { access_token: token(user, email), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `refresh-${user.id}`,
      user: { id: user.id, aud: "authenticated", role: "authenticated", email, app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" } });
  }
  if (u.pathname === "/auth/v1/logout") return route.fulfill({ status: 204, headers: cors });
  const bearer = (req.headers().authorization || "").replace(/^Bearer /, "");
  const sub = (() => { try { return JSON.parse(Buffer.from(bearer.split(".")[1], "base64url").toString()).sub; } catch { return null; } })();
  const [email, user] = Object.entries(USERS).find(([, x]) => x.id === sub) || [];
  if (u.pathname === "/rest/v1/client_members") {
    if (!user) return json(route, 200, []);
    if (user.failFirst && !failed.has(email)) { failed.add(email); return json(route, 500, { message: "Internal error" }); }   /* 500: supabase-js retries 503 by itself */
    return json(route, 200, user.member ? [user.member] : []);
  }
  if (u.pathname === "/rest/v1/clients") return json(route, 200, user?.client && u.searchParams.get("id") === `eq.${user.client.id}` ? [user.client] : []);
  return json(route, 404, { message: "not mocked" });
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.route("**/*", handle);
const errors = [];
const page = async () => { const pg = await ctx.newPage(); pg.on("pageerror", (e) => errors.push(String(e))); await pg.goto(APP + "#candidates"); return pg; };
const h1 = (pg) => pg.innerText("h1");
const waitH1 = (pg, text) => pg.waitForFunction((t) => document.querySelector("h1")?.textContent === t, text, { timeout: 5000 }).then(() => true, () => false);
const body = (pg) => pg.innerText("body");
const waitClient = (pg, name) => pg.waitForFunction((n) => document.querySelector(".shell .client b")?.textContent === n, name, { timeout: 5000 }).then(() => true, () => false);
const noDemo = async (pg, label) => { const t = await body(pg); const hit = DEMO_STRINGS.filter((s) => t.includes(s)); ck(`${label}: no demo data shown`, hit.length === 0, hit.join(", ")); };
const signIn = async (pg, email, password = PASSWORD) => { await pg.fill("#auth-email", email); await pg.fill("#auth-password", password); await pg.click(".auth-submit"); };
const storedSession = (pg) => pg.evaluate((k) => localStorage.getItem(k) !== null, `sb-${REF}-auth-token`);
const shot = async (pg, name, theme = "light") => { await pg.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme); await pg.waitForTimeout(50); await pg.screenshot({ path: path.join(DIR, `${name}-${theme}.png`) }); };

try {
  const A = await page();
  ck("signed out: the sign-in screen is shown", await waitH1(A, "Sign in"));
  ck("signed out: no workspace shell", (await A.$(".shell")) === null);
  ck("signed out: no sign-up or password-reset link", !/sign up|create account|register|forgot/i.test(await body(A)));
  await noDemo(A, "sign-in screen");
  await shot(A, "sign-in"); await shot(A, "sign-in", "dark"); await A.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));

  await signIn(A, "active@example.com", "wrong-password");
  await A.waitForSelector("#auth-error");
  ck("wrong password: explained, still signed out", (await A.innerText("#auth-error")) === "The email or password is incorrect." && (await h1(A)) === "Sign in");
  await shot(A, "sign-in-error");

  await signIn(A, "active@example.com");
  ck("active member: the workspace shell opens", await waitH1(A, "Candidates") && (await A.$(".shell")) !== null);
  ck("active member: sidebar shows the client from the database", (await A.innerText(".client b")) === "Offline Test Client");
  ck("active member: top bar shows the member's name and title", (await A.innerText(".me .who")).replace(/\s+/g, " ") === "Pat Example (test) Hiring manager");
  ck("active member: the session is saved for restoring", await storedSession(A));
  await noDemo(A, "workspace shell");
  await shot(A, "workspace"); await shot(A, "workspace", "dark"); await A.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));

  await A.reload();
  ck("reload: the session is restored without signing in again", await waitH1(A, "Candidates") && (await A.innerText(".client b")) === "Offline Test Client");
  await A.evaluate(() => (location.hash = "#progress"));
  ck("navigation keeps the shell, with no data yet", await waitH1(A, "Hiring progress") && (await A.innerText(".rempty")).startsWith("Workspace data is not connected yet."));

  const before = supabaseCalls.length;
  await A.click("text=Sign out");
  ck("sign-out: back to the sign-in screen", await waitH1(A, "Sign in"));
  ck("sign-out: workspace and client name are gone", (await A.$(".shell")) === null && !(await body(A)).includes("Offline Test Client"));
  ck("sign-out: the saved session is removed", await A.waitForFunction((k) => localStorage.getItem(k) === null, `sb-${REF}-auth-token`, { timeout: 5000 }).then(() => true, () => false));
  ck("sign-out: the session is ended with the sign-in service", supabaseCalls.slice(before).some((c) => c.startsWith("POST /auth/v1/logout")));

  await signIn(A, "none@example.com");
  ck("no active membership: the no-access state, no workspace", await waitH1(A, "No workspace access") && (await A.$(".shell")) === null);
  await noDemo(A, "no-access state");
  await shot(A, "no-access");
  await A.click("text=Sign out"); await waitH1(A, "Sign in");

  await signIn(A, "broken@example.com");
  ck("account load fails: an error state, no workspace and no demo data", await waitH1(A, "Workspace not loaded") && (await A.$(".shell")) === null);
  await noDemo(A, "load-error state");
  await shot(A, "load-error");
  await A.click("text=Try again");
  ck("retry after the failure: the workspace opens", await waitClient(A, "Recovered Test Client"));
  await A.click("text=Sign out"); await waitH1(A, "Sign in");

  /* Account change in another tab of the same browser. */
  await signIn(A, "active@example.com"); await waitClient(A, "Offline Test Client");
  const B = await page();
  ck("second tab: restores the same session", await waitH1(B, "Candidates") && (await B.innerText(".client b")) === "Offline Test Client");
  await B.click("text=Sign out"); await waitH1(B, "Sign in");
  ck("other tab signed out: this tab drops the workspace too", await waitH1(A, "Sign in") && !(await body(A)).includes("Offline Test Client"));
  await signIn(B, "second@example.com"); await waitH1(B, "Candidates");
  ck("other tab signed in as someone else: this tab shows only the new account", await waitClient(A, "Second Test Client") && !(await body(A)).includes("Offline Test Client"));
  ck("a member without a job title shows only the name", (await A.innerText(".me .who")).trim() === "Sam Second (test)");

  ck("the demo's saved actions are never written in Supabase mode", await A.evaluate(() => localStorage.getItem("ro-portal-demo-actions") === null));
  ck("every Supabase request went to the made-up offline project only", supabaseCalls.length > 0 && external.length === 0, external.join(", "));
  ck("reads only: no request other than sign-in, sign-out and GET", supabaseCalls.every((c) => /^(GET \/rest\/v1\/|POST \/auth\/v1\/(token|logout))/.test(c)), supabaseCalls.filter((c) => !/^(GET \/rest\/v1\/|POST \/auth\/v1\/(token|logout))/.test(c)).join(", "));
  ck("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  await server.close();
}
console.log(`Screenshots: ${path.relative(ROOT, DIR)}/`);
process.exit(done() ? 0 : 1);
