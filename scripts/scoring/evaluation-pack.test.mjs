/* W7 evaluation pack: candidate selection, reviewer slots, write-once sheets and the frozen comparison baseline, against a
   temporary folder of synthetic, fictional files. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as run from "../../src/scoring/run.ts";
import * as screening from "../../src/scoring/screening.ts";
import * as finalReview from "../../src/scoring/finalReview.ts";
import * as evaluationPack from "../../src/scoring/evaluationPack.ts";
import { groupCandidates } from "../../src/scoring/AssessHome.tsx";
import { buildVersions } from "../../src/scoring/versions.ts";
import { SYNTHETIC_FILES, SYNTHETIC_TEXT, bindClientView, syntheticInput, syntheticRubric } from "../../src/scoring/syntheticFixture.ts";
import { contextFor, loadPrivateData, loadRubrics, writeNewPrivateJson } from "./private-data.mjs";
import { baselineDrift, parsePackArgs, previewSelection, readBaseline, recordBaselines, writeSheets } from "./evaluation-pack.mjs";

const lib = { ...run, ...screening, ...finalReview, ...evaluationPack, buildVersions, groupCandidates };
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
const IDS = ["syn-a", "syn-b", "syn-c"];
let root, dir, shas;
const put = (rel, content) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); return hash(fs.readFileSync(f)); };
const putJson = (rel, v) => put(rel, JSON.stringify(v, null, 2));
const inputPath = (id) => path.join(dir, "runs/inputs", `${id}.input.json`);
function recordRun(id) {
  const v = run.validateRunInput(JSON.parse(fs.readFileSync(inputPath(id), "utf8")), { ...contextFor(dir, loadRubrics(dir)), hash });
  if (v.status === "blocked") throw new Error(v.problems.join("; "));
  const { result, resultSha256 } = run.computeRun(v.input, v.rubric, hash), runId = `run-${crypto.randomBytes(4).toString("hex")}`;
  writeNewPrivateJson(path.join(dir, "runs/records", `${runId}.json`), { runId, createdAt: new Date().toISOString(), result, resultSha256 });
  return runId;
}
const files = () => { const out = []; const walk = (d) => { if (fs.existsSync(d)) for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(path.join(d, f.name)) : out.push(path.relative(dir, path.join(d, f.name))); }; walk(path.join(dir, "evaluation")); return out.sort(); };
const sheets = (o) => writeSheets(dir, lib, o, "2026-01-10T00:00:00Z");
const baseline = (ids) => recordBaselines(dir, lib, ids, "2026-01-09T00:00:00Z");

/* Each supplied candidate has its own CV, an older hand-prepared assessment (the label mapping) and a newer automated
   draft of the identical CV (an intake). */
