/* Summaries, strengths and gaps stay consistent with the final checked assessment (synthetic, fictional data only): a
   strength resting on a requirement the checks no longer support is held for review in every presentation, the summary
   and gaps are flagged rather than rewritten, and no record, rating or score changes. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PreviewPage, type PreviewData } from "../preview/PreviewApp";
import { AssessmentSummary, ClientAssessmentSummary } from "./AssessmentPanels";
import { consistencyOf } from "./consistency";
import { viewOf, type AssessmentPayload, type AssessmentRecord, type LoadedConfig } from "./model";
import { reviewStatus } from "./AssessHome";
import { syntheticRubric } from "./syntheticFixture";
import type { Correction } from "./versions";

const config = { ...syntheticRubric(), sha256: "", frozenSha256: "", hashOk: true, recordedAt: "", cvsOpenedBefore: false } as LoadedConfig;
const REPORTING = "Logged synthetic calls in SynthCRM weekly.", DEALS = "Closed 40 synthetic deals in 2025.";
const STRENGTHS = [
  { text: "Synthetic reporting discipline, directly matching the reporting requirement.", evidence: [{ quote: REPORTING, page: 1 }] },
  { text: "Counted synthetic deal results.", evidence: [{ quote: DEALS, page: 1 }] },
  { text: "Strong Synthetic margins work.", evidence: [] },
];
const record = (): AssessmentRecord => ({
  id: "syn-k", kind: "real", label: "Candidate K", configId: config.id, configVersion: 1, producedBy: "AI route: test (ai-proposed)", createdAt: "2026-01-06T00:00:00Z",
  gates: [{ id: "G1", result: "Unknown", basis: "explicit", evidence: [], explanation: "Not stated." }, { id: "G2", result: "Unknown", basis: "explicit", evidence: [], explanation: "Not stated." }],
  criteria: [
    { id: "C1", status: "rated", rating: 3, basis: "explicit", detail: "Full", evidence: [{ quote: DEALS, page: 1 }], explanation: "Counted deals." },
    { id: "C2", status: "unknown", basis: "explicit", detail: null, evidence: [], explanation: "Rule check: margin results must be described. The AI's draft reasoning is kept in the run record." },
    { id: "I1", status: "unknown", basis: "explicit", detail: null, evidence: [{ quote: REPORTING, page: 1 }], explanation: "Rule check: regular documentation is needed. The AI's draft reasoning is kept in the run record." },
  ],
  otherResults: [], constraints: [], questions: [], manualReview: [], screening: null,
  strengths: STRENGTHS.map((s) => s.text), gaps: ["No synthetic licence is mentioned."],
  clientView: { summary: "Synthetic seller with strong reporting. No licence is stated.", preparedBy: "", statusRule: "", strengths: STRENGTHS, gaps: ["No synthetic licence is mentioned."],
    statuses: { G1: { status: "not-stated" }, G2: { status: "not-stated" }, C1: { status: "needs-review" }, C2: { status: "not-stated" }, I1: { status: "needs-review" } } },
});
const fix = (criterionId: string, previous: Correction["previous"], next: Correction["next"], version = 2): Correction =>
  ({ assessmentId: "syn-k", version, criterionId, previous, next, evidence: "Synthetic check.", reason: "Synthetic.", reviewer: "R", at: "2026-01-10T00:00:00Z", source: "reviewer", configId: config.id, configVersion: 1 });
/** A client summary confirmed by a recruiter, keeping the given strengths (`current` false: confirmed for an earlier state). */
const confirmedBy = (kept: typeof STRENGTHS, current = true, approvedHeld?: { text: string; reason: string }[]): Partial<AssessmentRecord> => {
  const content = { ...record().clientView!, strengths: kept };
  return { clientView: current ? content : null, clientViews: [
    { revision: 1, current: false, describes: { assessmentFingerprint: "f", assessmentVersion: 1, stateSha256: "s", rubric: { id: config.id, version: 1, sha256: "" } }, content: record().clientView!, statusRule: "", preparation: { method: "assistant-prepared", actor: "AI", at: "2026-01-06T00:00:00Z" } },
    { revision: 2, current, describes: { assessmentFingerprint: "f", assessmentVersion: 2, stateSha256: "t", rubric: { id: config.id, version: 1, sha256: "" } }, content, statusRule: "", preparation: { method: "reviewer-confirmed", actor: "R", at: "2026-01-11T00:00:00Z" },
      ...(approvedHeld ? { review: { baseRevision: 1, changesSha256: "c", changes: [], retained: {}, approvedHeld } } : {}) },
  ] } as Partial<AssessmentRecord>;
};
const recruiter = (c: Correction[] = [], over: Partial<AssessmentRecord> = {}) => renderToStaticMarkup(<AssessmentSummary v={viewOf({ ...record(), ...over }, config, c, [])} onChanged={() => {}} />);
const previewOf = (c: Correction[] = [], over: Partial<AssessmentRecord> = {}) =>
  renderToStaticMarkup(<PreviewPage data={{ schema: "assessment-preview/1", generatedAt: "2026-01-07T00:00:00Z", config, assessments: [{ ...record(), ...over, corrections: c }] }} />);
