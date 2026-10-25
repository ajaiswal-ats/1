/* The shared next-step derivation (next.ts): every rule, and the cases that dates or stage labels alone would get wrong. */
import { describe, expect, it } from "vitest";
import type { RoleStatus, Stage } from "../data/fixtures";
import type { DbEvent, DbInterview, DbNote, DbOutcome, DbPackage, DbSubmission, Workspace } from "./data";
import { canGiveFeedback } from "./moves";
import { AWAITING_SUMMARY, NOT_RECORDED, NO_INTERVIEW, deriveNext, feedbackTask, interviewLabel, offerStatus, ordered, requirementLine, waitingCount, waitingOnYou } from "./next";

const TODAY = "2026-10-12";
interface Spec {
  stage?: Stage; role?: RoleStatus; version?: number; events?: Partial<DbEvent>[]; pkg?: boolean | Partial<DbPackage>;
  rounds?: Partial<DbInterview>[]; outcomes?: Partial<DbOutcome>[]; links?: [number, string][]; notes?: Partial<DbNote>[]; steps?: boolean;
}
/* One submission "s1" on role "r1"; events default to "shared" at version 1. */
function ws(x: Spec = {}): { ws: Workspace; s: DbSubmission } {
  const evs: DbEvent[] = (x.events ?? [{}]).map((e, i) => ({ id: i + 1, submissionId: "s1", version: i + 1, kind: i === 0 ? "shared" : "stage_move", toStage: "To review",
    occurredOn: "2026-10-01", actorKind: i === 0 ? "revenue_optics" : "client", actorMemberId: null, ...e }));
  const s: DbSubmission = { id: "s1", roleId: "r1", personId: "p1", stage: x.stage ?? "To review", sharedOn: "2026-10-01", version: x.version ?? evs.length };
  const rounds: DbInterview[] = (x.rounds ?? []).map((r, i) => ({ id: `i${i + 1}`, submissionId: "s1", round: i + 1, status: "requested", requestedOn: null, suggestedTimes: null,
    scheduledOn: null, timeText: null, interviewers: null, heldOn: null, feedbackRecordedOn: null, asOfVersion: s.version, ...r }));
  const notes: DbNote[] = (x.notes ?? []).map((n, i) => ({ id: `n${i + 1}`, submissionId: "s1", eventId: 0, kind: "feedback", about: null, text: "x", category: null, authorMemberId: "m1", createdAt: "", ...n }));
  const pkg: DbPackage | null = x.pkg === false ? null : { id: "k1", submissionId: "s1", version: 1, setId: "set1", whyShared: "Why.", strengths: [], pointsToClarify: [], keyFacts: [],
    evidence: new Map([["q1", { requirementId: "q1", status: "supported", evidence: "e", source: "Resume" }], ["q2", { requirementId: "q2", status: "partly_supported", evidence: "e", source: "Resume" }]]),
    ...(typeof x.pkg === "object" ? x.pkg : {}) };
  return {
    s,
    ws: {
      clientId: "c1", screening: null, roles: [{ id: "r1", title: "Role", location: "", status: x.role ?? "Open", openedOn: "2026-09-01", recruiterName: "" }],
      people: new Map([["p1", { id: "p1", name: "Pat Example", headline: "", location: "" }]]), subs: [s], moves: [], events: evs, notes,
      content: { roleInfo: new Map(), sets: new Map([["r1", { id: "set1", roleId: "r1", version: 1, label: "Version 1", agreedOn: "2026-09-01",
        requirements: [{ id: "q1", position: 1, text: "A", tier: "must" }, { id: "q2", position: 2, text: "B", tier: "must" }] }]]), packages: new Map(pkg ? [["s1", pkg]] : []) },
      steps: x.steps === false ? null : { interviews: new Map(rounds.length ? [["s1", rounds]] : []), outcomes: new Map(x.outcomes?.length ? [["s1", x.outcomes.map((o) => ({ submissionId: "s1", status: "offer_made", recordedOn: "2026-10-05", asOfVersion: s.version, ...o } as DbOutcome))]] : []),
        feedbackLinks: new Map((x.links ?? []).map(([r, n]) => [`i${r}`, n])) },
    },
  };
}
const next = (x: Spec) => { const w = ws(x); return deriveNext(w.ws, w.s, TODAY); };
const label = (x: Spec) => { const w = ws(x); return interviewLabel(w.ws, w.s)?.[1]; };
const AT_INTERVIEW = { stage: "Interview" as Stage, events: [{}, { toStage: "Interview" as Stage, occurredOn: "2026-10-02" }] };

