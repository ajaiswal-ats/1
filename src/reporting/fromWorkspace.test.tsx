/* Hiring progress in Supabase mode (fromWorkspace.ts and the shared metrics): stage history from the recorded entries,
   declines and who made them, feedback that is not a move, missing search records, role filters, rolling UTC weeks, and
   histories that do not add up. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RoleStatus, Stage } from "../data/fixtures";
import { WEEKS, weeksBefore } from "../lib/dates";
import { ByRole } from "../progress/ByRole";
import { Pipeline } from "../progress/Pipeline";
import { TimeInStage } from "../progress/TimeInStage";
import { Weekly } from "../progress/Weekly";
import type { DbEvent, DbInterview, DbSubmission, Workspace } from "../workspace/data";
import { ReportDataError, reportData } from "./fromWorkspace";
import { hiddenRoles, pipelineModel, roleRows, stageAudit, weeklyCounts, type ReportData, type RoleFilter } from "./metrics";

const TODAY = "2026-10-12";
type Ev = [kind: DbEvent["kind"], to: Stage, on: string, by?: "client" | "revenue_optics"];
interface SubSpec { id: string; role?: string; shared?: string; events?: Ev[]; rounds?: Partial<DbInterview>[] }

/* A workspace with roles r1 (open), r2 (on hold), r3 (closed); each submission's history is its "shared" entry plus `events`. */
function ws(subs: SubSpec[], { steps = true, roles = [["r1", "Open"], ["r2", "On hold"], ["r3", "Closed"]] as [string, RoleStatus][] } = {}): Workspace {
  let id = 0;
  const events: DbEvent[] = [], dbSubs: DbSubmission[] = [];
  for (const x of subs) {
    const shared = x.shared ?? "2026-10-01", evs: Ev[] = [["shared", "To review", shared, "revenue_optics"], ...(x.events ?? [])];
    let stage: Stage = "To review";
    evs.forEach(([kind, to, on, by = "client"], i) => {
      events.push({ id: ++id, submissionId: x.id, version: i + 1, kind, toStage: to, occurredOn: on, actorKind: by, actorMemberId: null });
      if (kind !== "feedback") stage = to;
    });
    dbSubs.push({ id: x.id, roleId: x.role ?? "r1", personId: `p-${x.id}`, stage, sharedOn: shared, version: evs.length });
  }
  const rounds = new Map(subs.filter((x) => x.rounds?.length).map((x) => [x.id, x.rounds!.map((r, i) => ({ id: `${x.id}-i${i + 1}`, submissionId: x.id, round: i + 1, status: "requested",
    requestedOn: null, suggestedTimes: null, scheduledOn: null, timeText: null, interviewers: null, heldOn: null, feedbackRecordedOn: null, asOfVersion: 1, ...r } as DbInterview))]));
  return {
    clientId: "c1", roles: roles.map(([rid, status]) => ({ id: rid, title: `Role ${rid}`, location: "", status, openedOn: "2026-09-01", recruiterName: "" })),
    people: new Map(), subs: dbSubs, moves: [], events, notes: [], content: null,
    steps: steps ? { interviews: rounds, outcomes: new Map(), feedbackLinks: new Map() } : null,
  };
}
const data = (subs: SubSpec[], o?: Parameters<typeof ws>[1]) => reportData(ws(subs, o))!;
const model = (d: ReportData, f: RoleFilter = "all", today = TODAY) => pipelineModel(d, f, today);
const audit = (d: ReportData, f: RoleFilter = "all") => Object.fromEntries(stageAudit(d, f, TODAY).map((a) => [a.stage, a]));
const html = (d: ReportData, f: RoleFilter = "all", includeOnHold = false) => {
  const M = model(d, f), role = d.roles.find((r) => r.id === f) ?? null, none = () => {};
  return {
    pipeline: renderToStaticMarkup(<Pipeline data={d} filter={f} role={role} M={M} today={TODAY} view="reached" onView={none} />),
    time: renderToStaticMarkup(<TimeInStage data={d} filter={f} role={role} M={M} today={TODAY} />),
    roles: renderToStaticMarkup(<ByRole data={d} filter={f} rows={roleRows(d, f, includeOnHold, "fewest")} includeOnHold={includeOnHold} sort="fewest" onIncludeOnHold={none} onSort={none} />),
    weekly: renderToStaticMarkup(<Weekly filter={f} weeks={weeklyCounts(d, f, weeksBefore(TODAY))} scheduled={0} recorded={d.recorded} />),
  };
};

