/* Milestone 5 in Supabase mode, end to end offline: Hiring progress from the same workspace snapshot as Candidates and
   Roles, through the real supabase-js client, the loaders, the client functions (stage moves, decline, general and
   round-linked feedback) and the Supabase-mode page. Exact parity with the demo at the fixed demo date; consistency with
   the Candidates and Roles counts; client isolation and publication filtering; no search records requested. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { KEY, PASSWORDS, URL_BASE, asUser, createProject } from "./fake-supabase.mjs";
import { loadAccount } from "../../src/auth/account.ts";
import { loadWorkspace, roleRow, utcToday } from "../../src/workspace/data.ts";
import { WorkspacePage } from "../../src/workspace/DbViews.tsx";
import { createMoveController, supabaseMoveRpc } from "../../src/workspace/moves.ts";
import { feedbackTask } from "../../src/workspace/next.ts";
import { reportData } from "../../src/reporting/fromWorkspace.ts";
import { pipelineModel, roleRows, scheduledCount, stageAudit, weeklyCounts } from "../../src/reporting/metrics.ts";
import { countByStage } from "../../src/domain/candidates.ts";
import { FIXTURE, TODAY } from "../../src/data/fixtures.ts";
import { WEEKS, weeksBefore } from "../../src/lib/dates.ts";
import { seedId } from "../../scripts/db/api-read-lib.mjs";

const EMAIL = { harbor: "portal-test-harbor@example.com", northwind: "portal-test-northwind@example.com" };
const H = (ref) => seedId("submission", "harbor", ref), R = (ref) => seedId("role", "harbor", ref);
const ALL = ["To review", "Interview", "Offer", "Hired", "Declined"];
async function signIn(p, who = "harbor") {
  const paths = [], fetch = (url, init) => { paths.push(new URL(url).pathname); return p.fetch(url, init); };
  const sb = createClient(URL_BASE, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch } });
  const { data } = await sb.auth.signInWithPassword({ email: EMAIL[who], password: PASSWORDS[who] });
  const account = await loadAccount(sb, data.session.user.id);
  return { sb, paths, key: `${data.session.user.id}:${account.client.id}`, load: () => loadWorkspace(sb, account.client.id) };
}
async function controller(c) {
  const m = createMoveController(supabaseMoveRpc(c.sb), () => {}, { wait: () => Promise.resolve() });
  m.sync(c.key);
  return async (ref, intent) => {
    const ws = await c.load(), s = ws.subs.find((x) => x.id === H(ref));
    m.act(c.key, s, intent);
    await new Promise((r) => { const check = () => m.getState().status !== "saving" && (u(), r()); const u = m.subscribe(check); check(); });
    const st = m.getState(); m.dismiss(); return st.status;
  };
}
const page = (ws, today) => renderToStaticMarkup(createElement(WorkspacePage, { route: "progress", state: { status: "ready", key: "k", ws }, onRetry() {}, today }));
/* Everything a chart shows, for one source and role filter (role ids already in that source's terms). */
function charts(d, f, today, weeks) {
  const M = pipelineModel(d, f, today);
  return {
    reached: M.reached.slice(2), now: M.now.slice(2), dec: M.closed.dec, decBy: M.closed.decBy, offers: M.offers,
    time: M.time.slice(2), audit: stageAudit(d, f, today).slice(2),
    roles: [false, true].flatMap((h) => ["fewest", "az"].map((s) => roleRows(d, f, h, s).map((r) => [r.role.title, r.by, r.total, r.dec]))),
    weekly: weeklyCounts(d, f, weeks), scheduled: scheduledCount(d, f),
  };
}

