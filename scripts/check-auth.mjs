/* Browser check of the Supabase portal's sign-in and session handling, fully offline. Exits 1 on any failure.
   It starts its own dev server (port 5174) in Supabase mode with a made-up project URL and public key, and answers every
   request to that made-up project inside the browser (Playwright routes): nothing reaches a real Supabase project, and any
   other outside request fails the check. Screenshots go to compare-output/auth/.
   Usage: npm run check:auth (the demo dev server on 5173 is not needed and is not affected) */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { OUT, ROOT, reporter } from "./lib/compare.mjs";

const REF = "offlinetestproject00", HOST = `${REF}.supabase.co`, PORT = 5174, APP = `http://127.0.0.1:${PORT}/`;
const RECORD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "check-auth-ui-moves-"));   /* the dev test-run recorder writes here, not to supabase/runs */
Object.assign(process.env, { VITE_DEV_RECORD_MOVES: "true", DEV_MOVE_RECORD_DIR: RECORD_DIR, VITE_PORTAL_MODE: "supabase", VITE_SUPABASE_URL: `https://${HOST}`, VITE_SUPABASE_ANON_KEY: "sb_publishable_offline_check_only" });
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
/* Workspace rows of the made-up clients (as row-level security would return them for that client's member). */
const row = (client_id, o) => ({ client_id, ...o });
const ago = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);   /* UTC dates relative to today */
const WORKSPACES = {
  c1: {
    roles: [row("c1", { id: "r11", title: "Field Technician", location: "Reno, NV", status: "Open", opened_on: "2026-10-01", recruiter_name: "Alex Kim" }),
            row("c1", { id: "r12", title: "Dispatch Planner", location: "", status: "On hold", opened_on: "2026-09-15", recruiter_name: "" })],
    people: [row("c1", { id: "p11", name: "Riley Offline", headline: "Technician · Example Co", location: "Reno, NV" }), row("c1", { id: "p12", name: "Casey Offline", headline: "", location: "" }),
             row("c1", { id: "p13", name: "Jordan Offline", headline: "Coordinator", location: "" })],
    submissions: [row("c1", { id: "5a1a0000-0000-4000-8000-000000000011", role_id: "r11", person_id: "p11", stage: "Interview", shared_on: ago(5), publication: "published", version: 2 }),
                  row("c1", { id: "5a1a0000-0000-4000-8000-000000000012", role_id: "r12", person_id: "p11", stage: "To review", shared_on: ago(3), publication: "published", version: 1 }),
                  row("c1", { id: "5a1a0000-0000-4000-8000-000000000013", role_id: "r11", person_id: "p12", stage: "Declined", shared_on: ago(20), publication: "published", version: 2 }),
                  row("c1", { id: "5a1a0000-0000-4000-8000-000000000014", role_id: "r11", person_id: "p13", stage: "To review", shared_on: ago(30), publication: "published", version: 1 })],
    client_notes: [],
    submission_events: [
      row("c1", { id: 1, submission_id: "5a1a0000-0000-4000-8000-000000000011", submission_version: 1, kind: "shared", to_stage: "To review", occurred_on: ago(5), actor_kind: "revenue_optics", actor_member_id: null }),
      row("c1", { id: 2, submission_id: "5a1a0000-0000-4000-8000-000000000011", submission_version: 2, kind: "stage_move", to_stage: "Interview", occurred_on: ago(1), actor_kind: "client", actor_member_id: null }),
      row("c1", { id: 3, submission_id: "5a1a0000-0000-4000-8000-000000000012", submission_version: 1, kind: "shared", to_stage: "To review", occurred_on: ago(3), actor_kind: "revenue_optics", actor_member_id: null }),
      row("c1", { id: 4, submission_id: "5a1a0000-0000-4000-8000-000000000013", submission_version: 1, kind: "shared", to_stage: "To review", occurred_on: ago(20), actor_kind: "revenue_optics", actor_member_id: null }),
      row("c1", { id: 5, submission_id: "5a1a0000-0000-4000-8000-000000000013", submission_version: 2, kind: "stage_move", to_stage: "Declined", occurred_on: ago(15), actor_kind: "client", actor_member_id: null }),
      row("c1", { id: 6, submission_id: "5a1a0000-0000-4000-8000-000000000014", submission_version: 1, kind: "shared", to_stage: "To review", occurred_on: ago(30), actor_kind: "revenue_optics", actor_member_id: null }),
    ],
  },
  c2: {
    roles: [row("c2", { id: "r21", title: "Second Role Only", location: "Austin, TX", status: "Open", opened_on: "2026-10-03", recruiter_name: "Jamie Scott" })],
    people: [row("c2", { id: "p21", name: "Sky Second", headline: "Planner", location: "" })],
    submissions: [row("c2", { id: "5a1a0000-0000-4000-8000-000000000021", role_id: "r21", person_id: "p21", stage: "To review", shared_on: "2026-10-09", publication: "published", version: 1 })],
    client_notes: [],
    submission_events: [row("c2", { id: 7, submission_id: "5a1a0000-0000-4000-8000-000000000021", submission_version: 1, kind: "shared", to_stage: "To review", occurred_on: "2026-10-09", actor_kind: "revenue_optics", actor_member_id: null })],
  },
  c4: { roles: [], people: [], submissions: [], submission_events: [], client_notes: [] },
};
const FIRST_NAMES_C1 = ["Riley Offline", "Casey Offline", "Field Technician", "Dispatch Planner"];
const control = { slowClient: null, failWorkspaceOnce: new Set(["c4"]), loseRpcAnswers: 0, holdRpc: null };
/* client_move_stage, as the made-up server: same rules as the real function (stored result per key, version check,
   provisional stage rule). `loseRpcAnswers`: process the request, then drop the answer (an uncertain outcome). */