const strengthsBox = (h: string) => h.slice(h.indexOf("<h3>Strengths</h3>"), h.indexOf("<h3>To confirm"));
const shownList = (h: string) => { const b = strengthsBox(h); return b.slice(0, b.includes('class="sc-held"') ? b.indexOf('class="sc-held"') : undefined); };

describe("strengths that rest on a requirement the checks no longer support", () => {
  it("are held for review when a quote is word for word that requirement's evidence, or the text names it; others stay", () => {
    const v = viewOf(record(), config, [], []), fit = consistencyOf(v, STRENGTHS.map((s) => ({ text: s.text, quotes: s.evidence })));
    expect(fit.undercut.map((x) => [x.id, x.by])).toEqual([["C2", "rule check"], ["I1", "rule check"]]);
    expect(fit.held.map((x) => [x.text, x.because.map((b) => b.id)])).toEqual([[STRENGTHS[0].text, ["I1"]], [STRENGTHS[2].text, ["C2"]]]);
    expect(fit.shown.map((x) => x.text)).toEqual([STRENGTHS[1].text]);
  });
  it("recruiter page: not listed as strengths; held with the reason, verbatim, with no replacement wording", () => {
    const h = recruiter();
    expect(shownList(h)).toContain("Counted synthetic deal results.");
    expect(shownList(h)).not.toMatch(/directly matching the reporting requirement|Strong Synthetic margins work/);
    expect(strengthsBox(h)).toContain("Held for review (2): not shown as strengths, because the final assessment does not support what they rest on.");
    expect(strengthsBox(h)).toContain("Synthetic reporting discipline, directly matching the reporting requirement.");
    expect(strengthsBox(h)).toContain("It rests on Synthetic reporting (now Not confirmed). It stays held, even if a rating is later raised, until a recruiter keeps this strength when confirming the client summary. No replacement wording is written.");
    expect(h.slice(h.indexOf("<summary>All requirements"))).not.toMatch(/Further strengths in the draft/); // held strengths are not listed again as strengths
  });
  it("client view: held strengths are not shown, and the client is told some are being checked, without internal detail", () => {
    const c = renderToStaticMarkup(<ClientAssessmentSummary v={viewOf(record(), config, [], [])} />);
    expect(c).toContain("<li>Counted synthetic deal results.</li>");
    expect(c).not.toMatch(/directly matching the reporting requirement|Strong Synthetic margins work|rule check|Rule check/);
    expect(c).toContain("2 further strengths are being checked by a recruiter.");
    expect(c).toContain("A recruiter is checking parts of this summary against the requirements below.");
  });
  it("saved preview: the same as the recruiter page", () => {
    const data: PreviewData = { schema: "assessment-preview/1", generatedAt: "2026-01-07T00:00:00Z", config, assessments: [record()] };
    const p = renderToStaticMarkup(<PreviewPage data={data} />);
    expect(shownList(p)).not.toMatch(/directly matching the reporting requirement/);
    expect(strengthsBox(p)).toContain("Held for review (2)");
  });
  it("a recruiter raising the rating does not release it: the strength stays held, in every presentation", () => {
    const raise = [fix("I1", { status: "unknown" }, { status: "rated", rating: 2 })], v = viewOf(record(), config, raise, []);
    const h = recruiter(raise), c = renderToStaticMarkup(<ClientAssessmentSummary v={v} />), p = previewOf(raise);
    expect(shownList(h)).not.toContain("directly matching the reporting requirement");
    expect(strengthsBox(h)).toContain("Held for review (2)");
    expect(strengthsBox(h)).toContain("It rests on Synthetic reporting (now 2)."); // the state now is shown, and it is still held
    expect(c).not.toContain("directly matching the reporting requirement");
    expect(c).toContain("2 further strengths are being checked by a recruiter.");
    expect(shownList(p)).not.toContain("directly matching the reporting requirement");
  });
  it("it is released only when a recruiter actively approves that strength, with a reason, in a client summary confirmed for the current assessment", () => {
    const raise = [fix("I1", { status: "unknown" }, { status: "rated", rating: 2 })], REASON = "Synthetic: checked the call logs with the candidate.";
    const kept = confirmedBy([STRENGTHS[0], STRENGTHS[1]], true, [{ text: STRENGTHS[0].text, reason: REASON }]), dropped = confirmedBy([STRENGTHS[1]]);
    /* Kept without an approval (a default tick or an older confirmation) or with too short a reason: still held everywhere. */
    for (const over of [confirmedBy([STRENGTHS[0], STRENGTHS[1]]), confirmedBy([STRENGTHS[0], STRENGTHS[1]], true, []), confirmedBy([STRENGTHS[0], STRENGTHS[1]], true, [{ text: STRENGTHS[0].text, reason: "ok" }])]) {
      expect(shownList(recruiter(raise, over))).not.toContain("directly matching the reporting requirement");
      expect(renderToStaticMarkup(<ClientAssessmentSummary v={viewOf({ ...record(), ...over }, config, raise, [])} />)).not.toContain("directly matching the reporting requirement");
      expect(shownList(previewOf(raise, over))).not.toContain("directly matching the reporting requirement");
    }
    const h = recruiter(raise, kept);
    expect(shownList(h)).toContain("directly matching the reporting requirement");
    expect(strengthsBox(h)).toContain("Held for review (1)"); // the margins claim was not kept, so it stays held
    expect(shownList(recruiter(raise, dropped))).not.toContain("directly matching the reporting requirement");
    expect(shownList(recruiter(raise, confirmedBy([STRENGTHS[0]], false)))).not.toContain("directly matching the reporting requirement"); // an older confirmation does not count
    const c = renderToStaticMarkup(<ClientAssessmentSummary v={viewOf({ ...record(), ...kept }, config, raise, [])} />);
    expect(c).toContain("<li>Synthetic reporting discipline, directly matching the reporting requirement.</li>");
    expect(shownList(previewOf(raise, kept))).toContain("directly matching the reporting requirement");
  });
  it("a strength held because a recruiter lowered its requirement stays held when the rating is later restored or raised", () => {
    const down = fix("C1", { status: "rated", rating: 3 }, { status: "unknown" }), back = fix("C1", { status: "unknown" }, { status: "rated", rating: 3 }, 3);
    const h = recruiter([down, back]);
    expect(shownList(h)).not.toContain("Counted synthetic deal results.");
    expect(strengthsBox(h)).toContain("It rests on Winning synthetic deals (now 3).");
    expect(h).toContain("Winning synthetic deals (now 3)"); // and the summary stays marked
  });
  it("a recruiter correction that lowers a requirement holds the strengths resting on it", () => {
    const h = recruiter([fix("C1", { status: "rated", rating: 3 }, { status: "unknown" })]);
    expect(shownList(h)).not.toContain("Counted synthetic deal results.");
    expect(strengthsBox(h)).toContain("It rests on Winning synthetic deals (now Not confirmed).");
  });
});

