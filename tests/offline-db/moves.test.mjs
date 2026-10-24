/* Stage changes end to end, offline: the portal's move call through the real supabase-js client and the real
   client_move_stage function and row-level security (PGlite behind the stand-in Data API), then the targeted cleanup
   for the manual UI test. */
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { KEY, PASSWORDS, URL_BASE, asUser, createProject, snapshot } from "./fake-supabase.mjs";
import { loadAccount } from "../../src/auth/account.ts";
import { loadWorkspace } from "../../src/workspace/data.ts";
import { createMoveController, supabaseMoveRpc } from "../../src/workspace/moves.ts";
import { createWorkspaceController } from "../../src/workspace/store.ts";
import { seedId } from "../../scripts/db/api-read-lib.mjs";
import { uiRestoreSql } from "../../scripts/db/ui-moves-lib.mjs";
import { cleanEntry } from "../../scripts/dev/move-record-lib.mjs";

const EMAIL = { harbor: "portal-test-harbor@example.com", northwind: "portal-test-northwind@example.com", harborInactive: "portal-test-harbor-inactive@example.com" };
const H = (ref) => seedId("submission", "harbor", ref);
const flush = () => new Promise((r) => setTimeout(r, 0));

async function client(p, who, fetchImpl = p.fetch) {
  const sb = createClient(URL_BASE, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (u, i) => fetchImpl(u, i) } });
  const { data, error } = await sb.auth.signInWithPassword({ email: EMAIL[who], password: PASSWORDS[who] });
  expect(error).toBeNull();
  return { sb, userId: data.session.user.id };
}
const req = (ref, toStage, expectedVersion, key = crypto.randomUUID()) => ({ submissionId: H(ref), toStage, expectedVersion, key });
const portalEvents = async (p) => (await p.db.query("select count(*)::int as n from public.submission_events where source = 'portal'")).rows[0].n;
const stageOf = async (p, ref) => (await p.db.query("select stage || ' v' || version as s from public.submissions where id = $1", [H(ref)])).rows[0].s;

describe("client_move_stage through supabase-js", () => {
  it("a permitted move is confirmed with the new stage and version", async () => {
    const p = await createProject(), { sb } = await client(p, "harbor");
    const out = await supabaseMoveRpc(sb)(req("ab-fsr", "Interview", 1));
    expect(out).toMatchObject({ kind: "ok", result: { submission_id: H("ab-fsr"), stage: "Interview", version: 2 } });
    expect(await stageOf(p, "ab-fsr")).toBe("Interview v2");
  });

  it("an answer lost after the server saved it: uncertain; the same request and key then return the stored result, saved once", async () => {
    const p = await createProject();
    let lose = true;
    const lossy = async (u, i) => { const r = await p.fetch(u, i); if (String(u).includes("/rpc/") && lose) { lose = false; throw new TypeError("fetch failed"); } return r; };
    const { sb } = await client(p, "harbor", lossy), rpc = supabaseMoveRpc(sb), r = req("ab-fsr", "Interview", 1);
    expect(await rpc(r)).toEqual({ kind: "uncertain" });
    expect(await stageOf(p, "ab-fsr")).toBe("Interview v2");      // it was saved
    expect(await rpc(r)).toMatchObject({ kind: "ok", result: { stage: "Interview", version: 2 } });
    expect(await portalEvents(p)).toBe(1);
  });

  it("a request that never answers times out as uncertain", async () => {
    const p = await createProject();
    const hang = (u, i) => (String(u).includes("/rpc/") ? new Promise((_, rej) => i.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))) : p.fetch(u, i));
    const { sb } = await client(p, "harbor", hang);
    expect(await supabaseMoveRpc(sb, 50)(req("ab-fsr", "Interview", 1))).toEqual({ kind: "uncertain" });
    expect(await portalEvents(p)).toBe(0);
  });

  it("a stale version is a version_conflict; the other refusals keep their codes", async () => {
    const p = await createProject(), { sb } = await client(p, "harbor"), rpc = supabaseMoveRpc(sb);
    expect((await rpc(req("en-pa", "Interview", 1))).kind).toBe("ok");
    expect(await rpc(req("en-pa", "Offer", 1))).toEqual({ kind: "error", code: "version_conflict" });
    expect(await rpc(req("tb-rsm", "Offer", 2))).toEqual({ kind: "error", code: "move_not_permitted" });   // on-hold role
    expect(await rpc(req("zz-isl", "Interview", 1))).toEqual({ kind: "error", code: "submission_not_found" });   // unpublished
    expect((await rpc(req("en-pa", "Offer", 2))).kind).toBe("ok");                                              // [provisional]
    expect(await rpc(req("en-pa", "Hired", 3))).toEqual({ kind: "error", code: "move_not_permitted" });         // not from Offer
  });

  it("isolation: Northwind cannot move a Harbor submission; an inactive member cannot move at all", async () => {
    const p = await createProject();
    const nw = await client(p, "northwind"), inactive = await client(p, "harborInactive");
    expect(await supabaseMoveRpc(nw.sb)(req("ab-fsr", "Interview", 1))).toEqual({ kind: "error", code: "submission_not_found" });
    expect(await supabaseMoveRpc(inactive.sb)(req("ab-fsr", "Interview", 1))).toEqual({ kind: "error", code: "not_a_client_member" });
    expect(await portalEvents(p)).toBe(0);
  });
});

