/* How a server rule check on an essential check is shown (synthetic data only): the check's status replaces "met", the
   reason and the AI's original proposal are shown separately, and a later recruiter correction takes precedence. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TENURE_DUTIES_STATUS } from "./aiAssessment";
import { AssessmentSummary, ClientAssessmentSummary } from "./AssessmentPanels";
import { viewOf, type AssessmentRecord, type LoadedConfig } from "./model";
import { syntheticRubric } from "./syntheticFixture";
import type { Correction } from "./versions";

const config = { ...syntheticRubric(), sha256: "a", frozenSha256: "a", hashOk: true, recordedAt: "", cvsOpenedBefore: false } as LoadedConfig;
const check = { aiProposed: "Pass" as const, status: TENURE_DUTIES_STATUS, reason: "The quoted dates add up to about 78 months on the most cautious reading, which meets the time needed. The server cannot establish that each role involved outside or field selling." };
const rec: AssessmentRecord = {
  id: "syn-t", kind: "real", label: "Candidate T", configId: config.id, configVersion: 1, producedBy: "AI route: test (ai-proposed)", createdAt: "2026-01-06T00:00:00Z", addedAt: "2026-01-04T00:00:00Z",
  gates: [{ id: "G1", result: "Unknown", basis: "explicit", evidence: [{ quote: "Drove to synthetic depots weekly.", page: 1 }], explanation: "The AI's own reading: field visits across several roles.", check },
    { id: "G2", result: "Unknown", basis: "explicit", evidence: [], explanation: "Not stated." }],
  criteria: [{ id: "C1", status: "rated", rating: 2, basis: "explicit", detail: "Full", evidence: [], explanation: "x" }, { id: "C2", status: "rated", rating: 2, basis: "explicit", detail: "Full", evidence: [], explanation: "x" }, { id: "I1", status: "unknown", basis: "explicit", detail: null, evidence: [], explanation: "x" }],
  otherResults: [], constraints: [], strengths: ["s"], gaps: ["g"], questions: [], manualReview: [], screening: null,
  clientView: { summary: "Synthetic.", preparedBy: "", statusRule: "", strengths: [], gaps: [], statuses: { G1: { status: "needs-review" }, G2: { status: "not-stated" } } },
};
const page = (corrections: Correction[] = []) => renderToStaticMarkup(<AssessmentSummary v={viewOf(rec, config, corrections, [])} rules={[]} onChanged={() => {}} />);
const itemOf = (h: string, name: string) => { const i = h.indexOf(`<span class="sc-item-n">${name}<`); return h.slice(h.lastIndexOf("<details", i), h.indexOf("</details>", i)); };

describe("tenure check display", () => {
  it("shows the check's status in To confirm instead of met", () => {
    const h = page(), first = h.slice(0, h.indexOf("<summary>All requirements"));
    expect(first).toMatch(/Synthetic licence<span class="xs muted"> · Essential requirement<\/span><\/span><span class="sc-item-s"><span class="chip c-warn">Not confirmed — recruiter must check field duties<\/span>/);
    expect(h).not.toMatch(/Met on the CV/);
  });
  it("shows the status, the server's reason and the AI's original proposal separately in the item, keeping the AI's explanation", () => {
    const e = itemOf(page(), "Synthetic licence");
    expect(e).toMatch(/<span class="chip c-warn">Not confirmed — recruiter must check field duties<\/span>/);
    expect(e).toContain("The server cannot establish that each role involved outside or field selling. The AI proposed: met.");
    expect(e).not.toMatch(/c-info">Needs review/);
    expect(e).toContain("<q>Drove to synthetic depots weekly.</q>");
    expect(e).toContain("The AI&#x27;s own reading: field visits across several roles.");
  });
  it("gives way to a recruiter's correction", () => {
    const fix: Correction = { assessmentId: "syn-t", version: 2, criterionId: "G1", previous: { status: "gate", result: "Unknown" }, next: { status: "gate", result: "Pass" }, evidence: "Synthetic: checked the field duties.", reason: "Synthetic.", reviewer: "R", at: "2026-01-10T00:00:00Z", source: "reviewer", configId: config.id, configVersion: 1 };
    const h = page([fix]);
    expect(h).not.toContain("recruiter must check field duties");
    expect(itemOf(h, "Synthetic licence")).toContain("A recruiter has changed this (see Review and corrections).");
  });
  it("is also shown, without the reason, in the client preview", () => {
    const c = renderToStaticMarkup(<ClientAssessmentSummary v={viewOf(rec, config, [], [])} />);
    expect(c).toContain("Not confirmed — recruiter must check field duties");
    expect(c).not.toMatch(/AI proposed|most cautious reading/);
  });
});