describe("stage history from recorded entries", () => {
  it("same-day moves keep their recorded order: To review → Interview → To review on one day gives two To review stays and one Interview stay", () => {
    const d = data([{ id: "a", events: [["stage_move", "Interview", "2026-10-05"], ["stage_move", "To review", "2026-10-05"]] }]);
    expect(d.moves.map((m) => m.to)).toEqual(["Interview", "To review"]);
    const a = audit(d);
    expect([a.Submitted.entries, a.Submitted.completed, a.Submitted.ongoing, a.Interview.entries, a.Interview.completed]).toEqual([2, 1, 1, 1, 1]);
    expect(model(d).now.slice(2)).toEqual([1, 0, 0, 0]);
    expect(model(d).reached.slice(2)).toEqual([1, 1, 0, 0]);
  });
  it("a backward move starts a new stay; reached does not go down", () => {
    const d = data([{ id: "a", events: [["stage_move", "Interview", "2026-10-03"], ["stage_move", "To review", "2026-10-08"]] }]);
    expect(model(d).reached.slice(2)).toEqual([1, 1, 0, 0]);
    expect(audit(d).Submitted.entries).toBe(2);
  });
  it("a skipped stage counts as reached, with no stay and no days", () => {
    const d = data([{ id: "a", events: [["stage_move", "Offer", "2026-10-04"]] }]);
    const a = audit(d);
    expect([a.Interview.reached, a.Interview.entered, a.Interview.skipped, a.Interview.entries]).toEqual([1, 0, 1, 0]);
  });
  it("a repeated stage: two stays, reached once", () => {
    const d = data([{ id: "a", events: [["stage_move", "Interview", "2026-10-02"], ["stage_move", "To review", "2026-10-04"], ["stage_move", "Interview", "2026-10-06"]] }]);
    const a = audit(d);
    expect([a.Interview.reached, a.Interview.entries, a.Interview.completed, a.Interview.ongoing]).toEqual([1, 2, 1, 1]);
  });
  it("a Revenue Optics move is not the client team's: the To review stay it ends is not a client decision", () => {
    const d = data([{ id: "a", events: [["stage_move", "Interview", "2026-10-03", "revenue_optics"]] }, { id: "b", events: [["stage_move", "Interview", "2026-10-03"]] }]);
    expect(model(d).time.find((t) => t.s === "Submitted")).toMatchObject({ n: 2, byYou: 1 });
  });
});

describe("declines", () => {
  const d = data([
    { id: "a", events: [["decline", "Declined", "2026-10-04"]] },
    { id: "b", events: [["stage_move", "Interview", "2026-10-03"], ["decline", "Declined", "2026-10-06"]] },
    { id: "c", events: [["stage_move", "Declined", "2026-10-05", "revenue_optics"]] },
    { id: "d" },
  ]);
  it("end the open stay, are not in stage now, and are credited to whoever recorded them", () => {
    const M = model(d);
    expect(M.now.slice(2)).toEqual([1, 0, 0, 0]);
    expect(M.closed).toEqual({ dec: 3, decBy: { you: 2, ro: 1 }, np: null });
    expect(audit(d).Interview).toMatchObject({ completed: 1, ongoing: 0 });
  });
  it("are described as the client team's or Revenue Optics', never as the signed-in user's", () => {
    const h = html(d);
    expect(h.pipeline).toContain("Not shown: 3 declined (2 by your team, 1 by Revenue Optics).");
    expect(h.roles).toContain("Also not shown: 3 declined.");
    for (const s of Object.values(h)) expect(s).not.toMatch(/declined by you|your decision|Revenue Optics, you and/);
    expect(h.time).toContain("ended with a decision by your team");
  });
});

describe("feedback is not a stage move", () => {
  it("general and interview feedback entries change no stay, count or move", () => {
    const base = data([{ id: "a", events: [["stage_move", "Interview", "2026-10-03"]], rounds: [{ status: "held", heldOn: "2026-10-05" }] }]);
    const withFeedback = data([{ id: "a", events: [["stage_move", "Interview", "2026-10-03"], ["feedback", "Interview", "2026-10-06"], ["feedback", "Interview", "2026-10-07"]], rounds: [{ status: "held", heldOn: "2026-10-05" }] }]);
    expect(withFeedback.moves).toEqual(base.moves);
    expect(model(withFeedback)).toEqual(model(base));
    expect(stageAudit(withFeedback, "all", TODAY)).toEqual(stageAudit(base, "all", TODAY));
    expect(withFeedback.held).toEqual([{ sid: "a", d: "2026-10-05" }]);
  });
  it("an interview held is not a move either (it only counts in Weekly)", () => {
    const d = data([{ id: "a", events: [["stage_move", "Interview", "2026-10-03"]], rounds: [{ status: "held", heldOn: "2026-10-05" }, { status: "cancelled" }] }]);
    expect(d.moves).toHaveLength(1);
    expect(d.subs[0].client.status).toBe("none");                 // the current round is cancelled: not scheduled
    expect(weeklyCounts(d, "all", weeksBefore(TODAY)).map((w) => w.held)).toEqual([0, 0, 0, 0, 0, 1]);
  });
});

