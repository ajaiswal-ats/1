/* W6 display: the recruiter's final review on the recruiter page (synthetic data only). */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssessmentSummary, ClientAssessmentSummary } from "./AssessmentPanels";
import { viewOf, type AssessmentRecord, type LoadedConfig } from "./model";
import { screeningKey } from "./finalReview";
import { SCREENING_SCORE_PENDING, SEPARATE } from "./routing";
import type { ScreeningSet } from "./screening";
import { syntheticRubric } from "./syntheticFixture";

const config = { ...syntheticRubric(), sha256: "", frozenSha256: "", hashOk: true, recordedAt: "", cvsOpenedBefore: false } as LoadedConfig;
const rec = (over: Partial<AssessmentRecord> = {}): AssessmentRecord => ({ id: "syn-f", kind: "real", label: "Candidate F", configId: config.id, configVersion: 1, producedBy: "AI route: test (ai-proposed)", createdAt: "2026-01-06T00:00:00Z",
  gates: [{ id: "G1", result: "Unknown", basis: "explicit", evidence: [], explanation: "x" }, { id: "G2", result: "Pass", basis: "explicit", evidence: [], explanation: "x" }],
  criteria: [{ id: "C1", status: "rated", rating: 3, basis: "explicit", detail: "Full", evidence: [], explanation: "x" }, { id: "C2", status: "disputed", basis: "explicit", detail: null, evidence: [], explanation: "x" }, { id: "I1", status: "rated", rating: 2, basis: "explicit", detail: "Full", evidence: [], explanation: "x" }],
  otherResults: [], constraints: [], strengths: [], gaps: [], questions: [], manualReview: [], screening: null,
  clientView: { summary: "Synthetic.", preparedBy: "", statusRule: "", strengths: [], gaps: [], statuses: {} }, ...over });
const box = (r: AssessmentRecord, sets?: ScreeningSet[]) => { const h = renderToStaticMarkup(<AssessmentSummary v={viewOf(r, config, [], [])} onChanged={() => {}} screeningSets={sets} />); return h.slice(h.indexOf("<h3>Recruiter final review</h3>")); };
const D = (revision: number, decision: string, reason: string, at: string, key = screeningKey(null)) => ({ kind: "finalDecision", revision, at, reviewer: "Synthetic recruiter", decision, reason, cv: { version: 1, stateSha256: "" }, screeningRevision: 0, openItems: [], acknowledgedOpenItems: false, screeningKey: key });

