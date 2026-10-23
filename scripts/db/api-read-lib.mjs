/* Read-only checks through the hosted Auth and Data API, as a signed-out visitor and as the four real test users.
   Uses only the public key and the users' own sessions; never the service role key or the database connection.
   No request changes application data: every Data API request is a GET. Sign-in and sign-out do write Auth's own records
   (sessions, last sign-in time, audit log); see supabase/README.md. Passwords, tokens and the key are never printed. */
import crypto from "node:crypto";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
export const TABLES = ["clients", "client_members", "roles", "people", "submissions", "submission_events"];

/** The seed's deterministic id for a label: the same value as md5('portal-m1:…')::uuid in Postgres. */
export const seedId = (...parts) => {
  const h = crypto.createHash("md5").update(["portal-m1", ...parts].join(":")).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** Payload of a JWT, without verifying it (only used to check which role a key or session claims). */
export const jwtPayload = (token) => {
  try { return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")); } catch { return null; }
};

/** Accepts only a public client key: a publishable key, or a legacy key whose role is anon. Never a secret key. */
export function checkPublicKey(key) {
  if (!key) return { ok: false, why: "SUPABASE_ANON_KEY is empty" };
  if (key.startsWith("sb_publishable_")) return { ok: true, kind: "publishable key" };
  if (key.startsWith("sb_secret_")) return { ok: false, why: "SUPABASE_ANON_KEY holds a secret key; use the publishable (public) key" };
  const p = key.startsWith("eyJ") ? jwtPayload(key) : null;
  if (p?.role === "anon") return { ok: true, kind: "legacy anon key" };
  if (p?.role) return { ok: false, why: `SUPABASE_ANON_KEY is a legacy key for role "${p.role}"; use the anon (public) key` };
  return { ok: false, why: "SUPABASE_ANON_KEY is not a recognised Supabase public key" };
}

/** The project URL must be the plain https://<project-ref>.supabase.co address. */
export const checkUrl = (url) => /^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(url || "");

export const USERS = [
  { key: "harbor", email: "portal-test-harbor@example.com", label: "Harbor member (active)", passwordName: "PORTAL_TEST_PASSWORD_HARBOR" },
  { key: "northwind", email: "portal-test-northwind@example.com", label: "Northwind member (active)", passwordName: "PORTAL_TEST_PASSWORD_NORTHWIND" },
  { key: "harborInactive", email: "portal-test-harbor-inactive@example.com", label: "Harbor member (inactive)", passwordName: "PORTAL_TEST_PASSWORD_HARBOR_INACTIVE" },
  { key: "noMembership", email: "portal-test-no-membership@example.com", label: "signed in, no membership", passwordName: "PORTAL_TEST_PASSWORD_NO_MEMBERSHIP" },
];

const H = (ref) => seedId("submission", "harbor", ref);
const all = (who, rows) => TABLES.map((t, i) => ({ who, path: `${t}?select=*`, want: { status: 200, rows: rows[i] } }));
const denied = { status: [401, 403], code: "42501" };

/** Every Data API request, with the expected HTTP status and row count (or error code). All are GET requests. */
export const READS = [
  // Signed out: public key only. No table privileges, so PostgREST refuses (401 or 403, permission denied).
  ...TABLES.map((t) => ({ who: "anon", path: `${t}?select=*`, want: denied })),
  { who: "anon", path: "idempotency_keys?select=*", want: { status: 404 }, note: "staff-only table is not in the exposed schema" },
  { who: "anon", path: "idempotency_keys?select=*", profile: "app_private", want: { status: 406, code: "PGRST106" }, note: "private schema is not exposed" },
  { who: "forged", path: "submissions?select=*", want: { status: 401 }, note: "a made-up bearer token is rejected" },
  // Harbor member: only Harbor, only published.
  ...all("harbor", [1, 1, 4, 11, 12, 23]),
  { who: "harbor", path: "clients?select=name", want: { status: 200, body: [{ name: "Harbor Industrial Supply" }] } },
  { who: "harbor", path: "client_members?select=display_name,active", want: { status: 200, body: [{ display_name: "Maria Alvarez (test)", active: true }] }, note: "own membership only, not the inactive colleague" },
  { who: "harbor", path: "roles?select=ref&status=eq.On%20hold", want: { status: 200, rows: 1 } },
  { who: "harbor", path: "submissions?select=id&publication=neq.published", want: { status: 200, rows: 0 }, note: "unpublished" },
  { who: "harbor", path: `submissions?select=id&id=eq.${H("zz-isl")}`, want: { status: 200, rows: 0 }, note: "unpublished submission, by id" },
  { who: "harbor", path: `people?select=id&id=eq.${seedId("person", "harbor", "zz")}`, want: { status: 200, rows: 0 }, note: "person with only an unpublished submission, by id" },
  { who: "harbor", path: `submission_events?select=id&submission_id=eq.${H("zz-isl")}`, want: { status: 200, rows: 0 }, note: "unpublished submission's history" },
  { who: "harbor", path: `submissions?select=id&id=eq.${seedId("submission", "northwind", "n1-ops")}`, want: { status: 200, rows: 0 }, note: "Northwind submission, by id" },
  ...TABLES.filter((t) => t !== "clients").map((t) => ({ who: "harbor", path: `${t}?select=id&client_id=eq.${seedId("client", "northwind")}`, want: { status: 200, rows: 0 }, note: "Northwind rows" })),
  { who: "harbor", path: `clients?select=id&id=eq.${seedId("client", "northwind")}`, want: { status: 200, rows: 0 }, note: "Northwind client" },
  { who: "harbor", path: "idempotency_keys?select=*", profile: "app_private", want: { status: 406, code: "PGRST106" }, note: "private schema is not exposed" },
  // Northwind member: only Northwind's one published submission.
  ...all("northwind", [1, 1, 1, 1, 1, 1]),
  { who: "northwind", path: "submissions?select=ref", want: { status: 200, body: [{ ref: "n1-ops" }] } },
  { who: "northwind", path: "people?select=name", want: { status: 200, body: [{ name: "Robin Hale" }] }, note: "Casey Lund (unpublished) hidden" },
  { who: "northwind", path: `submissions?select=id&id=eq.${seedId("submission", "northwind", "n2-ops")}`, want: { status: 200, rows: 0 }, note: "unpublished submission, by id" },
  ...TABLES.filter((t) => t !== "clients").map((t) => ({ who: "northwind", path: `${t}?select=id&client_id=eq.${seedId("client", "harbor")}`, want: { status: 200, rows: 0 }, note: "Harbor rows" })),
  // Signed in without an active membership: the request is allowed, but row-level security returns nothing.
  ...all("harborInactive", [0, 0, 0, 0, 0, 0]),
  ...all("noMembership", [0, 0, 0, 0, 0, 0]),
];

/** Whether a response matches its expectation; returns the short description printed after PASS or FAIL. */
export function judge(want, status, body) {
  const statuses = [want.status].flat();
  const got = `HTTP ${status}` + (Array.isArray(body) ? `, ${body.length} row${body.length === 1 ? "" : "s"}` : body?.code ? `, ${body.code}` : "");
  let ok = statuses.includes(status);
  if (ok && want.code) ok = body?.code === want.code;
  if (ok && want.rows !== undefined) ok = Array.isArray(body) && body.length === want.rows;
  if (ok && want.body) ok = JSON.stringify(body) === JSON.stringify(want.body);
  const expected = `HTTP ${statuses.join(" or ")}` + (want.rows !== undefined ? `, ${want.rows} row${want.rows === 1 ? "" : "s"}` : "")
    + (want.code ? `, ${want.code}` : "") + (want.body ? `, ${JSON.stringify(want.body)}` : "");
  return { ok, text: ok ? got : `${got} (expected ${expected})` };
}

/** Replaces every secret value in text with <hidden>. */
export const scrubber = (secrets) => (text) => secrets.filter((s) => s && s.length >= 6).reduce((t, s) => t.split(s).join("<hidden>"), String(text));

/** Runs the checks. `fetch` and `log` are passed in so the flow can be tested without a network. Returns the failure count. */
export async function runChecks({ fetch, url, key, passwords, log }) {
  const base = url.replace(/\/$/, "");
  const sessions = {};
  const say = (line) => log(scrubber([key, ...Object.values(passwords), ...Object.values(sessions).flatMap((x) => [x.access, x.refresh])])(line));
  let fails = 0;
  const result = (ok, line) => { if (!ok) fails++; say(`${ok ? "PASS" : "FAIL"}  ${line}`); };
  const keyHeader = { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}) };
  const call = async (path, init = {}) => {
    try {
      const r = await fetch(`${base}${path}`, init);
      const text = await r.text();
      let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = null; }
      return { status: r.status, body };
    } catch (e) { return { status: 0, body: { code: "network", message: String(e?.message || e) } }; }
  };

  try {
    // 1. Sign in each test user with email and password (the same request the browser client makes).
    say("— Sign-in (Auth, public key only) —");
    for (const u of USERS) {
      const r = await call("/auth/v1/token?grant_type=password", { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ email: u.email, password: passwords[u.key] }) });
      const p = r.status === 200 ? jwtPayload(r.body?.access_token || "") : null;
      const ok = r.status === 200 && p?.role === "authenticated" && p?.aud === "authenticated" && p?.sub === r.body?.user?.id && r.body?.user?.email === u.email && !!r.body?.refresh_token;
      if (r.status === 200 && r.body?.access_token) sessions[u.key] = { access: r.body.access_token, refresh: r.body.refresh_token, id: r.body.user?.id };
      result(ok, `[${u.label}] sign in ${u.email} — ${ok ? "HTTP 200, session for role authenticated, user id matches" : `HTTP ${r.status}${r.body?.error_code ? `, ${r.body.error_code}` : ""}${p ? `, role ${p.role}` : ""}`}`);
    }
    {
      const r = await call("/auth/v1/token?grant_type=password", { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ email: USERS[3].email, password: `wrong-${crypto.randomBytes(12).toString("hex")}` }) });
      result(r.status === 400 && !r.body?.access_token, `[wrong password] sign in ${USERS[3].email} is refused — HTTP ${r.status}${r.body?.error_code ? `, ${r.body.error_code}` : ""}`);
    }
    for (const u of USERS.filter((x) => sessions[x.key])) {
      const r = await call("/auth/v1/user", { headers: { apikey: key, Authorization: `Bearer ${sessions[u.key].access}` } });
      result(r.status === 200 && r.body?.email === u.email && r.body?.id === sessions[u.key].id, `[${u.label}] the session is accepted by Auth (GET /auth/v1/user) — HTTP ${r.status}`);
    }

    // 2. Data API reads (GET only).
    say("— Data API reads (GET only) —");
    const labels = { anon: "signed out", forged: "made-up token", ...Object.fromEntries(USERS.map((u) => [u.key, u.label])) };
    for (const q of READS) {
      if (!["anon", "forged"].includes(q.who) && !sessions[q.who]) { result(false, `[${labels[q.who]}] GET ${q.path} — skipped: not signed in`); continue; }
      const headers = q.who === "anon" ? { ...keyHeader } : { apikey: key, Authorization: `Bearer ${q.who === "forged" ? "not-a-real-token" : sessions[q.who].access}` };
      if (q.profile) headers["Accept-Profile"] = q.profile;
      const r = await call(`/rest/v1/${q.path}`, { headers });
      const j = judge(q.want, r.status, r.body);
      result(j.ok, `[${labels[q.who]}] GET ${q.profile ? `${q.profile}.` : ""}${q.path.replace(UUID, "<seed id>")}${q.note ? ` (${q.note})` : ""} — ${j.text}`);
    }
  } finally {
    // 3. Always sign out, so no refresh token is left behind.
    say("— Sign-out —");
    for (const u of USERS.filter((x) => sessions[x.key])) {
      const r = await call("/auth/v1/logout?scope=local", { method: "POST", headers: { apikey: key, Authorization: `Bearer ${sessions[u.key].access}` } });
      result(r.status === 204 || r.status === 200, `[${u.label}] sign out — HTTP ${r.status}`);
    }
  }
  return fails;
}
