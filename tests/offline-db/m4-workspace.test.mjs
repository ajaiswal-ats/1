/* Milestone 4 in Supabase mode, end to end offline: next steps, Waiting on you, interview status and requirement support
   through the real supabase-js client, the loaders and the Supabase-mode pages, on milestone 3 only, milestone 4 without
   rows, and milestone 4 seeded; consistency of every count; counts after decisions; parity with the demo's fixtures; and
   cleanup of a recorded run that includes round-linked feedback. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { KEY, PASSWORDS, URL_BASE, createProject, snapshot } from "./fake-supabase.mjs";
import { loadAccount } from "../../src/auth/account.ts";
import { loadWorkspace } from "../../src/workspace/data.ts";
import { WorkspacePage } from "../../src/workspace/DbViews.tsx";
import { createMoveController, supabaseMoveRpc } from "../../src/workspace/moves.ts";
import { deriveNext, feedbackTask, interviewLabel, ordered, requirementLine, waitingCount, waitingOnYou } from "../../src/workspace/next.ts";
import { DataProvider } from "../../src/data/DataProvider.tsx";
import { RolePage } from "../../src/roles/RolePage.tsx";
import { FIXTURE, TODAY } from "../../src/data/fixtures.ts";
import { seedId } from "../../scripts/db/api-read-lib.mjs";
import { uiRestoreSql } from "../../scripts/db/ui-moves-lib.mjs";
import { cleanEntry } from "../../scripts/dev/move-record-lib.mjs";

const EMAIL = { harbor: "portal-test-harbor@example.com", northwind: "portal-test-northwind@example.com" };
const H = (ref) => seedId("submission", "harbor", ref);
async function signIn(p, who = "harbor", fetch = p.fetch) {
  const sb = createClient(URL_BASE, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch } });
  const { data } = await sb.auth.signInWithPassword({ email: EMAIL[who], password: PASSWORDS[who] });
  const account = await loadAccount(sb, data.session.user.id);
  return { sb, account, key: `${data.session.user.id}:${account.client.id}`, load: () => loadWorkspace(sb, account.client.id) };
}
const page = (ws, route) => renderToStaticMarkup(createElement(WorkspacePage, { route, state: { status: "ready", key: "k", ws }, onRetry() {}, today: TODAY }));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const sub = (ws, ref) => ws.subs.find((s) => s.id === H(ref));
const rowsByName = (html) => Object.fromEntries([...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].slice(1).map((m) => text(m[1])).map((t) => [t.split(" ").slice(0, 2).join(" "), t]));

describe("compatibility: milestone 3 only, milestone 4 without rows, milestone 4 seeded", () => {
  it("milestone 3 only: no steps; Waiting on you stays disabled and marked not connected", async () => {
    const ws = await (await signIn(await createProject({ m4: false }))).load();
    expect(ws.steps).toBeNull();
    expect(deriveNext(ws, sub(ws, "tb-isl"), TODAY)).toBeNull();
    const h = page(ws, "candidates");
    expect(h).toContain('title="Not connected yet">Waiting on you <span class="ct">—</span>');
    expect(h).toContain("Next steps, requirement evidence and interviews are not connected yet.");
  });
  it("milestone 4 without rows: reviews only where a summary is shared; no interview is inferred from the stage", async () => {
    const ws = await (await signIn(await createProject({ m4Seed: false }))).load();
    expect(waitingCount(ws, ws.subs, TODAY)).toBe(4);                             // tb-isl, pr-isl, en-pa, ab-fsr; tb-rsm has no recorded round
    expect(interviewLabel(ws, sub(ws, "tb-rsm"))[1]).toBe("No client interview recorded");
    expect(deriveNext(ws, sub(ws, "tb-rsm"), TODAY).short).toBe("Recruiter to follow up");          // the client's own move is the latest change
    expect(deriveNext(ws, sub(ws, "cm-rsm"), TODAY).short).toBe("Recruiter to follow up");
    expect(deriveNext(ws, sub(ws, "gl-rsm"), TODAY).short).toBe("Offer stage saved · status not recorded");
  });
  it("milestone 4 seeded: 5 waiting on you, the same in every view", async () => {
    const ws = await (await signIn(await createProject())).load();
    expect(waitingCount(ws, ws.subs, TODAY)).toBe(5);
    expect(page(ws, "candidates")).toContain('Waiting on you <span class="ct">5</span>');
    const roles = page(ws, "roles");
    expect([...roles.matchAll(/<span class="chip c-warn">(\d+)<\/span>/g)].reduce((n, m) => n + Number(m[1]), 0)).toBe(5);
    /* The same person on two roles counts per submission: Taylor Brooks' review and her interview feedback. */
    expect(["tb-isl", "tb-rsm"].map((r) => deriveNext(ws, sub(ws, r), TODAY).kind)).toEqual(["review", "feedback"]);
    /* Ordering: waiting first, longest waiting first; the list's "you" rows are exactly the waiting ones. */
    const order = ordered(ws, ws.subs, TODAY).map((s) => s.id);
    expect(order.slice(0, 5).every((id) => waitingOnYou(ws, ws.subs.find((s) => s.id === id), TODAY))).toBe(true);
    expect(order[0]).toBe(H("tb-rsm"));
    const list = page(ws, `role-${seedId("role", "harbor", "rsm")}`);
    expect((list.match(/<tr class="you">/g) ?? []).length).toBe(1);
  });
  it("Northwind: the cancelled newer round is current, so the older round's feedback is not a task", async () => {
    const ws = await (await signIn(await createProject(), "northwind")).load();
    const n1 = ws.subs[0];
    expect(feedbackTask(ws, n1)).toBeNull();
    expect(interviewLabel(ws, n1)[1]).toBe("Interview cancelled");
    expect(deriveNext(ws, n1, TODAY).short).toBe("Next step not recorded");
    expect(waitingCount(ws, ws.subs, TODAY)).toBe(0);
  });
});

