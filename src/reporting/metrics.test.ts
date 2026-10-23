/* Reporting calculations checked against the 2h reference numbers (test_2f.py) and stage-move scenarios (test_moves.py). */
import { describe, expect, it } from "vitest";
import { FIXTURE, TODAY, type Dataset, type Stage } from "../data/fixtures";
import { applyAction } from "../domain/actions";
import { days } from "../lib/dates";
import {
  hiddenRoles, pipelineModel, records, roleRows, scheduledCount, sharedStays, stageAudit, waitingForClient, weeklyCounts, weeklyTrend,
  type RoleFilter,
} from "./metrics";

const fresh = (): Dataset => structuredClone(FIXTURE);

/** Applies a client stage change with the app's own action rules (domain/actions.ts, ported from 2h's submitForm). */
function move(data: Dataset, sid: string, to: Stage, d = TODAY): Dataset {
  applyAction(data, to === "Declined" ? { type: "decline", sid, text: "Test decline note (fictional)", cat: "No category", d } : { type: "move", sid, to, note: "", d });
  return data;
}
const staysOf = (data: Dataset, sid: string) => {
  const c = data.subs.find((s) => s.id === sid)!;
  return sharedStays(data, sid, c.shared).map((t) => [t.stage, t.start, t.end, t.endedBy]);
};
const audit = (data: Dataset, f: RoleFilter = "all") => Object.fromEntries(stageAudit(data, f, TODAY).map((a) => [a.stage, a]));

/** The guarantees 2h states for every stage, after any sequence of moves. */
function expectInvariants(data: Dataset, f: RoleFilter = "all") {
  const A = stageAudit(data, f, TODAY);
  for (const a of A) {
    expect(a.ongoing, `${a.stage}: ongoing stays = in stage now`).toBe(a.now);
    expect(a.completed + a.ongoing, `${a.stage}: completed + ongoing = stays`).toBe(a.entries);
    expect(a.entered + a.skipped, `${a.stage}: entered + skipped = reached`).toBe(a.reached);
    expect(a.skipped).toBeGreaterThanOrEqual(0);
  }
  expect(A.filter((a) => ["Sourced", "Screened", "Submitted"].includes(a.stage)).every((a) => a.skipped === 0), "only Interview and Offer can be skipped").toBe(true);
  /* Every stay belongs to a stage the candidate actually entered: stays match the entries into timed stages one for one. */
  for (const x of records(data, f).filter((r) => r.sub)) {
    const entries = ["To review", ...data.moves.filter((m) => m.sid === x.sid).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0)).map((m) => m.to)]
      .map((s) => ({ "To review": "Submitted", Interview: "Interview", Offer: "Offer" } as Record<string, string>)[s]).filter(Boolean);
    expect(sharedStays(data, x.sid!, x.sub!.shared).map((t) => t.stage), x.sid!).toEqual(entries);
  }
  /* Time in stage shows the audited numbers. */
  const M = pipelineModel(data, f, TODAY);
  expect(M.time.map((t) => t.n)).toEqual(A.map((a) => a.completed));
  expect(M.time.map((t) => t.open)).toEqual(A.map((a) => a.ongoing));
}

/** Cross-chart consistency from test_2f.py. */
function expectConsistent(data: Dataset, f: RoleFilter, includeOnHold: boolean) {
  const M = pipelineModel(data, f, TODAY), rows = roleRows(data, f, includeOnHold, "fewest");
  const hidden = hiddenRoles(data, f, includeOnHold).map((r) => r.id);
  const hiddenNow = ["To review", "Interview", "Offer", "Hired"].map((s) => data.subs.filter((c) => hidden.includes(c.role) && c.stage === s).length);
  const sums = [0, 1, 2, 3].map((i) => rows.reduce((a, r) => a + r.by[i], 0));
  expect(sums, "role chart = Pipeline 'In stage now' minus roles hidden from the role chart").toEqual([2, 3, 4, 5].map((i, k) => M.now[i] - hiddenNow[k]));
  const W = weeklyCounts(data, f);
  expect(W.reduce((a, w) => a + w.shared, 0)).toBeLessThanOrEqual(M.reached[2]);
  expect(W.reduce((a, w) => a + w.held, 0)).toBeLessThanOrEqual(M.reached[3]);
}