describe("summaries and gaps are flagged, never rewritten", () => {
  const FLAG = "Marked for review: the AI wrote this summary before these changes, so parts of it may no longer hold. Its wording is kept as written. Changed since:";
  it("after a decrease: the summary keeps its words and is marked for review, naming what changed", () => {
    const h = recruiter();
    expect(h).toContain("<b>Summary.</b> Synthetic seller with strong reporting. No licence is stated.</p>");
    expect(h).toContain(`${FLAG} Synthetic margins (now Not confirmed), Synthetic reporting (now Not confirmed).`);
  });
  it("after an increase only: a newly confirmed requirement can contradict 'No licence is stated', so the summary is marked too, in every presentation", () => {
    const clean = { ...record(), criteria: record().criteria.map((c) => ({ ...c, explanation: "Synthetic." })) }, up = [fix("G1", { status: "gate", result: "Unknown" }, { status: "gate", result: "Pass" })];
    const v = viewOf(clean, config, up, []), h = renderToStaticMarkup(<AssessmentSummary v={v} onChanged={() => {}} />);
    expect(h).toContain("<b>Summary.</b> Synthetic seller with strong reporting. No licence is stated.</p>"); // wording kept
    expect(h).toContain(`${FLAG} Synthetic licence (now Met on the CV · provisional).`);
    expect(renderToStaticMarkup(<ClientAssessmentSummary v={v} />)).toContain("A recruiter is checking parts of this summary against the requirements below.");
    const p = renderToStaticMarkup(<PreviewPage data={{ schema: "assessment-preview/1", generatedAt: "2026-01-07T00:00:00Z", config, assessments: [{ ...clean, corrections: up }] }} />);
    expect(p).toContain(`${FLAG} Synthetic licence (now Met on the CV · provisional).`);
    expect(strengthsBox(h)).not.toContain("Held for review"); // a raise alone holds no strength
  });
  it("after both: every change is named; a recruiter confirming the client summary for the current assessment clears the mark", () => {
    const both = [fix("G1", { status: "gate", result: "Unknown" }, { status: "gate", result: "Pass" }), fix("C1", { status: "rated", rating: 3 }, { status: "unknown" }, 3)];
    expect(recruiter(both)).toContain(`${FLAG} Synthetic margins (now Not confirmed), Synthetic reporting (now Not confirmed), Winning synthetic deals (now Not confirmed), Synthetic licence (now Met on the CV · provisional).`);
    const ok = recruiter(both, confirmedBy([STRENGTHS[1]]));
    expect(ok).not.toContain("Marked for review");
    expect(renderToStaticMarkup(<ClientAssessmentSummary v={viewOf({ ...record(), ...confirmedBy([STRENGTHS[1]]) }, config, both, [])} />)).not.toContain("A recruiter is checking parts of this summary");
  });
  it("gaps are flagged when a recruiter has since raised a requirement", () => {
    const h = recruiter([fix("G1", { status: "gate", result: "Unknown" }, { status: "gate", result: "Pass" })]);
    expect(h).toContain("Check these gaps: written before a recruiter changed Synthetic licence (now Met on the CV · provisional).");
    expect(h).toContain("No synthetic licence is mentioned.");
    const c = renderToStaticMarkup(<ClientAssessmentSummary v={viewOf(record(), config, [fix("G1", { status: "gate", result: "Unknown" }, { status: "gate", result: "Pass" })], [])} />);
    expect(c).toContain("A recruiter has updated some requirements since these points were written; they are being checked.");
  });
  it("nothing is flagged or held when nothing changed", () => {
    const clean = { ...record(), criteria: record().criteria.map((c) => ({ ...c, explanation: "Synthetic." })) };
    const h = renderToStaticMarkup(<AssessmentSummary v={viewOf(clean, config, [], [])} onChanged={() => {}} />);
    expect(h).not.toMatch(/Held for review|Check this summary|Check these gaps/);
    expect(shownList(h)).toContain("Strong Synthetic margins work.");
  });
});

