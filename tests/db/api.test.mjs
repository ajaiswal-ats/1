/* Milestone 1 through the hosted Data API and Auth, as a signed-out visitor and as real signed-in test users.
   Uses only the public key and user sessions for requests (the service role key only creates the test users).
   Resets the fictional seed before and after. Run with: npm run db:test:api */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../../scripts/db/env.mjs";
import { ensureUsers, keyHeaders } from "../../scripts/db/users.mjs";
import { reseed } from "../../scripts/db/seed.mjs";
import { FIXTURE } from "../../src/data/fixtures.ts";
import { replay } from "../../src/domain/actions.ts";
import { pipelineModel } from "../../src/reporting/metrics.ts";

const env = loadEnv(["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_DB_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
const anon = keyHeaders(env.SUPABASE_ANON_KEY);
let users, tokens = {};

const signIn = async (u) => {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env.SUPABASE_ANON_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email: u.email, password: u.password }) });
  expect(r.status, `sign-in ${u.email}`).toBe(200);
  return (await r.json()).access_token;
};
const as = (who) => (who === "anon" ? anon : { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${tokens[who]}` });
const get = async (who, path) => { const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: as(who) }); return { status: r.status, body: await r.json().catch(() => null) }; };
const rpc = async (who, args) => {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/client_move_stage`, { method: "POST", headers: { ...as(who), "Content-Type": "application/json" }, body: JSON.stringify(args) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const sub = async (who, ref) => (await get(who, `submissions?select=id,ref,stage,version&ref=eq.${ref}`)).body[0];
const TABLES = ["clients", "client_members", "roles", "people", "submissions", "submission_events"];

beforeAll(async () => {
  users = await ensureUsers(env);
  reseed(env);
  for (const k of Object.keys(users)) tokens[k] = await signIn(users[k]);
}, 60_000);
afterAll(() => reseed(env));

describe("signed out", () => {
  it.each(TABLES)("cannot read %s", async (t) => {
    const r = await get("anon", `${t}?select=*`);
    expect(r.status === 401 || r.status === 403 || (r.status === 200 && r.body.length === 0), `HTTP ${r.status}`).toBe(true);
    expect(r.status).not.toBe(500);
    if (r.status === 200) expect(r.body).toEqual([]);
  });
  it("cannot call client_move_stage", async () => {
    const r = await rpc("anon", { p_submission_id: crypto.randomUUID(), p_to_stage: "Offer", p_expected_version: 1, p_idempotency_key: crypto.randomUUID() });
    expect([401, 403, 404]).toContain(r.status);
  });
});

describe("signed in", () => {
  it("users without an active membership see nothing", async () => {
    for (const who of ["noMembership", "harborInactive"]) for (const t of TABLES) expect((await get(who, `${t}?select=*`)).body, `${who} ${t}`).toEqual([]);
  });
  it("a Harbor member sees only Harbor's published data", async () => {
    const s = (await get("harbor", "submissions?select=ref,publication")).body;
    expect(s).toHaveLength(12);
    expect(s.every((x) => x.publication === "published")).toBe(true);
    expect(s.map((x) => x.ref)).not.toContain("zz-isl");
    expect((await get("harbor", "people?select=ref")).body).toHaveLength(11);
    expect((await get("harbor", "clients?select=name")).body).toEqual([{ name: "Harbor Industrial Supply" }]);
    expect((await get("harbor", "client_members?select=display_name")).body).toEqual([{ display_name: "Maria Alvarez (test)" }]);
  });
  it("a Northwind member sees only its one published submission", async () => {
    expect((await get("northwind", "submissions?select=ref")).body).toEqual([{ ref: "n1-ops" }]);
    expect((await get("northwind", "roles?select=ref")).body).toEqual([{ ref: "ops" }]);
  });
  it("direct writes are refused", async () => {
    const s = await sub("harbor", "tb-isl");
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/submissions?id=eq.${s.id}`, { method: "PATCH", headers: { ...as("harbor"), "Content-Type": "application/json" }, body: JSON.stringify({ stage: "Hired" }) });
    expect([401, 403]).toContain(r.status);
    expect((await sub("harbor", "tb-isl")).stage).toBe("To review");
  });
});

describe("client_move_stage over HTTP", () => {
  it("moves, returns the same result for a retry, and refuses key reuse, stale versions and hidden submissions", async () => {
    const s = await sub("harbor", "ab-fsr"), key = crypto.randomUUID();
    const a = await rpc("harbor", { p_submission_id: s.id, p_to_stage: "Interview", p_expected_version: s.version, p_idempotency_key: key });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ stage: "Interview", version: s.version + 1 });
    expect(await rpc("harbor", { p_submission_id: s.id, p_to_stage: "Interview", p_expected_version: s.version, p_idempotency_key: key })).toEqual(a);
    const reused = await rpc("harbor", { p_submission_id: s.id, p_to_stage: "Offer", p_expected_version: s.version, p_idempotency_key: key });
    expect([reused.status, reused.body.message]).toEqual([409, "idempotency_key_reused"]);
    const stale = await rpc("harbor", { p_submission_id: s.id, p_to_stage: "Offer", p_expected_version: s.version, p_idempotency_key: crypto.randomUUID() });
    expect([stale.status, stale.body.message]).toEqual([409, "version_conflict"]);
    const northwindSub = (await get("northwind", "submissions?select=id")).body[0].id;
    const other = await rpc("harbor", { p_submission_id: northwindSub, p_to_stage: "Interview", p_expected_version: 1, p_idempotency_key: crypto.randomUUID() });
    expect([other.status, other.body.message]).toEqual([404, "submission_not_found"]);
  });
  it("two simultaneous moves from the same version: exactly one succeeds", async () => {
    const s = await sub("harbor", "en-pa");
    const both = await Promise.all(["Interview", "Offer"].map((to) => rpc("harbor", { p_submission_id: s.id, p_to_stage: to, p_expected_version: s.version, p_idempotency_key: crypto.randomUUID() })));
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(both.find((r) => r.status === 409).body.message).toBe("version_conflict");
  });
});

describe("reporting parity", () => {
  it("what a signed-in client reads gives the same Pipeline and Time in stage as the frontend's own data", async () => {
    reseed(env);
    const moves = [["je-isl", "To review"], ["tb-isl", "Interview"], ["tb-isl", "Hired"]];
    for (const [ref, to] of moves) {
      const s = await sub("harbor", ref);
      expect((await rpc("harbor", { p_submission_id: s.id, p_to_stage: to, p_expected_version: s.version, p_idempotency_key: crypto.randomUUID() })).status).toBe(200);
    }
    const subs = (await get("harbor", "submissions?select=id,ref,stage")).body;
    const events = (await get("harbor", "submission_events?select=submission_id,kind,to_stage,occurred_on,actor_kind,submission_version&order=submission_version")).body;
    const refOf = Object.fromEntries(subs.map((s) => [s.id, s.ref]));
    const today = events.filter((e) => e.kind === "stage_move").map((e) => e.occurred_on).sort().at(-1);
    const fromDb = { ...FIXTURE,
      subs: FIXTURE.subs.map((c) => ({ ...c, stage: subs.find((s) => s.ref === c.id).stage })),
      moves: events.filter((e) => e.kind === "stage_move").map((e) => ({ sid: refOf[e.submission_id], to: e.to_stage, d: e.occurred_on, by: e.actor_kind === "client" ? "you" : "ro" })) };
    const expected = replay(FIXTURE, moves.map(([sid, to]) => ({ type: "move", sid, to, note: "", d: today }))).data;
    for (const r of ["all", ...FIXTURE.roles.map((x) => x.id)]) {
      const a = pipelineModel(fromDb, r, today), b = pipelineModel(expected, r, today);
      expect([a.reached, a.now, a.time], r).toEqual([b.reached, b.now, b.time]);
    }
  });
});