const cvFile = (id) => `cv-${id}.pdf`;
/** Writes a run input for `id` on candidate `cand`'s CV, prepared by `method` at `at`, and records its run. */
function addInput(id, cand, method, at) {
  const inp = syntheticInput(shas, hash, id);
  inp.sources.cv = { ...inp.sources.cv, file: cvFile(cand), sha256: shas.cvs[cand] };
  inp.preparation = { ...inp.preparation, method, actor: method === "ai-proposed" ? "AI route: synthetic-test" : "Synthetic preparer", at };
  putJson(`prototype/runs/inputs/${id}.input.json`, bindClientView(inp, hash));
  return recordRun(id);
}
/** Adds an intake (a newly added CV) holding the identical file as `cand`, with automated attempts at the given times. */
function addIntake(intakeId, cand, times) {
  putJson(`prototype/intake/${intakeId}/intake.json`, { label: `New CV ${cand}`, source: { sha256: shas.cvs[cand] }, uploadedAt: "2026-01-06T00:00:00Z" });
  return times.map((t, i) => addInput(`${intakeId}-a${i + 1}`, cand, "ai-proposed", t));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "eval-pack-test-")); dir = path.join(root, "prototype");
  shas = { jd: put(SYNTHETIC_FILES.jd, "synthetic jd bytes"), req: put(SYNTHETIC_FILES.req, "synthetic requirements"), text: put(SYNTHETIC_FILES.text, SYNTHETIC_TEXT),
    rubric: putJson("prototype/config/r1.json", syntheticRubric()), cvs: Object.fromEntries(IDS.map((id) => [id, put(cvFile(id), `synthetic cv bytes ${id}`)])) };
  shas.cv = shas.cvs["syn-a"];
  putJson("prototype/config/manifest.json", { frozenConfigs: [{ file: "config/r1.json", sha256: shas.rubric }] });
  putJson("prototype/mapping.json", { rule: "Synthetic", assignedAt: "2026-01-04T10:00:00Z", candidates: IDS.map((id, i) => ({ id, label: `Candidate ${"ABC"[i]}`, sourceFile: cvFile(id), sha256: shas.cvs[id] })) });
  for (const [i, id] of IDS.entries()) { addInput(id, id, "assistant-prepared", "2026-01-03T00:00:00Z"); addIntake(`in-syn-${i}`, id, ["2026-01-07T00:00:00Z"]); }
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("W7 pack arguments", () => {
  it("one candidate without --reviewer: that candidate only, both slots (the reported bug)", () => {
    expect(parsePackArgs(["syn-b"], IDS)).toEqual({ ids: ["syn-b"], slots: ["1", "2"], draft: false, baseline: false, preview: false });
  });
  it("several candidates, either reviewer option, or none named (all supplied candidates)", () => {
    expect(parsePackArgs(["syn-a", "syn-c", "syn-a"], IDS)).toMatchObject({ ids: ["syn-a", "syn-c"], slots: ["1", "2"] });
    expect(parsePackArgs(["--reviewer", "1", "syn-c"], IDS)).toMatchObject({ ids: ["syn-c"], slots: ["1"] });
    expect(parsePackArgs(["syn-a", "--reviewer", "2", "syn-b"], IDS)).toMatchObject({ ids: ["syn-a", "syn-b"], slots: ["2"] });
    expect(parsePackArgs(["--reviewer", "1", "--reviewer", "2"], IDS)).toMatchObject({ ids: IDS, slots: ["1", "2"] });
    expect(parsePackArgs(["--baseline", "syn-a"], IDS)).toMatchObject({ ids: ["syn-a"], baseline: true });
  });
  it("refuses unknown candidates, unknown options and reviewer slots other than 1 or 2", () => {
    const p = (a) => parsePackArgs(a, IDS).problems ?? [];
    expect(p(["syn-z"])).toEqual(['unknown candidate ID "syn-z": use syn-a, syn-b, syn-c']);
    expect(p(["syn-a", "--force"])).toEqual(['unknown option "--force"']);
    expect(p(["-r", "1"])[0]).toBe('unknown option "-r"');
    expect(p(["--reviewer", "3"])).toEqual(['unknown reviewer slot "3": use 1 or 2']);
    expect(p(["--reviewer", "0", "syn-a"])).toEqual(['unknown reviewer slot "0": use 1 or 2']);
    expect(p(["syn-a", "--reviewer"])).toEqual(["--reviewer needs a slot: 1 or 2"]);
    expect(p(["--reviewer", "--draft"])).toEqual(["--reviewer needs a slot: 1 or 2"]);
    expect(p(["--baseline", "--reviewer", "1"])).toEqual(["--baseline records the baseline only: it takes no --reviewer or --draft"]);
    expect(p(["--preview", "--baseline"])).toEqual(["--preview only shows the selection: it takes no other option"]);
  });
  it("the command refuses invalid arguments before writing anything", () => {
    for (const args of [["syn-z"], ["--reviewer", "3"], ["syn-a", "--force"]]) {
      const r = spawnSync(process.execPath, ["scripts/scoring/evaluation-pack.mjs", ...args], { env: { ...process.env, SCORING_PRIVATE_DIR: dir }, encoding: "utf8" });
      expect([r.status, r.stdout]).toEqual([2, expect.stringMatching(/^REFUSED — .*\nNothing was written\.\n$/)]);
    }
    expect(files()).toEqual([]);
  });
});

