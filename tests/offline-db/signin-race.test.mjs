/* Regression, with the pinned supabase-js (not a fake auth client): a sign-in that is still pending when another account
   signs in, and then fails, must not put the screen back to "Sign in". supabase-js returns network and API failures as
   { error }, but rethrows other failures, such as browser storage refusing to save the session.
   The "other tab" is a second sign-in on the same client: it reaches our listener through the same SIGNED_IN
   notification that another tab's sign-in delivers over BroadcastChannel (which supabase-js only uses in a browser). */
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { MESSAGES, createAuthController } from "../../src/auth/session.ts";

const URL_BASE = "https://abcdefghijklmnopqrst.supabase.co";
const USERS = { "a@example.com": "11111111-1111-4111-8111-111111111111", "b@example.com": "22222222-2222-4222-8222-222222222222" };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (id) => `${b64({ alg: "HS256" })}.${b64({ sub: id, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const loadAccount = async (userId) => ({ kind: "active", member: { id: `m-${userId.slice(0, 4)}`, clientId: "c", displayName: "X", jobTitle: "" }, client: { id: "c", name: `Client of ${userId.slice(0, 4)}` } });

function setup({ storageRefuses = null, gateA = null, network = true } = {}) {
  const fetch = async (url, init = {}) => {
    if (!network) throw new TypeError("Failed to fetch");
    const u = new URL(url);
    if (u.pathname !== "/auth/v1/token") return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    const { email } = JSON.parse(init.body), id = USERS[email];
    if (email === "a@example.com" && gateA) await gateA;
    return new Response(JSON.stringify({ access_token: token(id), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `r-${id}`,
      user: { id, email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" } }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, removeItem: (k) => mem.delete(k),
    setItem: (k, v) => { if (storageRefuses && v.includes(storageRefuses)) throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); mem.set(k, v); } };
  const sb = createClient(URL_BASE, "sb_publishable_offline", { auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storage }, global: { fetch } });
  const c = createAuthController(sb.auth, loadAccount);
  c.start();
  return { sb, c };
}

describe("sign-in with the pinned supabase-js", () => {
  it("REGRESSION: a pending sign-in that throws after another account signed in leaves the newer account in place", async () => {
    let releaseA;
    const { sb, c } = setup({ storageRefuses: USERS["a@example.com"], gateA: new Promise((r) => { releaseA = r; }) });
    await wait();
    const pending = c.signIn("a@example.com", "pw");                       // this tab: pending
    expect((await sb.auth.signInWithPassword({ email: "b@example.com", password: "pw" })).error).toBeNull();   // "another tab"
    await wait();
    expect(c.getState()).toMatchObject({ status: "ready", user: { id: USERS["b@example.com"] } });
    releaseA(); await pending; await wait();
    expect(c.getState()).toMatchObject({ status: "ready", user: { id: USERS["b@example.com"] }, client: { name: "Client of 2222" } });
    expect((await sb.auth.getSession()).data.session.user.id).toBe(USERS["b@example.com"]);   // the screen matches the stored session
  });

  it("the pinned SDK really rethrows a storage failure (it is not returned as an error)", async () => {
    const { sb } = setup({ storageRefuses: USERS["a@example.com"] });
    await expect(sb.auth.signInWithPassword({ email: "a@example.com", password: "pw" })).rejects.toMatchObject({ name: "QuotaExceededError" });
  });

  it("without a race, a storage failure gets the storage message, and the screen stays signed out", async () => {
    const { c } = setup({ storageRefuses: USERS["a@example.com"] });
    await wait();
    await c.signIn("a@example.com", "pw"); await wait();
    expect(c.getState()).toEqual({ status: "signed-out", pending: false, error: MESSAGES.storage, notice: null });
  });

  it("a network failure is returned by the SDK as an error, and keeps its own message", async () => {
    const { c } = setup({ network: false });
    await wait();
    await c.signIn("a@example.com", "pw"); await wait();
    expect(c.getState()).toEqual({ status: "signed-out", pending: false, error: MESSAGES.offline, notice: null });
  });
});
