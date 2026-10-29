/* Versioned assessment runs (src/scoring/run.ts), with synthetic inputs only. */
import { describe, expect, it } from "vitest";
import { appendChained, assessmentFingerprint, canonical, chainProblems, clientContentProblems, computeRun, currentState, normalise, retentionProblems, validateRunInput, type ClientViewRevision, type RunInput, type ValidationContext } from "./run";
import { SYNTHETIC_FILES, SYNTHETIC_TEXT, syntheticInput, syntheticRubric } from "./syntheticFixture";
import type { Correction } from "./versions";

/* A deterministic 64-hex test hash (FNV-1a variants); the run logic takes any hash function. The local server and run
   command use SHA-256. */
const hash = (s: string) => Array.from({ length: 8 }, (_, k) => { let x = (0x811c9dc5 ^ (k * 0x9e3779b1)) >>> 0; for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619) >>> 0; return x.toString(16).padStart(8, "0"); }).join("");
const RUBRIC = syntheticRubric(), RUBRIC_V2 = { ...syntheticRubric(2), criteria: syntheticRubric(2).criteria.map((c) => (c.id === "C1" ? { ...c, weight: 1 } : c)) };
const SHAS = { cv: hash("cv"), jd: hash("jd"), req: hash("req"), text: hash(SYNTHETIC_TEXT), rubric: hash(canonical(RUBRIC)) };
const pages = SYNTHETIC_TEXT.split(/^=== PAGE \d+ of \d+ ===$/m).slice(1).map(normalise);
function ctx(over: Partial<{ files: Record<string, string | null>; rubrics: ValidationContext["rubrics"] }> = {}): ValidationContext {
  const files: Record<string, string | null> = { [SYNTHETIC_FILES.cv]: SHAS.cv, [SYNTHETIC_FILES.jd]: SHAS.jd, [SYNTHETIC_FILES.req]: SHAS.req, [SYNTHETIC_FILES.text]: SHAS.text, ...over.files };
  return {
    fileSha: (f) => files[f] ?? null, pages: (f) => (f === SYNTHETIC_FILES.text ? pages : null), hash,
    rubrics: over.rubrics ?? [
      { id: "synthetic-rubric", version: 2, sha256: hash(canonical(RUBRIC_V2)), manifestSha256: hash(canonical(RUBRIC_V2)), config: RUBRIC_V2 },
      { id: "synthetic-rubric", version: 1, sha256: SHAS.rubric, manifestSha256: SHAS.rubric, config: RUBRIC },
    ],
  };
}
const input = () => syntheticInput(SHAS, hash);
const valid = (i: RunInput = input(), c = ctx()) => { const v = validateRunInput(i, c); if (v.status === "blocked") throw new Error(v.problems.join("; ")); return v; };
const blockedBy = (i: unknown, c = ctx()) => { const v = validateRunInput(i, c); expect(v.status).toBe("blocked"); return v.problems.join("; "); };

describe("rubric selection", () => {
  it("uses exactly the rubric version the assessment names, whatever the manifest order", () => {
    const v = valid();
    expect(v.rubric.version).toBe(1);
    const reversed = ctx({ rubrics: [...ctx().rubrics].reverse() });
    expect(valid(input(), reversed).rubric.version).toBe(1);
    expect(computeRun(input(), valid(input(), reversed).rubric, hash).resultSha256).toBe(computeRun(input(), v.rubric, hash).resultSha256);
  });
  it("never substitutes another version", () => {
    expect(blockedBy(input(), ctx({ rubrics: [ctx().rubrics[0]] }))).toMatch(/rubric synthetic-rubric v1 is not in the manifest/);
  });
  it("blocks a rubric whose file or recorded fingerprint differs", () => {
    const r = ctx().rubrics[1];
    expect(blockedBy(input(), ctx({ rubrics: [{ ...r, sha256: hash("edited") }] }))).toMatch(/does not match its recorded fingerprint/);
    expect(blockedBy({ ...input(), rubric: { ...input().rubric, sha256: hash("other") } })).toMatch(/does not match its recorded fingerprint/);
  });
});