describe("Sourced, Screened and not progressed: Not available, never 0", () => {
  const d = data([{ id: "a" }, { id: "b", events: [["stage_move", "Interview", "2026-10-03"]] }]);
  it("the model has null for them, and no search stays", () => {
    const M = model(d);
    expect(M.reached).toEqual([null, null, 2, 1, 0, 0]);
    expect(M.now).toEqual([null, null, 1, 1, 0, 0]);
    expect(M.closed.np).toBeNull();
    expect(M.time.filter((t) => !t.available).map((t) => t.s)).toEqual(["Sourced", "Screened"]);
    expect(M.time.slice(0, 2).map((t) => [t.n, t.open])).toEqual([[0, 0], [0, 0]]);
    expect(audit(d).Sourced).toMatchObject({ reached: null, now: null, skipped: 0 });
  });
  it("the charts and their tables say Not available and give no number for them", () => {
    const h = html(d);
    expect(h.pipeline).toContain('aria-label="Sourced not available, Screened not available, Submitted 2');
    expect(h.pipeline).toContain("<tr><td class=\"\">Sourced</td><td class=\"n\">Not available</td><td class=\"n\">Not available</td></tr>");
    expect(h.pipeline).toContain("Not progressed before sharing: not available.");
    expect(h.pipeline).toContain("search records are not connected to the portal");
    expect(h.time).toContain('aria-label="Sourced: not available"');
    expect(h.time).toContain("<tr><td class=\"\">Screened</td><td class=\"n\">Not available</td><td class=\"n\">Not available</td><td class=\"n\">Not available</td><td class=\"n\">Not available</td></tr>");
    expect(h.pipeline + h.time).not.toMatch(/Sourced<\/td><td class="n">0|Screened<\/td><td class="n">0/);
  });
  it("say which candidates are included: currently shared only", () => {
    const h = html(d);
    for (const s of [h.pipeline, h.time, h.weekly]) expect(s).toContain("Candidates that are withdrawn or no longer shared are not included");
  });
});

