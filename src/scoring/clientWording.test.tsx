/* F4: plain-English client wording (synthetic, fictional data only). Client-facing summaries, strengths and points to
   clarify are shown through a separate display layer: scoring language is rewritten as complete, simple sentences, and a
   sentence that cannot be rewritten safely becomes "This point needs recruiter review". Stored text, evidence, ratings,
   scores and the recruiter's view are unchanged. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssessmentSummary, ClientAssessmentSummary } from "./AssessmentPanels";
import { viewOf, type AssessmentRecord, type LoadedConfig } from "./model";
import { CLIENT_REVIEW, CLIENT_JARGON, clientWording, labelsFor } from "./plainText";
import { syntheticRubric } from "./syntheticFixture";

const config = { ...syntheticRubric(), sha256: "", frozenSha256: "", hashOk: true, recordedAt: "", cvsOpenedBefore: false } as LoadedConfig;
const labels = labelsFor(config), say = (t: string) => clientWording(t, labels);

describe("client wording: scoring language becomes plain sentences", () => {
  it("turns a bracketed 'not confirmed' tag into its own sentence", () => {
    expect(say("No synthetic licence is mentioned in any role (Synthetic licence not confirmed)."))
      .toBe("No synthetic licence is mentioned in any role. Synthetic licence is not yet confirmed.");
    expect(say("No margin or reporting work is described (C2 Unknown, I1 Unknown)."))
      .toBe("No margin or reporting work is described. Synthetic margins and Synthetic reporting are not yet confirmed.");
  });
  it("keeps a requirement name that contains 'and' whole", () => {
    const withAnd = new Map([...labels, ["G9", "Synthetic licence and clean record"]]);
    expect(clientWording("The record is not stated (Synthetic licence and clean record not confirmed).", withAnd)).toBe("The record is not stated. Synthetic licence and clean record is not yet confirmed.");
  });
  it("turns a bracketed rating or limit tag into a plain sentence about that requirement, with no numbers", () => {
    expect(say("Deals are described but never counted within a period (Winning synthetic deals capped rated 2); ask for an example in screening."))
      .toBe("Deals are described but never counted within a period; ask for an example in screening. This affects the assessment of Winning synthetic deals.");
    expect(say("The role does not describe in-person visits (Synthetic reporting rating 3)."))
      .toBe("The role does not describe in-person visits. This affects the assessment of Synthetic reporting.");
  });
  it("rewrites threshold, rating and criterion language in place as complete sentences", () => {
    expect(say("NetSuite is listed but no use is described, leaving both the ERP essential requirement and the NetSuite skill below their Pass/level-2 thresholds."))
      .toBe("NetSuite is listed but no use is described, so the ERP essential requirement and the NetSuite skill cannot be confirmed from the CV.");
    expect(say("Field selling is about 22 months on a conservative reading, leaving the 3-year threshold unconfirmed."))
      .toBe("Field selling is about 22 months on a conservative reading, leaving the required 3 years unconfirmed.");
    expect(say("No battery work is mentioned; this would satisfy the 1-year alternative threshold for Synthetic licence."))
      .toBe("No battery work is mentioned; this would satisfy the shorter 1-year alternative for Synthetic licence.");
    expect(say("The role offers a reduced tenure threshold for battery candidates, making this gap material."))
      .toBe("The role offers a shorter required time in outside sales for battery candidates, making this gap material.");
    expect(say("Stock work is not described; Synthetic margins cannot be rated, and it is an Important criterion."))
      .toBe("Stock work is not described; Synthetic margins cannot be assessed from the CV, and it is an important requirement.");
    expect(say("The role does not describe visits, limiting recency evidence for field selling."))
      .toBe("The role does not describe visits, which limits the evidence of recent experience in field selling.");
  });
  it("shows 'This point needs recruiter review' for a sentence that cannot be rewritten safely, keeping the other sentences", () => {
    expect(say("Visits are weekly. The anchor for rating 2 applies under Option P.")).toBe(`Visits are weekly. ${CLIENT_REVIEW}`);
    expect(say("Scored 14 points of 27 under the rubric.")).toBe(CLIENT_REVIEW);
    expect(say("A tag for an unknown name (Mystery skill rated 2).")).toBe(CLIENT_REVIEW); // the name is not a requirement: not rewritten
  });
  it("leaves plain text exactly as it is, and never leaves scoring language behind", () => {
    for (const t of ["No synthetic licence is stated; ask in screening.", "Managed 30 key accounts with quarterly visits.", "The licence is not mentioned."]) expect(say(t)).toBe(t);
    for (const t of ["x (Synthetic margins capped rated 2).", "below its level-2 threshold.", "Pass level reached.", "Rated 3 for recency.", "Fails the gate."]) expect(say(t)).not.toMatch(CLIENT_JARGON);
  });
});

describe("the client view uses the display layer; the recruiter view and the records do not change", () => {
  const VIEW = { summary: "Synthetic seller. Field selling is about 22 months, leaving the 3-year threshold unconfirmed.", preparedBy: "", statusRule: "",
    strengths: [{ text: "Counted synthetic deals.", evidence: [{ quote: "Closed 40 synthetic deals in 2025.", page: 1 }] }],
    gaps: ["Deals are never counted within a period (Winning synthetic deals capped rated 2).", "No synthetic licence is stated (G1 Unknown)."],
    statuses: { G1: { status: "not-stated" as const }, G2: { status: "not-stated" as const }, C1: { status: "needs-review" as const }, C2: { status: "not-stated" as const }, I1: { status: "not-stated" as const } } };
  const rec = (): AssessmentRecord => ({ id: "syn-w", kind: "real", label: "Candidate W", configId: config.id, configVersion: 1, producedBy: "AI route: test (ai-proposed)", createdAt: "2026-01-06T00:00:00Z",
    gates: [{ id: "G1", result: "Unknown", basis: "explicit", evidence: [], explanation: "Not stated." }, { id: "G2", result: "Unknown", basis: "explicit", evidence: [], explanation: "Not stated." }],
    criteria: [{ id: "C1", status: "rated", rating: 2, basis: "explicit", detail: "Full", evidence: [{ quote: "Closed 40 synthetic deals in 2025.", page: 1 }], explanation: "Counted deals." },
      { id: "C2", status: "unknown", basis: "explicit", detail: null, evidence: [], explanation: "Not stated." }, { id: "I1", status: "unknown", basis: "explicit", detail: null, evidence: [], explanation: "Not stated." }],
    otherResults: [], constraints: [], questions: [], manualReview: [], screening: null, strengths: ["Counted synthetic deals."], gaps: VIEW.gaps, clientView: VIEW });
  it("client view: plain summary and points, the concerns still there, no scoring language", () => {
    const r = rec(), before = JSON.stringify(r), v = viewOf(r, config, [], []), c = renderToStaticMarkup(<ClientAssessmentSummary v={v} />);
    expect(c).toContain("<b>Summary.</b> Synthetic seller. Field selling is about 22 months, leaving the required 3 years unconfirmed.");
    expect(c).toContain("<li>Deals are never counted within a period. This affects the assessment of Winning synthetic deals.</li>");
    expect(c).toContain("<li>No synthetic licence is stated. Synthetic licence is not yet confirmed.</li>");
    expect(c).toMatch(/Synthetic licence<span class="xs muted"> · Essential requirement<\/span><\/span><span class="chip c-mute">Not stated/); // the essential concern stays listed
    expect(c.replace(/<[^>]+>/g, " ")).not.toMatch(CLIENT_JARGON);
    expect(JSON.stringify(r)).toBe(before); // the stored text is unchanged
  });
  it("recruiter view keeps the draft's own wording (technical language stays with the recruiter)", () => {
    const h = renderToStaticMarkup(<AssessmentSummary v={viewOf(rec(), config, [], [])} onChanged={() => {}} />);
    expect(h).toContain("Deals are never counted within a period (Winning synthetic deals capped rated 2).");
  });
});