describe("no record, rating or score changes", () => {
  it("rendering leaves the record and the result exactly as they were", () => {
    const rec = record(), before = JSON.stringify(rec), v = viewOf(rec, config, [], []), result = JSON.stringify(v.latest.result);
    renderToStaticMarkup(<><AssessmentSummary v={v} onChanged={() => {}} /><ClientAssessmentSummary v={v} /></>);
    expect(JSON.stringify(rec)).toBe(before);
    expect(JSON.stringify(viewOf(rec, config, [], []).latest.result)).toBe(result);
  });
});

describe("confirming without selecting a held strength leaves it held everywhere", () => {
  it("recruiter page, client view and saved preview, even though the confirmed summary no longer lists it", () => {
    const down = [fix("I1", { status: "unknown" }, { status: "rated", rating: 2 })], over = confirmedBy([STRENGTHS[1]]); // the held strengths were not ticked
    const h = recruiter(down, over);
    expect(shownList(h)).not.toContain("directly matching the reporting requirement");
    expect(strengthsBox(h)).toContain("It rests on Synthetic reporting (now 2)."); // its quotes are found in the earlier revision
    expect(renderToStaticMarkup(<ClientAssessmentSummary v={viewOf({ ...record(), ...over }, config, down, [])} />)).not.toContain("directly matching the reporting requirement");
    expect(shownList(previewOf(down, over))).not.toContain("directly matching the reporting requirement");
  });
});

