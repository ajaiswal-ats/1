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

export async function createProject() {
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
  await db.exec(read("supabase/seed/m1_fictional.sql"));
  await db.exec(`insert into auth.users (email, email_confirmed_at) select e, now() from unnest(array[${Object.values(EMAILS).map((e) => `'${e}'`).join(",")}]) e`);
  await db.exec(read("supabase/seed/m1_memberships.sql"));
  const ids = Object.fromEntries((await db.query("select email, id from auth.users")).rows.map((r) => [r.email, r.id]));
  return { db, ids, fetch: makeFetch(db, ids) };
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

function makeFetch(db, ids) {
  const tokens = new Map();
  const jwt = (p) => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(p)).toString("base64url")}.offline`;
  const reply = (status, body) => ({ status, text: async () => (body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body)) });
  return async (url, init = {}) => {
    const u = new URL(url), h = init.headers || {}, method = init.method || "GET";
    if (h.apikey !== KEY) return reply(401, { message: "Invalid API key" });
    if (u.pathname === "/auth/v1/token") {
      const { email, password } = JSON.parse(init.body);
      const key = Object.keys(EMAILS).find((k) => EMAILS[k] === email);
      if (!key || PASSWORDS[key] !== password) return reply(400, { error_code: "invalid_credentials" });
      const access = jwt({ sub: ids[email], role: "authenticated", aud: "authenticated", jti: crypto.randomUUID() });
      tokens.set(access, ids[email]);
      return reply(200, { access_token: access, refresh_token: crypto.randomUUID(), user: { id: ids[email], email } });
    }
    if (u.pathname === "/auth/v1/logout") return reply(204);
    if (!u.pathname.startsWith("/rest/v1/")) return reply(404, {});
    const bearer = (h.Authorization || "").replace(/^Bearer /, "");
    if (bearer && !tokens.has(bearer)) return reply(401, { code: "PGRST301", message: "JWT invalid" });
    const sub = bearer ? tokens.get(bearer) : null;
    const name = u.pathname.slice("/rest/v1/".length);
    const filters = [...u.searchParams].filter(([k]) => k !== "select").map(([k, v]) => { const m = v.match(/^eq\.(.*)$/); if (!/^[a-z_]+$/.test(k) || !m) throw new Error(`fake: unsupported filter ${k}=${v}`); return [k, m[1]]; });
    const where = filters.length ? ` where ${filters.map(([k], i) => `${k}::text = $${i + 1}`).join(" and ")}` : "";
    const params = filters.map(([, v]) => v);
    try {
      if (method === "GET") {
        const cols = (u.searchParams.get("select") || "*").split(",");
        if (!cols.every((c) => /^([a-z_]+|\*)$/.test(c))) throw new Error("fake: bad select");
        const r = await asUser(db, sub, `select coalesce(json_agg(t), '[]')::text as j from (select ${cols.join(", ")} from public.${name}${where}) t`, params);
        return reply(200, r.rows[0].j);
      }
      if (method === "POST" && name === "rpc/client_move_stage") {
        const b = JSON.parse(init.body);
        const r = await asUser(db, sub, "select public.client_move_stage($1, $2, $3, $4)::text as j", [b.p_submission_id, b.p_to_stage, b.p_expected_version, b.p_idempotency_key]);
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
      const status = e.code === "42501" ? (sub ? 403 : 401) : /^PT\d{3}$/.test(e.code) ? Number(e.code.slice(2)) : 400;
      return reply(status, { code: e.code, message: e.message, details: e.detail ?? null, hint: null });
    }
  };
}

/** Everything the restore must leave exactly as it was (or put back), as one comparable JSON value. */
export async function snapshot(db) {
  const tables = ["public.clients", "public.client_members", "public.roles", "public.people", "public.submissions", "public.submission_events", "app_private.idempotency_keys"];
  const out = {};
  for (const t of tables) out[t] = (await db.query(`select coalesce(json_agg(t order by t::text), '[]')::text as j from ${t} t`)).rows[0].j;
  return out;
}
