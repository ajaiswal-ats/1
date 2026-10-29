/* W1: screening questions and answer guides (synthetic, fictional data only). One versioned core set shared by every
   candidate for the role, candidate follow-ups that add to it, coverage of the starter's areas, critical skills and
   essential requirements, and every question unanswered with screening "Not assessed". */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssessmentSummary, ClientAssessmentSummary, RETRY, guarded } from "./AssessmentPanels";
import { viewOf, type AssessmentRecord, type LoadedConfig } from "./model";
import { STARTER_AREAS, coreSetFor, followUpsFor, screeningSetProblems, stateKey, type ScreeningSet } from "./screening";
import { syntheticRubric } from "./syntheticFixture";

const config = { ...syntheticRubric(), sha256: "", frozenSha256: "", hashOk: true, recordedAt: "", cvsOpenedBefore: false } as LoadedConfig;
const q = (id: string, area: ScreeningSet["questions"][number]["area"], use: "scored" | "confirms", checks: string[] = []) =>
  ({ id, area, use, checks, text: `Synthetic question ${id}?`, answerPoints: [`Synthetic point for ${id}`], source: "Synthetic" });
const SET = (over: Partial<ScreeningSet> = {}): ScreeningSet => ({
  schema: "screening-set/1", id: "syn-screening", version: 1, title: "Synthetic role: core screening questions", status: "proposed", statusNote: "Synthetic proposal.",
  rules: { id: config.id, version: config.version }, basedOn: ["Synthetic"], scale: "Synthetic scale note.", neverAssess: "Never rate accent, speed of speech, appearance or personal details.",
  questions: [q("Q1", "Knowledge of the role", "scored"), q("Q2", "Communication", "scored"), q("Q3", "Ownership and results", "scored", ["C1"]), q("Q4", "Problem solving", "scored"),
    q("Q5", "Understanding of the role and why they want to move", "scored"), q("Q6", "Fit with the client's working conditions", "confirms", ["G2"]), q("Q7", "Salary, joining date and location", "confirms", ["P1"]),
    q("Q8", "Ownership and results", "scored", ["C2"]), q("Q9", "Essential requirement", "confirms", ["G1"])], ...over });
const rec = (id: string, questions: AssessmentRecord["questions"]): AssessmentRecord => ({
  id, kind: "real", label: `Candidate ${id}`, configId: config.id, configVersion: 1, producedBy: "AI route: test (ai-proposed)", createdAt: "2026-01-06T00:00:00Z",
  gates: [{ id: "G1", result: "Unknown", basis: "explicit", evidence: [], explanation: "Not stated." }, { id: "G2", result: "Unknown", basis: "explicit", evidence: [], explanation: "Not stated." }],
  criteria: [{ id: "C1", status: "rated", rating: 2, basis: "explicit", detail: "Full", evidence: [], explanation: "x" }, { id: "C2", status: "unknown", basis: "explicit", detail: null, evidence: [], explanation: "x" }, { id: "I1", status: "unknown", basis: "explicit", detail: null, evidence: [], explanation: "x" }],
  otherResults: [], constraints: [], strengths: [], gaps: [], manualReview: [], screening: null, questions,
  clientView: { summary: "Synthetic.", preparedBy: "", statusRule: "", strengths: [], gaps: [], statuses: {} } });
const page = (r: AssessmentRecord, sets: ScreeningSet[] = [SET()]) => renderToStaticMarkup(<AssessmentSummary v={viewOf(r, config, [], [])} onChanged={() => {}} screeningSets={sets} />);
const section = (h: string) => h.slice(h.indexOf("<summary>Screening questions"), h.indexOf("<summary>Review or change assessment"));
const core = (h: string) => { const s = section(h); return s.slice(s.indexOf('<ol class="sc-qs sc-qs-core">'), s.indexOf("Follow-up questions for this candidate")); };
const A = rec("syn-a", [{ q: "Synthetic follow-up about margins for A?", for: "C2" }]), B = rec("syn-b", [{ q: "Synthetic follow-up about the licence for B?", for: "G1, C1" }, { q: "Synthetic follow-up with no core match?", for: "I1" }]);