describe("review", () => {
  it("open role, a shared summary: a task on you, from when it entered To review", () => {
    expect(next({})).toMatchObject({ who: "you", kind: "review", since: "2026-10-01", short: "Your review · 11 days" });
  });
  it("no shared summary (missing, withdrawn, paused or on superseded requirements): awaiting it, not a task", () => {
    expect(next({ pkg: false })).toMatchObject({ who: "ro", kind: "awaiting-summary", short: AWAITING_SUMMARY });
  });
  it("on hold or closed: no review actions are available, so no task, and nothing is made up", () => {
    expect(next({ role: "On hold" })).toMatchObject({ who: "ro", short: NOT_RECORDED });
    expect(next({ role: "Closed" })).toMatchObject({ who: "ro", short: NOT_RECORDED });
  });
});

describe("interview feedback: linked to its round only", () => {
  const held = { ...AT_INTERVIEW, rounds: [{ status: "held" as const, heldOn: "2026-10-06" }] };
  it("a held round without feedback: a task on you (open and on-hold roles), labelled feedback due", () => {
    expect(next(held)).toMatchObject({ who: "you", kind: "feedback", since: "2026-10-06" });
    expect(next({ ...held, role: "On hold" })).toMatchObject({ who: "you", kind: "feedback" });
    expect(label(held)).toBe("Interview held · feedback due");
  });
  it("no task where the controls do not allow feedback (closed role; stage To review): never a task the user cannot do", () => {
    for (const x of [{ ...held, role: "Closed" as RoleStatus }, { ...held, stage: "To review" as Stage, events: [{}] }]) {
      const w = ws(x);
      expect(canGiveFeedback(w.s, w.ws.roles[0])).toBe(false);
      expect(feedbackTask(w.ws, w.s)).toBeNull();
      expect(deriveNext(w.ws, w.s, TODAY)).toMatchObject({ who: "ro", short: NOT_RECORDED });
      expect(interviewLabel(w.ws, w.s)![1]).toBe("Interview held");
    }
  });
  it("general feedback (not linked) after the interview stays a note: the round is still due", () => {
    const x = { ...held, events: [...held.events, { kind: "feedback" as const, toStage: "Interview" as Stage, occurredOn: "2026-10-07", actorMemberId: "m1" }], version: 3, notes: [{ eventId: 3 }] };
    expect(next(x)).toMatchObject({ who: "you", kind: "feedback" });
  });
  it("feedback linked to the round completes it; Revenue Optics follows up", () => {
    const x = { ...held, events: [...held.events, { kind: "feedback" as const, toStage: "Interview" as Stage, occurredOn: "2026-10-07", actorMemberId: "m1" }], version: 3,
      notes: [{ eventId: 3 }], links: [[1, "n1"]] as [number, string][], rounds: [{ status: "held" as const, heldOn: "2026-10-06", asOfVersion: 2 }] };
    expect(next(x)).toMatchObject({ who: "ro", kind: "followup", sub: "Feedback shared 7 Oct" });
    expect(label(x)).toBe("Interview held · feedback given");
  });
  it("feedback recorded on the round by Revenue Optics completes it too", () => {
    expect(next({ ...held, rounds: [{ status: "held", heldOn: "2026-10-06", feedbackRecordedOn: "2026-10-08" }] })).toMatchObject({ kind: "followup", sub: "Feedback shared 8 Oct" });
  });
});