describe("recruiter final review", () => {
  it("shows open essential requirements and conflicts first, and that nothing is moved or published", () => {
    const h = box(rec());
    expect(h).toContain("Still open (2): ");
    expect(h).toContain("Synthetic licence (essential requirement): Not confirmed");
    expect(h).toContain("Synthetic margins (conflict): Conflicting information");
    expect(h).toContain("I have seen the open items above.");
    expect(h).toContain("Recording it does not accept, reject, move, publish or notify anything; the candidate&#x27;s stage is unchanged.");
    expect(h).toContain("No decision has been recorded.");
    expect(h).toMatch(/<option value="forward">Put forward to the client<\/option><option value="decline">Do not put forward<\/option><option value="hold">Hold — more information needed<\/option>/);
  });
  it("shows the current decision and every earlier one, with reasons, names and dates", () => {
    const h = box(rec({ finalDecisions: { schema: "final-decisions/1", assessmentId: "syn-f", entries: [D(1, "hold", "Licence not yet confirmed.", "2026-01-10T00:00:00Z"), D(2, "forward", "Licence confirmed.", "2026-01-12T00:00:00Z")] as never } }));
    expect(h).toContain("<b>Current decision: </b>Put forward to the client: Licence confirmed. (Synthetic recruiter, 12 Jan; CV version 1)");
    expect(h).toContain("<li>Hold — more information needed: Licence not yet confirmed. (Synthetic recruiter, 10 Jan; CV version 1)</li>");
  });
  it("says when nothing is open, and needs no acknowledgement then", () => {
    const h = box(rec({ gates: [{ id: "G1", result: "Pass", basis: "explicit", evidence: [], explanation: "x" }, { id: "G2", result: "Pass", basis: "explicit", evidence: [], explanation: "x" }],
      criteria: rec().criteria.map((c) => (c.id === "C2" ? { ...c, status: "rated" as const, rating: 2, detail: "Full" as const } : c)) }));
    expect(h).toContain("Nothing open: </b>no essential requirement or conflict is open.");
    expect(h).not.toContain("I have seen the open items above.");
  });
  it("marks the latest decision out of date when the screening evidence changed, keeping it in the history", () => {
    const answers = { kind: "answers", revision: 1, at: "2026-01-10T00:00:00Z", by: "R", set: { id: "s", version: 1, sha256: "s" }, answers: { Q1: "x" }, followUps: {}, excerpt: "", excerptFor: [] };
    const h = box(rec({ finalDecisions: { schema: "final-decisions/1", assessmentId: "syn-f", entries: [D(1, "hold", "Licence not yet confirmed.", "2026-01-10T00:00:00Z")] as never },
      screeningRecord: { schema: "screening-record/1", assessmentId: "syn-f", entries: [answers] as never } }));
    expect(h).toContain("Out of date — review again: </b>Hold — more information needed: Licence not yet confirmed.");
    expect(h).not.toContain("<b>Current decision: </b>");
  });
  it("offers 'Put forward' as not available, with the reason, only when an essential requirement is not met", () => {
    const failed = box(rec({ gates: [{ id: "G1", result: "Fail", basis: "explicit", evidence: [], explanation: "x" }, { id: "G2", result: "Pass", basis: "explicit", evidence: [], explanation: "x" }] }));
    expect(failed).toContain('<option value="forward" disabled="">Put forward to the client (not available)</option>');
    expect(failed).toContain("An essential requirement is not met. Putting the candidate forward needs a client exception, and this tool has no way to record one yet.");
    expect(failed).toMatch(/<option value="decline">Do not put forward<\/option><option value="hold">Hold — more information needed<\/option>/);
    const unconfirmed = box(rec());
    expect(unconfirmed).toContain('<option value="forward">Put forward to the client</option>');
    expect(unconfirmed).not.toContain("not available");
  });
  it("is never shown in the client view", () => {
    expect(renderToStaticMarkup(<ClientAssessmentSummary v={viewOf(rec(), config, [], [])} />)).not.toMatch(/Recruiter final review|Record decision|Put forward to the client/);
  });
});

/* Separate scoring (Akansha, 28 October 2026): "We can do separate scoring for now. We will look at combined scoring later." */
const q = (id: string, text: string, use: "scored" | "confirms") => ({ id, area: "Knowledge of the role" as const, text, checks: [], use, answerPoints: ["Synthetic point"], source: "Synthetic" });
const SET: ScreeningSet = { schema: "screening-set/1", id: "syn-screening", version: 1, title: "Synthetic set", status: "proposed", statusNote: "Synthetic.", rules: { id: config.id, version: 1 },
  basedOn: ["Synthetic"], scale: "1 to 5", neverAssess: "Never rate accent.", sha256: "s",
  questions: [q("Q1", "Synthetic question one?", "scored"), q("Q2", "Synthetic question two?", "scored"), q("Q3", "Synthetic question three?", "scored"), q("Q4", "Synthetic question four?", "scored"), q("Q9", "Synthetic licence check?", "confirms")] };
const save = { kind: "answers", revision: 1, at: "2026-01-10T00:00:00Z", by: "R", set: { id: "syn-screening", version: 1, sha256: "s" }, answers: { Q1: "Synthetic answer one.", Q2: "Synthetic answer two.", Q3: "Synthetic answer three." }, followUps: {}, excerpt: "", excerptFor: [] };
const proposal = { kind: "proposal", revision: 2, at: "2026-01-10T00:01:00Z", route: "Fake proposer", isAi: true, answersRevision: 1, dropped: [],
  ratings: { Q1: { rating: 3, quote: "Synthetic answer one.", reason: "Synthetic." }, Q2: { rating: 2, quote: "Synthetic answer two.", reason: "Synthetic." } } };
