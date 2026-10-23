/* Client actions on a submission (2h submitForm and actions): outcomes, validation, permissions, isolation between
   the same person's submissions, replay of saved actions, and agreement with the reports afterwards. */
import { describe, expect, it } from "vitest";
import { FIXTURE, TODAY, type Dataset } from "../data/fixtures";
import { pipelineModel, roleRows, sharedStays, stageAudit } from "../reporting/metrics";
import { applyAction, isPermitted, permitted, replay, savedHeading, savedToast, validationError, type DemoAction } from "./actions";
import { STAGES, candidateList, countByStage, forRole, nextStep, waitingOnYou } from "./candidates";

const fresh = (): Dataset => structuredClone(FIXTURE);
const sub = (d: Dataset, id: string) => d.subs.find((s) => s.id === id)!;
const run = (...actions: DemoAction[]) => replay(FIXTURE, actions).data;
const move = (sid: string, to: "To review" | "Interview" | "Offer" | "Hired", extra: Partial<DemoAction> = {}): DemoAction => ({ type: "move", sid, to, note: "", d: TODAY, ...extra } as DemoAction);
const decline = (sid: string, text = "Needs more team leadership.", cat = "Experience not aligned"): DemoAction => ({ type: "decline", sid, text, cat, d: TODAY });
const feedback = (sid: string, text = "Strong on coaching.", about = "Interview on 6 Oct"): DemoAction => ({ type: "feedback", sid, about, text, d: TODAY });

describe("outcomes", () => {
  it("Move to Interview with suggested times: an interview request (not a booking), waiting on Revenue Optics", () => {
    const d = run(move("tb-isl", "Interview", { times: "Tue afternoon" } as Partial<DemoAction>)), c = sub(d, "tb-isl");
    expect([c.stage, c.client, c.next]).toEqual(["Interview", { status: "requested", date: TODAY, slots: "Tue afternoon" }, { who: "ro", kind: "scheduling", since: TODAY }]);
    expect(nextStep(c, TODAY).short).toBe("Revenue Optics arranging");
    expect(d.hist["tb-isl"]).toEqual([["2026-10-09", "Revenue Optics shared Taylor for this role"], [TODAY, "You moved Taylor to Interview"]]);
    expect(d.moves.at(-1)).toEqual({ sid: "tb-isl", to: "Interview", d: TODAY, by: "you" });
  });
  it("without times the request says 'No times suggested'; a note is kept as a client note", () => {
    const d = run(move("pr-isl", "Interview", { note: " Ask about coaching. " } as Partial<DemoAction>));
    expect(sub(d, "pr-isl").client.slots).toBe("No times suggested");
    expect(d.notes["pr-isl"]).toEqual([{ kind: "Note with stage move", text: "Ask about coaching.", d: TODAY }]);
  });
  it("Offer or Hired saves the stage only: the recorded offer status is cleared and shown as not recorded", () => {
    const c = sub(run(move("ab-fsr", "Hired")), "ab-fsr");
    expect([c.stage, c.outcome, c.next.kind]).toEqual(["Hired", null, "moved-outcome"]);
    expect(nextStep(c, TODAY).short).toBe("Hired stage saved · status not recorded");
  });
  it("Decline keeps the trimmed note and category, ends the submission and records the move", () => {
    const d = run(decline("en-pa", "  Not enough pricing depth.  ", "Key skills gap")), c = sub(d, "en-pa");
    expect([c.stage, c.declineNote, c.next]).toEqual(["Declined", { text: "Not enough pricing depth.", cat: "Key skills gap", date: TODAY }, { who: "none", kind: "closed" }]);
    expect(d.moves.at(-1)).toEqual({ sid: "en-pa", to: "Declined", d: TODAY, by: "you" });
  });
  it("Feedback after a held interview: note saved, stage unchanged, now with Revenue Optics; history appended to the seeded history", () => {
    const d = run(feedback("tb-rsm")), c = sub(d, "tb-rsm");
    expect([c.stage, c.client.status, c.next]).toEqual(["Interview", "feedback", { who: "ro", kind: "followup", since: TODAY }]);
    expect(d.notes["tb-rsm"]).toEqual([{ kind: "Interview feedback", about: "Interview on 6 Oct", text: "Strong on coaching.", d: TODAY }]);
    expect(d.hist["tb-rsm"].at(-1)).toEqual([TODAY, "You shared interview feedback"]);
    expect(d.hist["tb-rsm"]).toHaveLength(4);
    expect(d.moves).toHaveLength(FIXTURE.moves.length);
  });
  it("feedback on a scheduled interview is saved but does not change the interview status", () => {
    expect(sub(run(feedback("je-isl")), "je-isl").client.status).toBe("scheduled");
  });
  it("panel heading and toast for each action never say anything was sent", () => {
    const all = [move("x", "Interview"), move("x", "Offer"), move("x", "Hired"), decline("x"), feedback("x")];
    expect(all.map(savedHeading)).toEqual(["Interview stage saved", "Offer stage saved", "Hired stage saved", "Declined", "Feedback saved"]);
    for (const a of all) expect(savedToast(a)).not.toMatch(/email|invit|notified|sent to/i);
    expect(all.filter((a) => a.type !== "feedback").every((a) => savedToast(a).includes("nothing was sent"))).toBe(true);
  });
});

