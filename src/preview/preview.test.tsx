/* The read-only assessment preview (synthetic data only): the draft label, result, summary, strengths, gaps and
   expandable evidence are shown; nothing can be changed, uploaded or sent; and the recruiter page is unchanged by the
   shared DraftAssessment. The export's selection and minimisation are tested in scripts/preview/export-data.test.mjs. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssessmentSummary } from "../scoring/AssessmentPanels";
import { viewOf, type AssessmentRecord, type LoadedConfig } from "../scoring/model";
import { syntheticRubric } from "../scoring/syntheticFixture";
import { PreviewPage, previewViews, type PreviewData } from "./PreviewApp";

const config = { ...syntheticRubric(), sha256: "", frozenSha256: "", hashOk: true, recordedAt: "", cvsOpenedBefore: false } as LoadedConfig;
const rec = (label: string, i: number): AssessmentRecord => ({
  id: `preview-${i}`, kind: "real", label, configId: config.id, configVersion: 1, producedBy: "AI draft (ai-proposed)", createdAt: "2026-01-06T00:00:00Z",
  gates: [{ id: "G1", result: "Unknown", basis: "explicit", evidence: [{ quote: "Synthetic licence held since 2019.", page: 1 }], explanation: "Synthetic: stated once." }, { id: "G2", result: "Unknown", basis: "explicit", evidence: [], explanation: "Not stated." }],
  criteria: [{ id: "C1", status: "rated", rating: 2, basis: "explicit", detail: "Full", evidence: [{ quote: "Opened synthetic accounts.", page: 1 }], explanation: "Synthetic explanation." },
    { id: "C2", status: "rated", rating: 2, basis: "explicit", detail: "Full", evidence: [], explanation: "x" }, { id: "I1", status: "unknown", basis: "explicit", detail: null, evidence: [], explanation: "x" }],
  otherResults: [], constraints: [], strengths: [`Synthetic strength of ${label}.`], gaps: [`Synthetic gap of ${label}.`], questions: [], manualReview: [], screening: null,
  clientView: { summary: `Synthetic summary of ${label}.`, preparedBy: "", statusRule: "", strengths: [], gaps: [], statuses: { G1: { status: "needs-review" }, G2: { status: "not-stated" }, C1: { status: "needs-review" } } },
});
const data: PreviewData = { schema: "assessment-preview/1", generatedAt: "2026-01-07T00:00:00Z", config, assessments: ["Candidate A", "Candidate B"].map(rec) };
const html = renderToStaticMarkup(<PreviewPage data={data} />);

describe("read-only assessment preview", () => {
  it("shows each candidate's draft with the AI draft label, result, summary, strengths and gaps", () => {
    expect(html.match(/AI draft — recruiter review needed/g)).toHaveLength(2);
    for (const l of ["Candidate A", "Candidate B"]) for (const t of [`Synthetic summary of ${l}.`, `Synthetic strength of ${l}.`, `Synthetic gap of ${l}.`]) expect(html).toContain(t);
    expect(html).toContain("The draft&#x27;s list of gaps");
    expect(html).toMatch(/<h3>To confirm \(\d+\)<\/h3>/);
    expect(html.indexOf("Candidate A")).toBeLessThan(html.indexOf("Candidate B")); // listed by label, not score
  });
  it("puts each item's quotes and explanation in an expandable item, and the rest under All requirements", () => {
    const e = html.slice(html.indexOf('<span class="sc-item-n">Synthetic licence<'), html.indexOf("</details>", html.indexOf('<span class="sc-item-n">Synthetic licence<')));
    expect(html).toMatch(/<details class="jd sc-details"><summary>All requirements \(\d+ more\)<\/summary>/);
    expect(e).toContain("Synthetic licence held since 2019.");
    expect(e).toContain("Synthetic: stated once.");
    expect(e).toContain("CV page 1");
    expect(html).not.toMatch(/\b(?:MH|SD|PC|G|C|I)\d\b(?![^<]*<\/q>)|rubric|fingerprint|undefined|NaN/);
  });
  it("has no form, input, button, upload, correction or screening controls, and no links away", () => {
    expect(html).not.toMatch(/<(form|input|textarea|select|button)\b/);
    expect(html).not.toMatch(/Record a recruiter correction|Review and corrections|Screening questions|Assess with AI|Add CV/);
    expect([...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]).every((h) => h.startsWith("#"))).toBe(true);
  });
  it("shows the test-rules notice and a short explanation, not the full assessment rules", () => {
    expect(html.match(/Test rules — awaiting approval/g)).toHaveLength(2);
    expect(html).toContain("The full rules are kept in the reference document, not on this page.");
    expect(html).not.toMatch(/Assessment rules \(test version|Choices made for this test|Rules applied to every CV|Skills and rating levels|Practical points \(checked/);
  });
  it("refuses data in an unexpected format", () => {
    expect(() => previewViews({ ...data, schema: "other" } as unknown as PreviewData)).toThrow(/expected format/);
  });
  it("leaves the recruiter page's content unchanged (the draft is shared, the review sections remain)", () => {
    const r = renderToStaticMarkup(<AssessmentSummary v={viewOf(data.assessments[0], config, [], [])} rules={[]} onChanged={() => {}} />);
    expect(r).toContain("AI draft — recruiter review needed");
    expect(r).toContain("<h3>To confirm (");
    expect(r).toContain("<summary>Review or change assessment</summary>");
    expect(r).toMatch(/Record a recruiter correction/);
    /* The full rules are not on the candidate page; the notice, the short explanation and how the result is worked out are. */
    expect(r).not.toMatch(/Assessment rules \(test version|Choices made for this test|Rules applied to every CV|Skills and rating levels|Practical points \(checked/);
    expect(r).toContain("Test rules — awaiting approval");
    expect(r).toContain("<b>Current result: </b>");
  });
});