describe("rounds and cancellation", () => {
  it("a newer requested round is current: arranging, and the older round's missing feedback is not a task", () => {
    const x = { ...AT_INTERVIEW, rounds: [{ status: "held" as const, heldOn: "2026-10-03" }, { status: "requested" as const, requestedOn: "2026-10-05", suggestedTimes: "Tue morning" }] };
    expect(next(x)).toMatchObject({ who: "ro", kind: "scheduling", sub: "You suggested: Tue morning" });
    expect(label(x)).toBe("Interview requested");
  });
  it("a cancelled newer round does not reactivate the older round's feedback", () => {
    const x = { ...AT_INTERVIEW, rounds: [{ status: "held" as const, heldOn: "2026-10-03" }, { status: "cancelled" as const, requestedOn: "2026-10-05" }] };
    const w = ws(x);
    expect(feedbackTask(w.ws, w.s)).toBeNull();
    expect(deriveNext(w.ws, w.s, TODAY)).toMatchObject({ who: "ro", short: NOT_RECORDED });
    expect(interviewLabel(w.ws, w.s)![1]).toBe("Interview cancelled");
  });
  it("a held round 2 is the task, even if round 1 has linked feedback", () => {
    const x = { ...AT_INTERVIEW, rounds: [{ status: "held" as const, heldOn: "2026-10-03" }, { status: "held" as const, heldOn: "2026-10-09" }], links: [[1, "n1"]] as [number, string][],
      events: [...AT_INTERVIEW.events, { kind: "feedback" as const, toStage: "Interview" as Stage, actorMemberId: "m1" }], version: 3, notes: [{ eventId: 3 }] };
    const w = ws(x);
    expect(feedbackTask(w.ws, w.s)?.id).toBe("i2");
    expect(deriveNext(w.ws, w.s, TODAY)).toMatchObject({ who: "you", kind: "feedback", since: "2026-10-09" });
  });
});

describe("the stage is not an interview", () => {
  it("at Interview with no recorded round: no interview, and the next step is not recorded", () => {
    expect(label(AT_INTERVIEW)).toBe(NO_INTERVIEW);
    expect(next({ ...AT_INTERVIEW, events: [{}, { toStage: "Interview" as Stage, actorKind: "revenue_optics" as const }] })).toMatchObject({ who: "ro", short: NOT_RECORDED });
  });
  it("a scheduled date in the past is still scheduled, never taken as held", () => {
    const x = { ...AT_INTERVIEW, rounds: [{ status: "scheduled" as const, scheduledOn: "2026-10-05", timeText: "10:00 CT", interviewers: "Maria" }] };
    expect(next(x)).toMatchObject({ who: "none", kind: "scheduled", long: "Interview Mon 5 Oct, 10:00 CT", sub: "With Maria" });
    expect(label(x)).toBe("Interview Mon 5 Oct");
  });
});

describe("ordering between facts and client changes uses versions, not dates", () => {
  const sameDay = "2026-10-06";
  it("a client move recorded after the interview request (higher version, same day) is the latest: recruiter to follow up", () => {
    const x = { stage: "Interview" as Stage, events: [{}, { toStage: "Interview" as Stage, occurredOn: sameDay }], rounds: [{ status: "requested" as const, requestedOn: sameDay, asOfVersion: 1 }] };
    expect(next(x)).toMatchObject({ kind: "moved", short: "Recruiter to follow up" });
  });
  it("the same day, the request recorded after the move (as of version 2): Revenue Optics arranging", () => {
    const x = { stage: "Interview" as Stage, events: [{}, { toStage: "Interview" as Stage, occurredOn: sameDay }], rounds: [{ status: "requested" as const, requestedOn: sameDay, asOfVersion: 2 }] };
    expect(next(x)).toMatchObject({ kind: "scheduling" });
  });
  it("a Revenue Optics stage change after the client's move is the latest change: the client's move no longer counts", () => {
    expect(next({ stage: "Offer", events: [{}, { toStage: "Interview" }, { toStage: "Offer", actorKind: "revenue_optics" }], outcomes: [{ status: "offer_made", asOfVersion: 1 }] }))
      .toMatchObject({ kind: "offer" });
  });
  it("a Revenue Optics stage change is not a client move", () => {
    expect(next({ stage: "Interview", events: [{}, { toStage: "Interview", actorKind: "revenue_optics" }] })).toMatchObject({ short: NOT_RECORDED });
  });
});

