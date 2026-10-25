/* Checks for the read-only API checks, with a fake Supabase instead of the network. */
import { describe, expect, it } from "vitest";
import { M1_READS, READS, USERS, checkPublicKey, checkUrl, judge, runChecks, scrubber, seedId } from "./api-read-lib.mjs";

const jwt = (payload) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

describe("settings", () => {
  it("accepts only a public key", () => {
    expect(checkPublicKey("sb_publishable_abc").ok).toBe(true);
    expect(checkPublicKey(jwt({ role: "anon" })).ok).toBe(true);
    expect(checkPublicKey("sb_secret_abc").ok).toBe(false);
    expect(checkPublicKey(jwt({ role: "service_role" })).ok).toBe(false);
    expect(checkPublicKey("").ok).toBe(false);
    expect(checkPublicKey("something-else").ok).toBe(false);
  });
  it("accepts only the plain project URL", () => {
    expect(checkUrl("https://abcdefghijklmnopqrst.supabase.co")).toBe(true);
    expect(checkUrl("http://abcdefghijklmnopqrst.supabase.co")).toBe(false);
    expect(checkUrl("https://abcdefghijklmnopqrst.supabase.co/rest/v1")).toBe(false);
  });
  it("computes the seed's ids exactly as Postgres md5(...)::uuid does", () => {
    expect(seedId("client", "harbor")).toBe("30fa9b2e-8cf8-eb5a-499c-3b794bc2b7b2");
  });
});

describe("requests", () => {
  it("are all reads", () => {
    expect(READS.every((q) => !("method" in q))).toBe(true);
  });
  it("judge status, error code, row count and body", () => {
    expect(judge({ status: 200, rows: 2 }, 200, [1, 2]).ok).toBe(true);
    expect(judge({ status: 200, rows: 2 }, 200, [1]).ok).toBe(false);
    expect(judge({ status: [401, 403], code: "42501" }, 403, { code: "42501" }).ok).toBe(true);
    expect(judge({ status: [401, 403], code: "42501" }, 200, []).ok).toBe(false);
    expect(judge({ status: 200, body: [{ a: 1 }] }, 200, [{ a: 2 }]).ok).toBe(false);
  });
  it("scrub secrets from output", () => {
    expect(scrubber(["supersecret"])("x supersecret y")).toBe("x <hidden> y");
  });
});

/* A fake Supabase that answers milestone 1's reads as the hosted project should, given the seed and memberships. The full
   milestone 1-6 set runs against the offline stand-in project in tests/offline-db/api-read.test.mjs. */
const KEY = "sb_publishable_testkey123";
const PASSWORDS = { harbor: "pw-harbor-1", northwind: "pw-northwind-1", harborInactive: "pw-inactive-1", noMembership: "pw-nomember-1" };
const COUNTS = { harbor: [1, 1, 4, 11, 12, 23], northwind: [1, 1, 1, 1, 1, 1], harborInactive: [0, 0, 0, 0, 0, 0], noMembership: [0, 0, 0, 0, 0, 0] };
const TABLES = ["clients", "client_members", "roles", "people", "submissions", "submission_events"];