describe("reference data, all roles (test_2f.py)", () => {
  const data = fresh(), M = pipelineModel(data, "all", TODAY);
  it("Pipeline reached 57/24/12/6/2/1 and in stage now 12/4/4/4/1/1", () => {
    expect(M.reached).toEqual([57, 24, 12, 6, 2, 1]);
    expect(M.now).toEqual([12, 4, 4, 4, 1, 1]);
    expect(M.closed).toEqual({ dec: 2, np: 29 });
    expect(M.offers).toEqual({ made: 2, acc: 1 });
  });
  it("Time in stage: averages 4.3/1.8/5.1/15.5/9, completed 45/20/8/2/1, ongoing 12/4/4/4/1 (25 in all)", () => {
    expect(M.time.map((t) => t.avg)).toEqual([4.3, 1.8, 5.1, 15.5, 9]);
    expect(M.time.map((t) => t.n)).toEqual([45, 20, 8, 2, 1]);
    expect(M.time.map((t) => t.open)).toEqual([12, 4, 4, 4, 1]);
    expect(M.time.reduce((a, t) => a + t.open, 0)).toBe(25);
  });
  it("'Waiting for client decision' applies to To review only", () => {
    expect(M.time.filter(waitingForClient).map((t) => t.s)).toEqual(["Submitted"]);
  });
  it("Candidates by role, open roles, fewest first: FSR 1, PA 2, ISL 3; the on-hold role is hidden", () => {
    expect(roleRows(data, "all", false, "fewest").map((r) => [r.role.title, r.total])).toEqual([["Field Sales Representative", 1], ["Pricing Analyst", 2], ["Inside Sales Leader", 3]]);
    expect(hiddenRoles(data, "all", false).map((r) => r.title)).toEqual(["Regional Sales Manager"]);
  });
  it("Include on-hold roles adds Regional Sales Manager 0/2/1/1 = 4; A–Z sorts by title", () => {
    const rows = roleRows(data, "all", true, "fewest");
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.role.id === "rsm")).toMatchObject({ by: [0, 2, 1, 1], total: 4, dec: 0 });
    expect(roleRows(data, "all", true, "az").map((r) => r.role.id)).toEqual(["fsr", "isl", "pa", "rsm"]);
  });
  it("Weekly: submitted 1/1/1/4/1/4, held 0/1/1/1/0/1, and the computed trend", () => {
    const W = weeklyCounts(data, "all");
    expect(W.map((w) => w.a)).toEqual(["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"]);
    expect(W.map((w) => w.shared)).toEqual([1, 1, 1, 4, 1, 4]);
    expect(W.map((w) => w.held)).toEqual([0, 1, 1, 1, 0, 1]);
    expect(weeklyTrend(W)?.text).toBe("Submissions increased; interviews held stayed level.");
    expect(scheduledCount(data, "all")).toBe(1);
  });
  it("charts agree with each other, with and without on-hold roles in the role chart", () => {
    expectConsistent(data, "all", false);
    expectConsistent(data, "all", true);
  });
  it("seed data meets every stage-count guarantee", () => expectInvariants(data));
});

describe("role filter (test_2f.py)", () => {
  const data = fresh();
  it.each([["isl", 18], ["pa", 14], ["fsr", 9], ["rsm", 16]])("%s: Pipeline Sourced = %i, charts consistent", (rid, sourced) => {
    expect(pipelineModel(data, rid, TODAY).reached[0]).toBe(sourced);
    expectConsistent(data, rid, false);
    expectConsistent(data, rid, true);
    expectInvariants(data, rid);
  });
  it("on-hold Regional Sales Manager: role chart empty unless included; Weekly and Time still count its history", () => {
    expect(roleRows(data, "rsm", false, "fewest")).toEqual([]);
    expect(roleRows(data, "rsm", true, "fewest").map((r) => r.total)).toEqual([4]);
    expect(weeklyCounts(data, "rsm").reduce((a, w) => a + w.held, 0)).toBe(4);
    expect(pipelineModel(data, "rsm", TODAY).time[3].n).toBe(2);
  });
  it("Field Sales Representative: too little weekly data, so no trend is stated", () => {
    expect(weeklyTrend(weeklyCounts(data, "fsr"))?.text).toBeNull();
  });
});

describe("a client move flows through every chart (test_2f.py)", () => {
  const data = move(fresh(), "pr-isl", "Interview");
  it("Pipeline reached Interview 7, To review now 3; Inside Sales Leader 1 To review, 2 Interview; weekly held unchanged", () => {
    const M = pipelineModel(data, "all", TODAY);
    expect(M.reached[3]).toBe(7);
    expect(M.now[2]).toBe(3);
    expect(roleRows(data, "all", false, "fewest").find((r) => r.role.id === "isl")!.by.slice(0, 2)).toEqual([1, 2]);
    expect(weeklyCounts(data, "all").map((w) => w.held)).toEqual([0, 1, 1, 1, 0, 1]);
    expectConsistent(data, "all", false);
    expectInvariants(data);
  });
});

