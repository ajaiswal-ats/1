/* The portal's scoring-test mode, rendered with the portal's own pages and synthetic, fictional data only. Checks that the
   test-data adapter passes the real workspace loader without inventing sharing history; that the client preview shows
   recorded evidence statuses (not ratings) and keeps important gaps visible; that the internal review keeps the
   technical detail; and that normal mode (no extension) renders exactly as before. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadWorkspace, type Workspace } from "../workspace/data";
import { History, WorkspacePage } from "../workspace/DbViews";
import { WorkspaceExtensionProvider, type WorkspaceExtension } from "../workspace/extensions";
import { fakeDb } from "../workspace/fakeDb";
import { AssessmentStatus, AssessmentSummary, BlockedAssessmentPanel, ClientAssessmentSummary, ClientNextStep, PAGE_NOTE, ScreeningNotAssessed, STATUS, TestHistory, evidenceRows } from "./AssessmentPanels";
import { configFor, viewOf, type AssessmentRecord, type BlockedAssessment, type ClientView, type LoadedConfig, type PrivateData } from "./model";
import { ADDED, TEST_CLIENT, testTables } from "./testMode";
import type { Criterion } from "./types";

const crit = (id: string, label: string, importance: Criterion["importance"], weight: number, extra: Partial<Criterion> = {}): Criterion =>
  ({ id, label, importance, weight, max: 3, included: true, anchors: { "1": "one", "2": "two", "3": "three" }, ...extra });
const CONFIG: LoadedConfig = {
  id: "synthetic-config", version: 1, status: "Experimental — not validated or approved", approved: false, frozenAt: "2026-01-05T00:00:00Z",
  role: { id: "role-syn", title: "Synthetic Test Role", client: "Fictional client", loc: "Nowhere", summary: "Synthetic summary.", roleSetupVersion: "draft", resp: ["Do synthetic things."] },
  gates: [{ id: "G1", label: "Synthetic licence" }, { id: "G2", label: "Synthetic lifting" }], gateExceptions: [],
  criteria: [crit("C1", "Winning synthetic deals", "Critical", 3), crit("C2", "Synthetic margins", "Critical", 3), crit("I1", "Synthetic reporting", "Important", 2),
    crit("N1", "Synthetic extra", "Nice to have", 1, { included: false, exclusionReason: "Synthetic exclusion" })],
  constraints: [{ id: "P1", label: "Location", detail: "Synthetic" }],
  policy: {
    unknown: "exclude", minOverallCoverage: [1, 2], minCriticalCoverage: [1, 2], coverageInclusive: true, cap: { value: 64, triggers: ["zero", "unknown"] },
    rounding: "half-up", capBeforeRounding: true, bandFrom: "rounded", disputed: "no-score",
    bands: [{ min: 80, label: "Strong" }, { min: 65, label: "Good" }, { min: 50, label: "Borderline" }, { min: 0, label: "Weak" }],
    screening: { scaleMin: 1, scaleMax: 5, minCoverage: [3, 4] }, combination: "none",
  },
  testChoices: [{ id: "T1", choice: "Synthetic choice", specStatus: "Synthetic" }],
  sha256: "abc", frozenSha256: "abc", hashOk: true, recordedAt: "2026-01-05T00:00:00Z", cvsOpenedBefore: false,
};
/* Statuses deliberately disagree with what a rating mapping would give: C1 is rated 3 but only "Claimed"; C2 is Unknown
   for Candidate A but "Needs review"; I1 is rated 1 but "Conflicting". */
