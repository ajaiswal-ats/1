/* Presentation separation in the scoring-test mode: the client view ("/") has no view switch, no recruiter tools, no
   scores and no link to the recruiter review ("/review"). This separates presentations on one computer; it is not
   authentication. Synthetic data only. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadWorkspace } from "../workspace/data";
import { WorkspacePage } from "../workspace/DbViews";
import { WorkspaceExtensionProvider, type WorkspaceExtension } from "../workspace/extensions";
import { fakeDb } from "../workspace/fakeDb";
import { AssessHome, groupCandidates } from "./AssessHome";
import { ClientAssessmentSummary } from "./AssessmentPanels";
import { viewOf, type AssessmentPayload, type AssessmentRecord, type LoadedConfig, type PrivateData } from "./model";
import { syntheticRubric } from "./syntheticFixture";
import { REVIEW_PATH, TEST_CLIENT, testTables, viewForPath } from "./testMode";

const config = { ...syntheticRubric(), sha256: "a", frozenSha256: "a", hashOk: true, recordedAt: "", cvsOpenedBefore: false } as LoadedConfig;
const a: AssessmentPayload = { id: "syn-a", kind: "real", label: "Candidate A", role: { id: "role-syn", title: "Synthetic Test Role", loc: "", summary: "", resp: [] }, cvSha256: "s1", configId: config.id, configVersion: 1,
  producedBy: "x (ai-proposed)", createdAt: "2026-01-02T00:00:00Z", addedAt: "2026-01-02T00:00:00Z",
  gates: [{ id: "G1", result: "Unknown", basis: "explicit", evidence: [], explanation: "x" }, { id: "G2", result: "Unknown", basis: "explicit", evidence: [], explanation: "x" }],
  criteria: [{ id: "C1", status: "rated", rating: 3, basis: "explicit", detail: "Full", evidence: [], explanation: "x" }, { id: "C2", status: "rated", rating: 2, basis: "explicit", detail: "Full", evidence: [], explanation: "x" }, { id: "I1", status: "unknown", basis: "explicit", detail: null, evidence: [], explanation: "x" }],
  otherResults: [], constraints: [], strengths: [], gaps: [], questions: [], manualReview: [], screening: null,
  clientView: { summary: "Synthetic summary.", preparedBy: "", statusRule: "", strengths: [], gaps: [], statuses: {} } };
const v = viewOf(a as AssessmentRecord, config, [], []), views = new Map([[a.id, v]]);
const ws = await loadWorkspace(fakeDb(testTables({ available: true, problems: [], configs: [config], assessments: [a] } as PrivateData)).db, TEST_CLIENT.id);
const page = (ext: WorkspaceExtension, route: string) => renderToStaticMarkup(
  <WorkspaceExtensionProvider value={ext}><WorkspacePage route={route} state={{ status: "ready", key: "k", ws }} onRetry={() => {}} today="2026-01-07" memberId="m1" /></WorkspaceExtensionProvider>);

describe("which presentation an address shows", () => {
  it("shows the recruiter review only at /review; every other address is the client view", () => {
    expect(viewForPath(REVIEW_PATH)).toBe("internal");
    expect(viewForPath("/review/")).toBe("internal");
    for (const p of ["/", "", "/reviewer", "/x/review", "/index.html"]) expect(viewForPath(p)).toBe("client");
  });
});

describe("client view", () => {
  const client: WorkspaceExtension = { summary: () => <ClientAssessmentSummary v={v} />, hideNextStep: () => true, tools: [], candidatesPage: () => null };
  it("has no view switch, no recruiter tools, no link to the review address and no score", () => {
    for (const route of ["candidates", "c-syn-a"]) {
      const h = page(client, route);
      expect(h).not.toMatch(/Client preview|Internal review|Recruiter tools|Assess a CV|Assess candidates/);
      expect(h).not.toMatch(/href="\/review|#assess/);
      expect(h).not.toMatch(/\d+ · (Strong|Good|Borderline|Weak)/);
    }
  });
});

describe("recruiter review", () => {
  const review: WorkspaceExtension = { tools: [{ route: "assess", label: "Assess a CV", render: () => <p>Assess flow</p> }], candidatesPage: () => <AssessHome groups={groupCandidates([a])} views={views} />, hideNextStep: () => true };
  it("keeps the assessment list and the Assess a CV tool, with no switch back to the client view", () => {
    const h = page(review, "candidates");
    expect(h).toContain("Assess candidates");
    expect(h).not.toMatch(/Client preview|Internal review/);
    expect(page(review, "assess")).toContain("Assess flow");
  });
});
