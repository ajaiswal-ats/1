/* The plain-English language pass (plainText.ts, AssessmentPanels.tsx) on synthetic, fictional data only: wording changes
   leave calculations, statuses and records untouched; important uncertainties stay visible; developer detail (IDs,
   fingerprints, raw times, engineering terms) is not shown; and a limited score names its real trigger. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssessmentStatus, AssessmentSummary, ClientAssessmentSummary, evidenceRows, shortSummary } from "./AssessmentPanels";
import { calculateCv } from "./calculator";
import { viewOf, type AssessmentRecord, type ClientView, type LoadedConfig } from "./model";
import { GATE, STATUS, TERMS, capExplanation, evidenceExplanation, evidencePoint, explanationText, plain, reasonLabel, resultLabel, labelsFor, sentences } from "./plainText";
import { syntheticRubric } from "./syntheticFixture";
import type { CapTrigger } from "./types";

const config = (triggers: CapTrigger[] = ["zero", "unknown"]): LoadedConfig => ({ ...syntheticRubric(), policy: { ...syntheticRubric().policy, cap: { value: 64, triggers } },
  gates: syntheticRubric().gates.map((g) => ({ ...g, testRule: "Pass when the CV says so (J17); otherwise Unknown." })),
  sha256: "a".repeat(64), frozenSha256: "a".repeat(64), hashOk: true, recordedAt: "2026-01-05T00:00:00Z", cvsOpenedBefore: false } as LoadedConfig);
const VIEW: ClientView = {
  summary: "Synthetic summary.", preparedBy: "Synthetic preparer.", statusRule: "Synthetic rule.",
  strengths: [{ text: "Synthetic strength.", evidence: [{ quote: "Synthetic quote", page: 1 }] }], gaps: ["Synthetic margins (C2) is Unknown."],
  statuses: { G1: { status: "separate" }, G2: { status: "not-stated" }, C1: { status: "needs-review" }, C2: { status: "conflicting" }, I1: { status: "claimed" } },
};
type Rating = number | null | "disputed";
const record = (ratings: Rating[], gate1: "Pass" | "Fail" | "Unknown" = "Unknown"): AssessmentRecord => ({
  id: "syn-x", kind: "real", label: "Candidate X", configId: "synthetic-rubric", configVersion: 1, producedBy: "Synthetic preparer.", createdAt: "2026-01-06T00:00:00Z", addedAt: "2026-01-04T10:00:00Z",
  gates: [{ id: "G1", result: gate1, basis: "explicit", evidence: [], explanation: "G1 is Unknown on the CV." }, { id: "G2", result: "Pass", basis: "interpretation", evidence: [{ quote: "Synthetic licence quote", page: 1 }], explanation: "Read as met." }],
  criteria: ["C1", "C2", "I1"].map((id, i) => { const r = ratings[i];
    return r === null ? { id, status: "unknown" as const, basis: "explicit" as const, detail: null, evidence: [], explanation: `${id} Unknown: not stated.`, flags: ["Critical criterion Unknown: triggers the test cap"] }
      : r === "disputed" ? { id, status: "disputed" as const, basis: "explicit" as const, detail: null, evidence: [], explanation: "Disputed between CV and call." }
      : { id, status: "rated" as const, rating: r, basis: "explicit" as const, detail: "Brief" as const, evidence: [{ quote: `Synthetic quote ${"xyz"[i]}`, page: 2 }], explanation: "Synthetic explanation." }; }),
  otherResults: [], constraints: [{ id: "P1", note: "Location recorded, not scored (P1)." }], strengths: ["Synthetic strength (C1)."], gaps: ["C2 is Unknown."],
  questions: [{ q: "Synthetic question?", for: "C2, G1" }], manualReview: ["Check C2 in the original."], screening: null, clientView: VIEW,
  run: { runId: "run-20260105T000000000Z-syn-x-abc123", createdAt: "2026-01-05T00:00:00.000Z", resultSha256: "b".repeat(64), assessmentFingerprint: "c".repeat(64) },
  provenance: { integrity: "all bound files match their fingerprints", extractionAccuracy: "unverified", reasons: [], sources: [{ source: "CV", recorded: { when: "2026-01-01T00:00:00Z", basis: "x" }, timing: "before preparation" }] },
  clientViews: [{ revision: 1, current: true, describes: { assessmentFingerprint: "c".repeat(64), assessmentVersion: 1, stateSha256: "d".repeat(64), rubric: { id: "synthetic-rubric", version: 1, sha256: "a".repeat(64) } },
    content: VIEW, statusRule: "", preparation: { method: "assistant-prepared", actor: "P", at: "2026-01-03T00:00:00Z" } }],
} as AssessmentRecord);
const render = (rec: AssessmentRecord, cfg = config()) => { const v = viewOf(rec, cfg, [], []);
  return { v, client: renderToStaticMarkup(<ClientAssessmentSummary v={v} />), internal: renderToStaticMarkup(<><AssessmentSummary v={v} rules={["Use SD-free rule about C1 and Unknown."]} onChanged={() => {}} /><AssessmentStatus v={v} /></>) }; };

describe("wording does not change calculations, statuses or records", () => {
  it("the shown result is exactly the calculator's, and rendering changes nothing it is given", () => {
    const rec = record([3, null, 2]), before = JSON.stringify(rec), { v, internal } = render(rec);
    expect(v.latest.result).toEqual(calculateCv(config(), v.record.gates.map((g) => ({ id: g.id, result: g.result })), v.latest.inputs));
    expect(JSON.stringify(rec)).toBe(before);
    expect(internal).toContain(resultLabel(v.latest.result));
  });
  it("recorded evidence statuses are shown as recorded, one plain label for each", () => {
    const { v } = render(record([3, 2, 2]));
    expect(evidenceRows(v).map((r) => [r.id, r.s?.status])).toEqual(Object.entries(VIEW.statuses).map(([k, s]) => [k, s.status]));
    expect(new Set(Object.values(STATUS).map((s) => s.label)).size).toBe(5);
    expect(Object.values(STATUS).some((s) => s.chip === "c-crit")).toBe(false); // no status looks like a failure
    expect(GATE.Unknown.label).toBe(TERMS.notConfirmed);
    expect(GATE.Unknown.chip).not.toBe(GATE.Fail.chip); // "Not confirmed" never looks like "Not met"
  });
});

describe("important uncertainties stay visible", () => {
  const { client, internal } = render(record([3, null, 2]));
  /* The first screen: everything before a collapsed section (the client view has none; the recruiter page's checklist
     items expand in place, so its first screen ends at "All requirements"). */
  const first = (h: string) => h.slice(0, h.includes("<summary>All requirements") ? h.indexOf('<details class="jd sc-details"><summary>All requirements') : h.indexOf("<details"));
  const names = ["Synthetic licence", "Synthetic lifting", "Winning synthetic deals", "Synthetic margins"], kinds = ["Checked separately", "Not stated", "Needs review", TERMS.conflict];
  it("the client preview names every essential requirement and critical skill on its first screen", () => {
    for (const x of [...names, ...kinds]) expect(first(client)).toContain(x);
    expect(first(client)).toMatch(/Missing information is not a failure/);
    expect(first(client)).toMatch(/Screening: <\/b>not assessed/);
  });
  it("the assessment page names every unresolved essential requirement and critical skill under To confirm, kept distinct", () => {
    expect(first(internal)).toContain("<h3>To confirm (4)</h3>");
    for (const x of [...names, ...kinds]) expect(first(internal)).toContain(x);
    expect(first(internal)).toMatch(/Missing information is not a failure/);
  });
  it("the first screen has one result marked as a draft needing review, the full summary and strengths", () => {
    const h = first(internal), ai = renderToStaticMarkup(<AssessmentSummary v={viewOf({ ...record([3, null, 2]), producedBy: "AI route: test (ai-proposed)" }, config(), [], [])} rules={[]} onChanged={() => {}} />);
    expect(h).toContain("Draft — recruiter review needed");
    expect(first(ai)).toContain("AI draft — recruiter review needed");
    expect(h.match(/64 · Borderline · score limited/g)).toHaveLength(1);
    expect(h).toContain("Score limited to 64 because Synthetic margins is not confirmed in the CV");
    expect(h).toContain("<b>Summary.</b> Synthetic summary.</p>");
    expect(h).toContain("<h3>Strengths</h3>");
    expect(h).not.toContain(TERMS.coverage);
  });
  it("has three sections below the candidate summary: Screening questions, Review or change assessment, Previous assessments", () => {
    const sections = [...internal.matchAll(/<details class="jd sc-details"><summary>([^<]+)<\/summary>/g)].map((m) => m[1]);
    expect(sections.slice(1)).toEqual(["Screening questions (no core set · 1 follow-up)", "Review or change assessment", "Previous assessments (0)"]);
    expect(sections[0]).toMatch(/^All requirements \(\d+ more\)$/);
    expect(first(internal)).not.toMatch(/Synthetic question|<form|Save correction/);
    expect(internal).toContain("None. This is the first assessment of this CV.");
    const withEarlier = renderToStaticMarkup(<AssessmentSummary v={viewOf(record([3, null, 2]), config(), [], [])} rules={[]} onChanged={() => {}} earlier={{ count: 1, node: <p>Earlier synthetic assessment.</p> }} />);
    expect(withEarlier).toContain("<summary>Previous assessments (1)</summary>");
    expect(withEarlier).toContain("Earlier synthetic assessment.");
  });
  it("shows each screening question with what it checks, and 'Not prepared' where there is no answer guide (none is invented)", () => {
    /* No core set here (none recorded for these synthetic rules), so the follow-up has no core question to borrow from. */
    expect(internal).toMatch(/<span>Synthetic question\?<\/span><span class="chip c-mute">Not answered<\/span><\/div><div class="xs muted">Checks: Synthetic margins, Synthetic licence<\/div><div class="xs muted"><b>Answer guide: <\/b>Not prepared for Synthetic margins, Synthetic licence<\/div><\/li>/);
    const guided = { ...record([3, null, 2]), questions: [{ q: "Synthetic question?", for: "C2", answerPoints: ["Names a synthetic margin figure"] }] };
    expect(renderToStaticMarkup(<AssessmentSummary v={viewOf(guided, config(), [], [])} onChanged={() => {}} />)).toMatch(/<b>A good answer covers:<\/b><ul class="sc-points"><li>Names a synthetic margin figure<\/li>/);
  });
  it("keeps the correction controls, a concise history and a short reason for a limited score, without the removed detail", () => {
    for (const x of ["Record a recruiter correction", "Save correction", "<h3 style=\"margin:16px 0 4px\">Changes so far</h3>", "Original draft, kept unchanged.", "<b>Current result: </b>"]) expect(internal).toContain(x);
    expect(internal.match(/Score limited to 64 because Synthetic margins is not confirmed in the CV/g)?.length).toBeGreaterThanOrEqual(2); // in the result box and beside the controls
    expect(internal).not.toMatch(/How the result is worked out|If the score limit were set off differently|Rated skill<\/th>|Where the information came from|run-2026|About this prototype|<th>Client summary<\/th>|Synthetic preparer\./);
  });
});

