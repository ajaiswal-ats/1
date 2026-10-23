/* Reading the signed-in user's membership and client: strict checks, no filling in of missing fields. */
import { describe, expect, it } from "vitest";
import { loadAccount, type Db } from "./account";

function fakeDb(tables: Partial<Record<string, { data: Record<string, unknown>[] | null; error?: unknown }>>) {
  const calls: string[] = [];
  const db: Db = {
    from: (t) => ({ select: (cols) => ({ eq: (col, v) => ({ limit: (n) => { calls.push(`${t}?select=${cols}&${col}=eq.${v}&limit=${n}`); return Promise.resolve({ data: tables[t]?.data ?? null, error: tables[t]?.error ?? null }); } }) }) }),
  };
  return { db, calls };
}
const member = { id: "m1", client_id: "c1", display_name: "Jo Doe", job_title: "" };

describe("loadAccount", () => {
  it("returns the membership and its client, reading only the user's own rows", async () => {
    const { db, calls } = fakeDb({ client_members: { data: [member] }, clients: { data: [{ id: "c1", name: "Test Client Co" }] } });
    expect(await loadAccount(db, "u1")).toEqual({ kind: "active", member: { id: "m1", clientId: "c1", displayName: "Jo Doe", jobTitle: "" }, client: { id: "c1", name: "Test Client Co" } });
    expect(calls).toEqual(["client_members?select=id, client_id, display_name, job_title&user_id=eq.u1&limit=2", "clients?select=id, name&id=eq.c1&limit=2"]);
  });
  it("reports no access when no active membership is visible (inactive and unassigned look the same)", async () => {
    expect(await loadAccount(fakeDb({ client_members: { data: [] } }).db, "u1")).toEqual({ kind: "none" });
  });
  it("throws, rather than inventing values, on errors or incomplete rows", async () => {
    const cases: Partial<Record<string, { data: Record<string, unknown>[] | null; error?: unknown }>>[] = [
      { client_members: { data: null, error: { message: "boom" } } },
      { client_members: { data: [member, member] } },
      { client_members: { data: [{ ...member, display_name: "" }] } },
      { client_members: { data: [{ ...member, job_title: null }] } },
      { client_members: { data: [member] }, clients: { data: [] } },
      { client_members: { data: [member] }, clients: { data: [{ id: "c1" }] } },
      { client_members: { data: [member] }, clients: { data: [{ id: "c2", name: "Other" }] } },
    ];
    for (const t of cases) await expect(loadAccount(fakeDb(t).db, "u1"), JSON.stringify(t)).rejects.toThrow();
  });
});