function fakeSupabase({ breakRls = false } = {}) {
  const calls = [];
  const tokens = {};
  const res = (status, body) => ({ status, text: async () => (body === undefined ? "" : JSON.stringify(body)) });
  const fetch = async (url, init = {}) => {
    const u = new URL(url), h = init.headers || {}, method = init.method || "GET";
    calls.push({ method, path: u.pathname + u.search, headers: h });
    if (h.apikey !== KEY) return res(401, { message: "Invalid API key" });
    if (u.pathname === "/auth/v1/token") {
      const { email, password } = JSON.parse(init.body);
      const user = USERS.find((x) => x.email === email);
      if (!user || PASSWORDS[user.key] !== password) return res(400, { error_code: "invalid_credentials" });
      const access = jwt({ role: "authenticated", aud: "authenticated", sub: `id-${user.key}`, n: Math.random() });
      tokens[access] = user.key;
      return res(200, { access_token: access, refresh_token: `refresh-${user.key}-xyz`, user: { id: `id-${user.key}`, email } });
    }
    const bearer = (h.Authorization || "").replace("Bearer ", "");
    const who = tokens[bearer];
    if (u.pathname === "/auth/v1/user") return who ? res(200, { id: `id-${who}`, email: USERS.find((x) => x.key === who).email }) : res(401, {});
    if (u.pathname === "/auth/v1/logout") return res(204);
    if (u.pathname.startsWith("/rest/v1/")) {
      if (bearer && !who) return res(401, { code: "PGRST301" });
      if (h["Accept-Profile"] === "app_private") return res(406, { code: "PGRST106" });
      const table = u.pathname.slice("/rest/v1/".length);
      if (!TABLES.includes(table)) return res(404, { code: "PGRST205" });
      if (!who) return res(401, { code: "42501" });
      /* Answer with what the plan expects (the fake knows the seed), or leak one row when RLS is "broken". */
      const q = M1_READS.find((r) => r.who === who && `/rest/v1/${r.path}` === u.pathname + decodeURIComponent(u.search).replace(/ /g, "%20"));
      const want = q?.want ?? { rows: COUNTS[who][TABLES.indexOf(table)] };
      let rows = want.body ?? Array.from({ length: want.rows ?? 0 }, () => ({}));
      if (breakRls && who === "noMembership" && table === "submissions") rows = [{ ref: "leak" }];
      return res(200, rows);
    }
    return res(404, {});
  };
  return { fetch, calls };
}

describe("runChecks against a fake Supabase", () => {
  it("passes, sends only GET to the Data API, signs everyone out, and prints no secret", async () => {
    const { fetch, calls } = fakeSupabase(), lines = [];
    const fails = await runChecks({ fetch, url: "https://abcdefghijklmnopqrst.supabase.co", key: KEY, passwords: PASSWORDS, log: (l) => lines.push(l), reads: M1_READS });
    expect(lines.filter((l) => l.startsWith("FAIL"))).toEqual([]);
    expect(fails).toBe(0);
    expect(calls.filter((c) => c.path.startsWith("/rest/v1/")).every((c) => c.method === "GET")).toBe(true);
    expect(calls.filter((c) => c.path.startsWith("/auth/v1/logout"))).toHaveLength(4);
    const out = lines.join("\n");
    for (const s of [KEY, ...Object.values(PASSWORDS), "refresh-harbor-xyz", "eyJ"]) expect(out).not.toContain(s);
  });
  it("reports a leaked row as a failure", async () => {
    const { fetch } = fakeSupabase({ breakRls: true }), lines = [];
    const fails = await runChecks({ fetch, url: "https://abcdefghijklmnopqrst.supabase.co", key: KEY, passwords: PASSWORDS, log: (l) => lines.push(l), reads: M1_READS });
    expect(fails).toBe(1);
    expect(lines.find((l) => l.startsWith("FAIL"))).toMatch(/signed in, no membership.*submissions/);
  });
  it("reports a wrong password, skips that user's reads, and still signs the others out", async () => {
    const { fetch, calls } = fakeSupabase(), lines = [];
    const fails = await runChecks({ fetch, url: "https://abcdefghijklmnopqrst.supabase.co", key: KEY, passwords: { ...PASSWORDS, northwind: "typo" }, log: (l) => lines.push(l), reads: M1_READS });
    expect(fails).toBeGreaterThan(1);
    expect(lines.some((l) => /FAIL.*Northwind.*sign in.*invalid_credentials/.test(l))).toBe(true);
    expect(calls.filter((c) => c.path.startsWith("/auth/v1/logout"))).toHaveLength(3);
  });
  it("signs out even when the network fails part-way", async () => {
    const { fetch: real, calls } = fakeSupabase(), lines = [];
    let n = 0;
    const fetch = async (url, init) => { if (url.includes("/rest/v1/") && ++n === 20) throw new Error("socket hang up"); return real(url, init); };
    await runChecks({ fetch, url: "https://abcdefghijklmnopqrst.supabase.co", key: KEY, passwords: PASSWORDS, log: (l) => lines.push(l), reads: M1_READS });
    expect(calls.filter((c) => c.path.startsWith("/auth/v1/logout"))).toHaveLength(4);
  });
});
