/* Reproducible extraction on synthetic PDFs (macOS with the Xcode Command Line Tools required: the tests fail, rather than
   skip, when swiftc or PDFKit is unavailable). Covers page association, reading order, Unicode, problem files,
   reproducibility, immutable outputs, path validation, verification records, blinding, comparison, quiet logs, and
   explicit adoption of a new extraction for a synthetic assessment. No real candidate file is used. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import * as extraction from "../../src/scoring/extraction.ts";
import * as blinding from "../../src/scoring/blinding.ts";
import * as run from "../../src/scoring/run.ts";
import { buildVersions } from "../../src/scoring/versions.ts";
import { bindClientView, syntheticInput, syntheticRubric } from "../../src/scoring/syntheticFixture.ts";
import { buildTool, checkOutDir, compareRecordFiles, extractPdf, readExtraction, recordVerification, runTool, sha256, verificationsFor, writeNew, blindExtraction } from "./extract.mjs";
import { adoptExtraction } from "../scoring/adopt-extraction.mjs";
import { loadPrivateData, runRecords, writeNewPrivateJson } from "../scoring/private-data.mjs";

const lib = { ...extraction, ...blinding, ...run };
let tmp, fx, out;
const extract = (name, label = `fixture ${name}`) => extractPdf({ pdf: path.join(fx, `${name}.pdf`), outDir: out, allowedRoot: out, label, lib });
const pagesOf = (r) => readExtraction(r.recordFile, lib).pages;

beforeAll(() => {
  if (process.platform !== "darwin") throw new Error("These tests need macOS (Apple PDFKit) with the Xcode Command Line Tools; they do not skip.");
  buildTool(); // throws a clear error if swiftc is missing
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "extract-test-"));
  fx = path.join(tmp, "fx"); out = path.join(tmp, "out");
  fs.mkdirSync(fx); fs.mkdirSync(out);
  runTool("make-fixtures", fx);
}, 180000);

describe("page association and reading order", () => {
  it("keeps each page's text on its own page", () => {
    const r = extract("normal"), p = pagesOf(r);
    expect([r.record.status, r.record.source.pageCount, p.length]).toEqual(["completed", 3, 3]);
    expect(lib.locateQuote(p, "Opened 12 new accounts in 2024.", 1).status).toBe("found");
    expect(lib.locateQuote(p, "Managed 30 key accounts", 1)).toEqual({ status: "found-on-other-pages", pages: [2] });
    expect(lib.locateQuote(p, "B.S. in Synthetic Studies", 3).status).toBe("found");
    expect([r.record.review, r.record.verification]).toEqual(["no problems detected (this is not a verification)", "not checked against PDF"]);
  });
  it("reads two columns left then right, and still flags the layout for a reading-order check", () => {
    const r = extract("columns"), t = pagesOf(r)[0];
    const order = ["LEFT-1", "LEFT-2", "LEFT-3", "RIGHT-1", "RIGHT-2", "RIGHT-3"].map((x) => t.indexOf(x));
    expect(order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1]))).toBe(true);
    expect(r.record.pages[0].flags).toContain("multiple columns: check the reading order");
    expect(r.record.review).toBe("manual review required");
  });
  it("keeps Unicode exactly, and shows where ligatures and hyphenation break quotes", () => {
    const r = extract("unicode"), p = pagesOf(r);
    expect(lib.locateQuote(p, "Zürich, naïve, São Paulo, Kraków, €1,200 — résumé.", 1).status).toBe("found");
    /* Independent expectation: the fixture draws exactly these characters (see pdftool.swift). The extractor may keep a
       ligature as one character or expand it; either way the application must not normalise it silently. A quote that
       differs from the extracted text only by ligatures fails with a "compatibility-characters" hint, and a page that
       still contains ligature characters is flagged. (Observed with PDFKit on this OS: "ﬃ" kept, "ﬁ" expanded.) */
    const SOURCE = "Precomposed: e\uFB03cient pro\uFB01le.", PLAIN = "Precomposed: efficient profile.";
    for (const q of [SOURCE, PLAIN, "e\uFB03cient", "pro\uFB01le", "efficient profile"]) {
      const at = lib.locateQuote(p, q, 1);
      if (p[0].includes(q)) expect(at.status, q).toBe("found");
      else expect(at, q).toEqual({ status: "not-found", nearMatch: ["compatibility-characters"] });
    }
    if (/[\uFB00-\uFB06]/.test(p[0])) expect(r.record.pages[0].flags).toContain("ligature characters: quotes typed without them will not match");
    expect(lib.locateQuote(p, "territory management", 1)).toEqual({ status: "not-found", nearMatch: ["hyphenation"] });
    expect(lib.locateQuote(p, "territory manage- ment", 1).status).toBe("found");
    expect(r.record.pages[0].flags).toContain("hyphenated line breaks: quotes across them may not match");
  });
});

