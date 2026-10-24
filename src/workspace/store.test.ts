/* Workspace data follows the account: cleared at once on sign-out or account change; late answers ignored; retry. */
import { describe, expect, it } from "vitest";
import type { Workspace } from "./data";
import { createWorkspaceController } from "./store";

const flush = () => new Promise((r) => setTimeout(r, 0));
const ws = (clientId: string): Workspace => ({ clientId, roles: [], people: new Map(), subs: [], moves: [], events: [] });
function deferred() {
  const pending: { clientId: string; resolve: (w: Workspace) => void; reject: (e: Error) => void }[] = [];
  const load = (clientId: string) => new Promise<Workspace>((resolve, reject) => pending.push({ clientId, resolve, reject }));
  const answer = (clientId: string, v: Workspace | Error) => { const i = pending.findIndex((p) => p.clientId === clientId); const [p] = pending.splice(i, 1); v instanceof Error ? p.reject(v) : p.resolve(v); };
  return { load, pending, answer };
}
const A = { userId: "ua", clientId: "harbor" }, B = { userId: "ub", clientId: "northwind" };

describe("workspace data state", () => {
  it("loads for the account, then is ready", async () => {
    const d = deferred(), c = createWorkspaceController(d.load);
    c.sync(A);
    expect(c.getState()).toEqual({ status: "loading", key: "ua:harbor" });
    d.answer("harbor", ws("harbor")); await flush();
    expect(c.getState()).toMatchObject({ status: "ready", key: "ua:harbor", ws: { clientId: "harbor" } });
  });
  it("sign-out clears the data at once, and a late answer is ignored", async () => {
    const d = deferred(), c = createWorkspaceController(d.load);
    c.sync(A); d.answer("harbor", ws("harbor")); await flush();
    c.sync(null);
    expect(c.getState()).toEqual({ status: "idle" });
    c.sync(A); c.sync(null); d.answer("harbor", ws("harbor")); await flush();
    expect(c.getState()).toEqual({ status: "idle" });
  });
  it("an account change drops the previous client's data before loading, and ignores its late answer", async () => {
    const d = deferred(), c = createWorkspaceController(d.load);
    c.sync(A); d.answer("harbor", ws("harbor")); await flush();
    c.sync(A);                                   // same account again (token refresh): nothing reloads
    expect(d.pending).toHaveLength(0);
    c.sync(B);
    expect(c.getState()).toEqual({ status: "loading", key: "ub:northwind" });
    c.sync(A); c.sync(B);                        // quick switching
    d.answer("harbor", ws("harbor")); await flush();
    expect(c.getState()).toEqual({ status: "loading", key: "ub:northwind" });
    while (d.pending.some((p) => p.clientId === "northwind")) d.answer("northwind", ws("northwind"));
    await flush();
    expect(c.getState()).toMatchObject({ status: "ready", key: "ub:northwind" });
  });
  it("data for a different client than the account's is refused", async () => {
    const d = deferred(), c = createWorkspaceController(d.load);
    c.sync(A); d.answer("harbor", ws("northwind")); await flush();
    expect(c.getState()).toEqual({ status: "error", key: "ua:harbor" });
  });
  it("a failed load is an error, and retry loads again", async () => {
    const d = deferred(), c = createWorkspaceController(d.load);
    c.sync(A); d.answer("harbor", new Error("network")); await flush();
    expect(c.getState()).toEqual({ status: "error", key: "ua:harbor" });
    c.retry();
    expect(c.getState()).toEqual({ status: "loading", key: "ua:harbor" });
    d.answer("harbor", ws("harbor")); await flush();
    expect(c.getState().status).toBe("ready");
  });
});