const fix = { kind: "correction", revision: 3, at: "2026-01-10T00:02:00Z", reviewer: "R", questionId: "Q2", from: 2, to: 4, quote: "Synthetic answer two.", reason: "Synthetic reason.", answersRevision: 1 };
const screened = (entries: unknown[]) => rec({ screeningRecord: { schema: "screening-record/1", assessmentId: "syn-f", entries: entries as never } });

describe("final review: CV and screening assessments shown separately (combined scoring deferred)", () => {
  it("removes the combined-recommendation line; shows the CV assessment and says screening is not assessed when there are no answers", () => {
    const h = box(rec());
    expect(h).not.toMatch(/Combined recommendation|awaiting agreed rules|Open question/);
    expect(h).toContain("<b>CV assessment: </b>");
    expect(h).toContain("<b>Screening assessment: </b>Not assessed: no screening answers are recorded.");
    expect(h).toContain(SEPARATE);
    expect(h).not.toContain(SCREENING_SCORE_PENDING);
  });
  it("shows each scored question's current rating and who set it, and states that the overall screening score is not calculated", () => {
    const h = box(screened([save, proposal, fix]), [SET]);
    expect(h).toContain("<li>Synthetic question one?: 3 of 5 (AI draft, not reviewed)</li>");
    expect(h).toContain("<li>Synthetic question two?: 4 of 5 (set by a recruiter)</li>");
    expect(h).toContain("<li>Synthetic question three?: Not rated yet</li>");
    expect(h).toContain("<li>Synthetic question four?: Not answered</li>");
    expect(h).not.toContain("Synthetic licence check?"); // confirmation-only questions carry no rating
    expect(h).toContain(`<span>${SCREENING_SCORE_PENDING}</span>`);
  });
  it("invents no screening score: no total, average, percentage or score out of 100 from the 1–5 ratings", () => {
    const sec = (h: string) => h.slice(h.indexOf("<b>Screening assessment: </b>"), h.indexOf(SEPARATE));
    const s = sec(box(screened([save, proposal, fix]), [SET]));
    expect(s).not.toMatch(/\d+\s*(%|\/\s*100|out of 100|points)|average|total|7 of|3\.5/i);
  });
  it("without the recorded question set, still lists the rated questions by ID, with no score", () => {
    const h = box(screened([save, proposal]));
    expect(h).toContain("<li>Q1: 3 of 5 (AI draft, not reviewed)</li>");
    expect(h).toContain("<li>Q2: 2 of 5 (AI draft, not reviewed)</li>");
    expect(h).toContain(SCREENING_SCORE_PENDING);
  });
  it("keeps the decision safeguards unchanged: required fields, open items, the failed-requirement block and the history", () => {
    const failed = box(screened([save, proposal]), [SET]);
    expect(failed).toContain("Still open (2): ");
    expect(failed).toContain("I have seen the open items above.");
    const blocked = box({ ...screened([save, proposal]), gates: [{ id: "G1", result: "Fail", basis: "explicit", evidence: [], explanation: "x" }, { id: "G2", result: "Pass", basis: "explicit", evidence: [], explanation: "x" }] }, [SET]);
    expect(blocked).toContain('<option value="forward" disabled="">Put forward to the client (not available)</option>');
    expect(blocked).toContain('placeholder="Reason (required)"');
    const changed = box({ ...screened([save, proposal, fix]), finalDecisions: { schema: "final-decisions/1", assessmentId: "syn-f", entries: [D(1, "hold", "Before the correction.", "2026-01-10T00:00:00Z", screeningKey({ schema: "screening-record/1", assessmentId: "syn-f", entries: [save, proposal] as never }))] as never } }, [SET]);
    expect(changed).toContain("Out of date — review again: </b>Hold — more information needed: Before the correction.");
  });
  it("is never shown in the client view", () => {
    expect(renderToStaticMarkup(<ClientAssessmentSummary v={viewOf(screened([save, proposal, fix]), config, [], [])} />)).not.toMatch(/CV assessment: |Screening assessment|of 5|Combined scoring/);
  });
});