const VIEW: ClientView = {
  summary: "Synthetic factual summary of the candidate.", preparedBy: "Synthetic preparer.", statusRule: "Synthetic rule.",
  strengths: [{ text: "Synthetic strength one.", evidence: [{ quote: "Synthetic strength quote", page: 1, verified: true }] }],
  gaps: ["Synthetic gap about margins."],
  statuses: { G1: { status: "separate" }, G2: { status: "not-stated" }, C1: { status: "claimed", reason: "Synthetic: listed only." }, C2: { status: "needs-review" }, I1: { status: "conflicting" } },
};
const ROLE = { id: "role-syn", title: "Synthetic Test Role", loc: "Nowhere", summary: "Synthetic summary.", resp: ["Do synthetic things."] };
const person = (id: string, label: string, ratings: (number | null)[], cv: ClientView | null = VIEW): AssessmentRecord & { role: typeof ROLE } => ({
  id, kind: "real", label, role: ROLE, configId: CONFIG.id, configVersion: 1, producedBy: "Synthetic test author.", createdAt: "2026-01-06T00:00:00Z", addedAt: "2026-01-04T10:00:00Z",
  gates: [{ id: "G1", result: "Unknown", basis: "explicit", evidence: [], explanation: "Not stated." }, { id: "G2", result: "Pass", basis: "explicit", evidence: [{ quote: "Synthetic gate quote", page: 1 }], explanation: "x" }],
  criteria: ["C1", "C2", "I1"].map((cid, i) => ratings[i] === null
    ? { id: cid, status: "unknown" as const, basis: "explicit" as const, detail: null, evidence: [], explanation: "x" }
    : { id: cid, status: "rated" as const, rating: ratings[i]!, basis: "explicit" as const, detail: "Full" as const, evidence: [{ quote: `Synthetic quote ${"xyz"[i]} ${label}`, page: 2, verified: true }], explanation: "Synthetic explanation." }),
  otherResults: [], constraints: [], strengths: ["S"], gaps: ["G"], questions: [{ q: "Synthetic question one?", for: "C1" }, { q: "Synthetic question two?", for: "C2" }], manualReview: [], screening: null, clientView: cv,
});
const DATA: PrivateData = {
  available: true, problems: [], configs: [CONFIG], consistencyRules: [], mappingRule: "Synthetic",
  assessments: [person("sub-a", "Candidate A", [3, null, 1]), person("sub-b", "Candidate B", [3, 3, 3])], frozen: { results: [] }, corrections: [],
};
const views = new Map((DATA.assessments as AssessmentRecord[]).map((a) => [a.id, viewOf(a, CONFIG, [], [])]));
const client: WorkspaceExtension = {
  added: ADDED, candidatesNote: "Synthetic test note.",
  summary: (s) => <ClientAssessmentSummary v={views.get(s.id)!} />, screening: () => <ScreeningNotAssessed />,
  actions: () => <ClientNextStep />, hideNextStep: () => true, history: (s) => <TestHistory addedAt={views.get(s.id)!.record.addedAt} />,
};
const internal: WorkspaceExtension = { ...client, summary: (s) => <AssessmentSummary v={views.get(s.id)!} rules={[]} onChanged={() => {}} />, actions: (s) => <AssessmentStatus v={views.get(s.id)!} />, hideNextStep: () => false };
const ws: Workspace = await loadWorkspace(fakeDb(testTables(DATA)).db, TEST_CLIENT.id);
const render = (w: Workspace, route: string, ext: WorkspaceExtension | null) => {
  const el = <WorkspacePage route={route} state={{ status: "ready", key: "k", ws: w }} onRetry={() => {}} today="2026-01-07" memberId="m1" />;
  return renderToStaticMarkup(ext ? <WorkspaceExtensionProvider value={ext}>{el}</WorkspaceExtensionProvider> : el);
};

describe("test-data adapter", () => {
  it("passes the real workspace loader: one role, Candidate A–B, nothing agreed, published or shared", () => {
    expect(ws.roles.map((r) => r.title)).toEqual(["Synthetic Test Role"]);
    expect([...ws.people.values()].map((p) => p.name).sort()).toEqual(["Candidate A", "Candidate B"]);
    expect(ws.events).toEqual([]);
    expect(ws.subs.map((s) => s.sharedOn)).toEqual(["2026-01-04", "2026-01-04"]); // the recorded import date, not invented
    expect([ws.content?.sets.size, ws.content?.packages.size, ws.notes, ws.steps, ws.screening]).toEqual([0, 0, null, null, null]);
  });
  it("refuses unavailable data rather than showing anything", () => {
    expect(() => testTables({ available: false, problems: ["The private scoring folder is not present on this computer."] })).toThrow(/not present/);
  });
});