describe("the client-summary confirmation form", () => {
  /* A client summary awaiting review after the checks changed the assessment (synthetic). */
  const pending = (): AssessmentRecord => ({ ...record(), clientView: null, latestStateSha: "s".repeat(64), rubric: { id: config.id, version: 1, sha256: "" },
    run: { runId: "r", createdAt: "2026-01-06T00:00:00Z", resultSha256: "", assessmentFingerprint: "f".repeat(64) },
    review: { baseRevision: 1, changes: [], affected: [], changesSha256: "c".repeat(64) },
    clientViews: [{ revision: 1, current: false, describes: { assessmentFingerprint: "f".repeat(64), assessmentVersion: 1, stateSha256: "s".repeat(64), rubric: { id: config.id, version: 1, sha256: "" } },
      content: record().clientView!, statusRule: "", preparation: { method: "assistant-prepared", actor: "AI", at: "2026-01-06T00:00:00Z" } }] } as AssessmentRecord);
  const form = () => { const h = renderToStaticMarkup(<AssessmentSummary v={viewOf(pending(), config, [], [])} onChanged={() => {}} />); return h.slice(h.indexOf("Strengths to keep"), h.indexOf("Points to clarify (one per line)") > 0 ? h.length : h.length); };
  const box = (h: string, text: string) => { const i = h.indexOf(text); return h.slice(h.lastIndexOf("<input", i), i); };
  it("starts held strengths unticked and marked, and other strengths ticked as before", () => {
    const h = form();
    expect(box(h, "Synthetic reporting discipline, directly matching the reporting requirement.")).not.toMatch(/checked/);
    expect(box(h, "Strong Synthetic margins work.")).not.toMatch(/checked/);
    expect(box(h, "Counted synthetic deal results.")).toMatch(/checked=""/);
    expect(h).toContain("Held for review: it rests on Synthetic reporting (now Not confirmed). Not kept unless you tick it and give a reason.");
    expect(h).not.toContain("Why does this strength still stand?"); // the reason box appears only once a held strength is ticked
  });
  it("still offers, unticked, a held strength that an earlier confirmation left out, so it can be approved later", () => {
    const rec = pending(), first = rec.clientViews![0];
    rec.clientViews = [first, { ...first, revision: 2, content: { ...first.content, strengths: [STRENGTHS[1]] }, preparation: { method: "reviewer-confirmed", actor: "R", at: "2026-01-11T00:00:00Z" } }];
    rec.review = { ...rec.review!, baseRevision: 2 };
    const all = renderToStaticMarkup(<AssessmentSummary v={viewOf(rec, config, [], [])} onChanged={() => {}} />), h = all.slice(all.indexOf("Strengths to keep"));
    expect(box(h, "Synthetic reporting discipline, directly matching the reporting requirement.")).not.toMatch(/checked/);
    expect(box(h, "Counted synthetic deal results.")).toMatch(/checked=""/);
  });
});