describe("one versioned core set, shared by every candidate for the role", () => {
  it("shows the same core questions, in the same order, for every candidate, with the set and version named", () => {
    const a = page(A), b = page(B);
    expect(core(a)).toBe(core(b));
    expect(section(a)).toContain("Core questions: Synthetic role: core screening questions, version 1. The same questions for every candidate for this role.");
    expect(core(a).match(/<li class="small" id="sq-Q\d+">/g)).toHaveLength(9);
    expect(core(a)).toContain('<ol class="sc-qs sc-qs-core">'); // unnumbered list: the IDs number them
  });
  it("shows for each question what it checks, whether it is scored or only confirms, and proposed answer points needing business review", () => {
    const s = section(page(A));
    expect(s).toContain("Ownership and results · Checks: Winning synthetic deals · Scored 1 to 5");
    expect(s).toContain("Essential requirement · Checks: Synthetic licence · Confirms a requirement; not scored");
    expect(s).toContain("Knowledge of the role · Scored 1 to 5"); // an area question names its area once
    expect(s).toMatch(/<b>Proposed answer points \(need business review\):<\/b><ul class="sc-points"><li>Synthetic point for Q1<\/li>/);
    expect(s).toContain('<p class="xs sc-flag" style="margin:0 0 4px">Synthetic proposal.</p>'); // the set's own review note, once
    expect(s).toContain("<b>Never rate accent, speed of speech, appearance or personal details.</b>");
    expect(section(page(A, [SET({ status: "approved" })]))).not.toMatch(/need business review/);
  });
});

describe("candidate follow-ups add to the core set", () => {
  it("lists each candidate's own follow-ups after the unchanged core set, pointing to the core questions whose answer points apply", () => {
    const a = section(page(A)), b = section(page(B));
    expect(a).toContain("Follow-up questions for this candidate (1)");
    expect(a).toContain("Synthetic follow-up about margins for A?");
    expect(a).toContain("Checks: Synthetic margins · Adds detail to core question Q8");
    expect(a).toMatch(/From core question Q8:<\/span><ul class="sc-points"><li>Synthetic point for Q8<\/li>/);
    expect(b).toContain("Checks: Synthetic licence, Winning synthetic deals · Adds detail to core question Q3, Q9");
    expect(b).toContain("<b>Answer guide: </b>Not prepared for Synthetic reporting"); // no core question and no requirement points: nothing is invented
    expect(a).not.toContain("Synthetic follow-up about the licence for B?");
    expect(followUpsFor(B, SET()).map((f) => [f.text, f.checks, f.coreIds, f.guide.map((g) => g.from), f.missing])).toEqual([
      ["Synthetic follow-up about the licence for B?", ["G1", "C1"], ["Q3", "Q9"], [{ core: "Q3" }, { core: "Q9" }], []],
      ["Synthetic follow-up with no core match?", ["I1"], [], [], ["I1"]]]);
  });
});

describe("versioning", () => {
  it("uses the latest set written for exactly these rules, never one for another rules version", () => {
    expect(coreSetFor([SET(), SET({ version: 2, title: "Synthetic v2" })], config).set?.version).toBe(2);
    const other = coreSetFor([SET({ rules: { id: config.id, version: 9 } })], config);
    expect([other.set, other.problems[0]]).toEqual([null, `the question set was written for rules ${config.id} version 9, not version 1 of these rules`]);
    expect(coreSetFor([SET({ rules: { id: config.id, version: 9 }, version: 3 }), SET()], config).set?.version).toBe(1);
  });
  it("shows no core set, with the reason, when the recorded file changed or the set is incomplete", () => {
    expect(section(page(A, [SET({ loadProblems: ["the question set has changed since it was recorded"] })]))).toContain("No core question set is shown: the question set has changed since it was recorded.");
    expect(section(page(A, []))).toContain("No core question set has been recorded for these rules.");
  });
  it("checks coverage: every starter area, every critical skill and every essential requirement; no essential requirement is scored", () => {
    expect(screeningSetProblems(SET(), config)).toEqual([]);
    const without = (ids: string[]) => SET({ questions: SET().questions.filter((x) => !ids.includes(x.id)) });
    expect(screeningSetProblems(without(["Q2"]), config)).toContain('no question covers "Communication"');
    expect(screeningSetProblems(without(["Q8"]), config)).toContain("no question covers the critical skill C2");
    expect(screeningSetProblems(without(["Q9"]), config)).toContain("no question confirms the essential requirement G1");
    expect(screeningSetProblems(SET({ questions: [...SET().questions, q("Q10", "Essential requirement", "scored", ["G1"])] }), config)).toContain("question Q10 would score an essential requirement or practical point");
    expect(screeningSetProblems(SET({ questions: [...SET().questions, q("Q11", "Problem solving", "scored", ["X9"])] }), config)).toContain("question Q11 checks X9, which is not in these rules");
    expect(STARTER_AREAS).toHaveLength(7);
  });
});