describe("evidence status is recorded, not derived from ratings", () => {
  it("shows the recorded status even where a rating mapping would say otherwise", () => {
    const rows = evidenceRows(views.get("sub-a")!);
    expect(rows.map((r) => [r.id, r.s?.status])).toEqual([["G1", "separate"], ["G2", "not-stated"], ["C1", "claimed"], ["C2", "needs-review"], ["I1", "conflicting"]]);
    /* The same statuses for a candidate with entirely different ratings. */
    expect(evidenceRows(views.get("sub-b")!).map((r) => r.s?.status)).toEqual(rows.map((r) => r.s?.status));
  });
  it("never shows a met or supported label, and a missing status is flagged, not filled in", () => {
    expect(render(ws, "c-sub-b", client)).not.toMatch(/>Supported<|Partly supported|>Met<|Confirmed not met/);
    const none = viewOf(person("sub-x", "Candidate X", [3, 3, 3], { ...VIEW, statuses: {} }), CONFIG, [], []);
    expect(evidenceRows(none).every((r) => r.s === null)).toBe(true);
    expect(renderToStaticMarkup(<ClientAssessmentSummary v={none} />)).toContain("Status not recorded");
  });
  it("keeps the five kinds of evidence status distinct, none styled as a failure", () => {
    const html = render(ws, "c-sub-a", client);
    for (const k of ["needs-review", "not-stated", "claimed", "separate", "conflicting"] as const) expect(html).toContain(STATUS[k].label);
    expect(new Set(Object.values(STATUS).map((s) => s.label)).size).toBe(5);
    expect(Object.values(STATUS).some((s) => s.chip === "c-crit")).toBe(false);
  });
});

describe("client preview", () => {
  const html = render(ws, "c-sub-a", client), beforeDetails = html;
  it("has one draft notice, a factual summary, strengths and gaps", () => {
    expect(html.split('class="banner').length - 1).toBe(1);
    expect(html).toContain("Draft assessment · recruiter review pending");
    expect(html).toContain("Synthetic factual summary of the candidate.");
    expect(html).toContain("<li>Synthetic strength one.</li>");
    expect(html).toContain("Synthetic gap about margins.");
  });
  it("names every must-have and Critical skill still to confirm, including Needs review", () => {
    expect(beforeDetails).toContain("Important information to confirm (5)");
    for (const x of ["Synthetic licence", "Synthetic lifting", "Winning synthetic deals", "Synthetic margins"]) expect(beforeDetails).toContain(x);
    expect(beforeDetails).toMatch(/Synthetic margins<span class="xs muted"> · Critical skill<\/span><\/span><span class="chip c-info">Needs review/);
    expect(beforeDetails).toMatch(/Synthetic reporting<span class="xs muted"> · Important skill<\/span><\/span><span class="chip c-warn">Information conflicts — review needed/); // a conflict is listed even for a non-critical skill
    expect(beforeDetails).toContain("Missing information is not a failure, and a quote from the CV is not proof that a requirement is met.");
    expect(html).not.toMatch(/>None\.<|other must-have/);
  });
  it("never shows None while essential requirements are unresolved, even when every one has quoted evidence", () => {
    const all = viewOf(person("sub-r", "Candidate R", [3, 3, 3], { ...VIEW, statuses: Object.fromEntries(["G1", "G2", "C1", "C2", "I1"].map((k) => [k, { status: "needs-review" as const }])) }), CONFIG, [], []);
    const h = renderToStaticMarkup(<ClientAssessmentSummary v={all} />);
    expect(h).toContain("Important information to confirm (4)");
    expect(h).not.toMatch(/>None\.<|other must-have/);
  });
  it("keeps suggested screening questions out of the client preview", () => {
    expect(html).not.toMatch(/Synthetic question (one|two)\?|screening questions/i);
  });
  it("has no View evidence section, quotes or page references: requirement-level evidence is in the recruiter review only", () => {
    expect(html).not.toMatch(/View evidence|<details|class="sc-q"|CV page \d|Synthetic strength quote|Synthetic quote/);
    expect(html).not.toContain(PAGE_NOTE);
  });
  it("keeps the evidence records and the recruiter's complete View evidence section", () => {
    const v = views.get("sub-a")!;
    expect(evidenceRows(v).find((r) => r.id === "C1")?.evidence).toEqual([{ quote: "Synthetic quote x Candidate A", page: 2, verified: true }]);
    expect(v.record.clientView?.strengths[0].evidence).toHaveLength(1);
    const internalHtml = render(ws, "c-sub-a", internal);
    expect(internalHtml).toContain("<summary>All requirements (");
    expect(internalHtml).toContain("Synthetic quote x Candidate A");
    expect(internalHtml).toContain(PAGE_NOTE);
  });
  it("has no score, formula, weight, cap, rubric ID, model detail or correction control", () => {
    for (const x of [/\d+ · (Strong|Good|Borderline|Weak)/, /\bweight\b/i, /\bcap(ped)?\b/i, /÷|×|Σ/, /\b(?:C|I|N|G)\d\b/, /synthetic-config/, /Synthetic test author|Synthetic preparer/, /<form|Save correction|<select/, /How this result is calculated/, /Coverage \d|Insufficient evidence/, /\bof 3\b/])
      expect(html, String(x)).not.toMatch(x);
  });
  it("replaces the client actions and says when the candidate was added, not shared", () => {
    expect(html).not.toMatch(/data-form=|id="mv"|>Decline<|Share interview feedback/);
    expect(html).not.toContain('aria-label="Next step"'); // no column reserved for an empty panel
    expect(html).toContain('class="cd cd-solo"');
    expect(html).toContain("<dt>Added to local test</dt><dd>4 Jan</dd>");
    expect(html).not.toMatch(/<dt>Shared<\/dt>|Shared 4 Jan|shared Candidate/);
  });
});