describe("initial review of the prepared draft (F2)", () => {
  const cur = (method: string, revision: number, content = record().clientView!) => ({ revision, current: true, describes: { assessmentFingerprint: "f".repeat(64), assessmentVersion: 1, stateSha256: "s".repeat(64), rubric: { id: config.id, version: 1, sha256: "" } },
    content, statusRule: "", preparation: { method, actor: method === "reviewer-confirmed" ? "Synthetic reviewer" : "AI", at: "2026-01-11T00:00:00Z" } });
  const draft = (): AssessmentRecord => ({ ...record(), latestStateSha: "s".repeat(64), rubric: { id: config.id, version: 1, sha256: "" }, review: null,
    run: { runId: "r", createdAt: "2026-01-06T00:00:00Z", resultSha256: "", assessmentFingerprint: "f".repeat(64) },
    clientViews: [cur("assistant-prepared", 1)], initialReview: { baseRevision: 1, changesSha256: "i".repeat(64) } } as AssessmentRecord);
  const page = (rec: AssessmentRecord) => renderToStaticMarkup(<AssessmentSummary v={viewOf(rec, config, [], [])} onChanged={() => {}} />);
  it("offers the summary-review form for the prepared draft without any rating change, as summary review only", () => {
    const h = page(draft()), form = h.slice(h.indexOf("Not reviewed yet"));
    expect(form).toContain("Not reviewed yet: this is the prepared draft summary.");
    expect(form).toContain("It does not change or approve the ratings, and it is not a hiring decision.");
    expect(form).toContain("Review the draft client summary (assessment version 1)");
    expect(form).toContain("I have reviewed this client summary against assessment version 1.");
    expect(form).not.toMatch(/What changed since client summary version|Why keep this unchanged\?/); // nothing changed; no reasons to keep the draft's wording
    expect(form).toMatch(/<textarea id="cvSummary"[^>]*>Synthetic seller with strong reporting\. No licence is stated\.<\/textarea>/); // editable summary
    expect(form).toMatch(/<textarea id="cvGaps"[^>]*>No synthetic licence is mentioned\.<\/textarea>/); // gaps to review
  });
  it("starts held strengths unticked, with the held note, and other strengths ticked", () => {
    const h = page(draft()), form = h.slice(h.indexOf("Strengths to keep")), box = (t: string) => { const i = form.indexOf(t); return form.slice(form.lastIndexOf("<input", i), i); };
    expect(box("Synthetic reporting discipline, directly matching the reporting requirement.")).not.toMatch(/checked/);
    expect(box("Counted synthetic deal results.")).toMatch(/checked=""/);
    expect(form).toContain("Held for review: it rests on Synthetic reporting (now Not confirmed). Not kept unless you tick it and give a reason.");
  });
  it("once confirmed: says who reviewed the summary, and that this is not a rating approval or hiring decision; no form", () => {
    const reviewed = { ...draft(), initialReview: null, clientViews: [{ ...cur("assistant-prepared", 1) }, cur("reviewer-confirmed", 2)] } as AssessmentRecord;
    const h = page(reviewed);
    expect(h).toContain("Reviewed by Synthetic reviewer on 11 Jan, and matches the current assessment. This records that the summary wording was reviewed; it does not approve the ratings and is not a hiring decision.");
    expect(h).not.toContain("Confirm client summary");
  });
  it("an approval given in an initial review releases the held strength, and clears the summary's review mark (both revisions are current)", () => {
    const content = { ...record().clientView!, strengths: [STRENGTHS[0], STRENGTHS[1]] };
    const approved = { ...draft(), initialReview: null, clientView: content,
      clientViews: [cur("assistant-prepared", 1), { ...cur("reviewer-confirmed", 2, content), review: { baseRevision: 1, changesSha256: "i".repeat(64), changes: [], retained: {}, initial: true, approvedHeld: [{ text: STRENGTHS[0].text, reason: "Synthetic: confirmed in the review." }] } }] } as AssessmentRecord;
    const h = page(approved);
    expect(shownList(h)).toContain("directly matching the reporting requirement");
    expect(h).not.toContain("Marked for review");
    const unticked = { ...approved, clientViews: [cur("assistant-prepared", 1), cur("reviewer-confirmed", 2, { ...content, strengths: [STRENGTHS[1]] })], clientView: { ...content, strengths: [STRENGTHS[1]] } } as AssessmentRecord;
    expect(shownList(page(unticked))).not.toContain("directly matching the reporting requirement");
  });
  it("the scoring home shows a reviewed summary separately from the ratings", () => {
    const reviewed = { ...draft(), initialReview: null, clientViews: [{ ...cur("assistant-prepared", 1) }, cur("reviewer-confirmed", 2)] } as AssessmentRecord;
    expect(reviewStatus(reviewed as AssessmentPayload, viewOf(reviewed, config, [], []))).toBe("Ratings not reviewed by a recruiter · client summary reviewed");
    expect(reviewStatus(draft() as AssessmentPayload, viewOf(draft(), config, [], []))).toBe("Not reviewed by a recruiter");
  });
});