describe("the portal's move flow (controllers) against the real function", () => {
  it("confirmed move, then the lists are refreshed from the database", async () => {
    const p = await createProject(), { sb, userId } = await client(p, "harbor"), account = await loadAccount(sb, userId);
    const data = createWorkspaceController((cid) => loadWorkspace(sb, cid)), acc = { userId, clientId: account.client.id }, key = `${userId}:${acc.clientId}`;
    const moves = createMoveController(supabaseMoveRpc(sb), () => data.refresh());
    data.sync(acc); moves.sync(key);
    await new Promise((r) => { const u = data.subscribe(() => data.getState().status === "ready" && (u(), r())); });
    const before = data.getState().ws.subs.find((s) => s.id === H("pr-isl"));
    expect(moves.move(key, before, "Interview")).toBe(true);
    await new Promise((r) => { const u = moves.subscribe(() => moves.getState().status === "saved" && (u(), r())); });
    await new Promise((r) => { const u = data.subscribe(() => data.getState().status === "ready" && (u(), r())); });
    expect(data.getState().ws.subs.find((s) => s.id === H("pr-isl"))).toMatchObject({ stage: "Interview", version: 2 });
  });

  it("an account switch while a move is in flight: its late answer is ignored (the server may still have saved it)", async () => {
    const p = await createProject();
    let release;
    const gated = async (u, i) => { if (String(u).includes("/rpc/")) await new Promise((r) => { release = r; }); return p.fetch(u, i); };
    const { sb, userId } = await client(p, "harbor", gated), account = await loadAccount(sb, userId), key = `${userId}:${account.client.id}`;
    const refreshes = [], moves = createMoveController(supabaseMoveRpc(sb), () => refreshes.push(1));
    moves.sync(key);
    moves.move(key, { id: H("ab-fsr"), version: 1 }, "Interview");
    await flush();
    moves.sync("someone-else:northwind");
    release(); await new Promise((r) => setTimeout(r, 50));
    expect(moves.getState()).toEqual({ status: "idle" });
    expect(refreshes).toEqual([]);
    expect(await stageOf(p, "ab-fsr")).toBe("Interview v2");     // which is why the cleanup looks for keys, not answers
  });
});

