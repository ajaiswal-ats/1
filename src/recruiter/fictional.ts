import { syntheticRubric } from "../scoring/syntheticFixture";
import type { Assessment } from "./data";

/** Fictional data for automated tests and the explicit local preview; never imported by a production entry. */
export function recruiterFixture(): Assessment {
  const inputs = { gates: [{ id: "G1", result: "Unknown" as const }, { id: "G2", result: "Unknown" as const }],
    criteria: [{ id: "C1", status: "rated" as const, rating: 3 }, { id: "C2", status: "rated" as const, rating: 2 }, { id: "I1", status: "unknown" as const }] };
  return { id: "11111111-1111-4111-8111-111111111111", submissionId: "22222222-2222-4222-8222-222222222222", candidate: "Candidate Example", client: "Example Client", role: "Example Role", revision: 1,
    rubric: syntheticRubric(), inputs, originalInputs: structuredClone(inputs), evidence: { C1: [{ quote: "Delivered three synthetic projects.", page: 1 }] }, preparedBy: "Synthetic offline draft",
    reviewed: false, published: false, review: null, setId: "33333333-3333-4333-8333-333333333333", requirements: [{ id: "44444444-4444-4444-8444-444444444444", text: "Synthetic agreed requirement", tier: "must" }],
    screeningQuestions: [{ id: "Q1", text: "Describe a synthetic result.", use: "scored", answerPoints: ["A specific result.", "A number and the candidate's own contribution."] },
      { id: "Q2", text: "Confirm a synthetic practical requirement.", use: "confirms", answerPoints: ["Explicit confirmation."] }], history: [] };
}
