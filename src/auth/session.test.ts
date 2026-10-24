/* Session state: restore, sign-in, account states, account changes, sign-out. A fake Auth client stands in for supabase.auth. */
import { describe, expect, it } from "vitest";
import { MESSAGES, createAuthController, type Account, type AuthClient, type AuthState } from "./session";

const flush = () => new Promise((r) => setTimeout(r, 0));
const session = (id: string) => ({ user: { id, email: `${id}@example.com` } });
const active = (id: string): Account => ({ kind: "active", member: { id: `m-${id}`, clientId: `c-${id}`, displayName: `Member ${id}`, jobTitle: "" }, client: { id: `c-${id}`, name: `Client ${id}` } });

function fakeAuth(opts: { stored?: string | null; passwords?: Record<string, string>; signOutFails?: boolean; restoreFails?: boolean } = {}) {
  let cb: (event: string, s: ReturnType<typeof session> | null) => void = () => {};
  const calls: string[] = [];
  const auth: AuthClient = {
    getSession: async () => (opts.restoreFails ? { data: { session: null }, error: { message: "refresh failed", status: 400 } } : { data: { session: opts.stored ? session(opts.stored) : null }, error: null }),
    onAuthStateChange: (f) => { cb = f; return { data: { subscription: { unsubscribe: () => calls.push("unsubscribe") } } }; },
    signInWithPassword: async ({ email, password }) => {
      calls.push(`signIn ${email}`);
      const id = email.split("@")[0];
      if (password === "offline") return { data: { session: null }, error: { name: "AuthRetryableFetchError", message: "fetch failed", status: 0 } };
      if (opts.passwords?.[id] !== password) return { data: { session: null }, error: { code: "invalid_credentials", status: 400 } };
      return { data: { session: session(id) }, error: null };
    },
    signOut: async () => { calls.push("signOut"); return { error: opts.signOutFails ? { name: "AuthRetryableFetchError", message: "fetch failed" } : null }; },
  };
  return { auth, calls, emit: (event: string, id: string | null) => cb(event, id ? session(id) : null) };
}

/** Account loads that resolve only when told to, so races can be tested. */
function deferredLoads() {
  const pending: { id: string; resolve: (a: Account) => void; reject: (e: Error) => void }[] = [];
  const load = (id: string) => new Promise<Account>((resolve, reject) => pending.push({ id, resolve, reject }));
  return { load, pending, answer: (id: string, a: Account | Error) => { const p = pending.find((x) => x.id === id)!; pending.splice(pending.indexOf(p), 1); a instanceof Error ? p.reject(a) : p.resolve(a); } };
}

const status = (s: AuthState) => s.status;

describe("restoring a session", () => {
  it("restores a saved session and loads the account", async () => {
    const f = fakeAuth({ stored: "a" }), c = createAuthController(f.auth, async (id) => active(id));
    expect(status(c.getState())).toBe("restoring");
    c.start(); await flush();
    expect(c.getState()).toMatchObject({ status: "ready", user: { id: "a" }, client: { name: "Client a" } });
  });
  it("shows sign-in when nothing is saved, or the saved session cannot be restored", async () => {
    for (const opts of [{ stored: null }, { restoreFails: true }]) {
      const c = createAuthController(fakeAuth(opts).auth, async (id) => active(id));
      c.start(); await flush();
      expect(c.getState()).toMatchObject({ status: "signed-out", error: opts.restoreFails ? MESSAGES.restore : null });
    }
  });
});

