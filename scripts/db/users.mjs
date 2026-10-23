/* The four fictional test users, managed through the Auth admin API with the service role key (this local script only;
   never browser code). Each run sets new random passwords, kept in memory for the tests and never written to disk.
   Memberships are written with psql after the seed.
   Usage: npm run db:users -- --ensure   (create or refresh users and memberships)
          npm run db:users -- --delete   (remove the test users; run after the milestone 1 tables are dropped) */
import crypto from "node:crypto";
import { keyHeaders, loadEnv, psql } from "./env.mjs";
export { keyHeaders };

export const TEST_USERS = [
  { key: "harbor", email: "portal-test-harbor@example.com", client: "harbor", name: "Maria Alvarez (test)", title: "Hiring manager", active: true },
  { key: "harborInactive", email: "portal-test-harbor-inactive@example.com", client: "harbor", name: "Inactive member (test)", title: "Former hiring manager", active: false },
  { key: "northwind", email: "portal-test-northwind@example.com", client: "northwind", name: "Northwind member (test)", title: "Hiring manager", active: true },
  { key: "noMembership", email: "portal-test-no-membership@example.com", client: null },
];


async function admin(env, method, pathname, body) {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/admin${pathname}`, {
    method, headers: { ...keyHeaders(env.SUPABASE_SERVICE_ROLE_KEY), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Auth admin ${method} ${pathname}: HTTP ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function findTestUsers(env) {
  const found = new Map();
  for (let page = 1; page < 50; page++) {
    const { users = [] } = await admin(env, "GET", `/users?page=${page}&per_page=100`);
    for (const u of users) if (TEST_USERS.some((t) => t.email === u.email)) found.set(u.email, u);
    if (users.length < 100) break;
  }
  return found;
}

/** Creates any missing test users, sets new random passwords, and writes memberships. Returns { key: { id, email, password } }. */
export async function ensureUsers(env) {
  const existing = await findTestUsers(env), out = {};
  for (const t of TEST_USERS) {
    const password = crypto.randomBytes(24).toString("base64url");
    const u = existing.get(t.email)
      ? await admin(env, "PUT", `/users/${existing.get(t.email).id}`, { password, email_confirm: true, app_metadata: { portal_test_user: true } })
      : await admin(env, "POST", "/users", { email: t.email, password, email_confirm: true, app_metadata: { portal_test_user: true } });
    out[t.key] = { id: u.id, email: t.email, password };
  }
  const rows = TEST_USERS.filter((t) => t.client).map((t) =>
    `(md5('portal-m1:client:${t.client}')::uuid, '${out[t.key].id}', '${t.name.replace(/'/g, "''")}', '${t.title}', ${t.active})`).join(",\n  ");
  const r = psql(env, ["-c", `insert into public.client_members (client_id, user_id, display_name, job_title, active) values
  ${rows}
on conflict (user_id) do update set client_id = excluded.client_id, display_name = excluded.display_name, job_title = excluded.job_title, active = excluded.active;`]);
  if (r.status !== 0) throw new Error(`memberships: ${r.stderr.trim()}`);
  return out;
}

/** Deletes the marked fictional test users still present; returns how many were deleted. Safe to re-run.
    Run after the milestone 1 tables are dropped: a member who made a move cannot be deleted while events refer to them. */
export async function deleteUsers(env) {
  const existing = await findTestUsers(env);
  let n = 0;
  for (const u of existing.values()) {
    if (!u.app_metadata?.portal_test_user) { console.log(`skipped ${u.email}: not marked as a portal test user`); continue; }
    await admin(env, "DELETE", `/users/${u.id}`);
    console.log(`deleted ${u.email}`);
    n++;
  }
  return n;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = loadEnv(["SUPABASE_URL", "SUPABASE_DB_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  if (process.argv.includes("--delete")) await deleteUsers(env);
  else if (process.argv.includes("--ensure")) { const u = await ensureUsers(env); console.log(`test users ready: ${Object.values(u).map((x) => x.email).join(", ")}`); }
  else console.log("Usage: npm run db:users -- --ensure | --delete");
}
