import { describe, expect, it } from "vitest";
import { recruiterFixture } from "./fictional";
import { STARTER_AREAS, type ScreeningSet } from "../scoring/screening";
import type { AssessmentRecord } from "../scoring/model";
import { prepareImport } from "./import";

function source() {
  const a = recruiterFixture(), config = a.rubric;
  const assessment: AssessmentRecord = { id: a.id, label: a.candidate, kind: "fictional", configId: config.id, configVersion: config.version,
    producedBy: "Synthetic preparation", createdAt: "2026-10-30T10:00:00Z", gates: a.inputs.gates.map((g) => ({ ...g, basis: "explicit", evidence: [], explanation: "Synthetic." })),
    criteria: a.inputs.criteria.map((c) => ({ ...c, detail: null, basis: "explicit", evidence: [], explanation: "Synthetic." })),
    otherResults: [], constraints: [], strengths: [], gaps: [], questions: [], manualReview: [], screening: null };
  const screeningSet: ScreeningSet = { schema: "screening-set/1", id: "synthetic-set", version: 1, title: "Synthetic questions", status: "proposed", statusNote: "For tests.", rules: { id: config.id, version: config.version }, basedOn: [], scale: "1 to 5", neverAssess: "Personal characteristics.",
    questions: [...STARTER_AREAS.map((area, i) => ({ id: `Q${i}`, area, text: `Synthetic question ${i}?`, checks: i === 0 ? ["C1", "C2"] : [], use: "scored" as const, answerPoints: ["Synthetic point."], source: "Synthetic." })),
      ...config.gates.map((g) => ({ id: g.id, area: "Essential requirement" as const, text: `Confirm ${g.label}?`, checks: [g.id], use: "confirms" as const, answerPoints: ["Confirm the fact."], source: "Synthetic." }))] };
  return { config, assessment, screeningSet };
}
describe("explicit owner-side assessment import preparation", () => {
  it("prepares unreviewed baseline inputs with their exact rubric, original record and core questions", () => {
    const s = source(), row = prepareImport(s, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(row.rubric.approved).toBe(false); expect(row.original_inputs).toEqual(row.inputs);
    expect(row.screening_questions).toHaveLength(s.screeningSet.questions.length);
    expect(row.source_record.assessment).toEqual(s.assessment);
    expect(row).not.toHaveProperty("review"); expect(row).not.toHaveProperty("reviewed_revision");
  });
  it("refuses a missing explicit portal mapping or a different rubric version", () => {
    const s = source(); expect(() => prepareImport(s, "name-match", "name-match")).toThrow(/UUIDs/);
    s.assessment.configVersion++;
    expect(() => prepareImport(s, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toThrow(/exactly/);
  });
  it("refuses a quote already marked unverified rather than promoting it to trusted evidence", () => {
    const s = source(); s.assessment.criteria[0].evidence = [{ quote: "Synthetic unsupported quotation.", page: 1, verified: false }];
    expect(() => prepareImport(s, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toThrow(/not been verified/);
  });
});
