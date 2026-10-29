/* The preview export's selection and minimisation (synthetic payloads only; no private data is read). */
import { describe, expect, it } from "vitest";
import { previewData } from "./export-data.mjs";

const config = { id: "syn", version: 1, approved: false, hashOk: true, sha256: "f".repeat(64), frozenSha256: "f".repeat(64), recordedAt: "x", cvsOpenedBefore: true, basedOn: { starter: "starter.pdf" },
  role: { id: "r", title: "R", loc: "L", summary: "Synthetic role description.", resp: ["Synthetic duty."] }, status: "Synthetic status.", frozenNote: "Synthetic note.",
  gates: [{ id: "G1", label: "Synthetic gate", source: "JD line 1", testRule: "SYNTHETIC GATE RULE TEXT" }], gateExceptions: [],
  criteria: [{ id: "C1", label: "Synthetic skill", importance: "Critical", weight: 3, max: 3, included: true, source: "JD", anchors: { 0: "SYNTHETIC ANCHOR TEXT" }, testRule: "SYNTHETIC CRITERION RULE TEXT" },
    { id: "N1", label: "Synthetic extra", importance: "Nice to have", weight: 1, max: 1, included: false, exclusionReason: "Synthetic exclusion reason." }],
  constraints: [{ id: "P1", label: "Synthetic point", note: "SYNTHETIC CONSTRAINT NOTE" }], policy: { synthetic: true }, testChoices: [{ id: "T1", text: "SYNTHETIC TEST CHOICE" }] };
const a = (id, sha, at, extra = {}) => ({ id, label: id.startsWith("cand-") ? `Candidate ${id.slice(-1).toUpperCase()}` : "New CV 9", status: "provisional", kind: "real", cvSha256: sha, createdAt: at, configId: "syn", configVersion: 1,
  producedBy: "AI route: claude-cli, model claude-x (ai-proposed)", gates: [], criteria: [], otherResults: [], strengths: [], gaps: [], questions: [{ q: "Q" }], manualReview: ["m"], constraints: [{ id: "x", note: "n" }],
  sources: { extraction: { tool: "t" } }, provenance: { p: 1 }, run: { runId: "run-1" }, rubric: { file: "config/r.json" }, clientView: { summary: "s", preparedBy: "AI route, run ai-run-1", statuses: {} }, latestVersion: 1, ...extra });
const base = () => ({ available: true, problems: [], configs: [config], assessments: [a("cand-a", "1", "2026-01-01"), a("cand-b", "2", "2026-01-01"), a("cand-c", "3", "2026-01-01"), a("cand-d", "4", "2026-01-01"),
  a("in-x-a1", "2", "2026-01-02", { intakeId: "in-x", attempt: 1 }), a("in-x-a2", "2", "2026-01-03", { intakeId: "in-x", attempt: 2 })] });

describe("preview export", () => {
  it("takes the latest assessment of each supplied candidate, under the supplied label", () => {
    const { out } = previewData(base(), { now: "2026-01-04T00:00:00Z" });
    expect(out.assessments.map((x) => [x.label, x.createdAt])).toEqual([["Candidate A", "2026-01-01"], ["Candidate B", "2026-01-03"], ["Candidate C", "2026-01-01"], ["Candidate D", "2026-01-01"]]);
  });
  it("keeps only what the page shows: no file names, fingerprints, run IDs, model details, provenance or questions", () => {
    const j = JSON.stringify(previewData(base()).out);
    expect(j).not.toMatch(/ffff|run-1|ai-run|claude|starter\.pdf|config\/r\.json|provenance|cvSha256|intakeId|"sources"|"Q"/);
    expect(j).toContain("AI draft (ai-proposed)");
  });
  it("leaves the full assessment rules out, keeping only names, calculation settings and the approval status", () => {
    const { out } = previewData(base()), j = JSON.stringify(out.config);
    expect(j).not.toMatch(/SYNTHETIC (?:GATE RULE|ANCHOR|CRITERION RULE|CONSTRAINT NOTE|TEST CHOICE)|Synthetic role description|Synthetic duty|JD line|Synthetic status|Synthetic note/);
    expect(out.config).toMatchObject({ approved: false, version: 1, role: { title: "R", loc: "L" }, gates: [{ id: "G1", label: "Synthetic gate" }], policy: { synthetic: true }, testChoices: [] });
    expect(out.config.criteria[1]).toMatchObject({ included: false, exclusionReason: "Synthetic exclusion reason." }); // the calculator checks it
  });
  it("keeps whether the current client summary was confirmed by a recruiter, without the recruiter's name or the time", () => {
    const data = base(), cur = { revision: 2, current: true, describes: { assessmentFingerprint: "ffff", assessmentVersion: 1, stateSha256: "ffff", rubric: { id: "syn" } }, content: { summary: "s", strengths: [], gaps: [], statuses: {} }, statusRule: "rule", preparation: { method: "reviewer-confirmed", actor: "Synthetic Reviewer Name", at: "2026-01-02T10:00:00Z" } };
    data.assessments[0].clientViews = [{ ...cur, revision: 1, current: false, preparation: { method: "assistant-prepared", actor: "x", at: "y" } }, cur];
    const a = previewData(data).out.assessments[0];
    expect(a.clientViews).toEqual([
      { revision: 1, current: false, content: { summary: "", strengths: [], gaps: [], statuses: {} }, describes: { assessmentVersion: 1 }, statusRule: "", preparation: { method: "", actor: "", at: "" } }, // strengths only
      { revision: 2, current: true, content: cur.content, describes: { assessmentVersion: 1 }, statusRule: "", preparation: { method: "reviewer-confirmed", actor: "", at: "" } }]);
    expect(JSON.stringify(a)).not.toMatch(/Synthetic Reviewer Name|2026-01-02T10/);
  });
  it("refuses extra candidates, blocked assessments, missing candidates and data with problems", () => {
    const extra = base(); extra.assessments.push(a("in-y-a1", "5", "2026-01-02", { intakeId: "in-y" }));
    expect(() => previewData(extra)).toThrow(/supplied candidates only/);
    const blocked = base(); blocked.assessments[5].status = "blocked";
    expect(() => previewData(blocked)).toThrow(/blocked/);
    const missing = base(); missing.assessments = missing.assessments.filter((x) => x.id !== "cand-d");
    expect(() => previewData(missing)).toThrow(/cand-d/);
    expect(() => previewData({ ...base(), problems: ["p"] })).toThrow(/problems/);
    expect(() => previewData({ ...base(), configs: [{ ...config, hashOk: false }] })).toThrow(/fingerprint/);
  });
});