describe("bound inputs", () => {
  it.each([
    ["CV", SYNTHETIC_FILES.cv], ["job description", SYNTHETIC_FILES.jd], ["role requirements", SYNTHETIC_FILES.req], ["extracted text", SYNTHETIC_FILES.text],
  ])("blocks a missing or changed %s file", (name, file) => {
    expect(blockedBy(input(), ctx({ files: { [file]: null } }))).toContain(`${name} file is missing`);
    expect(blockedBy(input(), ctx({ files: { [file]: hash("changed") } }))).toContain(`${name} file does not match its recorded fingerprint`);
  });
});

describe("provenance is separate from integrity", () => {
  it("matching fingerprints never make a run verified: it stays provisional with every gap stated", () => {
    const v = valid();
    expect(v.status).toBe("provisional");
    expect(v.provenance.integrity).toBe("all bound files match their fingerprints");
    expect(v.provenance.extractionAccuracy).toBe("unverified");
    expect(v.notes.join(" ")).toMatch(/Extraction accuracy unverified/);
  });
  it("an input cannot declare its own extraction verified", () => {
    const i = input() as unknown as { sources: { extraction: Record<string, unknown> } };
    expect(blockedBy({ ...i, sources: { ...i.sources, extraction: { ...i.sources.extraction, accuracy: "verified" } } })).toMatch(/accuracy must be "unverified"/);
    expect(blockedBy({ ...i, sources: { ...i.sources, extraction: { ...i.sources.extraction, verifiedAgainstSource: true } } })).toMatch(/cannot be self-declared/);
  });
  it("records when each fingerprint was first recorded, and keeps unknown as unknown", () => {
    const t = Object.fromEntries(valid().provenance.sources.map((x) => [x.source, x.timing]));
    expect(t).toEqual({ CV: "before preparation", "job description": "before preparation", "role requirements": "after preparation", "extracted text": "unknown" });
    const r = valid().provenance.reasons.join(" ");
    expect(r).toMatch(/role requirements fingerprint was first recorded after the assessment was prepared/);
    expect(r).toMatch(/extracted text fingerprint was recorded at an unknown time/);
  });
  it("requires a recorded time or an explicit unknown, with a basis", () => {
    const i = input();
    expect(blockedBy({ ...i, sources: { ...i.sources, cv: { ...i.sources.cv, recorded: { when: "", basis: "" } } } })).toMatch(/sources.cv: recorded/);
    expect(blockedBy({ ...i, sources: { ...i.sources, jd: { ...i.sources.jd, recorded: undefined } } })).toMatch(/sources.jd: recorded/);
  });
  it("provenance metadata does not change the assessment identity; bound bytes do", () => {
    const i = input(), fp = assessmentFingerprint(i, hash);
    expect(assessmentFingerprint({ ...i, sources: { ...i.sources, cv: { ...i.sources.cv, recorded: { when: "unknown", basis: "Changed." } } } }, hash)).toBe(fp);
    expect(assessmentFingerprint({ ...i, sources: { ...i.sources, cv: { ...i.sources.cv, sha256: hash("other") } } }, hash)).not.toBe(fp);
  });
});