describe("stage moves (test_moves.py)", () => {
  it("jump To review → Offer: Interview counts as reached by skipping and gets no stay", () => {
    const data = move(fresh(), "ab-fsr", "Offer"), a = audit(data);
    expectInvariants(data);
    expect(staysOf(data, "ab-fsr")).toEqual([["Submitted", "2026-10-10", "2026-10-12", "you"], ["Offer", "2026-10-12", null, null]]);
    expect([a.Interview.reached, a.Offer.reached, a.Interview.entered, a.Interview.skipped]).toEqual([7, 3, 6, 1]);
    const t = pipelineModel(data, "all", TODAY).time[3];
    expect([t.avg, t.n, t.open]).toEqual([15.5, 2, 4]);
  });
  it("jump To review → Hired: only a To review stay; Interview and Offer each skipped once; Hired reached 2", () => {
    const data = move(fresh(), "pr-isl", "Hired"), a = audit(data);
    expectInvariants(data);
    expect(staysOf(data, "pr-isl")).toEqual([["Submitted", "2026-10-07", "2026-10-12", "you"]]);
    expect([a.Interview.skipped, a.Offer.skipped, pipelineModel(data, "all", TODAY).reached[5]]).toEqual([1, 1, 2]);
  });
  it("back Interview → To review: a new To review stay; reached does not go down", () => {
    const data = move(fresh(), "so-pa", "To review"), a = audit(data);
    expectInvariants(data);
    expect(staysOf(data, "so-pa")).toEqual([["Submitted", "2026-09-29", "2026-10-06", "you"], ["Interview", "2026-10-06", "2026-10-12", "you"], ["Submitted", "2026-10-12", null, null]]);
    expect([a.Interview.reached, a.Submitted.now, a.Interview.now, a.Submitted.entries, a.Submitted.entered]).toEqual([6, 5, 3, 13, 12]);
  });
  it("repeated stages: each re-entry is a new stay; Pipeline counts the candidate once per stage", () => {
    const data = fresh();
    for (const s of ["To review", "Interview", "To review", "Interview", "Offer"] as Stage[]) move(data, "je-isl", s);
    expectInvariants(data);
    const st = staysOf(data, "je-isl");
    expect(st.map((t) => t[0])).toEqual(["Submitted", "Interview", "Submitted", "Interview", "Submitted", "Interview", "Offer"]);
    expect(st.at(-1)![2]).toBeNull();
    expect(st.slice(0, -1).every((t) => t[2])).toBe(true);
    const a = audit(data);
    expect([a.Interview.reached, a.Offer.reached]).toEqual([6, 3]);
  });
  it("dated repeat history: durations go to the stage actually entered; a stay ended by Revenue Optics is not a client decision", () => {
    const data = fresh(), c = data.subs.find((s) => s.id === "ab-fsr")!;
    c.shared = "2026-09-01"; c.stage = "Offer";
    data.moves.push({ sid: "ab-fsr", to: "Interview", d: "2026-09-05", by: "you" }, { sid: "ab-fsr", to: "To review", d: "2026-09-10", by: "you" },
      { sid: "ab-fsr", to: "Interview", d: "2026-09-12", by: "ro" }, { sid: "ab-fsr", to: "Offer", d: "2026-09-20", by: "ro" });
    expectInvariants(data);
    expect(sharedStays(data, "ab-fsr", "2026-09-01").map((t) => [t.stage, t.end ? days(t.start, t.end) : null]))
      .toEqual([["Submitted", 4], ["Interview", 5], ["Submitted", 2], ["Interview", 8], ["Offer", null]]);
    const t = pipelineModel(data, "all", TODAY).time[2];
    expect(t.byYou).toBe(t.n - 1);
    expect(waitingForClient(t)).toBe(false);
  });
  it("declines from Interview, To review and Offer end the stay; Declined has no stay", () => {
    const data = move(fresh(), "je-isl", "Declined");
    expectInvariants(data);
    expect(staysOf(data, "je-isl").at(-1)).toEqual(["Interview", "2026-09-29", "2026-10-12", "you"]);
    expect([audit(data).Interview.reached, audit(data).Interview.now]).toEqual([6, 3]);
    move(data, "tb-isl", "Declined");
    expectInvariants(data);
    expect(staysOf(data, "tb-isl")).toEqual([["Submitted", "2026-10-09", "2026-10-12", "you"]]);
    expect(waitingForClient(pipelineModel(data, "all", TODAY).time[2])).toBe(true);
    move(data, "ab-fsr", "Offer"); move(data, "ab-fsr", "Declined");
    expectInvariants(data);
    expect(staysOf(data, "ab-fsr").map((t) => t[0])).toEqual(["Submitted", "Offer"]);
    expect(staysOf(data, "ab-fsr").at(-1)![2]).toBe("2026-10-12");
    expect(audit(data).Interview.skipped).toBe(1);
  });
  it("moving to Offer or Hired clears the recorded offer outcome, as in 2h", () => {
    expect(pipelineModel(move(fresh(), "gl-rsm", "Hired"), "all", TODAY).offers).toEqual({ made: 1, acc: 1 });
  });
});

describe("empty states (test_2f.py)", () => {
  it("no data: nothing to count; open roles still listed with zero; no trend and no waiting label", () => {
    const data: Dataset = { ...fresh(), subs: [], search: [], held: [], moves: [] }, M = pipelineModel(data, "all", TODAY);
    expect(M.recs).toEqual([]);
    expect(M.time.every((t) => t.avg == null)).toBe(true);
    expect(M.time.some(waitingForClient)).toBe(false);
    expect(weeklyCounts(data, "all").every((w) => !w.shared && !w.held)).toBe(true);
    expect(weeklyTrend(weeklyCounts(data, "all"))?.text).toBeNull();
    expect(roleRows(data, "all", false, "fewest").map((r) => r.total)).toEqual([0, 0, 0]);
  });
  it("all roles on hold: the role chart has no rows", () => {
    const data = fresh(); data.roles.forEach((r) => (r.status = "On hold"));
    expect(roleRows(data, "all", false, "fewest")).toEqual([]);
  });
});
