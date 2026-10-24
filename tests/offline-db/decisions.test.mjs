/* Decline and interview feedback end to end, offline: the portal's action calls through real supabase-js to the real
   milestone 2 functions and row-level security, the portal's loader reading the notes back, and the targeted cleanup of
   a recorded UI test run (exact keys only). */
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { KEY, PASSWORDS, URL_BASE, asUser, createProject, snapshot } from "./fake-supabase.mjs";
import { loadAccount } from "../../src/auth/account.ts";
import { history, loadWorkspace } from "../../src/workspace/data.ts";
import { createMoveController, supabaseMoveRpc } from "../../src/workspace/moves.ts";
import { seedId } from "../../scripts/db/api-read-lib.mjs";
import { uiRestoreSql } from "../../scripts/db/ui-moves-lib.mjs";
import { cleanEntry } from "../../scripts/dev/move-record-lib.mjs";

const EMAIL = { harbor: "portal-test-harbor@example.com", northwind: "portal-test-northwind@example.com" };
const H = (ref) => seedId("submission", "harbor", ref);

async function client(p, who, fetchImpl = p.fetch) {
  const sb = createClient(URL_BASE, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (u, i) => fetchImpl(u, i) } });
  const { data, error } = await sb.auth.signInWithPassword({ email: EMAIL[who], password: PASSWORDS[who] });
  expect(error).toBeNull();
  const account = await loadAccount(sb, data.session.user.id);
  return { sb, userId: data.session.user.id, account, key: `${data.session.user.id}:${account.client.id}` };
}
const req = (action, ref, extra) => ({ action, submissionId: H(ref), key: crypto.randomUUID(), ...extra });
const strip = (snap) => ({ ...snap, "public.submissions": JSON.stringify(JSON.parse(snap["public.submissions"]).map(({ updated_at, ...x }) => x)) });

describe("decisions through supabase-js and row-level security", () => {
  it("a decline and a feedback are confirmed with their note, and the loader reads them back in their history", async () => {
    const p = await createProject(), c = await client(p, "harbor"), rpc = supabaseMoveRpc(c.sb);
    const d = await rpc(req("decline", "ab-fsr", { toStage: "Declined", expectedVersion: 1, note: "Not enough CRM depth.", category: "Key skills gap" }));
    expect(d).toMatchObject({ kind: "ok", result: { stage: "Declined", version: 2, note_id: expect.any(String) } });
    const f = await rpc(req("feedback", "je-isl", { toStage: "Interview", expectedVersion: 2, about: "General feedback", text: "Strong on process." }));
    expect(f).toMatchObject({ kind: "ok", result: { stage: "Interview", version: 3, note_id: expect.any(String) } });
    const ws = await loadWorkspace(c.sb, c.account.client.id);
    expect(ws.notes.map((n) => [n.kind, n.text, n.category, n.about])).toEqual(expect.arrayContaining([["decline", "Not enough CRM depth.", "Key skills gap", null], ["feedback", "Strong on process.", null, "General feedback"]]));
    const ab = ws.subs.find((s) => s.id === H("ab-fsr"));
    expect(history(ws, ab, c.account.member.id).entries.map((e) => `${e.actor} ${e.kind} ${e.toStage}`)).toEqual(["Revenue Optics shared To review", "You decline Declined"]);
    expect(ws.moves.filter((m) => m.submissionId === H("ab-fsr")).map((m) => m.toStage)).toEqual(["Declined"]);   // counted as a move for the reports
    const nw = await client(p, "northwind"), nwWs = await loadWorkspace(nw.sb, nw.account.client.id);
    expect(nwWs.notes).toEqual([]);                                                                                  // no Harbor notes for Northwind
  });

  it("refusals keep their codes: not permitted (on-hold decline), conflict, not found (other client)", async () => {
    const p = await createProject(), c = await client(p, "harbor"), rpc = supabaseMoveRpc(c.sb);
    expect(await rpc(req("decline", "tb-rsm", { toStage: "Declined", expectedVersion: 2, note: "x", category: null }))).toEqual({ kind: "error", code: "action_not_permitted" });
    expect(await rpc(req("feedback", "je-isl", { toStage: "Interview", expectedVersion: 1, about: null, text: "x" }))).toEqual({ kind: "error", code: "version_conflict" });
    const nw = await client(p, "northwind");
    expect(await supabaseMoveRpc(nw.sb)(req("decline", "ab-fsr", { toStage: "Declined", expectedVersion: 1, note: "x", category: null }))).toEqual({ kind: "error", code: "submission_not_found" });
  });

  it("an answer lost after the server saved a decline: the retry with the same key returns it, with one note", async () => {
    const p = await createProject();
    let lose = true;
    const lossy = async (u, i) => { const r = await p.fetch(u, i); if (String(u).includes("/rpc/client_decline") && lose) { lose = false; throw new TypeError("fetch failed"); } return r; };
    const c = await client(p, "harbor", lossy), rpc = supabaseMoveRpc(c.sb), r = req("decline", "ab-fsr", { toStage: "Declined", expectedVersion: 1, note: "x", category: null });
    expect(await rpc(r)).toEqual({ kind: "uncertain" });
    expect((await rpc(r)).kind).toBe("ok");
    expect((await p.db.query("select count(*)::int as n from public.client_notes")).rows[0].n).toBe(1);
  });

  it("on a database without milestone 2, the workspace still loads; notes are unavailable rather than an error", async () => {
    const p = await createProject({ m2: false }), c = await client(p, "harbor"), ws = await loadWorkspace(c.sb, c.account.client.id);
    expect(ws.notes).toBeNull();
    expect(ws.subs).toHaveLength(12);
  });
});

