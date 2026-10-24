/* Supabase-mode reads end to end, offline: the real supabase-js client signs in as each fictional test user and runs the
   portal's own account and workspace loaders against the real migration, seed, memberships and row-level security
   (PGlite behind the stand-in Auth and Data API). Checks Harbor / Northwind isolation and the no-access accounts. */
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { KEY, PASSWORDS, URL_BASE, createProject } from "./fake-supabase.mjs";
import { loadAccount } from "../../src/auth/account.ts";
import { loadWorkspace, roleRow, uniquePeople } from "../../src/workspace/data.ts";

const EMAIL = { harbor: "portal-test-harbor@example.com", northwind: "portal-test-northwind@example.com", harborInactive: "portal-test-harbor-inactive@example.com", noMembership: "portal-test-no-membership@example.com" };

async function signedIn(p, who) {
  const sb = createClient(URL_BASE, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: p.fetch } });
  const { data, error } = await sb.auth.signInWithPassword({ email: EMAIL[who], password: PASSWORDS[who] });
  expect(error).toBeNull();
  return { sb, userId: data.session.user.id };
}
const names = (ws) => ws.subs.map((s) => ws.people.get(s.personId).name);

describe("Supabase-mode reads through supabase-js and row-level security", () => {
  it("Harbor sees only Harbor's roles and published submissions", async () => {
    const p = await createProject(), { sb, userId } = await signedIn(p, "harbor");
    const account = await loadAccount(sb, userId);
    expect(account).toMatchObject({ kind: "active", client: { name: "Harbor Industrial Supply" }, member: { displayName: "Maria Alvarez (test)", jobTitle: "Hiring manager" } });
    const ws = await loadWorkspace(sb, account.client.id);
    expect(ws.roles.map((r) => r.title)).toEqual(["Field Sales Representative", "Inside Sales Leader", "Pricing Analyst", "Regional Sales Manager"]);
    expect(ws.subs).toHaveLength(12);
    expect(uniquePeople(ws.subs)).toBe(11);
    expect(names(ws)).not.toContain("Unpublished Test Candidate");
    expect(names(ws)).not.toContain("Robin Hale");
    expect(names(ws).filter((n) => n === "Taylor Brooks")).toHaveLength(2);
    expect(ws.moves).toHaveLength(11);
    const onHold = ws.roles.find((r) => r.status === "On hold");
    expect(onHold.title).toBe("Regional Sales Manager");
    expect(roleRow(ws, onHold, "2026-10-12")).toMatchObject({ shared: 4, byStage: [0, 2, 1, 1, 0] });
  });

  it("Northwind sees only its one role and one published submission", async () => {
    const p = await createProject(), { sb, userId } = await signedIn(p, "northwind");
    const account = await loadAccount(sb, userId);
    expect(account).toMatchObject({ kind: "active", client: { name: "Northwind Fictional Co." } });
    const ws = await loadWorkspace(sb, account.client.id);
    expect(ws.roles.map((r) => r.title)).toEqual(["Operations Coordinator"]);
    expect(names(ws)).toEqual(["Robin Hale"]);
    expect(ws.moves).toEqual([]);
  });

  it("the inactive and unassigned accounts have no workspace, and their reads return nothing", async () => {
    for (const who of ["harborInactive", "noMembership"]) {
      const p = await createProject(), { sb, userId } = await signedIn(p, who);
      expect(await loadAccount(sb, userId)).toEqual({ kind: "none" });
      for (const t of ["roles", "people", "submissions", "submission_events"]) expect((await sb.from(t).select("id")).data, `${who} ${t}`).toEqual([]);
    }
  });

  it("asking for another client's id returns nothing usable: the load stops instead of mixing clients", async () => {
    const p = await createProject(), { sb } = await signedIn(p, "harbor");
    const northwindId = (await p.db.query("select id from public.clients where ref = 'northwind'")).rows[0].id;
    await expect(loadWorkspace(sb, northwindId)).rejects.toThrow(/another client/);
  });

  it("if row-level security ever leaked another client's rows, the load would stop", async () => {
    const p = await createProject();
    await p.db.exec("alter policy roles_read_own_client on public.roles using (true)");   // deliberately broken, offline only
    const { sb, userId } = await signedIn(p, "harbor"), account = await loadAccount(sb, userId);
    await expect(loadWorkspace(sb, account.client.id)).rejects.toThrow(/another client/);
  });

  it("the reads are GET requests only", async () => {
    const p = await createProject(), methods = [];
    const spy = { ...p, fetch: (url, init = {}) => { if (String(url).includes("/rest/v1/")) methods.push((init.method || "GET").toUpperCase()); return p.fetch(url, init); } };
    const { sb, userId } = await signedIn(spy, "harbor"), account = await loadAccount(sb, userId);
    await loadWorkspace(sb, account.client.id);
    expect(methods.length).toBeGreaterThan(0);
    expect(new Set(methods)).toEqual(new Set(["GET"]));
  });
});
