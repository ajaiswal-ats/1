/* Read-only checks through the hosted Auth and Data API, as a signed-out visitor and as the four real test users.
   Uses only the public key and the users' own sessions; never the service role key or the database connection.
   Two kinds of request, kept apart:
   * Auth requests (not data): POST /auth/v1/token to sign in, GET /auth/v1/user, POST /auth/v1/logout to sign out. Sign-in
     and sign-out write Auth's own records (sessions, last sign-in time, audit log); see supabase/README.md.
   * Data reads: GET /rest/v1/<table> only. No RPCs (rpc/...), no writes, no other method.
   Milestones 1-6, against the current fictional baseline (milestone 6 seeded). Expectations check row identities and
   their client and publication relationships, not just counts, and targeted requests for known hidden or other-client
   rows must come back empty. The later reads select only ids, keys and states. No response content is printed (only
   status, counts and PASS/FAIL), and neither are passwords, tokens or the key. */
import crypto from "node:crypto";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
export const TABLES = ["clients", "client_members", "roles", "people", "submissions", "submission_events"];

/** A seed's deterministic id for a full label: the same value as md5('<label>')::uuid in Postgres. */
export const labelId = (label) => {
  const h = crypto.createHash("md5").update(label).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
/** The milestone 1 seed's id: md5('portal-m1:…')::uuid. */
export const seedId = (...parts) => labelId(["portal-m1", ...parts].join(":"));

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

/** Milestone 1's Data API requests, with the expected HTTP status and row count (or error code). All are GET requests. */
export const M1_READS = [
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
  { who: "northwind", path: "people?select=name", want: { status: 200, body: [{ name: "Robin Hale" }] }, note: "only the published submission's person; the unpublished one's is hidden" },
  { who: "northwind", path: `submissions?select=id&id=eq.${seedId("submission", "northwind", "n2-ops")}`, want: { status: 200, rows: 0 }, note: "unpublished submission, by id" },
  ...TABLES.filter((t) => t !== "clients").map((t) => ({ who: "northwind", path: `${t}?select=id&client_id=eq.${seedId("client", "harbor")}`, want: { status: 200, rows: 0 }, note: "Harbor rows" })),
  // Signed in without an active membership: the request is allowed, but row-level security returns nothing.
  ...all("harborInactive", [0, 0, 0, 0, 0, 0]),
  ...all("noMembership", [0, 0, 0, 0, 0, 0]),
];
/** Every Data API request: milestone 1's, then milestones 2-6. */
export const READS = [...M1_READS, ...LATER_READS()];

/* Milestones 2-6, against the current fictional baseline (milestones 3, 4 and 6 seeded; no client notes or feedback links).
   Ids are the seeds' deterministic labels; evidence and outcome rows have generated ids, so they are checked through
   their links (package, submission) instead. */
function LATER_READS() {
  const C = { harbor: seedId("client", "harbor"), northwind: seedId("client", "northwind") };
  const sub = (c, ref) => seedId("submission", c, ref), set = (c, s) => labelId(`portal-m3:set:${c}:${s}`);
  const m3pkg = (c, ref, v) => labelId(`portal-m3:package:${c}:${ref}:${v}`), m6pkg = (ref) => labelId(`portal-m6:package:harbor:${ref}`);
  const iv = (c, ref, n) => labelId(`portal-m4:interview:${c}:${ref}:${n}`), scr = (ref) => labelId(`portal-m6:screening:harbor:${ref}`);
  const req = (c, s, n) => labelId(`portal-m3:req:${c}:${s}:${n}`);
  const M6 = ["tb-isl", "tb-rsm", "je-isl", "pr-isl", "en-pa", "so-pa", "gl-rsm", "ab-fsr", "cm-rsm"];
  /* Harbor's visible packages: the 9 milestone 6 versions, plus Marcus Webb's and Ben Carter's milestone 3 version 1. */
  const pkgs = [...M6.map((r) => [m6pkg(r), r]), [m3pkg("harbor", "mw-isl", 1), "mw-isl"], [m3pkg("harbor", "bc-pa", 1), "bc-pa"]];
  const roleOf = (ref) => ref.split("-")[1], nReq = { isl: 5, pa: 4, fsr: 4, rsm: 4 };
  const NEW = [["client_notes", "id"], ["role_requirement_sets", "id"], ["role_requirements", "id"], ["submission_packages", "id"], ["requirement_evidence", "id"],
    ["client_interviews", "id"], ["offer_outcomes", "id"], ["interview_feedback", "interview_id"], ["screening_summaries", "id"]];
  const ok = (extra) => ({ status: 200, ...extra }), none = { status: 200, rows: 0 };
  const harborReq = Object.entries(nReq).flatMap(([s, n]) => Array.from({ length: n }, (_, i) => [req("harbor", `${s}:1`, i + 1), set("harbor", `${s}:1`)]));
  return [
    // Signed out: no access to any later table.
    ...NEW.map(([t, k]) => ({ who: "anon", path: `${t}?select=${k}`, want: denied })),
    // Harbor: exact rows, each Harbor's, on published submissions and the roles' agreed requirements.
    { who: "harbor", path: "client_notes?select=id,client_id", want: none, note: "milestone 2: no notes in the current baseline" },
    { who: "harbor", path: "role_requirement_sets?select=id,client_id,role_id,status", note: "milestone 3: the 4 agreed sets",
      want: ok({ rows: 4, each: { client_id: C.harbor, status: "agreed" }, pairs: { cols: ["id", "role_id"], values: ["isl", "pa", "fsr", "rsm"].map((r) => [set("harbor", `${r}:1`), seedId("role", "harbor", r)]) } }) },
    { who: "harbor", path: "role_requirements?select=id,client_id,set_id", note: "milestone 3: their 17 requirements",
      want: ok({ rows: 17, each: { client_id: C.harbor }, pairs: { cols: ["id", "set_id"], values: harborReq } }) },
    { who: "harbor", path: "submission_packages?select=id,client_id,submission_id,state", note: "milestone 3/6: the 11 published packages",
      want: ok({ rows: 11, each: { client_id: C.harbor, state: "published" }, pairs: { cols: ["id", "submission_id"], values: pkgs.map(([id, r]) => [id, sub("harbor", r)]) } }) },
    { who: "harbor", path: "submission_packages?select=id,requirement_set_id", note: "each on its role's agreed set",
      want: ok({ rows: 11, pairs: { cols: ["id", "requirement_set_id"], values: pkgs.map(([id, r]) => [id, set("harbor", `${roleOf(r)}:1`)]) } }) },
    { who: "harbor", path: "requirement_evidence?select=client_id,package_id,requirement_set_id", note: "milestone 3: 48 rows, one per requirement of each visible package",
      want: ok({ rows: 48, each: { client_id: C.harbor }, per: { col: "package_id", counts: Object.fromEntries(pkgs.map(([id, r]) => [id, nReq[roleOf(r)]])) },
        pairs: { cols: ["package_id", "requirement_set_id"], values: pkgs.map(([id, r]) => [id, set("harbor", `${roleOf(r)}:1`)]) } }) },
    { who: "harbor", path: "client_interviews?select=id,client_id,submission_id", note: "milestone 4: 6 rounds",
      want: ok({ rows: 6, each: { client_id: C.harbor }, pairs: { cols: ["id", "submission_id"], values: ["cm-rsm", "do-rsm", "gl-rsm", "je-isl", "so-pa", "tb-rsm"].map((r) => [iv("harbor", r, 1), sub("harbor", r)]) } }) },
    { who: "harbor", path: "offer_outcomes?select=client_id,submission_id,status", note: "milestone 4: 2 recorded outcomes",
      want: ok({ rows: 2, each: { client_id: C.harbor }, pairs: { cols: ["submission_id", "status"], values: [[sub("harbor", "do-rsm"), "offer_accepted"], [sub("harbor", "gl-rsm"), "offer_made"]] } }) },
    { who: "harbor", path: "interview_feedback?select=interview_id", want: none, note: "milestone 4: no feedback links in the current baseline" },
    { who: "harbor", path: "screening_summaries?select=id,client_id,package_id", note: "milestone 6: 9 summaries, each on its published milestone 6 package",
      want: ok({ rows: 9, each: { client_id: C.harbor }, pairs: { cols: ["id", "package_id"], values: M6.map((r) => [scr(r), m6pkg(r)]) } }) },
    // Harbor: known hidden rows, asked for by id. Each must come back empty.
    { who: "harbor", path: `submission_packages?select=id&id=eq.${m3pkg("harbor", "tb-isl", 1)}`, want: none, note: "superseded package version" },
    { who: "harbor", path: `submission_packages?select=id&id=eq.${m3pkg("harbor", "je-isl", 2)}`, want: none, note: "draft package" },
    { who: "harbor", path: `submission_packages?select=id&id=eq.${m3pkg("harbor", "do-rsm", 1)}`, want: none, note: "withdrawn package" },
    { who: "harbor", path: `submission_packages?select=id&id=eq.${m3pkg("harbor", "do-rsm", 2)}`, want: none, note: "paused package" },
    { who: "harbor", path: `submission_packages?select=id&id=eq.${m3pkg("harbor", "zz-isl", 1)}`, want: none, note: "published package of an unpublished submission" },
    { who: "harbor", path: `requirement_evidence?select=package_id&package_id=eq.${m3pkg("harbor", "tb-isl", 1)}`, want: none, note: "evidence of the superseded version" },
    { who: "harbor", path: `requirement_evidence?select=package_id&package_id=eq.${m3pkg("harbor", "zz-isl", 1)}`, want: none, note: "evidence of the unpublished submission's package" },
    { who: "harbor", path: `role_requirement_sets?select=id&id=eq.${set("harbor", "isl:2")}`, want: none, note: "draft requirement set" },
    { who: "harbor", path: `role_requirements?select=id&set_id=eq.${set("harbor", "isl:2")}`, want: none, note: "the draft set's requirements" },
    { who: "harbor", path: `client_interviews?select=id&submission_id=eq.${sub("harbor", "zz-isl")}`, want: none, note: "interviews of the unpublished submission" },
    // Harbor: Northwind's rows, by client and by id. Each must come back empty.
    ...NEW.map(([t, k]) => ({ who: "harbor", path: `${t}?select=${k}&client_id=eq.${C.northwind}`, want: none, note: "Northwind rows" })),
    { who: "harbor", path: `role_requirement_sets?select=id&id=eq.${set("northwind", "ops:2")}`, want: none, note: "Northwind's agreed set, by id" },
    { who: "harbor", path: `client_interviews?select=id&id=eq.${iv("northwind", "n1-ops", 1)}`, want: none, note: "Northwind interview, by id" },
    // Northwind: exact rows.
    { who: "northwind", path: "role_requirement_sets?select=id,client_id,status", note: "only its agreed version 2",
      want: ok({ rows: 1, ids: [set("northwind", "ops:2")], each: { client_id: C.northwind, status: "agreed" } }) },
    { who: "northwind", path: "role_requirements?select=id,client_id,set_id", note: "its 2 requirements",
      want: ok({ rows: 2, each: { client_id: C.northwind }, pairs: { cols: ["id", "set_id"], values: [1, 2].map((n) => [req("northwind", "ops:2", n), set("northwind", "ops:2")]) } }) },
    { who: "northwind", path: "submission_packages?select=id", want: none, note: "its only published package is on superseded requirements" },
    { who: "northwind", path: "requirement_evidence?select=package_id", want: none },
    { who: "northwind", path: "screening_summaries?select=id", want: none },
    { who: "northwind", path: "client_interviews?select=id,client_id,submission_id", note: "the published submission's 2 rounds (the unpublished submission's round hidden)",
      want: ok({ rows: 2, each: { client_id: C.northwind }, pairs: { cols: ["id", "submission_id"], values: [1, 2].map((n) => [iv("northwind", "n1-ops", n), sub("northwind", "n1-ops")]) } }) },
    { who: "northwind", path: "offer_outcomes?select=submission_id", want: none },
    { who: "northwind", path: "client_notes?select=id", want: none },
    { who: "northwind", path: "interview_feedback?select=interview_id", want: none },
    // Northwind: known hidden rows by id, and Harbor's rows by id and by client. Each must come back empty.
    { who: "northwind", path: `submission_packages?select=id&id=eq.${m3pkg("northwind", "n1-ops", 1)}`, want: none, note: "published package on superseded requirements" },
    { who: "northwind", path: `submission_packages?select=id&id=eq.${m3pkg("northwind", "n2-ops", 1)}`, want: none, note: "published package of an unpublished submission" },
    { who: "northwind", path: `role_requirement_sets?select=id&id=eq.${set("northwind", "ops:1")}`, want: none, note: "superseded requirement set" },
    { who: "northwind", path: `client_interviews?select=id&id=eq.${iv("northwind", "n2-ops", 1)}`, want: none, note: "interview of the unpublished submission" },
    { who: "northwind", path: `submission_packages?select=id&id=eq.${m6pkg("tb-isl")}`, want: none, note: "Harbor package, by id" },
    { who: "northwind", path: `screening_summaries?select=id&id=eq.${scr("tb-isl")}`, want: none, note: "Harbor summary, by id" },
    { who: "northwind", path: `client_interviews?select=id&id=eq.${iv("harbor", "tb-rsm", 1)}`, want: none, note: "Harbor interview, by id" },
    ...NEW.map(([t, k]) => ({ who: "northwind", path: `${t}?select=${k}&client_id=eq.${C.harbor}`, want: none, note: "Harbor rows" })),
    // Signed in without an active membership: nothing from any later table.
    ...["harborInactive", "noMembership"].flatMap((who) => NEW.map(([t, k]) => ({ who, path: `${t}?select=${k}`, want: none }))),
  ];
}

/** Whether a response matches its expectation; returns the short description printed after PASS or FAIL. Identity
    problems are described by counts only: no value from a response is ever printed.
    `want`: status (one or a list), code, rows (count), body (exact; not printed), and identity checks on the rows:
    ids (the exact set of `id` values), each (every row has these column values), pairs (the exact set of distinct
    [column, column] value pairs) and per (exact row count per value of a column). */
export function judge(want, status, body) {
  const statuses = [want.status].flat();
  const got = `HTTP ${status}` + (Array.isArray(body) ? `, ${body.length} row${body.length === 1 ? "" : "s"}` : body?.code ? `, ${body.code}` : "");
  const problems = [];
  let ok = statuses.includes(status);
  if (ok && want.code) ok = body?.code === want.code;
  if (ok && want.rows !== undefined) ok = Array.isArray(body) && body.length === want.rows;
  if (ok && want.body) { ok = JSON.stringify(body) === JSON.stringify(want.body); if (!ok) problems.push("body differs (not printed)"); }
  if (ok && (want.ids || want.each || want.pairs || want.per)) {
    if (!Array.isArray(body)) ok = false;
    else {
      const diff = (what, have, expect) => {
        const h = new Set(have), e = new Set(expect), extra = [...h].filter((x) => !e.has(x)).length, missing = [...e].filter((x) => !h.has(x)).length;
        if (extra || missing || have.length !== h.size) problems.push(`${what}: ${extra} unexpected, ${missing} missing${have.length !== h.size ? ", duplicates" : ""}`);
      };
      if (want.ids) diff("ids", body.map((r) => r.id), want.ids);
      if (want.pairs) diff(`${want.pairs.cols.join("/")} pairs`, [...new Set(body.map((r) => JSON.stringify(want.pairs.cols.map((c) => r[c]))))], want.pairs.values.map((v) => JSON.stringify(v)));
      for (const [col, v] of Object.entries(want.each ?? {})) { const n = body.filter((r) => r[col] !== v).length; if (n) problems.push(`${col}: ${n} row${n === 1 ? "" : "s"} not as expected`); }
      if (want.per) {
        const have = {}; for (const r of body) have[r[want.per.col]] = (have[r[want.per.col]] ?? 0) + 1;
        const keys = new Set([...Object.keys(have), ...Object.keys(want.per.counts)]), n = [...keys].filter((k) => have[k] !== want.per.counts[k]).length;
        if (n) problems.push(`rows per ${want.per.col}: ${n} value${n === 1 ? "" : "s"} with the wrong count`);
      }
      ok = problems.length === 0;
    }
  }
  const expected = `HTTP ${statuses.join(" or ")}` + (want.rows !== undefined ? `, ${want.rows} row${want.rows === 1 ? "" : "s"}` : "") + (want.code ? `, ${want.code}` : "");
  const checked = [want.ids && "ids", want.pairs && "links", want.each && "client/state", want.per && "per-parent counts", want.body && "body"].filter(Boolean);
  return { ok, text: ok ? `${got}${checked.length ? `; ${checked.join(", ")} as expected` : ""}` : `${got} (expected ${expected}${problems.length ? `; ${problems.join("; ")}` : ""})` };
}

/** A read's expectation in words, for the printed plan (no values from the seed beyond counts). */
export function describeWant(w) {
  if (w.code === "42501") return "refused (permission denied)";
  if (w.code) return `HTTP ${w.status}, ${w.code}`;
  if ([w.status].flat()[0] !== 200) return `HTTP ${[w.status].flat().join(" or ")}`;
  const checks = [w.ids && "exact ids", w.pairs && `exact ${w.pairs.cols.join("/")} links`, w.each && `every row ${Object.keys(w.each).join(" and ")} as expected`,
    w.per && `rows per ${w.per.col}`, w.body && "exact body"].filter(Boolean);
  return `${w.rows === 0 ? "must be empty" : w.rows !== undefined ? `${w.rows} row${w.rows === 1 ? "" : "s"}` : "rows"}${checks.length ? `; ${checks.join("; ")}` : ""}`;
}

/** Refuses anything that is not a plain data read: an RPC, a method, or a path outside a table. */
export function assertReadsOnly(reads) {
  for (const q of reads) {
    if ("method" in q || "body" in q || /^rpc\//.test(q.path) || !/^[a-z_]+\?select=/.test(q.path)) throw new Error(`not a plain GET read: ${q.path}`);
  }
}

/** Replaces every secret value in text with <hidden>. */
export const scrubber = (secrets) => (text) => secrets.filter((s) => s && s.length >= 6).reduce((t, s) => t.split(s).join("<hidden>"), String(text));

/** Runs the checks. `fetch` and `log` are passed in so the flow can be tested without a network; `reads` defaults to
    every request. Returns the failure count. */
export async function runChecks({ fetch, url, key, passwords, log, reads = READS }) {
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

  assertReadsOnly(reads);                        // before anything is sent
  try {
    // 1. Sign in each test user with email and password (the same request the browser client makes).
    say("— Auth requests, not data: sign-in (POST /auth/v1/token), session check (GET /auth/v1/user) —");
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
    say("— Data reads (GET /rest/v1 only; no RPCs, no writes) —");
    const labels = { anon: "signed out", forged: "made-up token", ...Object.fromEntries(USERS.map((u) => [u.key, u.label])) };
    for (const q of reads) {
      if (!["anon", "forged"].includes(q.who) && !sessions[q.who]) { result(false, `[${labels[q.who]}] GET ${q.path} — skipped: not signed in`); continue; }
      const headers = q.who === "anon" ? { ...keyHeader } : { apikey: key, Authorization: `Bearer ${q.who === "forged" ? "not-a-real-token" : sessions[q.who].access}` };
      if (q.profile) headers["Accept-Profile"] = q.profile;
      const r = await call(`/rest/v1/${q.path}`, { headers });
      const j = judge(q.want, r.status, r.body);
      result(j.ok, `[${labels[q.who]}] GET ${q.profile ? `${q.profile}.` : ""}${q.path.replace(UUID, "<seed id>")}${q.note ? ` (${q.note})` : ""} — ${j.text}`);
    }
  } finally {
    // 3. Always sign out, so no refresh token is left behind.
    say("— Auth requests, not data: sign-out (POST /auth/v1/logout) —");
    for (const u of USERS.filter((x) => sessions[x.key])) {
      const r = await call("/auth/v1/logout?scope=local", { method: "POST", headers: { apikey: key, Authorization: `Bearer ${sessions[u.key].access}` } });
      result(r.status === 204 || r.status === 200, `[${u.label}] sign out — HTTP ${r.status}`);
    }
  }
  return fails;
}