describe("requirement details wording", () => {
  /* The candidate summary: everything before the recruiter's own sections. */
  const evidenceOf = (h: string) => h.slice(0, h.indexOf("<h3>Where this stands</h3>"));
  const labels = labelsFor(config());
  it("shows each requirement as an expandable item: status in the line, quotes and the explanation inside, no internal codes", () => {
    const h = evidenceOf(render(record([3, null, 2])).internal), text = h.slice(h.indexOf("<h3>Strengths")).replace(/<[^>]+>/g, " ");
    expect(h).toMatch(/<details class="sc-item"><summary><span class="sc-item-n">Winning synthetic deals<span class="xs muted"> · Critical skill<\/span><\/span><span class="sc-item-s"><span class="chip c-info">Needs review<\/span><\/span><\/summary><div class="sc-item-b"><div class="sc-q"><q>Synthetic quote x<\/q>/);
    expect(h).not.toMatch(/<th>Rating<\/th>|\b\d of 3\b/);
    expect(text).not.toMatch(/\b(?:C1|C2|I1|G1|G2)\b|score limit/i);
    expect(h).toContain("Synthetic explanation.");
  });
  it("lists the remaining requirements, the draft's full wording and its gaps under All requirements, once", () => {
    const h = render(record([3, null, 2])).internal, all = h.slice(h.indexOf("<summary>All requirements"), h.indexOf("<summary>Screening questions"));
    expect(all).toMatch(/Synthetic reporting<span class="xs muted"> · Important skill/);
    expect(all).toContain("<h3 style=\"margin:14px 0 6px\">The draft&#x27;s list of gaps</h3>");
    expect(h.match(/Synthetic margins is not confirmed\./g) ?? []).toHaveLength(1); // the gap appears once, not beside the checklist too
    expect(h.slice(0, h.indexOf("<summary>All requirements"))).not.toMatch(/Gaps and points|Points to clarify|list of gaps/);
  });
  it("keeps important concerns visible: a stated mismatch, conflicting information and an essential requirement recorded as not met", () => {
    expect(evidenceOf(render(record([3, 0, "disputed"], "Fail")).internal)).toMatch(/The CV states that this was not part of the role[\s\S]*information conflicts[\s\S]*/);
    expect(evidenceOf(render(record([3, 2, 2], "Fail")).internal)).toContain("The draft records this as not met. A recruiter must check it; nothing is rejected automatically.");
  });
  it("numeric ratings stay in the review controls", () => {
    expect(render(record([3, null, 2])).internal).toMatch(/Now, in version 1: 3 of 3/);
  });
  it("keeps the draft's complete sentences, replacing codes and leaving out only standalone boilerplate", () => {
    expect(explanationText("Negotiation is described as a regular duty. With only one of the three elements described, rating is 1. Rated 2. Cannot rate. Nothing is inferred from silence.", labels))
      .toBe("Negotiation is described as a regular duty.");
    /* A sentence that carries a finding is kept whole, never cut at a clause. */
    expect(explanationText("The CV does not count new customers, so level 3 is not met. Rated 2 because the count is missing.", labels))
      .toBe("The CV does not count new customers, so rating 3 is not met. Rated 2 because the count is missing.");
    expect(explanationText("No mention anywhere. Unknown until verified in screening.", labels)).toBe("No mention anywhere. Not confirmed until verified in screening.");
    expect(explanationText("Per the C2 rule, a listed CRM is Unknown, not Fail.", labels)).toBe("Per the Synthetic margins rule, a listed CRM is not confirmed, not a failure.");
    expect(explanationText("No P1 profitability work. Revenue totals are P2–P4 items.", labels)).toBe("No profitability work. Revenue totals are other sales results.");
    expect(explanationText("Covers Trauma Level 1-3 hospitals.", labels)).toBe("Covers Trauma Level 1-3 hospitals."); // a range in the CV's own words is not a rating
    expect(explanationText("Nothing is inferred from silence.", labels)).toBe("");
    expect(sentences("Sold to W.W. Grainger for years. No ERP is named.")).toEqual(["Sold to W.W. Grainger for years.", "No ERP is named."]);
  });
  it("makes a short, balanced summary from two of the draft's own sentences: the opening one and the first concern", () => {
    expect(shortSummary("Twenty years of field sales. Recent roles manage hospital accounts. No ERP or margin evidence appears. Other.")).toBe("Twenty years of field sales. No ERP or margin evidence appears.");
    expect(shortSummary("One. Two. Three.")).toBe("One. Two.");
    expect(shortSummary("Only one.")).toBe("Only one.");
  });
  it("removes rating-level talk, codes and boilerplate without inventing anything, and never leaves an empty explanation", () => {
    expect(evidenceExplanation("Negotiation is described as a regular duty. With only one of the three elements described, rating is 1. Level 3 recency is met.", labels, "x")).toBe("Negotiation is described as a regular duty.");
    expect(evidenceExplanation("No P1 profit or margin work is described. Revenue totals are P2–P4 items and earn no C2 points per the rules (Option P). Nothing is inferred from silence.", labels, "x")).toBe("No profit or margin work is described.");
    expect(evidenceExplanation("C2 Unknown: not stated.", labels, "x")).toBe("Synthetic margins not confirmed: not stated.");
    expect(evidenceExplanation("Meets level 2. Nothing is inferred from silence.", labels, "Fallback meaning.")).toBe("Fallback meaning.");
    expect(evidenceExplanation("One. Two. Three.", labels, "x")).toBe("One. Two.");
    expect(evidencePoint("Only performance tracking is mentioned, leaving C2 rated 1.", labels)).toBe("Only performance tracking is mentioned.");
    expect(evidenceExplanation("The champion role describes knowledge-sharing for the field team, meeting level 2 (training described). No ongoing programme is described; level 3 not established.", labels, "x"))
      .toBe("The champion role describes knowledge-sharing for the field team. No ongoing programme is described.");
    expect(evidenceExplanation("The CV describes CRM use, which corresponds to level-3 activity. No recent role describes it.", labels, "x")).toBe("The CV describes CRM use. No recent role describes it.");
    expect(evidenceExplanation("A degree is listed. No recency or duration requirement applies.", labels, "x")).toBe("A degree is listed.");
    expect(evidenceExplanation("Roles do not define a set of accounts, which is required for level 2. Level 1 is the highest supportable rating.", labels, "x")).toBe("Roles do not define a set of accounts.");
    expect(evidencePoint("Both are below their Pass/level-2 thresholds.", labels)).toBe("Both are below their required thresholds.");
    expect(evidenceExplanation("A degree meets the level-3 threshold of associate degree or higher. C1 has no recency requirement.", labels, "x")).toBe("A degree meets the required threshold of associate degree or higher.");
    expect(evidencePoint("In-person contact is not stated (Synthetic margins rating 3). Ask about visits.", labels)).toBe("In-person contact is not stated. Ask about visits.");
  });
});