describe("validation", () => {
  it("decline and feedback need a note; moves do not", () => {
    expect(validationError(decline("tb-isl", "   "))).toBe("Add a short note so the recruiter knows why.");
    expect(validationError(feedback("tb-rsm", ""))).toBe("Add your feedback before sharing.");
    expect(validationError(move("tb-isl", "Offer"))).toBeNull();
  });
  it("a rejected action changes nothing", () => {
    expect(run(decline("tb-isl", " "))).toEqual(FIXTURE);
  });
});

describe("permissions (2h actions panel)", () => {
  const d = fresh(), p = (id: string) => permitted(d, sub(d, id));
  it("To review on an open role: Interview, Offer, Hired and Decline", () => {
    expect(p("tb-isl")).toEqual({ moveTo: ["Interview", "Offer", "Hired"], decline: true, feedback: false });
  });
  it("Interview: back to To review, Offer or Hired, Decline, and feedback once an interview is scheduled or held", () => {
    expect(p("je-isl")).toEqual({ moveTo: ["To review", "Offer", "Hired"], decline: true, feedback: true });
    expect(p("so-pa").feedback).toBe(false);
  });
  it("Offer: Decline only; Hired and Declined: nothing", () => {
    expect(permitted(run(move("ab-fsr", "Offer")), sub(run(move("ab-fsr", "Offer")), "ab-fsr"))).toEqual({ moveTo: [], decline: true, feedback: false });
    expect(p("do-rsm")).toEqual({ moveTo: [], decline: false, feedback: false });
    expect(p("mw-isl")).toEqual({ moveTo: [], decline: false, feedback: false });
  });
  it("on-hold role: stage moves and declines paused; feedback after a held interview still allowed", () => {
    expect(p("tb-rsm")).toEqual({ moveTo: [], decline: false, feedback: true });
    expect(isPermitted(d, move("tb-rsm", "Offer"))).toBe(false);
    expect(isPermitted(d, decline("cm-rsm"))).toBe(false);
  });
  it("unknown submissions are never permitted", () => {
    expect(isPermitted(d, move("nope", "Offer"))).toBe(false);
  });
});

