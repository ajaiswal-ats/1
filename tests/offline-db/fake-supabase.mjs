/* A stand-in for the hosted project, for offline tests only: PGlite (real Postgres in memory) with the roles and auth.uid()
   Supabase provides, the real milestone 1 migration, seed and membership SQL, and a minimal Auth and Data API that switches
   to the anon or authenticated role with JWT claims for every request, as PostgREST does. Tokens are unsigned test values. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
export const KEY = "sb_publishable_offline_test_key";
export const URL_BASE = "https://abcdefghijklmnopqrst.supabase.co";
export const PASSWORDS = { harbor: "offline-pw-harbor", northwind: "offline-pw-northwind", harborInactive: "offline-pw-inactive", noMembership: "offline-pw-nomember" };
const EMAILS = { harbor: "portal-test-harbor@example.com", northwind: "portal-test-northwind@example.com", harborInactive: "portal-test-harbor-inactive@example.com", noMembership: "portal-test-no-membership@example.com" };

/** `maxRows`: the server's row cap per request, like Supabase's "Max rows" (1,000 by default). `m3`: apply milestone 3
    (needs `m2`); `m3Seed`: also load its fictional content. `m4` / `m4Seed`: the same for milestone 4 (needs `m3`).
    `m6` / `m6Seed`: milestone 6 (needs `m3`; its seed needs `m3Seed`). Off unless asked for: its seed publishes new package
    versions, and the earlier milestones' tests describe the state before it. */