describe("W7 blank sheets: only the named candidates and slots, never overwritten", () => {
  beforeEach(() => baseline(IDS));
  it("one candidate, both slots, with or without --reviewer", () => {
    sheets({ ids: ["syn-b"], slots: ["1", "2"], draft: false });
    sheets({ ids: ["syn-c"], slots: ["2"], draft: false });
    expect(files().filter((f) => f.endsWith(".csv"))).toEqual(["evaluation/w7/reviewer-1/syn-b.csv", "evaluation/w7/reviewer-2/syn-b.csv", "evaluation/w7/reviewer-2/syn-c.csv"]);
  });
  it("several candidates, one slot", () => {
    sheets({ ids: ["syn-a", "syn-c"], slots: ["1"], draft: false });
    expect(files().filter((f) => f.endsWith(".csv"))).toEqual(["evaluation/w7/reviewer-1/syn-a.csv", "evaluation/w7/reviewer-1/syn-c.csv"]);
  });
  it("keeps an existing sheet byte for byte (a reviewer's answers are never overwritten)", () => {
    sheets({ ids: ["syn-a"], slots: ["1"], draft: false });
    const f = path.join(dir, "evaluation/w7/reviewer-1/syn-a.csv");
    fs.appendFileSync(f, "a reviewer's typing\r\n"); const before = fs.readFileSync(f, "utf8");
    expect(sheets({ ids: ["syn-a"], slots: ["1"], draft: false })[0].line).toBe("Candidate A, Reviewer 1: kept — evaluation/w7/reviewer-1/syn-a.csv already exists");
    expect(fs.readFileSync(f, "utf8")).toBe(before);
  });
  it("holds no AI result, even though the baseline is recorded", () => {
    sheets({ ids: ["syn-a"], slots: ["1"], draft: false });
    const csv = fs.readFileSync(path.join(dir, "evaluation/w7/reviewer-1/syn-a.csv"), "utf8"), a = loadPrivateData(dir, lib).assessments[0];
    for (const x of [...a.gates, ...a.criteria]) { expect(csv).not.toContain(x.explanation); for (const e of x.evidence) expect(csv).not.toContain(e.quote); }
    expect(csv).not.toMatch(/run-[0-9a-f]{8}|baseline/i);
  });
});

const baselinePath = (id = "syn-a") => path.join(dir, "evaluation/w7/baseline", `${id}.json`);
const readRaw = (id = "syn-a") => JSON.parse(fs.readFileSync(baselinePath(id), "utf8"));
const auto = (id = "in-syn-0-a1") => loadPrivateData(dir, lib).assessments.find((x) => x.id === id);