describe("parity with the demo at the fixed demo date", () => {
  it("Harbor: every chart from Submitted on equals the demo, for all roles and each role", async () => {
    const d = reportData(await (await signIn(await createProject())).load());
    expect(d.subs).toHaveLength(FIXTURE.subs.length);
    expect(charts(d, "all", TODAY, WEEKS)).toEqual(charts(FIXTURE, "all", TODAY, WEEKS));
    for (const r of FIXTURE.roles) expect(charts(d, R(r.id), TODAY, WEEKS), r.id).toEqual(charts(FIXTURE, r.id, TODAY, WEEKS));
    /* Only what the demo has from search records differs: Not available here, never 0. */
    const M = pipelineModel(d, "all", TODAY);
    expect([M.reached.slice(0, 2), M.now.slice(0, 2), M.closed.np, M.time.slice(0, 2).map((t) => t.available)]).toEqual([[null, null], [null, null], null, [false, false]]);
  });
  it("the page at the demo date shows the demo's numbers with Supabase-mode wording", async () => {
    const h = page(await (await signIn(await createProject())).load(), TODAY);
    expect(h).toContain("Fictional data · development");
    expect(h).toContain("As of 12 Oct 2026 (UTC) · candidates currently shared with your team; withdrawn or unshared candidates are not included");
    expect(h).toContain('aria-label="Sourced not available, Screened not available, Submitted 12, Interview 6, Offer 2, Hired 1"');
    expect(h).toContain("Not shown: 2 declined (2 by your team). Not progressed before sharing: not available.");
    expect(h).not.toMatch(/declined by you|ended with your decision/);
  });
});

describe("rolling weeks at a later date (no promise of equality with the demo's fixed weeks)", () => {
  it("weeks come from the supplied UTC date; counts are the recorded events inside them", async () => {
    const d = reportData(await (await signIn(await createProject())).load());
    const later = "2026-11-18", weeks = weeksBefore(later);
    expect(weeks[0][0]).toBe("2026-10-05");
    const W = weeklyCounts(d, "all", weeks);
    expect(W.map((w) => w.shared)).toEqual(weeks.map(([a, b]) => d.subs.filter((s) => s.shared >= a && s.shared <= b).length));
    expect(W.map((w) => w.held)).toEqual(weeks.map(([a, b]) => d.held.filter((x) => x.d >= a && x.d <= b).length));
    /* The seed's activity ends on 11 Oct, so these later weeks differ from the demo's: only 5 Oct – 11 Oct overlaps. */
    expect(W.map((w) => w.shared)).toEqual([weeklyCounts(d, "all", WEEKS)[5].shared, 0, 0, 0, 0, 0]);
    expect(page(await (await signIn(await createProject())).load(), later)).toContain("Shown: the last 6 full weeks, 5 Oct – 15 Nov.");
  });
});

describe("the same counts as Candidates and Roles", () => {
  const consistent = (ws, today) => {
    const d = reportData(ws), M = pipelineModel(d, "all", today);
    expect([...M.now.slice(2), M.closed.dec], "In stage now + declined = the Candidates counts").toEqual(countByStage(ws.subs, ALL));
    for (const role of ws.roles.filter((r) => r.status !== "Closed")) {
      const row = roleRows(d, role.id, true, "az")[0], rr = roleRow(ws, role, today);
      expect([...row.by, row.dec], role.title).toEqual(rr.byStage);
      expect(row.total + row.dec).toBe(rr.shared);
    }
  };
  it("seeded, and after skip, back, repeat and decline moves made through the client functions", async () => {
    const p = await createProject(), c = await signIn(p), act = await controller(c), today = utcToday();
    consistent(await c.load(), today);
    const before = pipelineModel(reportData(await c.load()), "all", today), auditBefore = stageAudit(reportData(await c.load()), "all", today);
    expect(await act("ab-fsr", { action: "move", toStage: "Offer" })).toBe("saved");                       // skips Interview
    for (const to of ["Interview", "To review", "Interview"]) expect(await act("pr-isl", { action: "move", toStage: to })).toBe("saved");   // back and repeat, same day
    expect(await act("tb-isl", { action: "decline", note: "Not a fit.", category: null })).toBe("saved");
    const ws = await c.load(), d = reportData(ws), M = pipelineModel(d, "all", today), A = stageAudit(d, "all", today);
    consistent(ws, today);
    expect(M.reached.slice(2)).toEqual([before.reached[2], before.reached[3] + 2, before.reached[4] + 1, before.reached[5]]);
    expect(M.now.slice(2)).toEqual([before.now[2] - 3, before.now[3] + 1, before.now[4] + 1, before.now[5]]);
    expect(M.closed).toEqual({ dec: before.closed.dec + 1, decBy: { you: before.closed.decBy.you + 1, ro: before.closed.decBy.ro }, np: null });
    expect(A[3].skipped - auditBefore[3].skipped).toBe(1);                                                  // ab-fsr: Interview by skipping
    expect(A[3].entries - auditBefore[3].entries).toBe(2);                                                  // pr-isl: two Interview stays
    expect(A[2].entries - auditBefore[2].entries).toBe(1);                                                  // pr-isl: back to To review
  });
});

