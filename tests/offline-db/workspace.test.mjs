/* Supabase-mode reads end to end, offline: the real supabase-js client signs in as each fictional test user and runs the
   portal's own account and workspace loaders against the real migration, seed, memberships and row-level security
   (PGlite behind the stand-in Auth and Data API). Checks Harbor / Northwind isolation and the no-access accounts. */
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { KEY, PASSWORDS, URL_BASE, createProject } from "./fake-supabase.mjs";
import { loadAccount } from "../../src/auth/account.ts";
import { history, loadWorkspace, roleRow, uniquePeople } from "../../src/workspace/data.ts";
import { asUser } from "./fake-supabase.mjs";
import { seedId } from "../../scripts/db/api-read-lib.mjs";

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

  it("history through row-level security: seeded client moves are 'Client team'; only the signed-in member's own moves are 'You'", async () => {
    const p = await createProject(), H = (ref) => seedId("submission", "harbor", ref);
    /* Offline only: a second active Harbor member, so a colleague's move can be told apart from the user's own. */
    await p.db.exec("update public.client_members set active = true where display_name = 'Inactive member (test)'");
    await asUser(p.db, p.ids[EMAIL.harborInactive], "select public.client_move_stage($1, 'Interview', 1, gen_random_uuid())", [H("ab-fsr")]);
    await asUser(p.db, p.ids[EMAIL.harbor], "select public.client_move_stage($1, 'Interview', 1, gen_random_uuid())", [H("pr-isl")]);
    const { sb, userId } = await signedIn(p, "harbor"), account = await loadAccount(sb, userId), ws = await loadWorkspace(sb, account.client.id);
    const lines = (ref) => history(ws, ws.subs.find((s) => s.id === H(ref)), account.member.id).entries.map((e) => `v${e.version} ${e.actor} ${e.kind} ${e.toStage}`);
    expect(lines("tb-rsm")).toEqual(["v1 Revenue Optics shared To review", "v2 Client team stage_move Interview"]);        // seeded: no member recorded
    expect(lines("do-rsm")).toEqual(["v1 Revenue Optics shared To review", "v2 Client team stage_move Interview", "v3 Revenue Optics stage_move Offer", "v4 Revenue Optics stage_move Hired"]);
    expect(lines("ab-fsr")).toEqual(["v1 Revenue Optics shared To review", "v2 Client team stage_move Interview"]);         // a colleague's move
    expect(lines("pr-isl")).toEqual(["v1 Revenue Optics shared To review", "v2 You stage_move Interview"]);                 // the user's own move
    for (const s of ws.subs) expect(history(ws, s, account.member.id).missing, s.id).toBe(0);
    const nw = await signedIn(p, "northwind"), nwAccount = await loadAccount(nw.sb, nw.userId), nwWs = await loadWorkspace(nw.sb, nwAccount.client.id);
    expect(nwWs.events.some((e) => ws.subs.some((s) => s.id === e.submissionId))).toBe(false);                             // no Harbor history for Northwind
  });

  it("paging: more than 1,000 candidates and history entries are all read through row-level security, under a 1,000- and a 300-row cap", async () => {
    for (const maxRows of [1000, 300]) {
      const p = await createProject({ maxRows });
      /* Offline only: 1,100 more fictional Harbor candidates on Pricing Analyst, each shared then moved twice (3,300 entries). */
      await p.db.exec(`
        with h as (select id from public.clients where ref = 'harbor'), r as (select id from public.roles where ref = 'pa' and client_id = (select id from h))
        insert into public.people (client_id, ref, name) select (select id from h), 'bulk' || g, 'Bulk Person ' || g from generate_series(1, 1100) g;
        insert into public.submissions (client_id, ref, role_id, person_id, stage, shared_on, publication, version)
          select p.client_id, 'bulk-' || p.ref, (select id from public.roles where ref = 'pa' and client_id = p.client_id), p.id, 'Offer', '2026-10-08', 'published', 3
          from public.people p where p.ref like 'bulk%';
        insert into public.submission_events (client_id, submission_id, submission_version, kind, to_stage, occurred_on, actor_kind, source)
          select s.client_id, s.id, v, case when v = 1 then 'shared' else 'stage_move' end, (array['To review','Interview','Offer'])[v], ('2026-10-0' || (7 + v))::date, case when v = 1 then 'revenue_optics' else 'client' end, 'seed'
          from public.submissions s cross join generate_series(1, 3) v where s.ref like 'bulk-%';`);
      const { sb, userId } = await signedIn(p, "harbor"), account = await loadAccount(sb, userId), ws = await loadWorkspace(sb, account.client.id);
      expect([ws.subs.length, ws.people.size, ws.events.length, ws.moves.length], `cap ${maxRows}`).toEqual([12 + 1100, 11 + 1100, 23 + 3300, 11 + 2200]);
      expect(ws.subs.filter((s) => history(ws, s, account.member.id).missing > 0), `cap ${maxRows}`).toEqual([]);
      const pa = ws.roles.find((r) => r.title === "Pricing Analyst");
      expect(roleRow(ws, pa, "2026-10-12").shared, `cap ${maxRows}`).toBe(3 + 1100);
      const nw = await signedIn(p, "northwind"), nwWs = await loadWorkspace(nw.sb, (await loadAccount(nw.sb, nw.userId)).client.id);
      expect([nwWs.subs.length, nwWs.events.length], `cap ${maxRows}: Northwind unaffected`).toEqual([1, 1]);
    }
  }, 120000);

  it("the reads are GET requests only", async () => {
    const p = await createProject(), methods = [];
    const spy = { ...p, fetch: (url, init = {}) => { if (String(url).includes("/rest/v1/")) methods.push((init.method || "GET").toUpperCase()); return p.fetch(url, init); } };
    const { sb, userId } = await signedIn(spy, "harbor"), account = await loadAccount(sb, userId);
    await loadWorkspace(sb, account.client.id);
    expect(methods.length).toBeGreaterThan(0);
    expect(new Set(methods)).toEqual(new Set(["GET"]));
  });
});