/* F3: the current summary is the source of the active strengths in every presentation; removed ones stay removed. */
describe("removed strengths stay removed (F3)", () => {
  const EXTRA = { text: "Synthetic weekly route planning.", evidence: [{ quote: "Planned synthetic routes weekly.", page: 1 }] };
  const all = [...STRENGTHS, EXTRA];
  const base = (): AssessmentRecord => ({ ...record(), strengths: all.map((s) => s.text), clientView: { ...record().clientView!, strengths: all } });
  /** A reviewed summary (both revisions current, as after an initial review) keeping only `kept`, with optional approvals. */
  const reviewed = (kept: typeof all, approvedHeld: { text: string; reason: string }[] = []): AssessmentRecord => {
    const rev = (n: number, method: string, strengths: typeof all, extra = {}) => ({ revision: n, current: true, describes: { assessmentFingerprint: "f", assessmentVersion: 1, stateSha256: "s", rubric: { id: config.id, version: 1, sha256: "" } },
      content: { ...record().clientView!, strengths }, statusRule: "", preparation: { method, actor: "R", at: "2026-01-11T00:00:00Z" }, ...extra });
    return { ...base(), clientView: { ...record().clientView!, strengths: kept },
      clientViews: [rev(1, "assistant-prepared", all), rev(2, "reviewer-confirmed", kept, { review: { baseRevision: 1, changesSha256: "c", changes: [], retained: {}, initial: true, approvedHeld } })] } as AssessmentRecord;
  };
  const views = (rec: AssessmentRecord) => ({
    recruiter: renderToStaticMarkup(<AssessmentSummary v={viewOf(rec, config, [], [])} onChanged={() => {}} />),
    client: renderToStaticMarkup(<ClientAssessmentSummary v={viewOf(rec, config, [], [])} />),
    preview: renderToStaticMarkup(<PreviewPage data={{ schema: "assessment-preview/1", generatedAt: "2026-01-07T00:00:00Z", config, assessments: [rec] }} />),
  });
  const history = (h: string) => h.slice(h.indexOf("Strengths not in the current summary"));
  it("an ordinary strength removed in the reviewed summary is absent from the active lists of all three views, and kept in history", () => {
    const { recruiter, client, preview } = views(reviewed([EXTRA]));
    for (const h of [recruiter, preview]) {
      expect(shownList(h)).not.toContain("Counted synthetic deal results.");
      expect(shownList(h)).toContain("Synthetic weekly route planning.");
      expect(h).toContain("Strengths not in the current summary (kept for the record, not active)");
      expect(history(h)).toContain("Counted synthetic deal results.");
      expect(history(h)).toContain("Removed in the reviewed summary.");
      expect(h.slice(h.indexOf("<summary>All requirements"))).not.toMatch(/Further strengths in the draft/);
    }
    expect(client).not.toContain("Counted synthetic deal results.");
    expect(client).toContain("<li>Synthetic weekly route planning.</li>");
  });
  it("held strengths left out stay held for explicit review: not active, not released, not re-added", () => {
    const { recruiter, client, preview } = views(reviewed([EXTRA]));
    for (const h of [recruiter, preview]) {
      expect(shownList(h)).not.toMatch(/directly matching the reporting requirement|Strong Synthetic margins work/);
      expect(strengthsBox(h)).toContain("Held for review (2)");
      expect(history(h)).not.toMatch(/directly matching the reporting requirement/); // held, not merely history
    }
    expect(client).not.toMatch(/directly matching the reporting requirement|Strong Synthetic margins work/);
  });
  it("a held strength kept and approved with a reason is active; one kept without approval stays held", () => {
    const approved = views(reviewed([STRENGTHS[0], EXTRA], [{ text: STRENGTHS[0].text, reason: "Synthetic: confirmed in the review." }]));
    expect(shownList(approved.recruiter)).toContain("directly matching the reporting requirement");
    expect(approved.client).toContain("directly matching the reporting requirement");
    const notApproved = views(reviewed([STRENGTHS[0], EXTRA]));
    for (const h of [notApproved.recruiter, notApproved.preview]) expect(shownList(h)).not.toContain("directly matching the reporting requirement");
    expect(notApproved.client).not.toContain("directly matching the reporting requirement");
  });
  it("without a reviewed summary, the active strengths are the current (draft) summary's, as before", () => {
    const h = renderToStaticMarkup(<AssessmentSummary v={viewOf(base(), config, [], [])} onChanged={() => {}} />);
    expect(shownList(h)).toContain("Counted synthetic deal results.");
    expect(shownList(h)).toContain("Synthetic weekly route planning.");
    expect(h).not.toContain("Strengths not in the current summary");
  });
});