describe("W7 baseline: which assessment is frozen", () => {
  it("an older hand-prepared and a newer automated assessment of the same CV: the automated one is frozen, with the candidate label and exact ID", () => {
    expect(baseline(["syn-a"]).map((o) => o.line)).toEqual(["Candidate A: baseline recorded — assessment in-syn-0-a1, version 1, run " + auto().run.runId + " (evaluation/w7/baseline/syn-a.json)"]);
    const { baseline: b } = readBaseline(dir, lib, "syn-a"), a = auto();
    expect([b.candidate, b.assessmentId, b.preparedHow]).toEqual([{ id: "syn-a", label: "Candidate A" }, "in-syn-0-a1", "AI draft"]);
    expect(b.selection.group.map((g) => [g.assessmentId, g.preparedHow])).toEqual([["syn-a", "Prepared by hand with an AI assistant"], ["in-syn-0-a1", "AI draft"]]);
    expect(b.ai).toMatchObject({ runId: a.run.runId, resultSha256: a.run.resultSha256, assessmentFingerprint: a.run.assessmentFingerprint, version: 1, stateSha256: a.latestStateSha });
    expect(b.ai.assessment.criteria).toEqual(a.criteria);
    expect(b.rules).toEqual({ id: "synthetic-rubric", version: 1, sha256: shas.rubric });
    expect([b.sources.cv.sha256, b.sources.jd.sha256, b.sources.extractedText.sha256, b.sources.runInput.file]).toEqual([shas.cvs["syn-a"], shas.jd, shas.text, "runs/inputs/in-syn-0-a1.input.json"]);
    expect(files()).toEqual(["evaluation/w7/baseline/syn-a.json"]); // the named candidate only
  });
  it("the latest of several automated drafts is the one the portal shows and the one frozen", () => {
    addIntake("in-syn-9", "syn-b", ["2026-01-08T00:00:00Z", "2026-01-09T00:00:00Z"]);
    expect(previewSelection(dir, lib, ["syn-b"])[0]).toMatchObject({ label: "Candidate B", assessmentId: "in-syn-9-a2", problems: [] });
    expect(groupCandidates(loadPrivateData(dir, lib).assessments).find((g) => g.name === "Candidate B").latest.id).toBe("in-syn-9-a2");
  });
  it("refuses, with the reason, when the latest assessment is hand-prepared; the earlier automated draft is not used", () => {
    /* A newer hand-prepared assessment of the same CV, above the automated draft (in-syn-0-a1, 7 January). */
    putJson("prototype/intake/in-syn-8/intake.json", { label: "New CV syn-a", source: { sha256: shas.cvs["syn-a"] }, uploadedAt: "2026-01-06T00:00:00Z" });
    addInput("in-syn-8-a1", "syn-a", "assistant-prepared", "2026-01-08T00:00:00Z");
    expect(baseline(["syn-a"])[0].line).toBe("Candidate A: NOT RECORDED — the latest assessment shown for this candidate (in-syn-8-a1) is not an automated draft; an earlier assessment is not used instead");
    /* With only the hand-prepared assessment, it is refused too, never used silently. */
    fs.rmSync(path.join(dir, "intake/in-syn-1"), { recursive: true }); fs.rmSync(inputPath("in-syn-1-a1"));
    expect(baseline(["syn-b"])[0].line).toBe("Candidate B: NOT RECORDED — the latest assessment shown for this candidate (syn-b) is not an automated draft; an earlier assessment is not used instead");
    expect(files()).toEqual([]);
  });
  it("refuses when the latest automated draft is blocked, and never falls back to an earlier one", () => {
    addIntake("in-syn-9", "syn-a", ["2026-01-08T00:00:00Z"]);
    const inp = JSON.parse(fs.readFileSync(inputPath("in-syn-9-a1"), "utf8")); inp.assessment.criteria[0].explanation = "Changed without a new run.";
    fs.writeFileSync(inputPath("in-syn-9-a1"), JSON.stringify(inp)); // the recorded run no longer matches: blocked
    expect(baseline(["syn-a"])[0].line).toMatch(/^Candidate A: NOT RECORDED — an assessment of this CV is blocked \(in-syn-9-a1: .+\), so which assessment is the latest cannot be confirmed$/);
    expect(files()).toEqual([]);
  });
  it("refuses an ambiguous selection: two latest drafts at the same time, or two supplied candidates with the identical CV", () => {
    addIntake("in-syn-9", "syn-a", ["2026-01-07T00:00:00Z"]); // the same time as in-syn-0-a1
    expect(baseline(["syn-a"])[0].line).toBe("Candidate A: NOT RECORDED — the latest assessment cannot be identified: two assessments have the same time, or a time is missing");
    const m = JSON.parse(fs.readFileSync(path.join(dir, "mapping.json"), "utf8")); m.candidates[2] = { ...m.candidates[2], sourceFile: cvFile("syn-b"), sha256: shas.cvs["syn-b"] };
    putJson("prototype/mapping.json", m); addInput("syn-c", "syn-b", "assistant-prepared", "2026-01-03T00:00:00Z");
    expect(baseline(["syn-b"])[0].line).toBe("Candidate B: NOT RECORDED — more than one supplied candidate has this identical CV; which one is meant is ambiguous");
    expect(files()).toEqual([]);
  });
  it("a newer automated draft after the baseline: the baseline keeps the frozen one, and the difference is reported", () => {
    baseline(["syn-a"]); const before = readRaw();
    addIntake("in-syn-9", "syn-a", ["2026-01-08T00:00:00Z"]);
    expect(baselineDrift(dir, lib, "syn-a")).toEqual(["the portal now shows a different assessment (in-syn-9-a1; baseline: in-syn-0-a1)"]);
    expect(readRaw()).toEqual(before);
    expect(baselineDrift(dir, lib, "syn-b")).toEqual(["no baseline is recorded for this candidate"]);
  });
  it("the frozen assessment itself replaced after the baseline: reported, and the baseline keeps the earlier one", () => {
    baseline(["syn-a"]); const before = readRaw();
    const inp = JSON.parse(fs.readFileSync(inputPath("in-syn-0-a1"), "utf8")); inp.assessment.criteria[0].explanation = "A newer synthetic explanation.";
    fs.writeFileSync(inputPath("in-syn-0-a1"), JSON.stringify(bindClientView(inp, hash))); recordRun("in-syn-0-a1");
    expect(baselineDrift(dir, lib, "syn-a")).toContain("the baseline's assessment has been replaced since the baseline");
    expect(readBaseline(dir, lib, "syn-a").baseline).toEqual(before);
  });
});