describe("signing in", () => {
  it("signs in, then loads the account", async () => {
    const f = fakeAuth({ passwords: { a: "pw" } }), d = deferredLoads(), c = createAuthController(f.auth, d.load);
    c.start(); await flush();
    const p = c.signIn("a@example.com", "pw");
    expect(c.getState()).toMatchObject({ status: "signed-out", pending: true });
    await p;
    expect(c.getState()).toMatchObject({ status: "loading", user: { id: "a" } });
    d.answer("a", active("a")); await flush();
    expect(c.getState()).toMatchObject({ status: "ready", member: { displayName: "Member a" } });
  });
  it("explains a wrong password or an unreachable service, and loads nothing", async () => {
    const f = fakeAuth({ passwords: { a: "pw" } }), loads: string[] = [], c = createAuthController(f.auth, async (id) => { loads.push(id); return active(id); });
    c.start(); await flush();
    await c.signIn("a@example.com", "nope");
    expect(c.getState()).toEqual({ status: "signed-out", pending: false, error: MESSAGES.wrong, notice: null });
    await c.signIn("a@example.com", "offline");
    expect(c.getState()).toMatchObject({ error: MESSAGES.offline });
    expect(loads).toEqual([]);
  });
  it("asks for both fields before sending anything", async () => {
    const f = fakeAuth(), c = createAuthController(f.auth, async (id) => active(id));
    c.start(); await flush();
    await c.signIn("  ", "pw"); await c.signIn("a@example.com", "");
    expect(c.getState()).toMatchObject({ error: MESSAGES.missing });
    expect(f.calls.filter((x) => x.startsWith("signIn"))).toEqual([]);
  });
});

describe("superseded sign-in attempts (regression: another tab signs in while this one is pending)", () => {
  /** An auth client whose sign-in answers only when told to, and can then resolve or throw. */
  function slowAuth() {
    let cb: (event: string, s: ReturnType<typeof session> | null) => void = () => {}, finish!: (f: () => unknown) => void;
    const auth: AuthClient = {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: (f) => { cb = f; return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword: () => new Promise((res, rej) => { finish = (f) => { try { res(f() as never); } catch (e) { rej(e); } }; }),
      signOut: async () => ({ error: null }),
    };
    return { auth, emit: (event: string, id: string | null) => cb(event, id ? session(id) : null), finish: (f: () => unknown) => finish(f) };
  }
  const quota = () => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); };
  const outcomes: [string, () => unknown][] = [
    ["throws a storage failure", quota],
    ["throws an unexpected error", () => { throw new Error("lock timed out"); }],
    ["returns an error", () => ({ data: { session: null }, error: { code: "invalid_credentials", status: 400 } })],
    ["returns its own session", () => ({ data: { session: session("a") }, error: null })],
  ];
  for (const [label, outcome] of outcomes) {
    it(`the older attempt ${label}: the newer account stays, with no message`, async () => {
      const f = slowAuth(), c = createAuthController(f.auth, async (id) => active(id));
      c.start(); await flush();
      const p = c.signIn("a@example.com", "pw");
      f.emit("SIGNED_IN", "b"); await flush(); await flush();
      expect(c.getState()).toMatchObject({ status: "ready", user: { id: "b" } });
      f.finish(outcome); await p; await flush();
      expect(c.getState()).toMatchObject({ status: "ready", user: { id: "b" }, client: { name: "Client b" } });
    });
  }
  it("an attempt superseded by a sign-out elsewhere does not sign anyone in", async () => {
    const f = slowAuth(), c = createAuthController(f.auth, async (id) => active(id));
    c.start(); await flush();
    const p = c.signIn("a@example.com", "pw");
    f.emit("SIGNED_IN", "b"); await flush(); await flush();
    f.emit("SIGNED_OUT", null); await flush();
    f.finish(() => ({ data: { session: session("a") }, error: null })); await p; await flush();
    expect(c.getState()).toEqual({ status: "signed-out", pending: false, error: null, notice: null });
  });
  it("with no race, each kind of failure gets its own message", async () => {
    for (const [outcome, message] of [
      [quota, MESSAGES.storage],
      [() => { throw Object.assign(new Error("quota"), { name: "NS_ERROR_DOM_QUOTA_REACHED" }); }, MESSAGES.storage],
      [() => { throw new Error("lock timed out"); }, MESSAGES.unexpected],
      [() => { throw new DOMException("denied", "SecurityError"); }, MESSAGES.unexpected],
      [() => ({ data: { session: null }, error: { name: "AuthRetryableFetchError", status: 0 } }), MESSAGES.offline],
    ] as [() => unknown, string][]) {
      const f = slowAuth(), c = createAuthController(f.auth, async (id) => active(id));
      c.start(); await flush();
      const p = c.signIn("a@example.com", "pw");
      f.finish(outcome); await p;
      expect(c.getState()).toEqual({ status: "signed-out", pending: false, error: message, notice: null });
    }
  });
});