describe("screening and history in test mode", () => {
  it("screening is Not assessed with no answers", () => {
    const s = renderToStaticMarkup(<ScreeningNotAssessed />);
    expect(s).toContain("Not assessed");
    expect(s).toContain("No screening answers have been added.");
    for (const v of views.values()) expect(v.screening.status).toBe("not-assessed");
  });
  it("history shows only the local-test addition, with no invented sharing or notes", () => {
    const h = renderToStaticMarkup(<TestHistory addedAt="2026-01-04T10:00:00Z" />);
    expect(h).toContain("No notes in this test assessment.");
    expect(h).toContain("Added to local test");
    expect(h).not.toMatch(/Revenue Optics shared|not available on this database/i);
  });
  it("lists and the role page say Added, not Shared", () => {
    expect(render(ws, "roles", client)).toMatch(/<th class="rv-r">Added<\/th>/);
    expect(render(ws, "role-role-syn", client)).toContain(">Added to local test<");
  });
});

describe("internal review", () => {
  it("keeps ratings, scores, the calculation and corrections, with rating and evidence status side by side", () => {
    const html = render(ws, "c-sub-b", internal);
    expect(html).not.toContain("About this prototype"); // the prototype report is not on the candidate page
    expect(html).toContain("Synthetic question two?"); // screening questions are internal
    expect(html).toContain('aria-label="Next step"');
    expect(html).toContain("Draft CV result: 100 · Strong");
    expect(html).toContain("not a sign-in"); // the page's mode line
    expect(html).toContain("100 · Strong");
    expect(html).toMatch(/Winning synthetic deals<span class="xs muted"> · Critical skill<\/span><\/span><span class="sc-item-s"><span class="chip c-mute">Claimed · needs checking/);
    expect(html).toContain("Now, in version 1: 3 of 3"); // the numeric rating stays in the review controls
    expect(html).not.toContain("How the result is worked out"); // calculation tables are not on the candidate page
    expect(html).toContain("Record a recruiter correction");
  });
});

describe("normal mode is unchanged", () => {
  it("without an extension: the usual empty summary, client actions and Shared wording", () => {
    const html = render(ws, "c-sub-a", null);
    expect(html).toContain("No summary is currently shared for this candidate.");
    expect(html).toContain('data-form="interview"');
    expect(html).toContain('<div class="cd">');
    expect(html).toContain('aria-label="Next step"');
    expect(html).toContain("<dt>Shared</dt><dd>4 Jan</dd>");
    expect(html).not.toMatch(/Draft assessment|Added to local test/);
    expect(render(ws, "roles", null)).toMatch(/<th class="rv-r">Shared<\/th>/);
    expect(render(ws, "role-role-syn", null)).toContain(">Shared with you<");
  });
  it("genuine sharing history still renders as before", async () => {
    const t = testTables(DATA);
    t.submission_events = [{ id: 1, submission_id: "sub-a", client_id: TEST_CLIENT.id, submission_version: 1, kind: "shared", to_stage: "To review", occurred_on: "2026-01-04", actor_kind: "revenue_optics", actor_member_id: null }];
    t.client_notes = [];
    const real = await loadWorkspace(fakeDb(t).db, TEST_CLIENT.id);
    const h = renderToStaticMarkup(<History ws={real} sub={real.subs.find((s) => s.id === "sub-a")!} memberId="m1" />);
    expect(h).toContain("Revenue Optics shared Candidate for this role");
    expect(h).toContain("No notes yet.");
  });
});