describe("cleanup after a manual UI test run, from its development test-run record", () => {
  const strip = (snap) => ({ ...snap, "public.submissions": JSON.stringify(JSON.parse(snap["public.submissions"]).map(({ updated_at, ...x }) => x)) });
  /** The same recording path as the dev server: entries pass the recorder's whitelist before they are kept. */
  function recorder() {
    const run = { kind: "ui-moves", runId: crypto.randomUUID(), project: "offline", createdAt: new Date().toISOString(), entries: [] };
    return { run, record: async (e) => { const c = cleanEntry(JSON.parse(JSON.stringify(e))); if (!c) throw new Error("rejected by the recorder"); run.entries.push(c); } };
  }
  async function tab(p, rec, fetchImpl) {
    const { sb, userId } = await client(p, "harbor", fetchImpl), account = await loadAccount(sb, userId), key = `${userId}:${account.client.id}`;
    const c = createMoveController(supabaseMoveRpc(sb), () => {}, { record: rec.record, wait: () => Promise.resolve() });
    c.sync(key);
    return async (ref, seen, to) => {
      c.move(key, { id: H(ref), ...seen }, to);
      await new Promise((r) => { const check = () => c.getState().status !== "saving" && (u(), r()); const u = c.subscribe(check); check(); });
      const st = c.getState(); c.dismiss(); return st.status;
    };
  }
  /** The manual plan: a move, a two-tab conflict, a provisional Offer, a lost answer resolved by the automatic retry,
      and a request whose answers were all lost (left uncertain). */
  async function manualRun(p, rec) {
    const tab1 = await tab(p, rec), tab2 = await tab(p, rec);
    expect(await tab1("ab-fsr", { version: 1, stage: "To review" }, "Interview")).toBe("saved");
    expect(await tab2("en-pa", { version: 1, stage: "To review" }, "Interview")).toBe("saved");
    expect(await tab1("en-pa", { version: 1, stage: "To review" }, "Offer")).toBe("conflict");          // tab 1 still saw version 1
    expect(await tab1("en-pa", { version: 2, stage: "Interview" }, "Offer")).toBe("saved");             // [provisional]
    let lose = 1;
    const lossy = async (u, i) => { const r = await p.fetch(u, i); if (String(u).includes("/rpc/") && lose-- > 0) throw new TypeError("fetch failed"); return r; };
    expect(await (await tab(p, rec, lossy))("pr-isl", { version: 1, stage: "To review" }, "Interview")).toBe("saved");
    const dead = async (u, i) => { const r = await p.fetch(u, i); if (String(u).includes("/rpc/")) throw new TypeError("fetch failed"); return r; };
    expect(await (await tab(p, rec, dead))("tb-isl", { version: 1, stage: "To review" }, "Interview")).toBe("uncertain");
  }

  it("records every request's exact key before sending, and no token or password", async () => {
    const p = await createProject(), rec = recorder();
    await manualRun(p, rec);
    const sent = rec.run.entries.filter((e) => e.phase === "sent");
    const dbKeys = (await p.db.query("select key::text from app_private.idempotency_keys")).rows.map((r) => r.key);
    expect(dbKeys.every((k) => sent.some((e) => e.key === k))).toBe(true);
    expect(new Set(sent.map((e) => e.key)).size).toBe(6);       // the conflict's key is recorded too, though nothing was saved for it
    const text = JSON.stringify(rec.run);
    for (const s of ["eyJ", ...Object.values(PASSWORDS), KEY]) expect(text).not.toContain(s);
  });

  it("puts every touched submission back exactly (apart from updated_at), including the uncertain request, and is safe to run again", async () => {
    const p = await createProject(), before = strip(await snapshot(p.db)), rec = recorder();
    await manualRun(p, rec);
    expect(await stageOf(p, "tb-isl")).toBe("Interview v2");     // saved, though the UI never got an answer
    const rows = (await p.db.exec(uiRestoreSql(rec.run))).at(-1).rows;
    expect(rows.every((r) => r.result === "OK"), JSON.stringify(rows)).toBe(true);
    expect(strip(await snapshot(p.db))).toEqual(before);
    expect((await p.db.exec(uiRestoreSql(rec.run))).at(-1).rows.every((r) => r.result === "OK")).toBe(true);
    expect(strip(await snapshot(p.db))).toEqual(before);
  });

  it("REGRESSION: an unrelated later move on one of the same candidates makes it refuse, changing nothing", async () => {
    const p = await createProject(), rec = recorder();
    await manualRun(p, rec);
    await asUser(p.db, p.ids[EMAIL.harbor], "select public.client_move_stage($1, 'Offer', 2, gen_random_uuid())", [H("ab-fsr")]);   // not recorded
    const after = await snapshot(p.db);
    await expect(p.db.exec(uiRestoreSql(rec.run))).rejects.toThrow(/RESTORE REFUSED[\s\S]*ab-fsr has 1 change\(s\) after the baseline that are not from this run/);
    expect(await snapshot(p.db)).toEqual(after);
  });

  it("an unrelated move on any other candidate, Harbor or Northwind, makes it refuse too", async () => {
    for (const [email, cl, ref, to, v] of [[EMAIL.harbor, "harbor", "so-pa", "To review", 2], [EMAIL.northwind, "northwind", "n1-ops", "Interview", 1]]) {
      const p = await createProject(), rec = recorder();
      expect(await (await tab(p, rec))("ab-fsr", { version: 1, stage: "To review" }, "Interview")).toBe("saved");
      await asUser(p.db, p.ids[email], "select public.client_move_stage($1, $2, $3, gen_random_uuid())", [seedId("submission", cl, ref), to, v]);
      const after = await snapshot(p.db);
      await expect(p.db.exec(uiRestoreSql(rec.run))).rejects.toThrow(/portal move not made by this run/);
      expect(await snapshot(p.db)).toEqual(after);
    }
  });

  it("an edit outside the portal action makes it refuse", async () => {
    const p = await createProject(), rec = recorder();
    expect(await (await tab(p, rec))("ab-fsr", { version: 1, stage: "To review" }, "Interview")).toBe("saved");
    await p.db.exec("update public.submissions set stage = 'Hired' where id = md5('portal-m1:submission:harbor:ab-fsr')::uuid");
    await expect(p.db.exec(uiRestoreSql(rec.run))).rejects.toThrow(/does not match its history/);
  });

  it("the cleanup is not generated from a record that touches a submission outside the fictional test set", async () => {
    const rec = recorder();
    await rec.record({ phase: "sent", action: "move", key: crypto.randomUUID(), submission_id: seedId("submission", "harbor", "so-pa"), expected_version: 2, seen_stage: "Interview", to_stage: "To review", attempt: 0 });
    expect(() => uiRestoreSql(rec.run)).toThrow(/not a fictional test submission/);
  });
});