const rpcKeys = new Map(), rpcCalls = [], unrecordedSends = [];
let nextEventId = 1000;
/* PostgREST-style paging for the made-up server: order=<col>.asc, <col>=gt.<value>, limit, and a 1,000-row cap. */
function pageOf(rows, params) {
  const order = params.get("order")?.replace(/\.asc$/, ""), limit = Math.min(Number(params.get("limit") ?? Infinity), 1000);
  const cmp = (a, b) => (typeof a === "number" && typeof b === "number" ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
  let out = rows.slice();
  if (order) out.sort((a, b) => cmp(a[order], b[order]));
  for (const [k, v] of params) if (v.startsWith("gt.")) out = out.filter((r) => cmp(r[k], typeof r[k] === "number" ? Number(v.slice(3)) : v.slice(3)) > 0);
  return out.slice(0, limit);
}
/* client_decline and client_add_feedback, as the made-up server: the same development rules as the real functions. */
function decide(cid, fn, b, memberId) {
  const ws = WORKSPACES[cid], sub = ws?.submissions.find((x) => x.id === b.p_submission_id);
  const text = String((fn === "client_decline" ? b.p_note : b.p_text) ?? "").trim();
  if (!text) return [400, { code: "PT400", message: "invalid_request" }];
  if (!sub) return [404, { code: "PT404", message: "submission_not_found" }];
  const k = `${fn}:${cid}:${b.p_submission_id}:${b.p_idempotency_key}`, fp = JSON.stringify([text, b.p_category ?? null, b.p_about ?? null, b.p_expected_version]);
  if (rpcKeys.has(k)) return rpcKeys.get(k).fp === fp ? [200, rpcKeys.get(k).result] : [409, { code: "PT409", message: "idempotency_key_reused" }];
  if (sub.version !== b.p_expected_version) return [409, { code: "PT409", message: "version_conflict" }];
  const role = ws.roles.find((r) => r.id === sub.role_id);
  const ok = fn === "client_decline" ? role.status === "Open" && ["To review", "Interview", "Offer"].includes(sub.stage)
    : ["Open", "On hold"].includes(role.status) && ["Interview", "Offer"].includes(sub.stage);
  if (!ok) return [403, { code: "PT403", message: "action_not_permitted" }];
  if (fn === "client_decline") sub.stage = "Declined";
  sub.version += 1;
  const eventId = nextEventId++, kind = fn === "client_decline" ? "decline" : "feedback", noteId = crypto.randomUUID();
  ws.submission_events.push(row(cid, { id: eventId, submission_id: sub.id, submission_version: sub.version, kind, to_stage: sub.stage, occurred_on: ago(0), actor_kind: "client", actor_member_id: memberId }));
  ws.client_notes.push(row(cid, { id: noteId, submission_id: sub.id, event_id: eventId, kind, about: fn === "client_decline" ? null : (b.p_about ?? null), text,
    category: fn === "client_decline" ? (b.p_category ?? null) : null, author_member_id: memberId, created_at: new Date().toISOString() }));
  const result = { submission_id: sub.id, stage: sub.stage, version: sub.version, event_id: eventId, note_id: noteId };
  rpcKeys.set(k, { fp, result });
  return [200, result];
}

function moveStage(cid, b, memberId) {
  const ws = WORKSPACES[cid], sub = ws?.submissions.find((x) => x.id === b.p_submission_id);
  if (!sub) return [404, { code: "PT404", message: "submission_not_found" }];
  const k = `${cid}:${b.p_submission_id}:${b.p_idempotency_key}`, fp = `${b.p_to_stage}:${b.p_expected_version}`;
  if (rpcKeys.has(k)) return rpcKeys.get(k).fp === fp ? [200, rpcKeys.get(k).result] : [409, { code: "PT409", message: "idempotency_key_reused" }];
  if (sub.version !== b.p_expected_version) return [409, { code: "PT409", message: "version_conflict", details: `current version ${sub.version}` }];
  const role = ws.roles.find((r) => r.id === sub.role_id);
  if (role.status !== "Open" || ["Offer", "Hired", "Declined"].includes(sub.stage) || !["To review", "Interview", "Offer", "Hired"].includes(b.p_to_stage) || b.p_to_stage === sub.stage)
    return [403, { code: "PT403", message: "move_not_permitted" }];
  sub.stage = b.p_to_stage; sub.version += 1;
  ws.submission_events.push(row(cid, { id: nextEventId++, submission_id: sub.id, submission_version: sub.version, kind: "stage_move", to_stage: sub.stage, occurred_on: ago(0), actor_kind: "client", actor_member_id: memberId }));
  const result = { submission_id: sub.id, stage: sub.stage, version: sub.version, event_id: ws.submission_events.length };
  rpcKeys.set(k, { fp, result });
  return [200, result];
}
/* Another member's move (made outside this browser), with its history entry. */
const bump = (cid, id, stage) => { const ws = WORKSPACES[cid], sub = ws.submissions.find((x) => x.id === id); sub.stage = stage; sub.version += 1;
  ws.submission_events.push(row(cid, { id: nextEventId++, submission_id: id, submission_version: sub.version, kind: "stage_move", to_stage: stage, occurred_on: ago(0), actor_kind: "client", actor_member_id: "m-colleague" })); };
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
  const table = u.pathname.slice("/rest/v1/".length), cid = user?.member?.client_id;
  const rpcFn = u.pathname.match(/^\/rest\/v1\/rpc\/(client_move_stage|client_decline|client_add_feedback)$/)?.[1];
  if (rpcFn && req.method() === "POST") {
    const b = JSON.parse(req.postData() || "{}");
    rpcCalls.push({ ...b, fn: rpcFn });
    /* The development test-run record must already hold this exact request when it reaches the server. */
    const runFile = fs.readdirSync(RECORD_DIR).find((f) => f.endsWith(".json"));
    const recorded = runFile && JSON.parse(fs.readFileSync(path.join(RECORD_DIR, runFile), "utf8")).entries.some((e) => e.phase === "sent" && e.key === b.p_idempotency_key && e.submission_id === b.p_submission_id && e.expected_version === b.p_expected_version
      && e.action === (rpcFn === "client_decline" ? "decline" : rpcFn === "client_add_feedback" ? "feedback" : "move") && (rpcFn !== "client_move_stage" || e.to_stage === b.p_to_stage));
    if (!recorded) unrecordedSends.push(b.p_idempotency_key);
    if (control.holdRpc) await control.holdRpc;
    if (!cid) return json(route, 403, { code: "PT403", message: "not_a_client_member" });
    const [status, out] = rpcFn === "client_move_stage" ? moveStage(cid, b, user.member.id) : decide(cid, rpcFn, b, user.member.id);
    if (control.loseRpcAnswers > 0) { control.loseRpcAnswers--; return route.abort("connectionreset"); }
    return json(route, status, out);
  }
  if (table in WORKSPACES.c1) {
    if (!cid) return json(route, 200, []);
    if (table === "roles" && control.failWorkspaceOnce.has(cid)) { control.failWorkspaceOnce.delete(cid); return json(route, 500, { message: "Internal error" }); }
    if (control.slowClient === cid) await new Promise((r) => setTimeout(r, 1500));   /* a slow answer, to test that it is ignored once stale */
    return json(route, 200, pageOf(WORKSPACES[cid][table], u.searchParams));
  }
  return json(route, 404, { message: "not mocked" });
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.route("**/*", handle);
const errors = [];
const consoleWarnings = [];
const page = async () => { const pg = await ctx.newPage(); pg.on("pageerror", (e) => errors.push(String(e))); pg.on("console", (m) => { if (["warning", "error"].includes(m.type())) consoleWarnings.push(m.text()); }); await pg.goto(APP + "#candidates"); return pg; };
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
  const waitText = (pg, sel, t) => pg.waitForFunction(([s, x]) => document.querySelector(s)?.textContent?.includes(x), [sel, t], { timeout: 5000 }).then(() => true, () => false);
  ck("Candidates: the counts come from the database", await waitText(A, ".lede", "4 submissions · 3 people · 2 roles"));
  ck("Candidates: pipeline cards show database names, headline and the same person's other role",
    (await A.innerText(".board")).includes("Riley Offline") && (await A.innerText(".board")).includes("Same person · also for Dispatch Planner") && (await A.$$(".ccard")).length === 3);
  ck("Candidates: nothing invented on cards (no next step, requirements or interview)", (await A.$$(".nextbar, .ccard .meta")).length === 0);
  ck("Candidates: Waiting on you is disabled and marked not connected", await A.$eval(".fchip.wait", (b) => b.disabled && b.title === "Not connected yet"));
  ck("sidebar: role count from the database", (await A.innerText(".client span")) === "2 roles with Revenue Optics");
  await shot(A, "workspace"); await shot(A, "workspace", "dark"); await A.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await A.click("text=List"); await A.waitForSelector(".ltab");
  ck("Candidates list: stage and shared date from the database; next step, requirements and interview not connected",
    (await A.innerText(".ltab tbody")).includes("Interview") && (await A.$$eval('.ltab [title="Not connected yet"]', (x) => x.length)) === 12);
  await shot(A, "candidates-list");
  await A.evaluate(() => (location.hash = "#roles"));
  ck("Roles: database roles with status, counts and last 7 days", await waitH1(A, "Roles") && (await A.innerText(".rtab")).includes("Dispatch Planner") && (await A.innerText(".rtab")).includes("1 shared · 1 moved"));
  await shot(A, "roles");
  await A.evaluate(() => (location.hash = "#role-r11"));
  ck("role page: database fields; descriptions and requirements not connected", await waitH1(A, "Field Technician") && (await body(A)).includes("requirements are not connected yet"));
  await A.evaluate(() => (location.hash = "#c-5a1a0000-0000-4000-8000-000000000011"));
  ck("candidate page: database fields; decline and feedback offered at Interview on an open role [provisional]", await waitH1(A, "Riley Offline")
    && !(await A.$eval("[data-form=decline]", (b) => b.disabled)) && !(await A.$eval("[data-form=feedback]", (b) => b.disabled)) && (await body(A)).includes("Manatal is not updated"));
  await shot(A, "candidate");

  /* Stage changes (made-up server). Riley Offline, Field Technician (open role), Interview v1 → Offer [provisional]. */
  const moveCalls = () => rpcCalls.length;
  await A.selectOption("#mv", "Offer");
  await A.click("[data-form=move]");
  ck("move form: Offer is marked provisional, and nothing claims a notification or Manatal update", (await A.innerText("#moveForm")).includes("Provisional for development testing") && (await A.innerText("#moveForm")).includes("nobody is notified and Manatal is not updated"));
  await shot(A, "move-form");
  let n0 = moveCalls();
  await A.dblclick("#moveForm button[type=submit]");
  ck("move: success is shown after the server confirms", await waitText(A, ".act", "Stage saved: Offer"));
  ck("move: a double click sends one request, with the version seen and a new key", moveCalls() - n0 === 1 && rpcCalls.at(-1).p_expected_version === 2 && /^[0-9a-f-]{36}$/.test(rpcCalls.at(-1).p_idempotency_key));
  await shot(A, "move-saved");
  ck("move: the page shows the refreshed stage from the database", await waitText(A, ".statusdl", "Offer"));
  await A.click("text=Done");
  ck("after Done: no further moves from Offer [provisional rule]", await waitText(A, ".act", "Stage changes from Offer are not available"));
  await A.click("[data-tab=notes]");
  { const items = await A.$$eval(".hist li", (li) => li.map((x) => x.innerText.replace(/\s+/g, " ").trim()));
    ck("history: newest first, with dates; 'You' for the user's own move, 'Client team' for an unrecorded client move",
      items.length === 3 && /You moved Riley to Offer$/.test(items[0]) && /Client team moved Riley to Interview$/.test(items[1]) && /Revenue Optics shared Riley for this role$/.test(items[2]), items.join(" | ")); }
  await shot(A, "history");
  await A.evaluate(() => (location.hash = "#candidates"));
  ck("move: lists and counts are refreshed from the database", await waitText(A, '.col[aria-label="Offer"] .ct', "1"));

  /* Conflict: Jordan Offline (To review v1). The form is opened, then the made-up server changes it (another user). */
  await A.evaluate(() => (location.hash = "#c-5a1a0000-0000-4000-8000-000000000014")); await waitH1(A, "Jordan Offline");
  await A.selectOption("#mv", "Interview"); await A.click("[data-form=move]");
  bump("c1", "5a1a0000-0000-4000-8000-000000000014", "Offer");
  n0 = moveCalls();
  await A.click("#moveForm button[type=submit]");
  ck("conflict: a stale version is reported, not retried against the newer version", await waitText(A, ".act", "changed since you opened the page") && moveCalls() - n0 === 1);
  await shot(A, "move-conflict");
  await A.click("text=Review the latest stage");
  ck("conflict: the latest stage from the database is shown for review", await waitText(A, ".statusdl", "Offer"));
  await A.click("[data-tab=notes]");
  ck("history: another member's move is 'Client team', not 'You'", await waitText(A, ".hist", "Client team moved Jordan to Offer") && !(await A.innerText(".hist")).includes("You moved Jordan"));
  bump("c1", "5a1a0000-0000-4000-8000-000000000014", "Interview");     /* the made-up "other user" moves it back, so the next test can move it */
  await A.reload(); await waitH1(A, "Jordan Offline");

  /* Uncertain: the server saves it but both answers are lost; Check again resolves it with the same request and key. */
  control.loseRpcAnswers = 2;
  const eventsBefore = WORKSPACES.c1.submission_events.length;
  n0 = moveCalls();
  await A.selectOption("#mv", "To review"); await A.click("[data-form=move]"); await A.click("#moveForm button[type=submit]");
  ck("no answer: an uncertain outcome, not a failure", await A.waitForFunction(() => document.querySelector(".act")?.textContent?.includes("could not be confirmed"), null, { timeout: 8000 }).then(() => true, () => false));
  await shot(A, "move-uncertain");
  await A.click("text=Check again");
  ck("Check again: the stored result confirms it", await waitText(A, ".act", "Stage saved: To review"));
  const sent = rpcCalls.slice(n0);
  ck("uncertain: every attempt was the same request with the same key (3 sends), saved once",
    sent.length === 3 && new Set(sent.map((x) => JSON.stringify(x))).size === 1 && WORKSPACES.c1.submission_events.length - eventsBefore === 1, `${sent.length} sends`);
  await A.click("text=Done");

  /* Sign-out while saving: the late answer must not appear for anyone. */
  let releaseRpc; control.holdRpc = new Promise((r) => { releaseRpc = r; });
  await A.selectOption("#mv", "Interview"); await A.click("[data-form=move]"); await A.click("#moveForm button[type=submit]");
  await waitText(A, ".act", "Saving the move");
  await A.click("text=Sign out"); await waitH1(A, "Sign in");
  releaseRpc(); control.holdRpc = null; await A.waitForTimeout(500);
  { const t = await body(A); ck("sign-out while saving: the late answer is ignored", !t.includes("Stage saved") && !t.includes("Jordan Offline")); }
  await signIn(A, "active@example.com"); await waitClient(A, "Offline Test Client");
  await A.evaluate(() => (location.hash = "#c-5a1a0000-0000-4000-8000-000000000014")); await waitH1(A, "Jordan Offline");
  ck("after signing in again: no leftover message, the saved stage is read from the database", !(await body(A)).includes("Stage saved") && await waitText(A, ".statusdl", "Interview"));

  /* Decisions (milestone 2), on Jordan Offline (Field Technician, open role, Interview). */
  ck("decisions: Decline and Share interview feedback are offered at Interview on an open role [provisional]",
    !(await A.$eval("[data-form=decline]", (b) => b.disabled)) && !(await A.$eval("[data-form=feedback]", (b) => b.disabled)));
  let d0 = rpcCalls.length;
  const jordanVersion = WORKSPACES.c1.submissions.find((x) => x.id === "5a1a0000-0000-4000-8000-000000000014").version;
  await A.click("[data-form=feedback]");
  await A.click("#actForm button[type=submit]");
  ck("feedback: an empty note is refused in the form, and nothing is sent", (await A.innerText("#actForm .err")).includes("Add your feedback before sharing.") && rpcCalls.length === d0);
  await A.fill("#fNote", "Strong on scheduling; check weekend availability.");
  await A.dblclick("#actForm button[type=submit]");
  ck("feedback: saved after the server confirms; the stage is unchanged", await waitText(A, ".act", "Feedback saved") && (await A.innerText(".act")).includes("Stage unchanged") && await waitText(A, ".statusdl", "Interview"));
  ck("feedback: a double click sends one request (client_add_feedback, version seen, new key)", rpcCalls.length - d0 === 1 && rpcCalls.at(-1).fn === "client_add_feedback" && rpcCalls.at(-1).p_expected_version === jordanVersion, `sent ${rpcCalls.length - d0}, version ${rpcCalls.at(-1).p_expected_version} of ${jordanVersion}`);
  await A.click("text=Done");
  await A.click("[data-tab=notes]");
  ck("notes: the feedback shows as yours, under its subject, and in the history",
    await waitText(A, ".tabp", "Strong on scheduling") && (await A.innerText(".tabp")).includes("about General feedback") && (await A.innerText(".tabp")).includes("You ·")
    && (await A.innerText(".hist")).includes("You shared interview feedback"));
  await shot(A, "notes-feedback");
  /* Decline, with one lost answer: the automatic retry with the same key resolves it. */
  control.loseRpcAnswers = 1; d0 = rpcCalls.length;
  await A.click("[data-form=decline]");
  await A.fill("#fNote", "\t\n   \n");
  await A.click("#actForm button[type=submit]");
  ck("decline: a note of only tabs, newlines and spaces is refused in the form, and nothing is sent",
    (await A.innerText("#actForm .err")).includes("Add a short note so the recruiter knows why.") && rpcCalls.length === d0);
  await A.fill("#fNote", "Needs more field-service experience.");
  await A.selectOption("#fCat", "Experience not aligned");
  await shot(A, "decline-form");
  await A.click("#actForm button[type=submit]");
  ck("decline: saved, with the neutral wording, after a lost answer and an automatic retry with the same key",
    await A.waitForFunction(() => document.querySelector(".act")?.textContent?.includes("Declined for this role"), null, { timeout: 8000 }).then(() => true, () => false)
    && rpcCalls.length - d0 === 2 && rpcCalls.at(-1).p_idempotency_key === rpcCalls.at(-2).p_idempotency_key && WORKSPACES.c1.client_notes.filter((n) => n.kind === "decline").length === 1);
  await shot(A, "decline-saved");
  await A.click("text=Done");
  ck("after a decline: no further actions, the neutral note, and no 'You declined'",
    await waitText(A, ".act", "Declined for this role. The note is in Notes and history.") && (await A.$eval("[data-form=decline]", (b) => b.disabled)) && !(await body(A)).includes("You declined Jordan for"));
  await A.click("[data-tab=notes]");
  ck("notes: the decline note with its category", await waitText(A, ".tabp", "Needs more field-service experience.") && (await A.innerText(".tabp")).includes("Experience not aligned"));
  await shot(A, "notes-decline");
  /* On-hold role (Riley Offline, Dispatch Planner, To review): neither decision is offered. */
  await A.evaluate(() => (location.hash = "#c-5a1a0000-0000-4000-8000-000000000012")); await waitH1(A, "Riley Offline");
  ck("on-hold role at To review: no decline and no feedback [provisional]", (await A.$eval("[data-form=decline]", (b) => b.disabled)) && (await A.$eval("[data-form=feedback]", (b) => b.disabled)));
  await A.evaluate(() => (location.hash = "#candidates"));
  await A.evaluate(() => (location.hash = "#candidates"));

  await A.reload();
  ck("reload: the session is restored without signing in again", await waitH1(A, "Candidates") && (await A.innerText(".client b")) === "Offline Test Client");
  await A.evaluate(() => (location.hash = "#progress"));
  ck("Hiring progress: explicitly not connected", await waitH1(A, "Hiring progress") && (await A.innerText(".rempty")).startsWith("Hiring progress is not connected yet."));

  const before = supabaseCalls.length;
  await A.click("text=Sign out");
  ck("sign-out: back to the sign-in screen", await waitH1(A, "Sign in"));
  ck("sign-out: workspace and client name are gone", (await A.$(".shell")) === null && !(await body(A)).includes("Offline Test Client"));
  { const t = await body(A); ck("sign-out: no workspace data left on the page", !FIRST_NAMES_C1.some((x) => t.includes(x)), FIRST_NAMES_C1.filter((x) => t.includes(x)).join(", ")); }
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
  await A.evaluate(() => (location.hash = "#roles"));
  ck("workspace data fails to load: an error with retry, and no data", await waitText(A, ".rempty.dberr", "could not be loaded") && (await A.$(".rtab")) === null);
  await shot(A, "workspace-error");
  await A.click("text=Try again");
  ck("retry: an empty workspace shows its empty state", await waitText(A, ".rempty", "No roles yet."));
  await A.click("text=Sign out"); await waitH1(A, "Sign in");

  /* Account change in another tab of the same browser, while the first account's data is still loading (slow answer). */
  control.slowClient = "c1";
  await signIn(A, "active@example.com"); await waitClient(A, "Offline Test Client");
  await A.evaluate((names) => { window.__staleSeen = false; new MutationObserver(() => { if (window.__switched && names.some((n) => document.body.innerText.includes(n))) window.__staleSeen = true; }).observe(document.body, { subtree: true, childList: true, characterData: true }); }, FIRST_NAMES_C1);
  const B = await page();
  ck("second tab: restores the same session", await waitH1(B, "Candidates") && (await B.innerText(".client b")) === "Offline Test Client");
  await A.evaluate(() => { window.__switched = true; });
  await B.click("text=Sign out"); await waitH1(B, "Sign in");
  ck("other tab signed out: this tab drops the workspace too", await waitH1(A, "Sign in") && !(await body(A)).includes("Offline Test Client"));
  await signIn(B, "second@example.com"); await waitH1(B, "Candidates");
  ck("other tab signed in as someone else: this tab shows only the new account", await waitClient(A, "Second Test Client") && !(await body(A)).includes("Offline Test Client"));
  ck("a member without a job title shows only the name", (await A.innerText(".me .who")).trim() === "Sam Second (test)");
  await A.evaluate(() => (location.hash = "#candidates"));
  ck("after the switch: only the new client's candidates", await waitText(A, ".board", "Sky Second"));
  await A.waitForTimeout(1800);   /* the previous account's slow answers arrive now */
  { const t = await body(A); ck("the previous account's late answers are ignored", !FIRST_NAMES_C1.some((x) => t.includes(x)) && (await A.evaluate(() => window.__staleSeen)) === false); }
  control.slowClient = null;

  ck("the demo's saved actions are never written in Supabase mode", await A.evaluate(() => localStorage.getItem("ro-portal-demo-actions") === null));
  ck("every Supabase request went to the made-up offline project only", supabaseCalls.length > 0 && external.length === 0, external.join(", "));
  {
    const runFile = fs.readdirSync(RECORD_DIR).find((f) => f.endsWith(".json")), text = runFile ? fs.readFileSync(path.join(RECORD_DIR, runFile), "utf8") : "";
    const sentKeys = new Set(text ? JSON.parse(text).entries.filter((e) => e.phase === "sent").map((e) => e.key) : []);
    ck("test-run record: every request was recorded with its exact key before it was sent", rpcCalls.length > 0 && unrecordedSends.length === 0 && rpcCalls.every((b) => sentKeys.has(b.p_idempotency_key)), unrecordedSends.join(", "));
    ck("test-run record: no password, session token or project key in it", text !== "" && ![PASSWORD, "eyJ", "sb_publishable_", "refresh-"].some((x) => text.includes(x)));
    ck("test-run record: readable only by its owner", runFile && (fs.statSync(path.join(RECORD_DIR, runFile)).mode & 0o777) === 0o600);
    ck("the banner says test-run recording is on", (await A.innerText(".mockline")).includes("test-run recording on"));
  }
  ck("test-run record: no decision text in it", !["Strong on scheduling", "Needs more field-service", "weekend availability"].some((x) => (fs.readdirSync(RECORD_DIR).filter((f) => f.endsWith(".json")).map((f) => fs.readFileSync(path.join(RECORD_DIR, f), "utf8")).join("")).includes(x)));
  const allowed = /^(GET \/rest\/v1\/|POST \/auth\/v1\/(token|logout)|POST \/rest\/v1\/rpc\/(client_move_stage|client_decline|client_add_feedback)$)/;
  ck("writes only through the three action functions: nothing else besides reads, sign-in and sign-out", supabaseCalls.every((c) => allowed.test(c)), supabaseCalls.filter((c) => !allowed.test(c)).join(", "));
  ck("no page errors", errors.length === 0, errors.join(" | "));
  ck("one Supabase client per tab (no duplicate GoTrueClient warning)", !consoleWarnings.some((w) => w.includes("Multiple GoTrueClient")), consoleWarnings.filter((w) => w.includes("GoTrueClient")).slice(0, 1).join(""));
  ck("no other console warnings or errors", consoleWarnings.filter((w) => !w.includes("Multiple GoTrueClient") && !w.includes("Failed to load resource")).length === 0, consoleWarnings.filter((w) => !w.includes("Failed to load resource")).slice(0, 3).join(" | "));
} finally {
  await browser.close();
  await server.close();
}
console.log(`Screenshots: ${path.relative(ROOT, DIR)}/`);
process.exit(done() ? 0 : 1);