describe("schema and structure", () => {
  it.each([
    ["not an object", 5, /not an object/],
    ["wrong schema", { ...input(), schema: "x" }, /schema must be/],
    ["missing sources", { ...input(), sources: undefined }, /sources are required/],
    ["bad fingerprint", { ...input(), sources: { ...input().sources, cv: { file: "a", sha256: "nothex" } } }, /sources.cv/],
    ["bad gate result", { ...input(), assessment: { ...input().assessment, gates: [{ id: "G1", result: "Maybe", evidence: [], explanation: "x" }] } }, /gate 1/],
    ["rated without a rating", { ...input(), assessment: { ...input().assessment, criteria: [{ id: "C1", status: "rated", evidence: [], explanation: "x" }] } }, /whole-number rating/],
    ["evidence without a page", { ...input(), assessment: { ...input().assessment, otherResults: [{ type: "P2", quote: "q" }] } }, /quote and a page/],
    ["screening answers", { ...input(), assessment: { ...input().assessment, screening: {} } }, /screening must be null/],
    ["no client view", { ...input(), clientView: undefined }, /clientView is required/],
    ["bad evidence status", { ...input(), clientView: { ...input().clientView, content: { ...input().clientView.content, statuses: { G1: { status: "met" } } } } }, /invalid evidence status/],
  ])("blocks %s", (_, raw, msg) => expect(blockedBy(raw)).toMatch(msg));
  it("blocks gates or criteria that do not match the rubric exactly, and ratings out of range", () => {
    const i = input();
    expect(blockedBy({ ...i, assessment: { ...i.assessment, gates: i.assessment.gates.slice(1) } })).toMatch(/gate results do not match/);
    expect(blockedBy({ ...i, assessment: { ...i.assessment, criteria: [...i.assessment.criteria, { ...i.assessment.criteria[0], id: "N1" }] } })).toMatch(/criteria do not match/);
    expect(blockedBy({ ...i, assessment: { ...i.assessment, criteria: i.assessment.criteria.map((c) => (c.id === "C1" ? { ...c, rating: 4 } : c)) } })).toMatch(/outside the rubric/);
  });
});

describe("quote checks against the bound extraction", () => {
  it("matches across line breaks (whitespace collapsed) but nothing else", () => {
    expect(valid().status).toBe("provisional"); // "Synthetic quote alpha, wrapped" spans a line break
    expect(blockedBy({ ...input(), assessment: { ...input().assessment, criteria: input().assessment.criteria.map((c) => (c.id === "C1" ? { ...c, evidence: [{ quote: "synthetic QUOTE beta", page: 2 }] } : c)) } })).toMatch(/criterion C1 quote 1: quote not found on page 2/);
  });
  it("blocks a quote on the wrong page or beyond the last page, without repeating the quote", () => {
    const wrong = { ...input(), assessment: { ...input().assessment, criteria: input().assessment.criteria.map((c) => (c.id === "C1" ? { ...c, evidence: [{ quote: "Synthetic quote beta", page: 1 }] } : c)) } };
    const p = blockedBy(wrong);
    expect(p).toMatch(/quote not found on page 1/);
    expect(p).not.toContain("Synthetic quote beta");
    expect(blockedBy({ ...input(), assessment: { ...input().assessment, otherResults: [{ type: "P2", quote: "x", page: 9 }] } })).toMatch(/page 9 is beyond the extracted text \(2 pages\)/);
  });
  it("checks client-view strength quotes and statuses against the rubric", () => {
    const c = input().clientView.content;
    expect(clientContentProblems(c, RUBRIC, pages)).toEqual([]);
    expect(clientContentProblems({ ...c, strengths: [{ text: "x", evidence: [{ quote: "not there", page: 1 }] }] }, RUBRIC, pages).join()).toMatch(/strength 1 quote 1/);
    expect(clientContentProblems({ ...c, statuses: { ...c.statuses, C2: undefined as never } }, RUBRIC, pages).join()).toMatch(/C2 has no recorded evidence status/);
  });
});

describe("deterministic results", () => {
  it("identical inputs give identical results and fingerprints, with no run ID or time in them", () => {
    const a = computeRun(input(), RUBRIC, hash), b = computeRun(JSON.parse(JSON.stringify(input())), RUBRIC, hash);
    expect(a.resultSha256).toBe(b.resultSha256);
    expect(canonical(a.result)).toBe(canonical(b.result));
    expect(canonical(a.result)).not.toMatch(/runId|createdAt/);
    expect(a.result.v1).toMatchObject({ status: "scored", points: 15, possible: 18, score: 83 });
  });
  it("any change to ratings, gates, evidence, requirements or rubric changes the assessment fingerprint", () => {
    const fp = valid().assessmentFingerprint, i = input();
    const variants: RunInput[] = [
      { ...i, assessment: { ...i.assessment, criteria: i.assessment.criteria.map((c) => (c.id === "C2" ? { ...c, rating: 1 } : c)) } },
      { ...i, assessment: { ...i.assessment, gates: i.assessment.gates.map((g) => (g.id === "G1" ? { ...g, result: "Fail" as const } : g)) } },
      { ...i, assessment: { ...i.assessment, criteria: i.assessment.criteria.map((c) => (c.id === "C1" ? { ...c, explanation: "Changed." } : c)) } },
      { ...i, sources: { ...i.sources, roleRequirements: { ...i.sources.roleRequirements, version: "changed" } } },
      { ...i, rubric: { ...i.rubric, version: 2 } },
    ];
    for (const x of variants) expect(computeRun(x, RUBRIC, hash).result.assessmentFingerprint).not.toBe(fp);
  });
});

