/* Candidate rules checked against 2h's fictional data (the values 2h shows on its Candidates page),
   and against the reports, so the sidebar, Candidates and Hiring progress agree. */
import { describe, expect, it } from "vitest";
import { FIXTURE, TODAY, type Dataset } from "../data/fixtures";
import { pipelineModel, roleRows } from "../reporting/metrics";
import {
  STAGES, candidateList, countByStage, forRole, interviewLabel, nextStep, otherSubmissions, people, requirementLine, roleOf, search, waitingOnYou,
} from "./candidates";

const data = FIXTURE;
const sub = (id: string) => data.subs.find((s) => s.id === id)!;
const ids = (l: { id: string }[]) => l.map((c) => c.id);

describe("counts", () => {
  it("12 submissions, 11 people (one person shared for two roles), 5 waiting on you", () => {
    expect(data.subs).toHaveLength(12);
    expect(people(data.subs)).toBe(11);
    expect(data.subs.filter(waitingOnYou)).toHaveLength(5);
  });
  it("board columns by latest saved stage: To review 4, Interview 4, Offer 1, Hired 1; Declined 2", () => {
    expect(countByStage(data.subs, [...STAGES, "Declined"])).toEqual([4, 4, 1, 1, 2]);
  });
  it("Regional Sales Manager (on hold) still lists its 4 submissions and 4 people", () => {
    const l = forRole(data, "rsm");
    expect([l.length, people(l)]).toEqual([4, 4]);
  });
});

describe("filters and order", () => {
  it("waiting on you first, longest waiting first, then the rest by how long they have waited", () => {
    expect(ids(candidateList(data, "all", "all", TODAY))).toEqual(
      ["tb-rsm", "pr-isl", "en-pa", "tb-isl", "ab-fsr", "cm-rsm", "gl-rsm", "so-pa", "je-isl", "mw-isl", "bc-pa", "do-rsm"]);
  });
  it("Waiting on you: 5 across all roles, 1 for Field Sales Representative", () => {
    expect(ids(candidateList(data, "all", "you", TODAY))).toEqual(["tb-rsm", "pr-isl", "en-pa", "tb-isl", "ab-fsr"]);
    expect(ids(candidateList(data, "fsr", "you", TODAY))).toEqual(["ab-fsr"]);
  });
  it("role filter keeps only that role's submissions", () => {
    expect(ids(candidateList(data, "isl", "all", TODAY)).sort()).toEqual(["je-isl", "mw-isl", "pr-isl", "tb-isl"]);
  });
  it("the list is a copy: filtering never reorders the shared data", () => {
    const before = ids(data.subs);
    candidateList(data, "all", "all", TODAY);
    expect(ids(data.subs)).toEqual(before);
  });
});

describe("labels", () => {
  it("next step for each kind, as 2h words it", () => {
    expect(["tb-isl", "tb-rsm", "je-isl", "so-pa", "gl-rsm", "do-rsm", "cm-rsm", "mw-isl"].map((id) => nextStep(sub(id), TODAY).short)).toEqual([
      "Your review · 3 days", "Your feedback · 6 days", "Interview Thu 15 Oct", "Revenue Optics arranging",
      "Offer made (recorded)", "Offer accepted (recorded)", "Revenue Optics following up", "No action needed"]);
    expect(nextStep(sub("do-rsm"), TODAY).sub).toBe("Recorded 28 Sep · starts 2 Nov 2026");
    expect(nextStep(sub("ab-fsr"), "2026-10-11").short).toBe("Your review · 1 day");
    expect(["tb-isl", "je-isl", "gl-rsm", "do-rsm", "mw-isl"].map((id) => nextStep(sub(id), TODAY).cls)).toEqual(["you", "sched", "ro", "done", "ro"]);
  });
  it("interview label for each status", () => {
    expect(["je-isl", "so-pa", "tb-rsm", "gl-rsm", "tb-isl", "mw-isl"].map((id) => interviewLabel(sub(id)))).toEqual([
      ["c-info", "Interview Thu 15 Oct"], ["c-mute", "Interview requested"], ["c-warn", "Interview held · feedback due"],
      ["c-ok", "Interview held · feedback given"], ["c-mute", "Screening call available"], ["c-mute", "No interview yet"]]);
  });
  it("requirement line counts supported must-haves only", () => {
    expect(requirementLine(sub("tb-isl"), roleOf(data, sub("tb-isl")))).toBe("3 of 4 must-haves supported");
    expect(requirementLine(sub("tb-rsm"), roleOf(data, sub("tb-rsm")))).toBe("1 of 3 must-haves supported");
  });
  it("same person, other role", () => {
    expect(ids(otherSubmissions(data, sub("tb-isl")))).toEqual(["tb-rsm"]);
    expect(otherSubmissions(data, sub("pr-isl"))).toEqual([]);
  });
});

describe("search", () => {
  it("matches candidate names (up to 6) and role titles; empty query shows nothing", () => {
    expect(ids(search(data, "tay")!.subs)).toEqual(["tb-isl", "tb-rsm"]);
    expect(search(data, "sales")!.roles.map((r) => r.id)).toEqual(["isl", "fsr", "rsm"]);
    expect(search(data, "a")!.subs.length).toBe(6);
    expect(search(data, "  ")).toBeNull();
  });
});

describe("agreement with the reports", () => {
  it("board stage counts and declines match Pipeline 'In stage now' for all roles and each role", () => {
    for (const r of ["all", ...data.roles.map((x) => x.id)]) {
      const M = pipelineModel(data, r, TODAY), l = forRole(data, r);
      expect(countByStage(l, STAGES), r).toEqual(M.now.slice(2));
      expect(countByStage(l, ["Declined"])[0], r).toBe(M.closed.dec);
    }
  });
  it("the role chart's totals are each role's submissions minus declines", () => {
    for (const row of roleRows(data, "all", true, "az")) expect(row.total + row.dec).toBe(forRole(data, row.role.id).length);
  });
  it("no data: nothing listed", () => {
    const empty: Dataset = { ...data, subs: [], moves: [], search: [], held: [] };
    expect(candidateList(empty, "all", "all", TODAY)).toEqual([]);
    expect(countByStage(empty.subs, STAGES)).toEqual([0, 0, 0, 0]);
  });
});