describe("unanswered: nothing is asked, recorded or scored", () => {
  it("every question is 'Not answered' and screening is 'Not assessed', with no score", () => {
    const s = section(page(B));
    expect(s.match(/chip c-mute">Not answered</g)).toHaveLength(9 + 2);
    expect(s).toContain('<b>Screening: </b><span class="chip c-mute">Not assessed</span> No answers have been added, so there is no screening score.');
    expect(s).not.toMatch(/screening score \d|Rated \d|Proposed rating|Recruiter rating|chip c-info">Answered/i);
  });
  it("the client view shows no screening questions, and the record is unchanged", () => {
    const r = rec("syn-c", [{ q: "Synthetic follow-up?", for: "C2" }]), before = JSON.stringify(r), v = viewOf(r, config, [], []);
    expect(renderToStaticMarkup(<ClientAssessmentSummary v={v} />)).not.toMatch(/Synthetic question Q|Synthetic follow-up|Not answered/);
    page(r);
    expect(JSON.stringify(r)).toBe(before);
    expect(v.screening.status).toBe("not-assessed");
  });
});

/* W1 follow-up guides: every follow-up has a guide for everything it checks. A core question's points apply only to the
   requirements it covers; any other requirement uses its own answer points from the set; none is invented. */
describe("every follow-up has a relevant answer guide", () => {
  const V2 = () => SET({ version: 2, requirementPoints: { I1: { points: ["Synthetic reporting point"], source: "Synthetic JD line" } } });
  const C = rec("syn-c", [{ q: "Synthetic margins and reporting?", for: "C2, I1" }, { q: "Synthetic reporting only?", for: "I1" }, { q: "Synthetic licence again?", for: "G1" }]);
  it("a follow-up covered only in part by a core question gets the core points and the missing requirement's own points", () => {
    const [f] = followUpsFor(C, V2());
    expect([f.guide.map((g) => [g.from, g.points]), f.missing]).toEqual([[[{ core: "Q8" }, ["Synthetic point for Q8"]], [{ requirement: "I1" }, ["Synthetic reporting point"]]], []]);
    const s = section(page(C, [V2()]));
    expect(s).toMatch(/From core question Q8:<\/span><ul class="sc-points"><li>Synthetic point for Q8<\/li><\/ul><\/div><div style="margin-top:2px"><span class="muted">For Synthetic reporting:<\/span><ul class="sc-points"><li>Synthetic reporting point<\/li>/);
  });
  it("a follow-up no core question covers gets its requirement's points; one wholly covered inherits the core guide only", () => {
    const [, r, g] = followUpsFor(C, V2());
    expect([r.guide.map((x) => x.from), r.missing]).toEqual([[{ requirement: "I1" }], []]);
    expect([g.guide.map((x) => x.from), g.missing]).toEqual([[{ core: "Q9" }], []]);
  });
  it("every follow-up has a guide, none says 'Not prepared', and undefined expectations are marked for business review", () => {
    const set = SET({ version: 2, requirementPoints: { I1: { points: ["Synthetic reporting point"], source: "Synthetic", reviewNote: "The synthetic JD does not say how much reporting is expected." } } });
    const all = followUpsFor(C, set);
    expect(all.every((f) => f.guide.length > 0 && f.missing.length === 0 && f.guide.every((x) => x.points.length > 0))).toBe(true);
    const s = section(page(C, [set]));
    expect(s).not.toContain("Not prepared");
    expect(s).toContain("Needs business review: The synthetic JD does not say how much reporting is expected.");
    expect(s.match(/chip c-mute">Not answered</g)).toHaveLength(9 + 3); // still unanswered
    expect(s).toContain('<span class="chip c-mute">Not assessed</span>');
  });
  it("requirement points must name a requirement in these rules, not compete with a core question, and not be empty", () => {
    expect(screeningSetProblems(V2(), config)).toEqual([]);
    expect(screeningSetProblems(SET({ requirementPoints: { X9: { points: ["x"], source: "x" }, C1: { points: ["x"], source: "x" }, I1: { points: [], source: "x" } } }), config))
      .toEqual(["answer points are given for X9, which is not in these rules", "answer points for C1 would compete with the core question that covers it", "answer points for I1 are empty"]);
  });
});

/* W2 display: answers, draft ratings and corrections in the recruiter section (synthetic record). */
describe("answers and draft ratings on the recruiter page", () => {
  const save = { kind: "answers" as const, revision: 1, at: "2026-01-10T00:00:00Z", by: "Synthetic recruiter", set: { id: "syn-screening", version: 1, sha256: "s" },
    answers: { Q1: "Visiting customers and keeping the top accounts close.", Q9: "Yes, I hold the licence." }, followUps: { "F1:Synthetic follow-up about margins for A?": { question: "Synthetic follow-up about margins for A?", answer: "Margins rose 2 points." } }, excerpt: "" };
  const record = (entries: unknown[]) => ({ ...A, screeningRecord: { schema: "screening-record/1" as const, assessmentId: A.id, entries: entries as never } });
  const html = (entries: unknown[]) => section(page(record(entries), [SET({ sha256: "s" })]));
  it("restores saved answers, shows Not answered for the rest, and Answered in a follow-up where only a follow-up was answered", () => {
    const h = html([save]);
    expect(h).toContain(">Visiting customers and keeping the top accounts close.</textarea>");
    expect(h).toMatch(/id="sq-Q2">.*?chip c-mute">Not answered</);
    expect(h).toMatch(/id="sq-Q8">.*?chip c-info">Answered in a follow-up</); // Q8 is supported by the margins follow-up
    expect(h).toContain("Answers recorded for 2 of 9 core questions; 0 of 6 scored questions rated. No screening score is calculated.");
    expect(h).toMatch(/id="sq-Q9">.*?Confirms a requirement: the answer is recorded, with no rating and no points\./);
  });
  it("shows a proposed rating as a draft with its quote and reason, a dropped one with why, and a recruiter's correction with earlier versions", () => {
    const proposal = { kind: "proposal", revision: 2, at: "2026-01-10T00:01:00Z", route: "Fake proposer", isAi: false, answersRevision: 1,
      ratings: { Q1: { rating: 3, quote: "keeping the top accounts close", reason: "Covers close contact with top accounts." } }, dropped: [{ questionId: "Q8", problem: "the quote is not word for word in the answer given" }] };
    const h1 = html([save, proposal]);
    expect(h1).toContain("Proposed rating 3 of 5</span><b class=\"sc-flag\"> Draft — recruiter review needed (prepared by Fake proposer).</b>");
    expect(h1).toContain("<q>keeping the top accounts close</q>");
    expect(h1).toContain("No draft rating: the quote is not word for word in the answer given.");
    const fix = { kind: "correction", revision: 3, at: "2026-01-10T00:02:00Z", reviewer: "R", questionId: "Q1", from: 3, to: 4, quote: "Visiting customers", reason: "Both points are covered.", answersRevision: 1 };
    const h2 = html([save, proposal, fix]);
    expect(h2).toContain("Recruiter rating 4 of 5");
    expect(h2).toContain("Earlier versions: proposed 3");
    expect(h2).not.toContain("Draft — recruiter review needed (prepared by Fake proposer).</b></div><div class=\"sc-q\"><q>Visiting");
  });
  it("keeps the answers with the question-set version they were saved with", () => {
    const h = section(page(record([save]), [SET({ sha256: "s" }), SET({ version: 2, sha256: "t", title: "Synthetic v2" })]));
    expect(h).toContain("Core questions: Synthetic role: core screening questions, version 1. The same questions for every candidate for this role. Answers are kept with this version.");
    expect(section(page(record([save]), [SET({ sha256: "changed" })]))).toContain("No core question set is shown: the question set these answers were saved with is no longer available unchanged.");
  });
});

/* W2 fix 2: save, propose and correct recover from a network failure. */
describe("recovering from a failed request", () => {
  it("always clears the busy state, shows the plain retry message, and never retries", async () => {
    const busy: boolean[] = [], shown: string[] = [];
    let calls = 0;
    const r = await guarded(async () => { calls++; throw new TypeError("Failed to fetch"); }, (b) => busy.push(b), (t) => shown.push(t), "The answers were not saved. Try again.");
    expect([r, calls, busy, shown]).toEqual([null, 1, [true, false], ["The answers were not saved. Try again."]]);
  });
  it("returns the result and clears the busy state when the request succeeds", async () => {
    const busy: boolean[] = [];
    expect(await guarded(async () => "ok", (b) => busy.push(b), () => { throw new Error("no message expected"); }, "x")).toBe("ok");
    expect(busy).toEqual([true, false]);
  });
  it("has plain-English retry messages that keep typed answers and never promise an automatic retry of AI requests", () => {
    expect(RETRY.save).toMatch(/not saved.*still on this page.*Save answers again/s);
    expect(RETRY.propose).toMatch(/not retried automatically/);
    expect(RETRY.propose).toMatch(/may already have used AI allowance/);
    expect(RETRY.correct).toMatch(/not saved.*still here.*Save rating again/s);
  });
});

/* W3 display: the screening-call summary on the recruiter page (synthetic record). */
describe("screening call summary on the recruiter page", () => {
  const save = { kind: "answers" as const, revision: 1, at: "2026-01-10T00:00:00Z", by: "Synthetic recruiter", set: { id: "syn-screening", version: 1, sha256: "s" },
    answers: { Q1: "Visiting customers and keeping the top accounts close.", Q3: "I won 12 new synthetic accounts in 2025." }, followUps: {}, excerpt: "", excerptFor: [] };
  const content = { strengths: [{ text: "Counts new accounts.", quote: "I won 12 new synthetic accounts", questionId: "Q3" }], concerns: [{ text: "Brief on account care." }],
    communication: { text: "Answered the questions asked and gave a result." }, summary: ["Line one.", "Line two.", "Line three.", "Line four."] };
  const set = SET({ sha256: "s" });
  const recOf = (entries: unknown[]) => ({ ...A, screeningRecord: { schema: "screening-record/1" as const, assessmentId: A.id, entries: entries as never } });
  const callSummary = (entries: unknown[]) => { const h = page(recOf(entries), [set]); return h.slice(h.indexOf("<h3 style=\"margin:16px 0 6px\">Screening call summary</h3>"), h.indexOf("<summary>Review or change assessment")); };
  const keyFor = (entries: unknown[]) => stateKey({ schema: "screening-record/1", assessmentId: A.id, entries: entries as never }, set);
  it("shows a draft labelled for review, with quotes, the system's list of unanswered questions, and no score", () => {
    const draft = { kind: "summaryDraft", revision: 2, at: "2026-01-10T00:01:00Z", route: "Fake summariser", isAi: false, stateKey: keyFor([save]), content, dropped: ["concern 2: the quote is not word for word in the answer to Q1"] };
    const h = callSummary([save, draft]);
    expect(h).toContain("Draft — recruiter review needed (prepared by Fake summariser).");
    expect(h).toContain("Counts new accounts.<div class=\"sc-q\"><q>I won 12 new synthetic accounts</q><div class=\"src\">Answer to Q3 (Ownership and results)</div>");
    expect(h).toContain("Not answered yet (7)");
    expect(h).toContain("Q4 (Problem solving; scored). Not answered yet; this is not a failure.");
    expect(h).toContain("Q6 (Fit with the client&#x27;s working conditions; confirmation only). Not answered yet; this is not a failure.");
    expect(h).toContain("From the saved answers: 2 of 6 scored questions and 0 of 3 confirmation-only questions answered. Counts are never taken from the summary text.");
    expect(h).toContain("Left out of the draft: concern 2: the quote is not word for word in the answer to Q1.");
    expect(h).toContain("A summary of the call, not a score or a recommendation; it is not shown to the client.");
    expect(h).not.toMatch(/Out of date|score \d|recommend (?:hiring|rejecting)/);
  });
  it("marks the summary out of date when the ratings or answers it describes have changed", () => {
    const draft = { kind: "summaryDraft", revision: 2, at: "2026-01-10T00:01:00Z", route: "Fake summariser", isAi: false, stateKey: keyFor([save]), content, dropped: [] };
    const fix = { kind: "correction", revision: 3, at: "2026-01-10T00:02:00Z", reviewer: "R", questionId: "Q3", from: null, to: 4, quote: "I won 12 new synthetic accounts", reason: "Counted, with a year.", answersRevision: 1 };
    expect(callSummary([save, draft, fix])).toContain("<b>Out of date: </b>the answers or ratings changed after this summary was written. Review it again before relying on it.");
  });
  it("shows a recruiter-confirmed version, with earlier versions kept", () => {
    const draft = { kind: "summaryDraft", revision: 2, at: "2026-01-10T00:01:00Z", route: "Fake summariser", isAi: false, stateKey: keyFor([save]), content, dropped: [] };
    const reviewed = { kind: "summaryReview", revision: 3, at: "2026-01-11T00:00:00Z", reviewer: "Synthetic recruiter", stateKey: keyFor([save]), content, basedOnRevision: 2 };
    const h = callSummary([save, draft, reviewed]);
    expect(h).toContain("Reviewed by Synthetic recruiter on 11 Jan");
    expect(h).toContain("Earlier versions: draft 10 Jan");
    expect(h).not.toContain("Draft — recruiter review needed (prepared by");
  });
  it("names a follow-up as the source of a quote taken from its answer", () => {
    const withFu = { ...save, followUps: { "F1:Synthetic follow-up about margins for A?": { question: "Synthetic follow-up about margins for A?", answer: "Margins rose 2 points after I stopped discounting." } } };
    const c2 = { ...content, strengths: [{ text: "Improved margin.", quote: "Margins rose 2 points", followUp: "F1:Synthetic follow-up about margins for A?" }] };
    const draft = { kind: "summaryDraft", revision: 2, at: "2026-01-10T00:01:00Z", route: "Fake summariser", isAi: false, stateKey: keyFor([withFu]), content: c2, dropped: [] };
    expect(callSummary([withFu, draft])).toContain("<q>Margins rose 2 points</q><div class=\"src\">Answer to follow-up 1: Synthetic follow-up about margins for A?</div>");
  });
  it("is never shown in the client view", () => {
    const r = recOf([save, { kind: "summaryDraft", revision: 2, at: "2026-01-10T00:01:00Z", route: "Fake summariser", isAi: false, stateKey: "", content, dropped: [] }]);
    expect(renderToStaticMarkup(<ClientAssessmentSummary v={viewOf(r, config, [], [])} />)).not.toMatch(/Screening call summary|Counts new accounts|Line one/);
  });
});

/* W4 display: CV claims against the call on the recruiter page (synthetic record). */
describe("CV claims and the call on the recruiter page", () => {
  const save = { kind: "answers" as const, revision: 1, at: "2026-01-10T00:00:00Z", by: "Synthetic recruiter", set: { id: "syn-screening", version: 1, sha256: "s" },
    answers: { Q8: "I raised margins by 4 points in 2025.", Q9: "My licence is being renewed." }, followUps: {}, excerpt: "", excerptFor: [] };
  const review = { kind: "claimReview", revision: 2, at: "2026-01-10T00:01:00Z", route: "Fake CV checker", isAi: false, answersRevision: 1, dropped: ["proposal 3: the call quote is not word for word in the answer it cites"], items: [
    { id: "C1", requirementId: "C1", cvState: { status: "rated", rating: 2 }, cvQuote: null, cvPage: null, callQuote: "raised margins by 4 points", callSource: { questionId: "Q8" }, explanation: "The call lowers the deals rating.", proposal: { type: "correction", next: { status: "rated", rating: 1 } } },
    { id: "C2", requirementId: "G1", cvState: { status: "gate", result: "Unknown" }, cvQuote: null, cvPage: null, callQuote: "being renewed", callSource: { questionId: "Q9" }, explanation: "Validity now is unclear.", proposal: { type: "conflict" } }] };
  const recOf = (entries: unknown[]) => ({ ...A, screeningRecord: { schema: "screening-record/1" as const, assessmentId: A.id, entries: entries as never } });
  const panel = (entries: unknown[]) => { const h = page(recOf(entries), [SET({ sha256: "s" })]); return h.slice(h.indexOf("CV claims and the call"), h.indexOf("<summary>Review or change assessment")); };
  it("lists proposed corrections and unresolved conflicts separately, with the CV and call evidence, as a draft that changes nothing", () => {
    const h = panel([save, review]);
    expect(h).toContain("Draft — recruiter review needed (prepared by Fake CV checker).");
    expect(h.indexOf("Proposed corrections (1)")).toBeLessThan(h.indexOf("Winning synthetic deals"));
    expect(h.indexOf("Unresolved conflicts (1)")).toBeLessThan(h.indexOf("Synthetic licence"));
    expect(h).toContain("Winning synthetic deals</b> · in the CV assessment: 2 of 3<b> · proposed: 1 of 3</b>");
    expect(h).toContain("<q>raised margins by 4 points</q><div class=\"src\">Call: answer to Q8</div>");
    expect(h).toContain("The CV does not state this.");
    expect(h).toContain("conflict: no value proposed");
    expect(h).toContain("Left out of the check: proposal 3: the call quote is not word for word in the answer it cites.");
    expect(h).toMatch(/Accept correction<\/button>.*Record as conflicting<\/button>/s);
  });
  it("shows decisions, and marks the check out of date when the answers changed", () => {
    const decided = [save, review, { kind: "claimDecision", revision: 3, at: "2026-01-10T00:02:00Z", reviewer: "R", claimReviewRevision: 2, itemId: "C1", decision: "accepted", reason: "Checked the call notes.", correctionVersion: 2 },
      { kind: "claimDecision", revision: 4, at: "2026-01-10T00:03:00Z", reviewer: "R", claimReviewRevision: 2, itemId: "C2", decision: "dismissed", reason: "The licence will be shown.", correctionVersion: null }];
    const h = panel(decided);
    expect(h).toContain("Accepted · CV version 2</span> R: Checked the call notes.");
    expect(h).toContain("Dismissed</span> R: The licence will be shown.");
    expect(h).not.toMatch(/Accept correction|Record as conflicting/);
    expect(panel([save, review, { ...save, revision: 3 }])).toContain("<b>Out of date: </b>the screening answers changed after this check.");
  });
  it("an older saved upward proposal, or one missing a CV quote the CV has, cannot be accepted: only dismissed, with the reason", () => {
    const older = { ...review, items: [
      { ...review.items[0], id: "C1", requirementId: "C2", cvState: { status: "unknown" }, proposal: { type: "correction", next: { status: "rated", rating: 3 } } },
      { ...review.items[0], id: "C3", requirementId: "C1", cvState: { status: "rated", rating: 2 } }] };
    const withEvidence = { ...A, criteria: A.criteria.map((c) => (c.id === "C1" ? { ...c, evidence: [{ quote: "Synthetic CV line about deals.", page: 1 }] } : c)) };
    const h0 = page({ ...withEvidence, screeningRecord: { schema: "screening-record/1" as const, assessmentId: A.id, entries: [save, older] as never } }, [SET({ sha256: "s" })]), h = h0.slice(h0.indexOf("CV claims and the call"));
    expect(h).toContain("Cannot be accepted: call evidence cannot raise a CV skill rating or make an unconfirmed skill rated. The answer stays with the screening.");
    expect(h).toContain("No CV quote was cited, although the CV records evidence for this.");
    expect(h).toContain("Cannot be accepted: the CV records evidence for this requirement, but the proposal does not cite it.");
    expect(h).not.toContain("Accept correction");
    expect(h.match(/>Dismiss<\/button>/g)).toHaveLength(2); // each can still be dismissed
  });
  it("says 'The CV does not state this' only when the record has no CV evidence", () => {
    const h = panel([save, review]);
    expect(h.match(/The CV does not state this\./g)).toHaveLength(2); // C1 and G1 have no CV evidence in this record
  });
  it("is never shown in the client view", () => {
    expect(renderToStaticMarkup(<ClientAssessmentSummary v={viewOf(recOf([save, review]), config, [], [])} />)).not.toMatch(/CV claims and the call|raised margins|Accept correction/);
  });
});