describe("Time in stage when every completed stay took 0 days", () => {
  it("same-day stays: '0 days' and the stay count are shown with a finite bar width, not 'No completed stays'", () => {
    const d = data([
      { id: "a", shared: "2026-10-05", events: [["stage_move", "Interview", "2026-10-05"], ["stage_move", "Offer", "2026-10-05"]] },
      { id: "b", shared: "2026-10-06", events: [["decline", "Declined", "2026-10-06"]] },
    ]);
    expect(model(d).time.slice(2).map((t) => [t.avg, t.n])).toEqual([[0, 2], [0, 1], [null, 0]]);
    const h = html(d).time;
    expect(h).not.toContain("No completed stays yet for this selection.");
    expect(h).not.toContain("NaN");
    expect(h).toContain('aria-label="To review: 0 days, 2 completed stays"');
    expect(h).toContain('<span class="tsa-v">0 days</span>');
    expect(h).toContain("2 stays");
    expect(h).toMatch(/class="tsa-bar" style="width:0%/);
  });
});

describe("role filters", () => {
  const d = data([
    { id: "a", role: "r1", events: [["stage_move", "Interview", "2026-10-03"]] },
    { id: "b", role: "r2", shared: "2026-09-21", events: [["stage_move", "Interview", "2026-09-28"]] },
    { id: "c", role: "r3", shared: "2026-09-14", events: [["stage_move", "Hired", "2026-09-30", "revenue_optics"]] },
  ]);
  it("Pipeline, Time and Weekly include on-hold and closed roles; one role selects only its candidates", () => {
    expect(model(d).reached[2]).toBe(3);
    expect(model(d, "r1").reached.slice(2)).toEqual([1, 1, 0, 0]);
    expect(model(d, "r3").reached.slice(2)).toEqual([1, 1, 1, 1]);
    expect(weeklyCounts(d, "all", weeksBefore(TODAY)).map((w) => w.shared)).toEqual([0, 0, 1, 1, 1, 0]);
    expect(weeklyCounts(d, "r2", weeksBefore(TODAY)).map((w) => w.shared)).toEqual([0, 0, 0, 1, 0, 0]);
  });
  it("Candidates by role: open roles; on-hold only when included; closed never, and named as closed", () => {
    expect(roleRows(d, "all", false, "az").map((r) => r.role.id)).toEqual(["r1"]);
    expect(roleRows(d, "all", true, "az").map((r) => r.role.id)).toEqual(["r1", "r2"]);
    expect(hiddenRoles(d, "all", true).map((r) => r.id)).toEqual(["r3"]);
    expect(html(d, "all", true).roles).toContain("Not shown now: Role r3 (closed).");
    expect(html(d, "r3", true).roles).toContain("Role r3 is closed. Closed roles are not shown in this chart.");
    expect(html(d, "r2").roles).toContain("Role r2 is on hold. Tick &quot;Include on-hold roles&quot; to show it.");
    expect(html(d, "r3").pipeline).toContain("Role r3 (closed now)");
    expect(html(d).pipeline).toContain("every role, including roles that are on hold or closed now");
  });
});

describe("rolling UTC weeks from the supplied date", () => {
  it("at the demo date they are the demo's fixed weeks", () => {
    expect(weeksBefore(TODAY)).toEqual(WEEKS);
  });
  it("later dates: the 6 full Monday–Sunday weeks before the current week, on any weekday", () => {
    expect(weeksBefore("2026-11-04")[0]).toEqual(["2026-09-21", "2026-09-27"]);   // Wednesday
    expect(weeksBefore("2026-11-04")[5]).toEqual(["2026-10-26", "2026-11-01"]);
    expect(weeksBefore("2026-11-01")[5]).toEqual(["2026-10-19", "2026-10-25"]);   // Sunday: its own week is not full yet
    expect(weeksBefore("2026-11-02")[5]).toEqual(["2026-10-26", "2026-11-01"]);   // Monday
  });
  it("counts move with the weeks; activity before the window drops out and is not shown as a gap", () => {
    const d = data([{ id: "a", shared: "2026-09-02" }, { id: "b", shared: "2026-10-27", events: [["stage_move", "Interview", "2026-10-28"]], rounds: [{ status: "held", heldOn: "2026-10-30" }] }]);
    expect(weeklyCounts(d, "all", weeksBefore("2026-11-04")).map((w) => [w.shared, w.held])).toEqual([[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [1, 1]]);
    expect(weeklyCounts(d, "all", weeksBefore(TODAY)).map((w) => w.shared)).toEqual([1, 0, 0, 0, 0, 0]);
  });
  it("Weekly in Supabase mode is recorded activity: a 0 is not proof that nothing happened", () => {
    const h = html(data([{ id: "a", shared: "2026-10-05" }]));
    expect(h.weekly).toContain("Activity recorded in the portal. Each week, Monday to Sunday (UTC).");
    expect(h.weekly).toContain("which does not prove that no recruiting activity happened");
    expect(h.weekly).not.toContain("No records");
    const empty = html(data([]));
    expect(empty.weekly).toContain("No submissions or interviews held were recorded in the portal in these 6 weeks.");
  });
});

describe("nothing is filled in", () => {
  it("without milestone 4 there are no report rows (not connected)", () => {
    expect(reportData(ws([{ id: "a" }], { steps: false }))).toBeNull();
  });
  it("a history that does not add up is an error, not a guess", () => {
    const broken = (f: (w: Workspace) => void) => { const w = ws([{ id: "a", events: [["stage_move", "Interview", "2026-10-03"]] }]); f(w); return () => reportData(w); };
    expect(broken((w) => w.events.splice(1, 1))).toThrow(ReportDataError);                                  // a missing entry
    expect(broken((w) => { w.subs[0].sharedOn = "2026-09-30"; })).toThrow(/share on the shared date/);
    expect(broken((w) => { w.events[1].occurredOn = "2026-09-30"; })).toThrow(/back in time/);
    expect(broken((w) => { w.subs[0].stage = "Offer"; })).toThrow(/current stage/);
    expect(broken((w) => { w.steps!.interviews.set("a", [{ id: "x", submissionId: "a", round: 1, status: "held", requestedOn: null, suggestedTimes: null, scheduledOn: null, timeText: null,
      interviewers: null, heldOn: null, feedbackRecordedOn: null, asOfVersion: 1 }]); })).toThrow(/held interview has no date/);
  });
});