describe("stale client output", () => {
  const corr = (fp: string, over: Partial<Correction> = {}) => ({ assessmentId: "syn-a", version: 2, criterionId: "C2", previous: { status: "rated" as const, rating: 2 }, next: { status: "rated" as const, rating: 1 },
    evidence: "e", reason: "r", reviewer: "t", at: "2026-01-04T00:00:00Z", source: "reviewer" as const, configId: "synthetic-rubric", configVersion: 1, basedOn: fp, ...over });
  it("the migrated client view is current for version 1", () => {
    const v = valid(), s = currentState(v, [], [], hash);
    expect(s.currentClientView?.revision).toBe(1);
  });
  it.each([
    ["a lower rating", { next: { status: "rated" as const, rating: 1 } }],
    ["Unknown", { next: { status: "unknown" as const } }],
    ["Disputed", { next: { status: "disputed" as const } }],
    ["a higher rating", { next: { status: "rated" as const, rating: 3 } }],
  ])("a correction to %s leaves no current client view", (_, over) => {
    const v = valid(), s = currentState(v, [corr(v.assessmentFingerprint, over)], [], hash);
    expect(s.latest.version).toBe(2);
    expect(s.currentClientView).toBeNull();
    expect(s.clientViews.map((x) => x.current)).toEqual([false]);
  });
  it("a reviewer revision bound to the current state is current; the earlier one stays historical", () => {
    const v = valid(), c = corr(v.assessmentFingerprint), s1 = currentState(v, [c], [], hash);
    const rev: ClientViewRevision = { revision: 2, describes: { assessmentFingerprint: v.assessmentFingerprint, assessmentVersion: 2, stateSha256: s1.latestStateSha, rubric: v.input.rubric }, content: v.input.clientView.content, statusRule: "", preparation: { method: "reviewer-confirmed", actor: "R", at: "2026-01-05T00:00:00Z" } };
    const s2 = currentState(v, [c], [rev], hash);
    expect(s2.currentClientView?.revision).toBe(2);
    expect(s2.clientViews.map((x) => x.current)).toEqual([false, true]);
    /* A later correction makes revision 2 historical as well. */
    const s3 = currentState(v, [c, corr(v.assessmentFingerprint, { version: 3, previous: { status: "rated", rating: 1 }, next: { status: "rated", rating: 2 } })], [rev], hash);
    expect(s3.currentClientView).toBeNull();
  });
  it("a revision bound to another state, or followed by a stale one, is not current", () => {
    const v = valid();
    const wrong = { ...v.input.clientView, revision: 2, describes: { ...v.input.clientView.describes, stateSha256: hash("other") } };
    expect(currentState(v, [], [wrong], hash).currentClientView).toBeNull();
  });
  it("corrections made for other inputs are historical and not applied", () => {
    const v = valid(), s = currentState(v, [corr(hash("old inputs"))], [], hash);
    expect([s.latest.version, s.historicalCorrections.length, s.currentClientView?.revision]).toEqual([1, 1, 1]);
  });
  it("changed assessment inputs make the old client view stale", () => {
    const i = input();
    const changed = { ...i, assessment: { ...i.assessment, criteria: i.assessment.criteria.map((c) => (c.id === "C2" ? { ...c, rating: 1 } : c)) } };
    expect(currentState(valid(changed), [], [], hash).currentClientView).toBeNull();
  });
});