describe("cross-role isolation", () => {
  it("declining Taylor for Inside Sales Leader leaves Taylor's Regional Sales Manager submission untouched", () => {
    const d = run(decline("tb-isl"));
    expect(sub(d, "tb-rsm")).toEqual(sub(FIXTURE, "tb-rsm"));
    expect(d.notes["tb-rsm"]).toBeUndefined();
    expect(d.hist["tb-rsm"]).toEqual(FIXTURE.hist["tb-rsm"]);
    expect(d.moves.filter((m) => m.sid === "tb-rsm")).toEqual(FIXTURE.moves.filter((m) => m.sid === "tb-rsm"));
  });
  it("feedback on Taylor's Regional Sales Manager interview does not touch the Inside Sales Leader submission", () => {
    const d = run(feedback("tb-rsm"));
    expect(sub(d, "tb-isl")).toEqual(sub(FIXTURE, "tb-isl"));
    expect(d.notes["tb-isl"]).toBeUndefined();
    expect(d.hist["tb-isl"]).toBeUndefined();
  });
});

describe("saved actions (reload persistence)", () => {
  const log = [move("tb-isl", "Interview"), feedback("tb-rsm"), decline("en-pa"), move("pr-isl", "Hired")];
  it("replaying the saved log rebuilds the same data every time, and never changes the base fixtures", () => {
    const before = JSON.stringify(FIXTURE);
    const a = replay(FIXTURE, log), b = replay(FIXTURE, JSON.parse(JSON.stringify(log)));
    expect(a.data).toEqual(b.data);
    expect(a.applied).toEqual(log);
    expect(JSON.stringify(FIXTURE)).toBe(before);
  });
  it("replay gives the same result as applying the actions one by one", () => {
    const d = fresh(); log.forEach((x) => applyAction(d, x));
    expect(replay(FIXTURE, log).data).toEqual(d);
  });
  it("saved actions that are no longer permitted, unknown or incomplete are skipped", () => {
    const r = replay(FIXTURE, [decline("en-pa"), move("en-pa", "Offer"), move("ghost", "Offer"), feedback("tb-rsm", "  "), move("ab-fsr", "Offer")]);
    expect(r.applied).toEqual([decline("en-pa"), move("ab-fsr", "Offer")]);
    expect(sub(r.data, "en-pa").stage).toBe("Declined");
  });
});

describe("agreement with the sidebar, Candidates and Hiring progress after changes", () => {
  const d = run(move("tb-isl", "Interview"), decline("en-pa"), move("ab-fsr", "Offer"), feedback("tb-rsm"), move("je-isl", "To review"));
  it("waiting on you drops from 5 to 1 and the Candidates filter agrees", () => {
    expect(d.subs.filter(waitingOnYou).map((c) => c.id)).toEqual(["pr-isl"]);
    expect(candidateList(d, "all", "you", TODAY).map((c) => c.id)).toEqual(["pr-isl"]);
  });
  it("board stage counts equal Pipeline 'In stage now' for every role; role chart totals match", () => {
    for (const r of ["all", ...d.roles.map((x) => x.id)]) {
      const M = pipelineModel(d, r, TODAY), l = forRole(d, r);
      expect(countByStage(l, STAGES), r).toEqual(M.now.slice(2));
      expect(countByStage(l, ["Declined"])[0], r).toBe(M.closed.dec);
    }
    for (const row of roleRows(d, "all", true, "az")) expect(row.total + row.dec).toBe(forRole(d, row.role.id).length);
  });
  it("stage history follows the reporting rules: skipped stages count as reached, moves back start a new stay", () => {
    const a = Object.fromEntries(stageAudit(d, "all", TODAY).map((x) => [x.stage, x]));
    expect(a.Interview.skipped).toBe(1); /* ab-fsr went To review → Offer */
    expect(sharedStays(d, "je-isl", "2026-09-24").map((t) => [t.stage, t.end])).toEqual([["Submitted", "2026-09-29"], ["Interview", TODAY], ["Submitted", null]]);
    for (const x of Object.values(a)) {
      expect(x.ongoing).toBe(x.now);
      expect(x.entered + x.skipped).toBe(x.reached);
    }
  });
});
