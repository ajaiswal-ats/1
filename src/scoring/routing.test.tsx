/* Routing as Akansha's starter specifies it (synthetic data only): from the CV score alone, must-haves first. Nothing the
   starter leaves open is decided: no routing below 50 or without a score, no screening-score formula, no combination
   (deferred by Akansha on 28 October 2026). */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssessmentSummary, ClientAssessmentSummary } from "./AssessmentPanels";
import { calculateCv } from "./calculator";
import { viewOf, type AssessmentRecord, type LoadedConfig } from "./model";
import { SEPARATE, starterRouting } from "./routing";
import { syntheticRubric } from "./syntheticFixture";

const config = { ...syntheticRubric(), sha256: "", frozenSha256: "", hashOk: true, recordedAt: "", cvsOpenedBefore: false } as LoadedConfig;
const gates = (g1: "Pass" | "Fail" | "Unknown" = "Pass") => [{ id: "G1", result: g1 }, { id: "G2", result: "Pass" as const }];
const result = (ratings: (number | null)[], g1: "Pass" | "Fail" | "Unknown" = "Pass") =>
  calculateCv(config, gates(g1), ["C1", "C2", "I1"].map((id, i) => (ratings[i] === null ? { id, status: "unknown" as const } : { id, status: "rated" as const, rating: ratings[i]! })));

describe("starter routing, from the CV score alone", () => {
  it("65 or more goes to screening; 50 to 64 is screened only to check the gaps", () => {
    const high = result([3, 3, 3]), mid = result([2, 2, 1]);
    expect(high.score! >= 65 && mid.score! >= 50 && mid.score! < 65).toBe(true);
    expect(starterRouting(high)).toMatchObject({ specified: true, text: "Goes to screening (the starter: a CV score of 65 or more)." });
    expect(starterRouting(mid)).toMatchObject({ specified: true, text: "Screened only to check the gaps (the starter: a CV score of 50 to 64)." });
  });
  it("a failed must-have stops here, whatever the score; the client may allow an exception", () => {
    expect(starterRouting(result([3, 3, 3], "Fail"))).toMatchObject({ specified: true, text: "Stops here: an essential requirement is not met, whatever the score. A recruiter checks it; the client may allow an exception." });
  });
  it("an unconfirmed must-have is asked about in the call; it is not a fail", () => {
    const r = starterRouting(result([3, 3, 3], "Unknown"));
    expect([r.specified, r.askInCall]).toEqual([true, ["G1"]]);
  });
  it("decides nothing the starter leaves open: below 50, or no score (missing information is not a zero)", () => {
    const low = result([1, 0, 1]);
    expect(low.score! < 50).toBe(true);
    expect(starterRouting(low)).toMatchObject({ specified: false, text: "No routing: the starter does not say what happens below 50 (band: weak). A recruiter decides the next step." });
    const none = result([null, null, null]);
    expect(none.status).toBe("insufficient");
    expect(starterRouting(none)).toMatchObject({ specified: false, text: "No routing: there is no CV score, and the starter gives no routing without one. Missing information is not a zero; a recruiter decides the next step." });
  });
});

describe("the recruiter page keeps the scores separate; combined scoring is deferred", () => {
  const rec: AssessmentRecord = { id: "syn-r", kind: "real", label: "Candidate R", configId: config.id, configVersion: 1, producedBy: "AI route: test (ai-proposed)", createdAt: "2026-01-06T00:00:00Z",
    gates: [{ id: "G1", result: "Unknown", basis: "explicit", evidence: [], explanation: "x" }, { id: "G2", result: "Pass", basis: "explicit", evidence: [], explanation: "x" }],
    criteria: [{ id: "C1", status: "rated", rating: 3, basis: "explicit", detail: "Full", evidence: [], explanation: "x" }, { id: "C2", status: "rated", rating: 3, basis: "explicit", detail: "Full", evidence: [], explanation: "x" }, { id: "I1", status: "rated", rating: 3, basis: "explicit", detail: "Full", evidence: [], explanation: "x" }],
    otherResults: [], constraints: [], strengths: [], gaps: [], questions: [], manualReview: [], screening: null,
    clientView: { summary: "Synthetic.", preparedBy: "", statusRule: "", strengths: [], gaps: [], statuses: {} } };
  it("shows the CV score with the starter's routing, no screening score, and combined scoring as deferred (not awaited)", () => {
    const h = renderToStaticMarkup(<AssessmentSummary v={viewOf(rec, config, [], [])} onChanged={() => {}} />), box = h.slice(h.indexOf("<h3>Where this stands</h3>"), h.indexOf("<summary>Screening questions"));
    expect(box).toContain("Goes to screening (the starter: a CV score of 65 or more).");
    expect(box).toContain("Ask in the call (the starter): Synthetic licence.");
    expect(box).toContain("No screening score is calculated: the starter rates answers 1 to 5 but does not say how they become a score out of 100.");
    expect(box).toContain(`<dt>Combined</dt><dd>${SEPARATE}</dd>`);
    expect(box).not.toMatch(/awaiting agreed rules|Open question/);
    expect(box).not.toMatch(/combined score|weight/i);
  });
  it("is not shown in the client view", () => {
    expect(renderToStaticMarkup(<ClientAssessmentSummary v={viewOf(rec, config, [], [])} />)).not.toMatch(/Where this stands|Combined recommendation|Goes to screening/);
  });
});