describe("parity with the demo's fixtures", () => {
  it("the derived next step (who and kind) equals each fixture's stored one", async () => {
    const ws = await (await signIn(await createProject())).load();
    for (const f of FIXTURE.subs) {
      const n = deriveNext(ws, sub(ws, f.id), TODAY);
      expect([n.who, n.kind], f.id).toEqual([f.next.who, f.next.kind]);
    }
  });
  it("each role page's list rows read as the demo's, with the documented differences", async () => {
    const ws = await (await signIn(await createProject())).load();
    for (const r of FIXTURE.roles) {
      const demo = rowsByName(renderToStaticMarkup(createElement(DataProvider, null, createElement(RolePage, { id: r.id }))));
      const db = rowsByName(page(ws, `role-${seedId("role", "harbor", r.id)}`));
      expect(Object.keys(db).sort(), r.id).toEqual(Object.keys(demo).sort());
      for (const [name, row] of Object.entries(demo)) {
        /* Screening calls are not connected; Daniel Okafor's summary is hidden (withdrawn and paused), so no requirement count. */
        const want = row.replace("Screening call available", "No client interview recorded").replace("No interview yet", "No client interview recorded")
          .replace(name === "Daniel Okafor" ? /\d+ of \d+ must-haves supported/ : /$^/, "—");
        expect(db[name], `${r.id} ${name}`).toBe(want);
      }
    }
  });
  it("requirement support comes from the visible summary's evidence", async () => {
    const ws = await (await signIn(await createProject())).load();
    expect(requirementLine(ws, sub(ws, "tb-isl"))).toMatch(/^\d of 4 must-haves supported$/);
    expect(requirementLine(ws, sub(ws, "do-rsm"))).toBeNull();
  });
});