export async function createProject({ maxRows = 1000, m2 = true, m3 = m2, m3Seed = m3, m4 = m3, m4Seed = m4, m6 = false, m6Seed = m6 } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    grant anon, authenticated, service_role to postgres;
    create schema auth; grant usage on schema auth to anon, authenticated;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;`);
  await db.exec(read("supabase/migrations/20261023120000_m1_tenancy_stage_events.sql"));
  if (m2) await db.exec(read("supabase/migrations/20261025120000_m2_decline_feedback.sql"));
  await db.exec(read("supabase/seed/m1_fictional.sql"));
  await db.exec(`insert into auth.users (email, email_confirmed_at) select e, now() from unnest(array[${Object.values(EMAILS).map((e) => `'${e}'`).join(",")}]) e`);
  await db.exec(read("supabase/seed/m1_memberships.sql"));
  if (m3) await db.exec(read("supabase/migrations/20261026120000_m3_requirements_packages.sql"));
  if (m3 && m3Seed) await db.exec(read("supabase/seed/m3_fictional.sql"));
  if (m4) await db.exec(read("supabase/migrations/20261027120000_m4_interviews_outcomes.sql"));
  if (m4 && m4Seed) await db.exec(read("supabase/seed/m4_fictional.sql"));
  if (m6) await db.exec(read("supabase/migrations/20261028120000_m6_screening_summaries.sql"));
  if (m6 && m6Seed) await db.exec(read("supabase/seed/m6_fictional.sql"));
  const ids = Object.fromEntries((await db.query("select email, id from auth.users")).rows.map((r) => [r.email, r.id]));
  return { db, ids, fetch: makeFetch(db, ids, maxRows) };
}

/** Runs one SQL statement as a user, the way PostgREST does: role and claims set for this transaction only. */
export async function asUser(db, sub, sql, params = []) {
  return db.transaction(async (tx) => {
    const role = sub ? "authenticated" : "anon";
    await tx.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [JSON.stringify(sub ? { sub, role } : { role }), sub || ""]);
    await tx.exec(`set local role ${role}`);
    return tx.query(sql, params);
  });
}

function makeFetch(db, ids, maxRows) {
  const tokens = new Map();
  const jwt = (p) => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(p)).toString("base64url")}.offline`;
  const reply = (status, body) => new Response(status === 204 || body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body),
    { status, headers: { "Content-Type": "application/json" } });
  return async (url, init = {}) => {
    const u = new URL(url), hd = new Headers(init.headers || {}), method = (init.method || "GET").toUpperCase();
    const h = { apikey: hd.get("apikey"), Authorization: hd.get("authorization") || "", "Accept-Profile": hd.get("accept-profile") };
    if (h.apikey !== KEY) return reply(401, { message: "Invalid API key" });
    if (u.pathname === "/auth/v1/token") {
      const { email, password } = JSON.parse(init.body);
      const key = Object.keys(EMAILS).find((k) => EMAILS[k] === email);
      if (!key || PASSWORDS[key] !== password) return reply(400, { error_code: "invalid_credentials" });
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const access = jwt({ sub: ids[email], role: "authenticated", aud: "authenticated", exp, jti: crypto.randomUUID() });
      tokens.set(access, ids[email]);
      return reply(200, { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: crypto.randomUUID(),
        user: { id: ids[email], email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" } });
    }
    if (u.pathname === "/auth/v1/logout") return reply(204);
    if (u.pathname === "/auth/v1/user") {
      const id = tokens.get((h.Authorization || "").replace(/^Bearer /, ""));
      return id ? reply(200, { id, email: Object.keys(ids).find((e) => ids[e] === id), aud: "authenticated", role: "authenticated" }) : reply(401, { error_code: "bad_jwt" });
    }
    if (!u.pathname.startsWith("/rest/v1/")) return reply(404, {});
    const bearer = (h.Authorization || "").replace(/^Bearer /, "");
    if (bearer && !tokens.has(bearer)) return reply(401, { code: "PGRST301", message: "JWT invalid" });
    const sub = bearer ? tokens.get(bearer) : null;
    const name = u.pathname.slice("/rest/v1/".length);
    if (h["Accept-Profile"] && h["Accept-Profile"] !== "public") return reply(406, { code: "PGRST106", message: "The schema must be one of the following: public" });
    const limit = u.searchParams.get("limit"), order = u.searchParams.get("order");
    if (limit !== null && !/^\d+$/.test(limit)) throw new Error("fake: bad limit");
    if (order !== null && !/^[a-z_]+\.asc$/.test(order)) throw new Error(`fake: unsupported order ${order}`);
    const filters = [...u.searchParams].filter(([k]) => !["select", "limit", "order"].includes(k)).map(([k, v]) => {
      const m = v.match(/^(eq|neq|gt)\.(.*)$/);
      if (!/^[a-z_]+$/.test(k) || !m) throw new Error(`fake: unsupported filter ${k}=${v}`);
      return [k, m[1], m[2]];
    });
    /* eq and neq compare as text (as before); gt compares in the column's own type, as PostgREST does. */
    const where = filters.length ? ` where ${filters.map(([k, op], i) => (op === "eq" ? `${k}::text = $${i + 1}` : op === "neq" ? `${k}::text <> $${i + 1}` : `${k} > $${i + 1}`)).join(" and ")}` : "";
    const params = filters.map(([, , v]) => v);
    const rowCap = Math.min(limit === null ? Infinity : Number(limit), maxRows);
    const tail = `${order ? ` order by ${order.replace(/\.asc$/, "")} asc` : ""}${Number.isFinite(rowCap) ? ` limit ${rowCap}` : ""}`;
    try {
      if (method === "GET") {
        const cols = (u.searchParams.get("select") || "*").split(",");
        if (!cols.every((c) => /^([a-z_]+|\*)$/.test(c))) throw new Error("fake: bad select");
        const r = await asUser(db, sub, `select coalesce(json_agg(t), '[]')::text as j from (select ${cols.join(", ")} from public.${name}${where}${tail}) t`, params);
        return reply(200, r.rows[0].j);
      }
      const RPCS = {
        client_move_stage: ["p_submission_id", "p_to_stage", "p_expected_version", "p_idempotency_key"],
        client_decline: ["p_submission_id", "p_note", "p_category", "p_expected_version", "p_idempotency_key"],
        client_add_feedback: ["p_submission_id", "p_about", "p_text", "p_expected_version", "p_idempotency_key"],
        client_add_interview_feedback: ["p_submission_id", "p_interview_id", "p_about", "p_text", "p_expected_version", "p_idempotency_key"],
      };
      const fn = name.startsWith("rpc/") ? name.slice(4) : null;
      if (method === "POST" && fn && RPCS[fn]) {
        const b = JSON.parse(init.body), args = RPCS[fn];
        const r = await asUser(db, sub, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")})::text as j`, args.map((a) => b[a] ?? null));
        return reply(200, r.rows[0].j);
      }
      if (method === "PATCH" && name === "submissions") {
        const b = JSON.parse(init.body);
        await asUser(db, sub, `update public.submissions set stage = $${params.length + 1}${where}`, [...params, b.stage]);
        return reply(204);
      }
      return reply(404, {});
    } catch (e) {
      if (!e.code) throw e;
      if (e.code === "42P01") return reply(404, { code: "PGRST205", message: "Could not find the table in the schema cache" });
      const status = e.code === "42501" ? (sub ? 403 : 401) : /^PT\d{3}$/.test(e.code) ? Number(e.code.slice(2)) : 400;
      return reply(status, { code: e.code, message: e.message, details: e.detail ?? null, hint: null });
    }
  };
}

/** Everything the restore must leave exactly as it was (or put back), as one comparable JSON value. */
export async function snapshot(db) {
  const tables = ["public.clients", "public.client_members", "public.roles", "public.people", "public.submissions", "public.submission_events", "app_private.idempotency_keys"];
  if ((await db.query("select to_regclass('public.client_notes') is not null as m2")).rows[0].m2) tables.push("public.client_notes");
  if ((await db.query("select to_regclass('public.role_requirement_sets') is not null as m3")).rows[0].m3)
    tables.push("public.role_requirement_sets", "public.role_requirements", "public.submission_packages", "public.requirement_evidence");
  if ((await db.query("select to_regclass('public.client_interviews') is not null as m4")).rows[0].m4)
    tables.push("public.client_interviews", "public.offer_outcomes", "public.interview_feedback");
  if ((await db.query("select to_regclass('public.screening_summaries') is not null as m6")).rows[0].m6) tables.push("public.screening_summaries");
  const out = {};
  for (const t of tables) out[t] = (await db.query(`select coalesce(json_agg(t order by t::text), '[]')::text as j from ${t} t`)).rows[0].j;
  return out;
}