describe("feedback is not a stage move", () => {
  it("general and round-linked feedback leave every report row and chart unchanged", async () => {
    const p = await createProject(), c = await signIn(p), act = await controller(c), today = utcToday();
    const before = reportData(await c.load());
    expect(await act("tb-rsm", { action: "feedback", about: null, text: "General thoughts." })).toBe("saved");
    const round = feedbackTask(await c.load(), (await c.load()).subs.find((s) => s.id === H("tb-rsm"))).id;
    expect(await act("tb-rsm", { action: "feedback", about: null, text: "Strong territory plan.", interviewId: round })).toBe("saved");
    const after = reportData(await c.load());
    expect(after).toEqual(before);
    expect(charts(after, "all", today, weeksBefore(today))).toEqual(charts(before, "all", today, weeksBefore(today)));
  });
});

describe("client isolation and publication", () => {
  it("each client's report has only its own currently shared submissions; unpublished ones are never counted", async () => {
    const p = await createProject();
    const unpublished = (await p.db.query("select id from public.submissions where publication <> 'published'")).rows.map((r) => r.id);
    const harbor = await signIn(p), north = await signIn(p, "northwind");
    const h = reportData(await harbor.load()), n = reportData(await north.load());
    expect([h.subs.length, n.subs.length]).toEqual([12, 1]);
    const ids = (d) => [...d.subs.map((s) => s.id), ...d.moves.map((m) => m.sid), ...d.held.map((x) => x.sid)];
    for (const id of unpublished) expect([...ids(h), ...ids(n)]).not.toContain(id);
    expect(ids(n).some((id) => ids(h).includes(id))).toBe(false);
    expect(n.roles.map((r) => r.id).some((id) => h.roles.some((r) => r.id === id))).toBe(false);
    /* Northwind's activity does not change Harbor's report. */
    const nw = (await north.load()).subs[0];
    await asUser(p.db, p.ids[EMAIL.northwind], `select public.client_move_stage('${nw.id}', '${nw.stage === "Interview" ? "To review" : "Interview"}', ${nw.version}, gen_random_uuid())`);
    expect(reportData(await north.load()).moves.length).toBe(n.moves.length + 1);
    expect(reportData(await harbor.load())).toEqual(h);
  });
  it("no search records or other internal tables are requested: only the workspace's own reads", async () => {
    const c = await signIn(await createProject());
    page(await c.load(), TODAY);
    const tables = [...new Set(c.paths.filter((x) => x.startsWith("/rest/v1/")).map((x) => x.slice(9)))].sort();
    expect(tables.filter((t) => /search|sourc|screen/i.test(t))).toEqual([]);
    const allowed = ["client_interviews", "client_members", "client_notes", "clients", "interview_feedback", "offer_outcomes", "people", "requirement_evidence",
      "role_requirement_sets", "role_requirements", "roles", "submission_events", "submission_packages", "submissions"];
    expect(tables.filter((t) => !allowed.includes(t))).toEqual([]);
    expect(tables).toEqual(expect.arrayContaining(["submissions", "submission_events", "client_interviews", "offer_outcomes"]));
  });
  it("without milestone 4 the page says not connected; nothing is calculated", async () => {
    const h = page(await (await signIn(await createProject({ m4: false }))).load(), TODAY);
    expect(h).toContain("Hiring progress is not connected yet: it needs interview and offer records (milestone 4) on this database.");
    expect(h).not.toContain("hp-funnel");
  });
});