describe("counts after decisions (supabase-js, the real controller)", () => {
  async function controller(p) {
    const c = await signIn(p), m = createMoveController(supabaseMoveRpc(c.sb), () => {}, { wait: () => Promise.resolve() });
    m.sync(c.key);
    const act = async (ref, intent) => {
      const ws = await c.load(), s = sub(ws, ref);
      m.act(c.key, s, intent);
      await new Promise((r) => { const check = () => m.getState().status !== "saving" && (u(), r()); const u = m.subscribe(check); check(); });
      const st = m.getState(); m.dismiss(); return st.status;
    };
    return { c, act };
  }
  it("decline, general feedback, round-linked feedback and a move: every count follows; nothing is inferred", async () => {
    const p = await createProject(), { c, act } = await controller(p);
    expect(await act("ab-fsr", { action: "decline", note: "Not a fit.", category: null })).toBe("saved");
    let ws = await c.load();
    expect(waitingCount(ws, ws.subs, TODAY)).toBe(4);
    expect(await act("tb-rsm", { action: "feedback", about: null, text: "General thoughts." })).toBe("saved");   // general: completes nothing
    ws = await c.load();
    expect(waitingCount(ws, ws.subs, TODAY)).toBe(4);
    expect(interviewLabel(ws, sub(ws, "tb-rsm"))[1]).toBe("Interview held · feedback due");
    const round = feedbackTask(ws, sub(ws, "tb-rsm")).id;
    expect(await act("tb-rsm", { action: "feedback", about: null, text: "Strong territory plan.", interviewId: round })).toBe("saved");
    ws = await c.load();
    expect(waitingCount(ws, ws.subs, TODAY)).toBe(3);
    expect(interviewLabel(ws, sub(ws, "tb-rsm"))[1]).toBe("Interview held · feedback given");
    expect(deriveNext(ws, sub(ws, "tb-rsm"), TODAY).kind).toBe("followup");
    expect(ws.steps.feedbackLinks.get(round)).toBeTruthy();
    expect(await act("pr-isl", { action: "move", toStage: "Interview" })).toBe("saved");
    ws = await c.load();
    expect(waitingCount(ws, ws.subs, TODAY)).toBe(2);
    expect(deriveNext(ws, sub(ws, "pr-isl"), TODAY).short).toBe("Recruiter to follow up");
    expect(interviewLabel(ws, sub(ws, "pr-isl"))[1]).toBe("No client interview recorded");
    expect(page(ws, "candidates")).toContain('Waiting on you <span class="ct">2</span>');
  });
  it("Jordan's scheduled round recorded held, then a move to Offer: feedback stays enabled and he stays waiting in every count", async () => {
    const p = await createProject(), { c, act } = await controller(p);
    await p.db.exec(`update public.client_interviews set status = 'held', held_on = '2026-10-15' where id = md5('portal-m4:interview:harbor:je-isl:1')::uuid`);
    let ws = await c.load();
    expect(deriveNext(ws, sub(ws, "je-isl"), TODAY).kind).toBe("feedback");
    expect(waitingCount(ws, ws.subs, TODAY)).toBe(6);
    expect(await act("je-isl", { action: "move", toStage: "Offer" })).toBe("saved");
    ws = await c.load();
    const je = sub(ws, "je-isl");
    expect(je.stage).toBe("Offer");
    expect(deriveNext(ws, je, TODAY)).toMatchObject({ who: "you", kind: "feedback" });
    expect(waitingOnYou(ws, je, TODAY)).toBe(true);
    expect(feedbackTask(ws, je)?.id).toBe(ws.steps.interviews.get(je.id)[0].id);
    expect(interviewLabel(ws, je)[1]).toBe("Interview held · feedback due");
    const detail = page(ws, `c-${je.id}`);
    expect(detail).toMatch(/data-form="feedback"(?![^>]*disabled)/);
    expect(text(detail)).toContain("Share interview feedback");
    expect(waitingCount(ws, ws.subs, TODAY)).toBe(6);
    expect(page(ws, "candidates")).toContain('Waiting on you <span class="ct">6</span>');
    const roles = page(ws, "roles");
    expect([...roles.matchAll(/<span class="chip c-warn">(\d+)<\/span>/g)].reduce((n, m) => n + Number(m[1]), 0)).toBe(6);
    expect(ordered(ws, ws.subs, TODAY).slice(0, 6).every((s) => waitingOnYou(ws, s, TODAY))).toBe(true);
  });
  it("a round-linked feedback for a round that is no longer current is refused, changing nothing", async () => {
    const p = await createProject(), { c, act } = await controller(p);
    const round = feedbackTask(await c.load(), sub(await c.load(), "tb-rsm")).id;
    await p.db.exec(`insert into public.client_interviews (client_id, submission_id, round, status, requested_on, as_of_version) values (md5('portal-m1:client:harbor')::uuid, '${H("tb-rsm")}', 2, 'requested', '2026-10-12', 1)`);
    const before = await snapshot(p.db);
    expect(await act("tb-rsm", { action: "feedback", about: null, text: "Too late.", interviewId: round })).toBe("failed");
    expect(await snapshot(p.db)).toEqual(before);
  });
});

describe("cleanup of a recorded run with round-linked feedback", () => {
  it("the generated cleanup removes the run's note and, with it, the link; everything else as before", async () => {
    const p = await createProject(), before = await snapshot(p.db), c = await signIn(p);
    const run = { kind: "ui-moves", runId: crypto.randomUUID(), project: "offline", createdAt: new Date().toISOString(), entries: [] };
    const m = createMoveController(supabaseMoveRpc(c.sb), () => {}, { record: async (e) => { run.entries.push(cleanEntry(JSON.parse(JSON.stringify(e)))); }, wait: () => Promise.resolve() });
    m.sync(c.key);
    const ws = await c.load(), s = sub(ws, "tb-rsm");
    m.act(c.key, s, { action: "feedback", about: null, text: "Linked.", interviewId: feedbackTask(ws, s).id });
    await new Promise((r) => { const check = () => m.getState().status !== "saving" && (u(), r()); const u = m.subscribe(check); check(); });
    expect(m.getState().status).toBe("saved");
    expect((await p.db.query("select count(*)::int as n from public.interview_feedback")).rows[0].n).toBe(1);
    expect(JSON.stringify(run)).not.toContain("Linked.");
    const rows = (await p.db.exec(uiRestoreSql(run))).at(-1).rows;
    expect(rows.every((r) => r.result === "OK"), JSON.stringify(rows)).toBe(true);
    const strip = (snap) => ({ ...snap, "public.submissions": JSON.stringify(JSON.parse(snap["public.submissions"]).map(({ updated_at, ...x }) => x)) });
    expect(strip(await snapshot(p.db))).toEqual(strip(before));
  });
});

describe("errors stop the load", () => {
  it("a partly applied milestone 4, or a refused read of one of its tables, is an error", async () => {
    const a = await createProject({ m4Seed: false });
    await a.db.exec("drop table public.interview_feedback");
    await expect((await signIn(a)).load()).rejects.toThrow(/only part of milestone 4/);
    const b = await createProject();
    await b.db.exec("revoke select on public.client_interviews from authenticated");
    await expect((await signIn(b)).load()).rejects.toThrow(/client_interviews could not be read/);
  });
});