describe("stale and blocked assessments", () => {
  const stale = viewOf(person("sub-s", "Candidate S", [3, 3, 3], null), CONFIG, [], []);
  it("a stale client view hides every older claim and shows the update notice", () => {
    const html = renderToStaticMarkup(<ClientAssessmentSummary v={stale} />);
    expect(html).toContain("Draft assessment · update pending after review");
    for (const x of [/Synthetic factual summary|Synthetic strength|Synthetic gap|Main strengths|Gaps and points|Requirement|Needs review|Not stated|Claimed|<details|\d+ · (Strong|Good)/]) expect(html).not.toMatch(x);
  });
  it("the internal review labels the older statuses historical and offers explicit confirmation", () => {
    const rec = { ...person("sub-h", "Candidate H", [3, 3, 3], null), run: { runId: "r1", createdAt: "2026-01-05T00:00:00Z", resultSha256: "a".repeat(64), assessmentFingerprint: "b".repeat(64) }, latestStateSha: "c".repeat(64),
      clientViews: [{ revision: 1, current: false, describes: { assessmentFingerprint: "b".repeat(64), assessmentVersion: 1, stateSha256: "d".repeat(64), rubric: { id: CONFIG.id, version: 1, sha256: "e".repeat(64) } }, content: VIEW, statusRule: "", preparation: { method: "assistant-prepared", actor: "P", at: "2026-01-03T00:00:00Z" } }],
      rubric: { id: CONFIG.id, version: 1, sha256: "e".repeat(64) },
      review: { baseRevision: 1, changes: [{ kind: "rating" as const, id: "C1", from: "3", to: "Unknown" }], affected: ["C1"], changesSha256: "f".repeat(64) } };
    const html = renderToStaticMarkup(<AssessmentSummary v={viewOf(rec, CONFIG, [], [])} rules={[]} onChanged={() => {}} />);
    expect(html).toContain("the client summary is out of date");
    expect(html).toContain(">older<");
    expect(html).toContain("Review the client summary for assessment version 1");
    expect(html).toContain("What changed since client summary version 1");
    expect(html).toContain("Winning synthetic deals: 3 → Not confirmed");
    expect(html).toContain("The client summary as it would appear");
    expect(html).toContain("changed in the assessment");
    expect(html).toMatch(/Why keep this unchanged\?/);
    expect(html).toContain("I have reviewed the changes and this client summary");
    expect(html).toContain("The client summary is out of date: the assessment changed after it was written.");
  });
  const blocked: BlockedAssessment = { id: "sub-z", label: "Candidate Z", status: "blocked", problems: ["CV file does not match its recorded fingerprint"], submissionId: "sub-z", addedAt: "2026-01-04T10:00:00Z", role: { id: "role-syn", title: "Synthetic Test Role", loc: "", summary: "", resp: [] } };
  it("a blocked assessment shows no assessment details in either view; reasons only in the internal review", () => {
    const client = renderToStaticMarkup(<BlockedAssessmentPanel b={blocked} internal={false} />), internal = renderToStaticMarkup(<BlockedAssessmentPanel b={blocked} internal />);
    expect(client).toContain("No assessment details are available for this candidate.");
    expect(client).not.toContain("fingerprint");
    expect(internal).toContain("CV file does not match its recorded fingerprint");
    for (const h of [client, internal]) expect(h).not.toMatch(/\d+ · (Strong|Good|Borderline|Weak)|Needs review|of 3/);
  });
  it("a blocked candidate still appears as a submission, with no assessment data", async () => {
    const t = testTables({ ...DATA, assessments: [...DATA.assessments!, blocked] });
    expect((t.people as { name: string; headline: string }[]).find((p) => p.name === "Candidate Z")?.headline).toBe("Test candidate · assessment unavailable");
    expect(t.submissions).toHaveLength(3);
  });
  it("an assessment is only matched with the exact rubric it names", () => {
    const v2 = { ...CONFIG, version: 2 };
    expect(configFor([v2, CONFIG], { configId: CONFIG.id, configVersion: 1 })).toBe(CONFIG);
    expect(configFor([v2], { configId: CONFIG.id, configVersion: 1 })).toBeNull();
    expect(configFor([{ ...CONFIG, hashOk: false }], { configId: CONFIG.id, configVersion: 1 })).toBeNull();
    expect(() => viewOf(person("sub-v", "Candidate V", [3, 3, 3]), v2, [], [])).toThrow(/not calculated under the rubric it names/);
  });
});