describe("offer outcomes are separate from the stage", () => {
  it("Offer with an offer recorded; Offer without one; a client move to Offer after the outcome", () => {
    expect(next({ stage: "Offer", outcomes: [{ status: "offer_made", recordedOn: "2026-10-05" }] })).toMatchObject({ kind: "offer", sub: "Recorded 5 Oct · Revenue Optics is following up" });
    expect(next({ stage: "Offer" })).toMatchObject({ kind: "moved-outcome", short: "Offer stage saved · status not recorded" });
    expect(next({ stage: "Offer", events: [{}, { toStage: "Interview" }, { toStage: "Offer" }], outcomes: [{ status: "offer_made", asOfVersion: 2 }] })).toMatchObject({ kind: "moved-outcome" });
  });
  it("Hired: accepted (with the summary's start date) or not recorded; the offer status line", () => {
    const w = ws({ stage: "Hired", outcomes: [{ status: "offer_accepted", recordedOn: "2026-09-28" }], pkg: { keyFacts: [{ label: "Start date", value: "2 Nov 2026" }] } });
    expect(deriveNext(w.ws, w.s, TODAY)).toMatchObject({ who: "none", kind: "hired", cls: "done", sub: "Recorded 28 Sep · starts 2 Nov 2026" });
    expect(offerStatus(w.ws, w.s)).toBe("Offer accepted · recorded by Revenue Optics 28 Sep");
    const v = ws({ stage: "Hired" });
    expect(deriveNext(v.ws, v.s, TODAY)).toMatchObject({ kind: "moved-outcome" });
    expect(offerStatus(v.ws, v.s)).toBe("Not recorded yet");
  });
  it("feedback due at Offer is a task, before the missing outcome", () => {
    expect(next({ stage: "Offer", rounds: [{ status: "held", heldOn: "2026-10-06" }] })).toMatchObject({ who: "you", kind: "feedback" });
  });
  it("a client move after the round was recorded held does not hide its feedback task (to Offer, or to Interview)", () => {
    const heldAt2 = [{ status: "held" as const, heldOn: "2026-10-06", asOfVersion: 2 }];
    const toOffer = { stage: "Offer" as Stage, events: [{}, { toStage: "Interview" as Stage }, { toStage: "Offer" as Stage, occurredOn: "2026-10-08" }], rounds: heldAt2 };
    expect(next(toOffer)).toMatchObject({ who: "you", kind: "feedback", since: "2026-10-06" });
    expect(label(toOffer)).toBe("Interview held · feedback due");
    const w = ws(toOffer);
    expect([waitingOnYou(w.ws, w.s, TODAY), waitingCount(w.ws, [w.s], TODAY), feedbackTask(w.ws, w.s)?.id]).toEqual([true, 1, "i1"]);
    const toInterview = { stage: "Interview" as Stage, events: [{}, { toStage: "Offer" as Stage, actorKind: "revenue_optics" as const }, { toStage: "Interview" as Stage }], rounds: heldAt2 };
    expect(next(toInterview)).toMatchObject({ who: "you", kind: "feedback" });
    /* Once that round's feedback is complete, the newer client move is the latest thing again. */
    expect(next({ ...toOffer, rounds: [{ ...heldAt2[0], feedbackRecordedOn: "2026-10-07" }] })).toMatchObject({ kind: "moved-outcome", since: "2026-10-08" });
  });
  it("Declined: closed", () => {
    expect(next({ stage: "Declined", events: [{}, { toStage: "Declined", kind: "decline" }] })).toMatchObject({ who: "none", kind: "closed" });
  });
});

describe("one derivation for counts, filters, ordering and requirement support", () => {
  it("without milestone 4 nothing is derived (shown as not connected)", () => {
    const w = ws({ steps: false });
    expect(deriveNext(w.ws, w.s, TODAY)).toBeNull();
    expect(interviewLabel(w.ws, w.s)).toBeNull();
  });
  it("waiting first, then the longest waiting; the count is the same function", () => {
    const base = ws({});
    const subs: DbSubmission[] = [
      { ...base.s, id: "a", sharedOn: "2026-10-10" }, { ...base.s, id: "b", stage: "Declined" }, { ...base.s, id: "c", sharedOn: "2026-10-02" },
    ];
    const w: Workspace = { ...base.ws, subs, events: subs.map((s, i) => ({ ...base.ws.events[0], id: i + 1, submissionId: s.id, occurredOn: s.sharedOn, toStage: s.stage })),
      content: { ...base.ws.content!, packages: new Map(subs.map((s) => [s.id, { ...base.ws.content!.packages.get("s1")!, submissionId: s.id }])) } };
    expect(ordered(w, subs, TODAY).map((s) => s.id)).toEqual(["c", "a", "b"]);
    expect(waitingCount(w, subs, TODAY)).toBe(subs.filter((s) => waitingOnYou(w, s, TODAY)).length);
    expect(waitingCount(w, subs, TODAY)).toBe(2);
  });
  it("requirement support counts supported must-haves only; no shared summary gives none", () => {
    const w = ws({});
    expect(requirementLine(w.ws, w.s)).toBe("1 of 2 must-haves supported");
    const v = ws({ pkg: false });
    expect(requirementLine(v.ws, v.s)).toBeNull();
  });
});