describe("re-confirming a client view after a change", () => {
  const corr = (fp: string) => ({ assessmentId: "syn-a", version: 2, criterionId: "C1", previous: { status: "rated" as const, rating: 3 }, next: { status: "unknown" as const },
    evidence: "e", reason: "Quote not supported (synthetic)", reviewer: "t", at: "2026-01-04T00:00:00Z", source: "reviewer" as const, configId: "synthetic-rubric", configVersion: 1, basedOn: fp });
  it("lists what changed and which requirements are affected, with a fingerprint of that list", () => {
    const v = valid(), s = currentState(v, [corr(v.assessmentFingerprint)], [], hash);
    expect(s.review?.baseRevision).toBe(1);
    expect(s.review?.affected).toEqual(["C1"]);
    expect(s.review?.changes.map((c) => [c.kind, c.id, c.from, c.to])).toEqual([["rating", "C1", "3", "Unknown"], ["correction", "C1", "3", "Unknown"]]);
    expect(s.review?.changesSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(currentState(v, [], [], hash).review).toBeNull(); // nothing to review while the view is current
  });
  it("changed inputs make every requirement affected", () => {
    const i = input(), changed = { ...i, assessment: { ...i.assessment, criteria: i.assessment.criteria.map((c) => (c.id === "C2" ? { ...c, rating: 1 } : c)) } };
    const s = currentState(valid(changed), [], [], hash);
    expect(s.review?.changes[0].kind).toBe("inputs");
    expect(s.review?.affected.sort()).toEqual(["C1", "C2", "G1", "G2", "I1"]);
  });
  /* C1 became Unknown: the strength quoting C1's evidence, the summary, the gaps and C1's status may now be wrong. */
  const base = input().clientView.content;
  it("refuses to re-approve an unchanged summary, strength, gap or affected status without a reason", () => {
    const p = retentionProblems(base, base, ["C1"], undefined).join(" | ");
    expect(p).toMatch(/summary is unchanged/);
    expect(p).toMatch(/some strengths are unchanged/);
    expect(p).toMatch(/some gaps are unchanged/);
    expect(p).toMatch(/C1 changed in the assessment but its evidence status is unchanged/);
  });
  it("accepts edited content, or kept content with a recorded reason for each part", () => {
    const edited = { summary: "Rewritten synthetic summary.", strengths: [], gaps: ["New synthetic gap."], statuses: { ...base.statuses, C1: { status: "not-stated" as const } } };
    expect(retentionProblems(base, edited, ["C1"], undefined)).toEqual([]);
    expect(retentionProblems(base, base, ["C1"], { summary: "Still accurate after review.", strengths: "Quote still supports it.", gaps: "Gaps are unaffected here.", statuses: { C1: "Reviewed against the new rating." } })).toEqual([]);
    expect(retentionProblems(base, base, ["C1"], { summary: "ok", strengths: "ok", gaps: "ok", statuses: { C1: "ok" } }).length).toBe(4); // a token reason is not enough
  });
  it("an unaffected status may stay unchanged without a reason", () => {
    const edited = { ...base, summary: "Rewritten synthetic summary.", strengths: [], gaps: [] };
    expect(retentionProblems(base, edited, ["C1"], { statuses: { C1: "Reviewed against the new rating." } })).toEqual([]);
  });
});

describe("reviewer history is append-only and tamper-evident", () => {
  const e1 = { assessmentId: "syn-a", n: 1 }, e2 = { assessmentId: "syn-a", n: 2 };
  it("accepts an intact chain", () => {
    expect(chainProblems(appendChained(appendChained([], e1, hash), e2, hash), hash, "entry")).toEqual([]);
  });
  it("detects an altered, removed or reordered entry", () => {
    const chain = appendChained(appendChained([], e1, hash), e2, hash);
    expect(chainProblems([{ ...chain[0], n: 9 }, chain[1]], hash, "entry")).toEqual(["entry entry 1 has been altered or reordered"]);
    expect(chainProblems([chain[1]], hash, "entry").length).toBe(1);
    expect(chainProblems([chain[1], chain[0]], hash, "entry").length).toBe(1);
  });
});