describe("W7 baseline: whole-record change detection", () => {
  const CHANGED = "the baseline has changed since it was recorded (its whole-record fingerprint does not match)";
  const edits = {
    "candidate label": (b) => { b.candidate.label = "Candidate Z"; },
    "assessment ID": (b) => { b.assessmentId = "in-syn-0-a9"; },
    "how it was prepared": (b) => { b.preparedHow = "Prepared by hand with an AI assistant"; },
    "selection record": (b) => { b.selection.group.pop(); },
    "rules version": (b) => { b.rules.version = 2; },
    "rules fingerprint": (b) => { b.rules.sha256 = "0".repeat(64); },
    "CV fingerprint": (b) => { b.sources.cv.sha256 = "1".repeat(64); },
    "JD file": (b) => { b.sources.jd.file = "other-jd.pdf"; },
    "run input fingerprint": (b) => { b.sources.runInput.sha256 = "2".repeat(64); },
    "run record fingerprint": (b) => { b.sources.runRecord.sha256 = "3".repeat(64); },
    "role requirements version": (b) => { b.sources.roleRequirements.version = "another draft"; },
    "extracted text fingerprint": (b) => { b.sources.extractedText.sha256 = "4".repeat(64); },
    "AI version": (b) => { b.ai.version = 2; },
    "AI state": (b) => { b.ai.stateSha256 = "5".repeat(64); },
    "run ID": (b) => { b.ai.runId = "run-other"; },
    "run time": (b) => { b.ai.runCreatedAt = "2030-01-01T00:00:00Z"; },
    "result fingerprint": (b) => { b.ai.resultSha256 = "6".repeat(64); },
    "assessment content": (b) => { b.ai.assessment.criteria[0].explanation = "Edited after recording."; },
    "recorded corrections": (b) => { b.ai.assessment.corrections.push({ criterionId: "C1" }); },
    "recording time": (b) => { b.recordedAt = "2030-01-01T00:00:00Z"; },
    "an added field": (b) => { b.extra = "added"; },
  };
  for (const [what, edit] of Object.entries(edits)) it(`detects a change to the ${what}, refuses to use it and never replaces it`, () => {
    baseline(["syn-a"]); const b = readRaw(); edit(b); fs.writeFileSync(baselinePath(), JSON.stringify(b)); const bytes = fs.readFileSync(baselinePath());
    expect(readBaseline(dir, lib, "syn-a").problems).toEqual([CHANGED]);
    expect(baselineDrift(dir, lib, "syn-a")).toEqual([CHANGED]);
    expect(sheets({ ids: ["syn-a"], slots: ["1"], draft: false })[0].line).toBe(`Candidate A: NOT WRITTEN — ${CHANGED}: record it first with --baseline`);
    expect(baseline(["syn-a"])[0]).toMatchObject({ ok: false, line: `Candidate A: NOT RECORDED — a baseline file exists but ${CHANGED}; it is kept for inspection and not replaced` });
    expect(fs.readFileSync(baselinePath())).toEqual(bytes);
    expect(files()).toEqual(["evaluation/w7/baseline/syn-a.json"]);
  });
  it("rejects an incomplete record (a field removed, even with a recomputed fingerprint), naming the missing fields", () => {
    baseline(["syn-a"]); const b = readRaw(); delete b.sources.runRecord; delete b.ai.stateSha256; fs.writeFileSync(baselinePath(), JSON.stringify(b));
    expect(readBaseline(dir, lib, "syn-a").problems).toEqual(["the baseline is incomplete or malformed (sources.runRecord.file, sources.runRecord.sha256, ai.stateSha256)"]);
    const c = readRaw(); delete c.recordSha256; fs.writeFileSync(baselinePath(), JSON.stringify(c));
    expect(readBaseline(dir, lib, "syn-a").problems).toEqual(["the baseline is incomplete or malformed (sources.runRecord.file, sources.runRecord.sha256, ai.stateSha256, recordSha256)"]);
  });
  it("rejects a baseline that is not JSON, or belongs to another candidate", () => {
    baseline(["syn-a", "syn-b"]);
    fs.copyFileSync(baselinePath("syn-b"), baselinePath("syn-c"));
    expect(readBaseline(dir, lib, "syn-c").problems).toEqual(["the baseline does not belong to this candidate"]);
    fs.writeFileSync(baselinePath("syn-a"), "{ not json");
    expect(readBaseline(dir, lib, "syn-a").problems).toEqual(["the baseline is not valid JSON"]);
  });
  it("an unchanged baseline reads back, and a repeated --baseline keeps it byte for byte", () => {
    baseline(["syn-a"]); const bytes = fs.readFileSync(baselinePath());
    expect(readBaseline(dir, lib, "syn-a").problems).toBeUndefined();
    expect(baselineDrift(dir, lib, "syn-a")).toEqual([]);
    expect(baseline(["syn-a"])[0].line).toBe("Candidate A: kept — baseline already recorded (evaluation/w7/baseline/syn-a.json)");
    expect(fs.readFileSync(baselinePath())).toEqual(bytes);
  });
  it("a sheet needs the candidate's baseline (except a format draft), and uses the frozen assessment's rules and sources", () => {
    expect(sheets({ ids: ["syn-a"], slots: ["1"], draft: false })[0].line).toBe("Candidate A: NOT WRITTEN — no baseline is recorded for this candidate: record it first with --baseline");
    sheets({ ids: ["syn-a"], slots: ["1"], draft: true });
    expect(files()).toEqual(["evaluation/w7-draft/reviewer-1/syn-a.csv"]);
    baseline(["syn-a"]); sheets({ ids: ["syn-a"], slots: ["1"], draft: false });
    const csv = fs.readFileSync(path.join(dir, "evaluation/w7/reviewer-1/syn-a.csv"), "utf8");
    expect(csv).toContain(`CV,${cvFile("syn-a")} · SHA-256 ${shas.cvs["syn-a"]}`); // the supplied CV file
    expect(csv).not.toMatch(/in-syn-/); // not the intake copy, and no assessment ID
  });
  it("refuses a sheet when the supplied CV file is not the identical file the frozen assessment used", () => {
    baseline(["syn-a"]); fs.writeFileSync(path.join(root, cvFile("syn-a")), "changed bytes");
    expect(sheets({ ids: ["syn-a"], slots: ["1"], draft: false })[0].line).toMatch(/^Candidate A: NOT WRITTEN — .*the supplied CV file is not the identical file the assessment used$/);
  });
});