describe("problem files", () => {
  it("does not extract text inside images, and says so", () => {
    const m = extract("mixed");
    expect(pagesOf(m)[0]).toContain("this sentence is real text");
    expect(pagesOf(m)[0]).not.toContain("IMAGEONLY");
    expect(m.record.pages[0].flags).toContain("contains images: any text inside them is not extracted");
    const i = extract("image-only");
    expect(i.record.pages[0].flags[0]).toMatch(/^image-only/);
    expect([i.record.status, i.record.review]).toEqual(["completed", "manual review required"]);
  });
  it("flags an empty page", () => {
    expect(extract("empty").record.pages[0].flags).toEqual(["empty: no text found"]);
  });
  it.each([["encrypted", "encrypted or password-protected: not extracted"], ["corrupt", "unreadable or corrupt PDF"], ["not-a-pdf", "unreadable or corrupt PDF"]])("fails %s with a clear status and no text output", (name, problem) => {
    const r = extract(name);
    expect([r.record.status, r.record.text, r.record.problems]).toEqual(["failed", null, [problem]]);
    expect(r.record.review).toBe("not applicable: extraction failed");
    expect(fs.existsSync(r.recordFile.replace(/\.json$/, ".txt"))).toBe(false);
  });
});

describe("reproducibility and immutability", () => {
  it("the same PDF gives the same content and text fingerprints; only IDs and times differ", () => {
    const a = extract("normal").record, b = extract("normal").record;
    expect([a.contentSha256, a.text.sha256]).toEqual([b.contentSha256, b.text.sha256]);
    expect(a.extractionId).not.toBe(b.extractionId);
    expect(a.tool).toMatchObject({ name: expect.stringContaining("PDFKit"), swiftc: expect.stringContaining("Swift version"), os: expect.stringMatching(/^macOS /) });
    expect(a.tool.toolSourceSha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("never overwrites an output, and refuses output folders outside the allowed root or beside the source", () => {
    const f = path.join(out, "fixed.json");
    writeNew(f, "first");
    expect(() => writeNew(f, "second")).toThrow(/already exists/);
    expect(fs.readFileSync(f, "utf8")).toBe("first");
    expect(() => checkOutDir(path.join(tmp, "elsewhere"), out)).toThrow(/outside the allowed/);
    expect(() => checkOutDir(fx, tmp, path.join(fx, "normal.pdf"))).toThrow(/must not be the folder holding the source PDF/);
    expect(fs.readdirSync(out).filter((x) => x.endsWith(".tmp"))).toEqual([]);
  });
  it("records hold no document text and no source file name", () => {
    const r = extract("normal"), raw = fs.readFileSync(r.recordFile, "utf8");
    expect(raw).not.toMatch(/Opened 12 new|normal\.pdf|\/fx\//);
  });
});

describe("human verification is separate and explicit", () => {
  it("an extraction is never verified by running or by fingerprints; only by a reviewer's record, for its scope", () => {
    const r = extract("normal"), status = () => lib.verificationStatus({ extractionId: r.record.extractionId, pageCount: 3 }, verificationsFor(r.recordFile, r.record.extractionId)).status;
    expect(status()).toBe("not checked against PDF");
    recordVerification({ recordFile: r.recordFile, reviewer: "Synthetic reviewer", reviewedOn: "2026-01-10", pages: ["1", "2"], method: "read side by side", result: "matches", lib });
    expect(status()).toBe("partly checked against PDF");
    recordVerification({ recordFile: r.recordFile, reviewer: "Synthetic reviewer", reviewedOn: "2026-01-11", pages: "all", method: "read side by side", result: "matches", lib });
    expect(status()).toBe("checked against PDF");
    expect(JSON.parse(fs.readFileSync(r.recordFile, "utf8")).verification).toBe("not checked against PDF"); // the record itself never changes
    expect(() => recordVerification({ recordFile: r.recordFile, reviewer: "", reviewedOn: "x", pages: "all", method: "", result: "ok", lib })).toThrow(/required/);
  });
});

describe("blinding an extraction", () => {
  it("writes a separate blinded text, a record without text, and a private residual review; the source is unchanged", () => {
    const r = extract("normal"), before = fs.readFileSync(path.join(out, r.record.text.file), "utf8");
    const { record } = blindExtraction({ recordFile: r.recordFile, outDir: out, allowedRoot: out, options: { names: ["Synthetic Candidate"] }, lib });
    expect(fs.readFileSync(path.join(out, r.record.text.file), "utf8")).toBe(before);
    const blinded = fs.readFileSync(path.join(out, record.output.file), "utf8");
    expect(blinded).toContain("[NAME] Profile");
    expect(blinded).toContain("B.S. in Synthetic Studies");
    expect(record).toMatchObject({ sourceExtractionId: r.record.extractionId, sourceTextSha256: r.record.text.sha256, guarantee: expect.stringMatching(/^none: best-effort/), residualReview: "pending human review" });
    expect(JSON.stringify(record)).not.toMatch(/Synthetic Candidate|Opened 12/);
  });
});

describe("comparison", () => {
  it("reports changed and missing pages and lost quotes, and changes nothing", () => {
    const a = extract("normal"), b = extract("normal-revised");
    const c = compareRecordFiles(a.recordFile, b.recordFile, lib, [{ id: "q1", quote: "Opened 12 new accounts", page: 1 }, { id: "q2", quote: "Managed 30 key accounts", page: 2 }]);
    expect(c.sameSource).toBe(false);
    expect(c.pages.map((p) => p.status)).toEqual(["unchanged", "changed", "missing-in-new"]);
    expect(c.attention).toEqual(["page 2: changed", "page 3: missing-in-new", "q2: no longer found on its page"]);
  });
});

describe("quiet command output", () => {
  it("prints labels, counts and fingerprints only: no text, names or paths, and a failing exit code on failure", () => {
    const named = path.join(fx, "Zqxvname Sentinelperson CV.pdf");
    fs.copyFileSync(path.join(fx, "normal.pdf"), named);
    const cli = (args) => spawnSync(process.execPath, ["scripts/extract/cli.mjs", ...args], { env: { ...process.env, EXTRACT_ALLOWED_ROOT: out }, encoding: "utf8" });
    const ok = cli(["extract", named, "--label", "Candidate S", "--out", out]), bad = cli(["extract", path.join(fx, "corrupt.pdf"), "--label", "Candidate T", "--out", out]);
    expect([ok.status, bad.status]).toEqual([0, 2]);
    expect(ok.stdout).toMatch(/^Candidate S: COMPLETED · 3 page\(s\)/);
    expect(bad.stdout).toMatch(/^Candidate T: FAILED · 0 page\(s\)/);
    for (const s of [ok.stdout, ok.stderr, bad.stdout, bad.stderr]) expect(s).not.toMatch(/Zqxvname|Sentinelperson|Opened 12|Synthetic Candidate|\/fx\/|extract-test-/);
    const outside = cli(["extract", named, "--label", "Candidate S", "--out", tmp]);
    expect([outside.status, outside.stdout.trim()]).toEqual([1, "FAILED (out-outside-root): The output folder is outside the allowed extraction folder."]);
  }, 60000);
});

describe("adopting a new extraction for a synthetic assessment", () => {
  /* A synthetic private folder: the CV is a synthetic PDF; the bound text simulates an earlier one-off extraction. */
  function setup({ legacyQuote = false } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "adopt-test-")), dir = path.join(root, "prototype");
    fs.mkdirSync(path.join(root, "fx")); fs.copyFileSync(path.join(fx, "normal.pdf"), path.join(root, "fx/normal.pdf"));
    const fresh = extractPdf({ pdf: path.join(root, "fx/normal.pdf"), outDir: path.join(dir, "extractions"), allowedRoot: path.join(dir, "extractions"), label: "Candidate A", lib });
    const pages = pagesOf(fresh), old = [`${pages[0]}\n`, `${pages[1]}${legacyQuote ? "\nLegacy sentence only in the old text." : ""}`, pages[2]];
    const put = (rel, data) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); return sha256(fs.readFileSync(f)); };
    const rubric = syntheticRubric();
    const shas = { cv: sha256(fs.readFileSync(path.join(root, "fx/normal.pdf"))), jd: put("jd.pdf", "jd"), req: put("req.md", "req"), text: put("prototype/extracted/syn-a.txt", lib.pagesToText(old)), rubric: put("prototype/config/r1.json", JSON.stringify(rubric)) };
    put("prototype/config/manifest.json", JSON.stringify({ frozenConfigs: [{ file: "config/r1.json", sha256: shas.rubric }] }));
    put("prototype/mapping.json", JSON.stringify({ rule: "Synthetic", assignedAt: "2026-01-01T00:00:00Z", candidates: [{ id: "syn-a", label: "Candidate A", sourceFile: "fx/normal.pdf", sha256: shas.cv }] }));
    const i = syntheticInput(shas, sha256);
    i.sources.cv.file = "fx/normal.pdf"; i.sources.jd.file = "jd.pdf"; i.sources.roleRequirements.file = "req.md"; i.sources.extraction.file = "prototype/extracted/syn-a.txt";
    i.assessment.gates[1].evidence = [{ quote: "Opened 12 new accounts in 2024.", page: 1 }];
    i.assessment.criteria[0].evidence = [{ quote: "Managed 30 key accounts", page: 2 }];
    i.assessment.criteria[1].evidence = [{ quote: "led field sales across a fictional territory", page: 1 }];
    if (legacyQuote) i.assessment.criteria[2] = { ...i.assessment.criteria[2], evidence: [{ quote: "Legacy sentence only in the old text.", page: 2 }] };
    i.clientView.content.strengths = [{ text: "Synthetic strength.", evidence: [{ quote: "Managed 30 key accounts", page: 2 }] }];
    put("prototype/runs/inputs/syn-a.input.json", JSON.stringify(bindClientView(i, sha256)));
    const runLib = { ...run, buildVersions };
    const record = () => {
      const d = loadPrivateData(dir, runLib), { contextFor, loadRubrics } = privateHelpers;
      const v = run.validateRunInput(JSON.parse(fs.readFileSync(path.join(dir, "runs/inputs/syn-a.input.json"), "utf8")), contextFor(dir, loadRubrics(dir)));
      if (v.status === "blocked") throw new Error(v.problems.join("; "));
      const { result, resultSha256 } = run.computeRun(v.input, v.rubric, sha256);
      writeNewPrivateJson(path.join(dir, "runs/records", `run-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.json`), { runId: `run-${Math.random().toString(16).slice(2)}`, createdAt: new Date().toISOString(), result, resultSha256 });
      return d;
    };
    record();
    return { root, dir, fresh, one: () => loadPrivateData(dir, runLib).assessments[0], record, input: () => JSON.parse(fs.readFileSync(path.join(dir, "runs/inputs/syn-a.input.json"), "utf8")) };
  }
  let privateHelpers;
  beforeAll(async () => { privateHelpers = await import("../scoring/private-data.mjs"); });

  it("the synthetic assessment starts valid (provisional) with a current client view", () => {
    const s = setup();
    expect([s.one().status, s.one().clientView?.revision]).toEqual(["provisional", 1]);
  });
  it("a comparison changes nothing", () => {
    const s = setup(), before = fs.readFileSync(path.join(s.dir, "runs/inputs/syn-a.input.json"));
    const c = lib.compareExtractions(lib.parsePages(fs.readFileSync(path.join(s.root, "prototype/extracted/syn-a.txt"), "utf8")), pagesOf(s.fresh));
    expect(c.pages.map((p) => p.status)).toEqual(["whitespace-only", "unchanged", "unchanged"]);
    expect(fs.readFileSync(path.join(s.dir, "runs/inputs/syn-a.input.json"))).toEqual(before);
    expect(s.one().clientView?.revision).toBe(1);
  });
  it("refuses an extraction of a different PDF, a failed extraction, and one that loses a bound quote", () => {
    const s = setup(), adopt = (recordFile) => () => adoptExtraction({ dir: s.dir, assessmentId: "syn-a", recordFile, reviewer: "Synthetic reviewer", reason: "Synthetic adoption test", lib });
    expect(adopt(extract("normal-revised").recordFile)).toThrow(/different PDF/);
    expect(adopt(extract("corrupt").recordFile)).toThrow(/Only a completed extraction/);
    const l = setup({ legacyQuote: true });
    expect(() => adoptExtraction({ dir: l.dir, assessmentId: "syn-a", recordFile: l.fresh.recordFile, reviewer: "Synthetic reviewer", reason: "Synthetic adoption test", lib })).toThrow(/1 bound quote\(s\) are not on their stated page in the new text: criterion I1 quote 1/);
    expect(l.one().status).toBe("provisional"); // nothing changed
  });
  it("adoption is explicit and versioned: a new input, a logged change, a new run required, and older client output stale", () => {
    const s = setup(), before = s.input(), oldResult = runRecords(s.dir)[0].result.v1;
    const r = adoptExtraction({ dir: s.dir, assessmentId: "syn-a", recordFile: s.fresh.recordFile, reviewer: "Synthetic reviewer", reason: "Replace the one-off text with the reproducible extraction", lib });
    expect(r).toMatchObject({ extractionId: s.fresh.record.extractionId, quotesChecked: 4 });
    const after = s.input();
    expect(after.sources.extraction).toMatchObject({ sha256: s.fresh.record.text.sha256, extractionId: s.fresh.record.extractionId, accuracy: "unverified" });
    expect(run.canonical(after.assessment)).toBe(run.canonical(before.assessment)); // no rating, gate or evidence changed
    expect(fs.readdirSync(path.join(s.dir, "runs/inputs/archive")).length).toBe(1);
    const log = JSON.parse(fs.readFileSync(path.join(s.dir, "runs/provenance-log.json"), "utf8")).entries;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: "extraction-adopted", assessmentId: "syn-a", resultMayBeUnchanged: true });
    /* Blocked until a new run; then provisional, with the old client view stale and a review of every part required. */
    expect(s.one()).toMatchObject({ status: "blocked", problems: ["no recorded run for these exact inputs: run npm run scoring:run"] });
    s.record();
    const a = s.one();
    expect([a.status, a.clientView, a.review.changes[0].kind]).toEqual(["provisional", null, "inputs"]);
    const newResult = runRecords(s.dir).find((x) => x.result.assessmentFingerprint === a.run.assessmentFingerprint).result.v1;
    expect([newResult.score, newResult.points, newResult.possible]).toEqual([oldResult.score, oldResult.points, oldResult.possible]);
  });
  it("an altered or truncated provenance log blocks the assessment", () => {
    const s = setup();
    adoptExtraction({ dir: s.dir, assessmentId: "syn-a", recordFile: s.fresh.recordFile, reviewer: "Synthetic reviewer", reason: "Replace the one-off text with the reproducible extraction", lib });
    s.record();
    const f = path.join(s.dir, "runs/provenance-log.json"), raw = JSON.parse(fs.readFileSync(f, "utf8"));
    fs.writeFileSync(f, JSON.stringify({ entries: [] }));
    expect(s.one().status).toBe("blocked");
    raw.entries[0].reason = "Rewritten reason";
    fs.writeFileSync(f, JSON.stringify(raw));
    expect(s.one().problems.join()).toMatch(/altered, reordered or truncated/);
  });
});
