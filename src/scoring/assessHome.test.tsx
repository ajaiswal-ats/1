/* The scoring tool's home screen and candidate identity, on synthetic data only: one row per candidate, grouped only by an
   identical recorded CV fingerprint (never by name or label), with earlier assessments kept in that candidate's history;
   and the normal client portal is unchanged when no extension is present. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadWorkspace } from "../workspace/data";
import { WorkspacePage } from "../workspace/DbViews";
import { WorkspaceExtensionProvider } from "../workspace/extensions";
import { fakeDb } from "../workspace/fakeDb";
import { AssessHome, AssessmentHistory, groupCandidates } from "./AssessHome";
import { viewOf, type AssessmentPayload, type AssessmentRecord, type LoadedConfig, type PrivateData } from "./model";
import { syntheticRubric } from "./syntheticFixture";
import { TEST_CLIENT, testTables } from "./testMode";

const config = { ...syntheticRubric(), sha256: "a", frozenSha256: "a", hashOk: true, recordedAt: "", cvsOpenedBefore: false } as LoadedConfig;
const ROLE = { id: "role-syn", title: "Synthetic Test Role", loc: "Nowhere", summary: "Synthetic summary.", resp: ["Do synthetic things."] };
const rec = (id: string, label: string, sha: string | null, at: string, ai = false, extra: Partial<AssessmentRecord> = {}): AssessmentPayload => ({
  id, kind: "real", label, role: ROLE, cvSha256: sha, configId: config.id, configVersion: 1, producedBy: ai ? "AI route: test (ai-proposed)" : "Synthetic preparer (assistant-prepared)", createdAt: at, addedAt: at,
  gates: [{ id: "G1", result: "Unknown", basis: "explicit", evidence: [], explanation: "x" }, { id: "G2", result: "Unknown", basis: "explicit", evidence: [], explanation: "x" }],
  criteria: [{ id: "C1", status: "rated", rating: ai ? 3 : 2, basis: "explicit", detail: "Full", evidence: [], explanation: "x" }, { id: "C2", status: "rated", rating: 2, basis: "explicit", detail: "Full", evidence: [], explanation: "x" }, { id: "I1", status: "unknown", basis: "explicit", detail: null, evidence: [], explanation: "x" }],
  otherResults: [], constraints: [], strengths: [], gaps: [], questions: [], manualReview: [], screening: null,
  clientView: { summary: "s", preparedBy: "", statusRule: "", strengths: [], gaps: [], statuses: {} }, ...extra,
});
/* Candidate A (earlier) and New CV 1 share a CV fingerprint; New CV 2 has a different file; Candidate Z has the same
   label pattern as nobody and no fingerprint at all. */
const list = [rec("cand-a", "Candidate A", "sha-1", "2026-01-02T00:00:00Z"), rec("in-1-a1", "New CV 1", "sha-1", "2026-01-05T00:00:00Z", true, { intakeId: "in-1", attempt: 1 } as never),
  rec("in-1-a2", "New CV 1", "sha-1", "2026-01-06T00:00:00Z", true, { intakeId: "in-1", attempt: 2 } as never),
  rec("in-2-a1", "New CV 2", "sha-2", "2026-01-05T00:00:00Z", true, { intakeId: "in-2", attempt: 1 } as never), rec("cand-z", "Candidate A copy", null, "2026-01-03T00:00:00Z")];
const views = new Map(list.map((a) => [a.id, viewOf(a as AssessmentRecord, config, [], [])]));

describe("candidate identity", () => {
  const groups = groupCandidates(list);
  it("groups only identical recorded CV fingerprints, never by name or label", () => {
    expect(groups.map((g) => [g.name, g.items.map((a) => a.id)])).toEqual([["Candidate A", ["cand-a", "in-1-a1", "in-1-a2"]], ["Candidate A copy", ["cand-z"]], ["New CV 2", ["in-2-a1"]]]);
  });
  it("shows the latest assessment and keeps the earlier ones in the candidate's history", () => {
    const a = groups[0];
    expect([a.latest.id, a.aliases, a.firstAdded]).toEqual(["in-1-a2", ["New CV 1"], "2026-01-02T00:00:00Z"]);
    const h = renderToStaticMarkup(<AssessmentHistory group={a} views={views} shownId={a.latest.id} />);
    expect(h.match(/Earlier, kept: /g)).toHaveLength(2);
    expect(h).toContain("Shown now: ");
    expect(h).toContain("(recorded as New CV 1)");
  });
  it("lists one person per candidate in the workspace tables", () => {
    const t = testTables({ available: true, problems: [], configs: [config], assessments: list } as PrivateData);
    expect((t.people as { name: string }[]).map((p) => p.name).sort()).toEqual(["Candidate A", "Candidate A copy", "New CV 2"]);
    expect((t.submissions as { id: string; shared_on: string }[]).find((s) => s.id === "in-1-a2")?.shared_on).toBe("2026-01-02");
  });
});

describe("home screen", () => {
  const html = renderToStaticMarkup(<AssessHome groups={groupCandidates(list)} views={views} />);
  it("lists candidate, latest draft result, review status and Open, with Add CV", () => {
    expect(html).toContain("<h1>Assess candidates</h1>");
    expect(html).toMatch(/<a class="btn btn-p" href="#assess">Add CV<\/a>/);
    for (const h of ["Candidate", "Latest draft result", "Review status"]) expect(html).toContain(`<th>${h}</th>`);
    expect(html.match(/>Open<\/a>/g)).toHaveLength(3);
    expect(html).toContain('href="#c-in-1-a2"');
    expect(html).toContain("2 earlier assessments in history");
    expect(html).toContain("AI draft");
    expect(html).toContain("Not reviewed by a recruiter");
    expect(html).not.toMatch(/Interview|Offer|Hired|Next step|Waiting on you/); // not the hiring pipeline
  });
  it("replaces only the scoring tool's Candidates page; the normal portal list is unchanged", async () => {
    const ws = await loadWorkspace(fakeDb(testTables({ available: true, problems: [], configs: [config], assessments: list } as PrivateData)).db, TEST_CLIENT.id);
    const page = (ext: boolean) => { const el = <WorkspacePage route="candidates" state={{ status: "ready", key: "k", ws }} onRetry={() => {}} today="2026-01-07" memberId="m1" />;
      return renderToStaticMarkup(ext ? <WorkspaceExtensionProvider value={{ candidatesPage: () => <AssessHome groups={groupCandidates(list)} views={views} /> }}>{el}</WorkspaceExtensionProvider> : el); };
    expect(page(true)).toContain("Assess candidates");
    const normal = page(false);
    expect(normal).not.toContain("Assess candidates");
    expect(normal).toMatch(/Next step/);
  });
});