describe("account states", () => {
  it("an inactive or unassigned account gets the no-access state", async () => {
    const c = createAuthController(fakeAuth({ stored: "a" }).auth, async () => ({ kind: "none" }));
    c.start(); await flush();
    expect(c.getState()).toEqual({ status: "no-access", user: { id: "a", email: "a@example.com" } });
  });
  it("a failed account load shows an error with no workspace, and can be retried", async () => {
    let fail = true;
    const c = createAuthController(fakeAuth({ stored: "a" }).auth, async (id) => { if (fail) throw new Error("network"); return active(id); });
    c.start(); await flush();
    expect(c.getState()).toEqual({ status: "error", user: { id: "a", email: "a@example.com" }, message: MESSAGES.account });
    fail = false; c.retry(); await flush();
    expect(status(c.getState())).toBe("ready");
  });
});

describe("account changes", () => {
  it("drops the previous account at once when another user signs in (for example in another tab)", async () => {
    const f = fakeAuth({ stored: "a" }), d = deferredLoads(), c = createAuthController(f.auth, d.load);
    c.start(); await flush(); d.answer("a", active("a")); await flush();
    expect(c.getState()).toMatchObject({ status: "ready", user: { id: "a" } });
    f.emit("SIGNED_IN", "b"); await flush();
    expect(c.getState()).toEqual({ status: "loading", user: { id: "b", email: "b@example.com" } });
    d.answer("b", active("b")); await flush();
    expect(c.getState()).toMatchObject({ status: "ready", user: { id: "b" }, client: { name: "Client b" } });
  });
  it("ignores a late answer for the previous user", async () => {
    const f = fakeAuth({ stored: "a" }), d = deferredLoads(), c = createAuthController(f.auth, d.load);
    c.start(); await flush();
    f.emit("SIGNED_IN", "b"); await flush();
    d.answer("a", active("a")); await flush();
    expect(c.getState()).toEqual({ status: "loading", user: { id: "b", email: "b@example.com" } });
    d.answer("b", { kind: "none" }); await flush();
    expect(status(c.getState())).toBe("no-access");
  });
  it("keeps the workspace on a token refresh for the same user", async () => {
    const f = fakeAuth({ stored: "a" }), loads: string[] = [], c = createAuthController(f.auth, async (id) => { loads.push(id); return active(id); });
    c.start(); await flush();
    f.emit("TOKEN_REFRESHED", "a"); f.emit("SIGNED_IN", "a"); await flush();
    expect(status(c.getState())).toBe("ready");
    expect(loads).toEqual(["a"]);
  });
  it("signs out when another tab signs out", async () => {
    const f = fakeAuth({ stored: "a" }), c = createAuthController(f.auth, async (id) => active(id));
    c.start(); await flush();
    f.emit("SIGNED_OUT", null); await flush();
    expect(c.getState()).toEqual({ status: "signed-out", pending: false, error: null, notice: null });
  });
});

describe("signing out", () => {
  it("clears the account before the sign-out request finishes", async () => {
    const f = fakeAuth({ stored: "a" }), c = createAuthController(f.auth, async (id) => active(id));
    c.start(); await flush();
    const p = c.signOut();
    expect(c.getState()).toEqual({ status: "signed-out", pending: false, error: null, notice: null });
    await p;
    expect(f.calls).toContain("signOut");
  });
  it("still signs out on this device when the service cannot be reached, and says so", async () => {
    const c = createAuthController(fakeAuth({ stored: "a", signOutFails: true }).auth, async (id) => active(id));
    c.start(); await flush();
    await c.signOut();
    expect(c.getState()).toEqual({ status: "signed-out", pending: false, error: null, notice: MESSAGES.signedOutOffline });
  });
  it("a load still running when the user signs out is discarded", async () => {
    const f = fakeAuth({ stored: "a" }), d = deferredLoads(), c = createAuthController(f.auth, d.load);
    c.start(); await flush();
    await c.signOut();
    d.answer("a", active("a")); await flush();
    expect(status(c.getState())).toBe("signed-out");
  });
});