describe("cleanup of a recorded UI decision test run (exact keys only)", () => {
  function recorder() {
    const run = { kind: "ui-moves", runId: crypto.randomUUID(), project: "offline", createdAt: new Date().toISOString(), entries: [] };
    return { run, record: async (e) => { const x = cleanEntry(JSON.parse(JSON.stringify(e))); if (!x) throw new Error("rejected by the recorder"); run.entries.push(x); } };
  }
  async function tab(p, rec, fetchImpl) {
    const c = await client(p, "harbor", fetchImpl);
    const m = createMoveController(supabaseMoveRpc(c.sb), () => {}, { record: rec.record, wait: () => Promise.resolve() });
    m.sync(c.key);
    return async (ref, seen, intent) => {
      m.act(c.key, { id: H(ref), ...seen }, intent);
      await new Promise((r) => { const check = () => m.getState().status !== "saving" && (u(), r()); const u = m.subscribe(check); check(); });
      const st = m.getState(); m.dismiss(); return st.status;
    };
  }
  /** The planned manual test: a decline (answer lost, then resolved by the automatic retry), feedback with a two-tab
      conflict against a stage move, and feedback on an on-hold role. */
  async function manualRun(p, rec) {
    let lose = 1;
    const lossy = async (u, i) => { const r = await p.fetch(u, i); if (String(u).includes("/rpc/client_decline") && lose-- > 0) throw new TypeError("fetch failed"); return r; };
    expect(await (await tab(p, rec, lossy))("ab-fsr", { version: 1, stage: "To review" }, { action: "decline", note: "Not enough CRM depth.", category: "Key skills gap" })).toBe("saved");
    const tab1 = await tab(p, rec), tab2 = await tab(p, rec);
    expect(await tab2("je-isl", { version: 2, stage: "Interview" }, { action: "feedback", about: "General feedback", text: "Strong on process." })).toBe("saved");
    expect(await tab1("je-isl", { version: 2, stage: "Interview" }, { action: "move", toStage: "Offer" })).toBe("conflict");
    expect(await tab1("tb-rsm", { version: 2, stage: "Interview" }, { action: "feedback", about: null, text: "Regional scope is open." })).toBe("saved");
  }

  it("records the action kind and never the decision text", async () => {
    const p = await createProject(), rec = recorder();
    await manualRun(p, rec);
    const text = JSON.stringify(rec.run);
    for (const s of ["Not enough CRM depth", "Strong on process", "Regional scope", "General feedback"]) expect(text).not.toContain(s);
    expect([...new Set(rec.run.entries.filter((e) => e.phase === "sent").map((e) => e.action))].sort()).toEqual(["decline", "feedback", "move"]);
  });

  it("restores every touched submission, deleting only the run's notes, history entries and keys; safe to run again", async () => {
    const p = await createProject(), before = strip(await snapshot(p.db)), rec = recorder();
    await manualRun(p, rec);
    expect((await p.db.query("select count(*)::int as n from public.client_notes")).rows[0].n).toBe(3);
    const rows = (await p.db.exec(uiRestoreSql(rec.run))).at(-1).rows;
    expect(rows.every((r) => r.result === "OK"), JSON.stringify(rows)).toBe(true);
    expect(strip(await snapshot(p.db))).toEqual(before);
    expect((await p.db.exec(uiRestoreSql(rec.run))).at(-1).rows.every((r) => r.result === "OK")).toBe(true);
  });

  it("REGRESSION: an unrelated later decision on one of the same candidates makes it refuse, changing nothing", async () => {
    const p = await createProject(), rec = recorder();
    await manualRun(p, rec);
    await asUser(p.db, p.ids[EMAIL.harbor], "select public.client_add_feedback($1, null, 'Unrecorded feedback.', 3, gen_random_uuid())", [H("je-isl")]);
    const after = await snapshot(p.db);
    await expect(p.db.exec(uiRestoreSql(rec.run))).rejects.toThrow(/RESTORE REFUSED[\s\S]*note .* was not made by this run[\s\S]*je-isl has 1 change\(s\) after the baseline/);
    expect(await snapshot(p.db)).toEqual(after);
  });

  it("an unrelated decision anywhere else, Harbor or Northwind, makes it refuse too", async () => {
    for (const [email, cl, ref, v] of [[EMAIL.harbor, "harbor", "en-pa", 1], [EMAIL.northwind, "northwind", "n1-ops", 1]]) {
      const p = await createProject(), rec = recorder();
      expect(await (await tab(p, rec))("ab-fsr", { version: 1, stage: "To review" }, { action: "decline", note: "x", category: null })).toBe("saved");
      await asUser(p.db, p.ids[email], "select public.client_decline($1, 'Unrecorded decline.', null, $2, gen_random_uuid())", [seedId("submission", cl, ref), v]);
      const after = await snapshot(p.db);
      await expect(p.db.exec(uiRestoreSql(rec.run))).rejects.toThrow(/note .* was not made by this run/);
      expect(await snapshot(p.db)).toEqual(after);
    }
  });
});