describe("no developer detail or engineering terms on screen", () => {
  const { client, internal } = render(record([3, null, "disputed"]));
  it.each([["client preview", client], ["internal review", internal]])("%s", (_, h) => {
    const text = h.replace(/<[^>]+>/g, " ");
    for (const x of [/\b[0-9a-f]{16,}\b/, /\d{4}-\d{2}-\d{2}T\d/, /\brun-\d/, /\b(?:C1|C2|I1|G1|G2|N1|P1)\b/, /\(J\d+\)/,
      /\bUnknown\b/, /\bDisputed\b/, /Insufficient evidence/i, /\bMust-have/i, /\brubric\b/i, /provenance/i, /fingerprint/i, /\bgates?\b/i, /synthetic-rubric/]) expect(text, String(x)).not.toMatch(x);
  });
  it("the client preview still has no score, weight, score limit or correction control", () => {
    for (const x of [/\d+ · (Strong|Good|Borderline|Weak)/, /\bweight\b/i, /score limit/i, /<form|<select/, /Review assessment/]) expect(client, String(x)).not.toMatch(x);
  });
});

describe("plain explanations keep their specific meaning", () => {
  const rows = (ratings: Rating[], cfg: LoadedConfig) => viewOf(record(ratings), cfg, [], []).latest.result;
  it("names the real trigger of a score limit: not confirmed, a stated mismatch or a low rating", () => {
    const cfg = config(["zero", "lowOne", "unknown"]);
    expect(capExplanation(rows([3, null, 3], cfg), cfg)).toMatch(/Synthetic margins is not confirmed in the CV/);
    const zero = capExplanation(rows([3, 0, 3], cfg), cfg)!;
    expect(zero).toMatch(/Synthetic margins is rated 0 \(the CV states a mismatch\)/);
    expect(zero).not.toMatch(/not confirmed/);
    expect(capExplanation(rows([3, 1, 3], cfg), cfg)).toMatch(/Synthetic margins is rated 1, a low rating/);
    expect(capExplanation(rows([3, 3, 3], cfg), cfg)).toBeNull();
  });
  it("only names triggers the rules actually use", () => {
    const cfg = config(["unknown"]);
    expect(capExplanation(rows([3, 1, 3], cfg), cfg)).toBeNull(); // a low rating does not limit the score under these rules
  });
  it("explains no score as missing information, conflict or a requirement not met, never as the candidate failing", () => {
    const cfg = config();
    const few = reasonLabel(rows([null, null, 3], cfg), cfg)!;
    expect(few).toMatch(new RegExp(`^${TERMS.notEnough}`));
    expect(few).toMatch(/not a judgement of the candidate/);
    expect(reasonLabel(rows([3, "disputed", 3], cfg), cfg)).toMatch(/Information conflicts — review needed: Synthetic margins/);
    const stopped = viewOf(record([3, 3, 3], "Fail"), cfg, [], []).latest.result;
    expect(reasonLabel(stopped, cfg)).toMatch(/Synthetic licence is recorded as not met/);
  });
  it("replaces internal IDs and Unknown in stored prose without changing the rest", () => {
    const labels = labelsFor(config());
    expect(plain("C2 Unknown, a Critical criterion (J08, J17); see the rubric.", labels)).toBe("Synthetic margins not confirmed, a critical skill; see the assessment rules.");
    expect(plain("Margins (C2) and licence (G1, C1) are Unknown.", labels)).toBe("Margins and licence are not confirmed.");
    expect(plain("Margin experience unknown.", labels)).toBe("Margin experience not confirmed.");
    expect(plain("TEST CHOICE T3: level 3 is undefined. Gate thresholds for each gate; otherwise 'Insufficient evidence — no score'. Several must-haves are open.", labels))
      .toBe("Test choice: rating 3 is not defined. Essential requirement thresholds for each essential requirement; otherwise 'Not enough information to score'. Several essential requirements are open.");
  });
});
