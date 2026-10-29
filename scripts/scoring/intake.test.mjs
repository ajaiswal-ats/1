/* CV intake and AI-proposed assessment through the local scoring server, on synthetic, fictional PDFs only (macOS PDFKit,
   like scripts/extract/extract.test.mjs; these tests fail rather than skip without it). The AI route is either the
   synthetic test route (labelled not AI) or a fake "claude" command; no model is called. */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as extraction from "../../src/scoring/extraction.ts";
import * as blinding from "../../src/scoring/blinding.ts";
import * as run from "../../src/scoring/run.ts";
import * as ai from "../../src/scoring/aiAssessment.ts";
import { buildVersions } from "../../src/scoring/versions.ts";
import { syntheticRubric } from "../../src/scoring/syntheticFixture.ts";
import { buildTool, runTool } from "../extract/extract.mjs";
import { claudeCli, routeFromEnv } from "./ai-route.mjs";
import { spawnSync } from "node:child_process";
import { completedJobResult, createScoringMiddleware, loadPrivateData } from "./private-data.mjs";
import { INTERRUPTED, jobsFor, latestJob, recoverJobs } from "./jobs.mjs";

const PORT = 5998, ORIGIN = `http://127.0.0.1:${PORT}`, lib = { ...extraction, ...blinding, ...run, buildVersions };
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
let root, dir, fx;
const put = (rel, c) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); return hash(fs.readFileSync(f)); };
const config = { ...syntheticRubric(), gates: [{ id: "G1", label: "Synthetic licence", testRule: "Pass only on an explicit statement." }, { id: "G2", label: "Synthetic lifting", testRule: "Never inferred from a CV. Unknown for every CV." }] };

/* Quotes from the synthetic "normal" fixture (scripts/extract/pdftool.swift), avoiding words blinding hides. */
const output = (over = {}) => ({
  summary: "Field sales across a fictional territory with counted new accounts and key-account management.",
  gates: [{ id: "G1", result: "Unknown", basis: "explicit", evidenceKind: "none", evidence: [], explanation: "No licence is mentioned." },
    { id: "G2", result: "Unknown", basis: "explicit", evidenceKind: "not-from-cv", evidence: [], explanation: "A CV cannot show this." }],
  criteria: [{ id: "C1", status: "rated", rating: 3, basis: "explicit", detail: "Full", evidenceKind: "described", evidence: [{ quote: "Opened 12 new accounts in 2024.", page: 1 }], explanation: "Counted new accounts in a stated year." },
    { id: "C2", status: "unknown", rating: null, basis: "explicit", detail: null, evidenceKind: "none", evidence: [], explanation: "No margin information." },
    { id: "I1", status: "rated", rating: 2, basis: "explicit", detail: "Brief", evidenceKind: "described", evidence: [{ quote: "Managed 30 key accounts with quarterly visits.", page: 2 }], explanation: "Regular account contact." }],
  strengths: [{ text: "Counted new-account results.", evidence: [{ quote: "Opened 12 new accounts in 2024.", page: 1 }] }],
  gaps: ["No margin results are described."],
  questions: [{ question: "What margins did you achieve?", checks: ["C2"] }, { question: "Do you hold the licence?", checks: ["G1"] }, { question: "How did you plan visits?", checks: ["I1"] }],
  ...over,
});
const fixture = (name, value) => { const f = path.join(root, `${name}.json`); fs.writeFileSync(f, typeof value === "string" ? value : JSON.stringify(value)); return f; };

function req({ method = "GET", url = "/", body, type = "application/json", headers = {} } = {}) {
  const chunks = body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
  const r = Readable.from(chunks);
  Object.assign(r, { method, url, socket: { remoteAddress: "127.0.0.1" }, headers: { host: `127.0.0.1:${PORT}`, ...(method !== "GET" ? { origin: ORIGIN } : {}), ...(body !== undefined ? { "content-type": type } : {}), ...headers } });
  return r;
}
let clock = 0;
function call(options, route = routeFromEnv({ SCORING_AI_ROUTE: "synthetic-test", SCORING_AI_FIXTURE: fixture("valid", output()) })) {
  const mw = createScoringMiddleware({ dir, port: PORT, lib, ai, route, root: "/work/client-portal-v1", now: () => new Date(Date.UTC(2026, 0, 10) + clock++ * 1000).toISOString() });
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { resolve({ status: this.statusCode, body: b ? JSON.parse(b) : null }); } };
    mw(req(options), res, () => resolve({ status: "next" }));
  });
}
const upload = (name, fileName = "Zqx Sentinel resume.pdf") => call({ method: "POST", url: "/__scoring/intake", body: fs.readFileSync(path.join(fx, `${name}.pdf`)), type: "application/pdf", headers: { "x-role-id": config.id, "x-role-version": "1", "x-file-name": encodeURIComponent(fileName) } });
const review = (id, result = "matches") => call({ method: "POST", url: `/__scoring/intake/${id}/extraction-review`, body: { reviewer: "Synthetic reviewer", result } });
const assess = (id, route, confirmNew = false) => call({ method: "POST", url: `/__scoring/intake/${id}/assess`, body: { confirmNew } }, route);
/** Starts a background job and waits for it to finish (the request itself answers at once). A rerun is confirmed. */
async function assessAndWait(id, route) {
  const started = await assess(id, route, true);
  for (let i = 0; i < 400 && ["queued", "processing"].includes(latestJob(dir, id)?.state); i++) await new Promise((r) => setTimeout(r, 25));
  return { started, job: latestJob(dir, id) };
}
const snapshot = (d) => !fs.existsSync(d) ? {} : Object.fromEntries(fs.readdirSync(d, { recursive: true }).filter((f) => fs.statSync(path.join(d, f)).isFile()).map((f) => [f, hash(fs.readFileSync(path.join(d, f)))]));

beforeAll(() => {
  if (process.platform !== "darwin") throw new Error("These tests need macOS (Apple PDFKit); they do not skip.");
  buildTool();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "intake-test-")); dir = path.join(root, "prototype"); fx = path.join(root, "fx");
  fs.mkdirSync(fx); runTool("make-fixtures", fx);
  const rsha = put("prototype/config/r1.json", JSON.stringify(config));
  put("prototype/config/manifest.json", JSON.stringify({ frozenConfigs: [{ file: "config/r1.json", sha256: rsha }] }));
  put("prototype/mapping.json", JSON.stringify({ rule: "Synthetic", assignedAt: "2026-01-04T10:00:00Z", candidates: [] }));
  const jd = put("synthetic-jd.pdf", "synthetic jd"), req2 = put("synthetic-req.md", "synthetic requirements"), jdText = put("prototype/extracted/jd.txt", "Synthetic job description text.");
  put("prototype/config/role-sources.json", JSON.stringify({ roles: [{ config: { id: config.id, version: 1 }, jd: { file: "synthetic-jd.pdf", sha256: jd, recorded: { when: "2026-01-01", basis: "Synthetic." } },
    jdText: { file: "prototype/extracted/jd.txt", sha256: jdText }, roleRequirements: { file: "synthetic-req.md", sha256: req2, version: "synthetic draft", recorded: { when: "2026-01-01", basis: "Synthetic." } } }] }));
}, 180000);
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("intake", () => {
  let id;
  it("refuses anything that is not a PDF", async () => {
    expect((await call({ method: "POST", url: "/__scoring/intake", body: Buffer.from("not a pdf"), type: "application/pdf", headers: { "x-role-id": config.id, "x-role-version": "1" } })).body.problems).toEqual(["The file is not a PDF."]);
    expect((await call({ method: "POST", url: "/__scoring/intake", body: Buffer.from("x"), type: "text/plain" })).status).toBe(415);
  });
  it("saves, extracts and blinds a CV under a neutral label, privately, without its file name", async () => {
    const r = await upload("normal");
    expect(r.status).toBe(201);
    id = r.body.id;
    expect([r.body.label, r.body.extraction.status, r.body.extraction.pages, r.body.review.status]).toEqual(["New CV 1", "completed", 3, "not reviewed"]);
    expect(r.body.blinding.replacements).toBeGreaterThan(0);
    const d = path.join(dir, "intake", id), meta = fs.readFileSync(path.join(d, "intake.json"), "utf8");
    expect(meta).not.toMatch(/Zqx|Sentinel|resume/i);
    for (const f of fs.readdirSync(d, { recursive: true })) if (fs.statSync(path.join(d, f)).isFile()) expect((fs.statSync(path.join(d, f)).mode & 0o077), f).toBe(0);
    const text = (await call({ url: `/__scoring/intake/${id}/text` })).body.pages;
    expect(text).toHaveLength(3);
    expect(text[0].blinded).toMatch(/^\[NAME\]/); // the page-1 name line is hidden from the AI's copy
  });
  it("explains extraction failures and page problems in plain English", async () => {
    const enc = await upload("encrypted");
    expect(enc.body.extraction).toEqual({ status: "failed", messages: ["The PDF is password-protected, so no text could be read."] });
    expect((await review(enc.body.id)).body.problems[0]).toMatch(/only a completed extraction can be checked/i);
    const img = await upload("image-only");
    expect(img.body.extraction.messages.join(" ")).toMatch(/no selectable text \(it may be a scanned image\)/);
  });
  it("requires a person's extraction review before assessment, and refuses after differences were found", async () => {
    expect((await assess(id)).body.problems).toEqual(["Review the extracted text against the PDF before assessing."]);
    const other = (await upload("normal")).body.id;
    await review(other, "differences found");
    expect((await assess(other)).body.problems[0]).toMatch(/found differences/);
  });
  it("reports a missing AI route instead of assessing", async () => {
    await review(id);
    const r = await assess(id, { route: null, reason: "No AI route is configured for this local server (set SCORING_AI_ROUTE)." });
    expect([r.status, r.body.problems]).toEqual([503, ["No AI route is configured for this local server (set SCORING_AI_ROUTE)."]]);
  });
});

describe("assessment", () => {
  let id, before;
  beforeAll(async () => { id = (await upload("normal")).body.id; await review(id); before = snapshot(path.join(dir, "runs")); });
  it("turns validated output into a normal assessment with a run record, shown under its neutral label", async () => {
    const { started, job } = await assessAndWait(id);
    expect([started.status, started.body.job.state]).toEqual([202, "queued"]); // answered at once; the work is in the background
    expect([job.state, job.assessmentId]).toEqual(["ready", `${id}-a1`]);
    const a = loadPrivateData(dir, lib).assessments.find((x) => x.id === `${id}-a1`);
    expect([a.status, a.intakeId, a.attempt]).toEqual(["provisional", id, 1]);
    expect(a.label).toMatch(/^New CV \d+$/);
    expect(a.producedBy).toMatch(/Non-AI test route: synthetic-test.*\(ai-proposed\)/);
    expect(a.criteria.find((c) => c.id === "C2")).not.toHaveProperty("rating");
    const runRec = JSON.parse(fs.readFileSync(path.join(dir, "intake", id, fs.readdirSync(path.join(dir, "intake", id)).find((f) => f.startsWith("ai-run-"))), "utf8"));
    expect([runRec.outcome, runRec.route.isAi, runRec.inputs.rubric.id]).toEqual(["valid", false, config.id]);
  });
  it("rejects invalid output completely: kept for inspection, no assessment, no run", async () => {
    const bad = routeFromEnv({ SCORING_AI_ROUTE: "synthetic-test", SCORING_AI_FIXTURE: fixture("bad", output({ criteria: output().criteria.map((c) => (c.id === "C1" ? { ...c, evidence: [{ quote: "Opened 99 new accounts in 2024.", page: 1 }] } : c)) })) });
    const inputsBefore = fs.readdirSync(path.join(dir, "runs/inputs")).length, { job } = await assessAndWait(id, bad);
    expect([job.state, job.assessmentId, job.error]).toEqual(["failed", null, "The AI draft did not pass the checks, so no assessment was made."]);
    expect(job.problems.join(" ")).toMatch(/skill C1 quote 1: not found on page 1/);
    expect(fs.readdirSync(path.join(dir, "runs/inputs")).length).toBe(inputsBefore);
    const notJson = routeFromEnv({ SCORING_AI_ROUTE: "synthetic-test", SCORING_AI_FIXTURE: fixture("notjson", "{oops") });
    expect((await assessAndWait(id, notJson)).job).toMatchObject({ state: "failed", error: "The synthetic output is not valid JSON." });
  });
  it("is repeatable: the same output gives the same calculated result; every run is kept", async () => {
    const { job } = await assessAndWait(id);
    expect(job.assessmentId).toBe(`${id}-a2`);
    const data = loadPrivateData(dir, lib), [a1, a2] = [1, 2].map((n) => data.assessments.find((x) => x.id === `${id}-a${n}`));
    expect(a2.status).toBe("provisional");
    const recs = fs.readdirSync(path.join(dir, "runs/records")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, "runs/records", f), "utf8")).result);
    const v = (aid) => { const x = recs.find((rr) => rr.assessmentId === aid).v1; return [x.status, x.points, x.possible, x.score]; };
    expect(v(a2.id)).toEqual(v(a1.id));
    expect(fs.readdirSync(path.join(dir, "intake", id)).filter((f) => f.startsWith("ai-run-"))).toHaveLength(4);
  });
  it("leaves every earlier record unchanged (new files only)", () => {
    const after = snapshot(path.join(dir, "runs"));
    for (const [f, h] of Object.entries(before)) expect(after[f], f).toBe(h);
  });
});

describe("background jobs", () => {
  let id;
  const slow = (ms) => routeFromEnv({ SCORING_AI_ROUTE: "synthetic-test", SCORING_AI_FIXTURE: fixture("slow", output()), SCORING_AI_DELAY_MS: String(ms) });
  beforeAll(async () => { id = (await upload("normal")).body.id; await review(id); });
  it("answers at once, keeps working after the request has ended, and shows Queued, Processing, then Ready", async () => {
    const route = slow(300), started = await assess(id, route, true);
    expect([started.status, started.body.job.state]).toEqual([202, "queued"]);
    await new Promise((r) => setTimeout(r, 60));
    expect(latestJob(dir, id).state).toBe("processing");
    const listed = (await call({ url: "/__scoring/intake" }, route)).body.intakes.find((x) => x.id === id);
    expect(listed.job.state).toBe("processing"); // what a refreshed page reads
    for (let i = 0; i < 100 && latestJob(dir, id).state !== "ready"; i++) await new Promise((r) => setTimeout(r, 25));
    expect(latestJob(dir, id)).toMatchObject({ state: "ready", assessmentId: expect.stringMatching(new RegExp(`^${id}-a\\d+$`)) });
  });
  it("returns the running job for repeated requests instead of starting another", async () => {
    const route = slow(300), before = jobsFor(dir, id).length;
    const [a, b, c] = await Promise.all([assess(id, route, true), assess(id, route, true), assess(id, route, true)]);
    const ids = new Set([a, b, c].map((r) => r.body.job.jobId));
    expect(ids.size).toBe(1);
    expect([a, b, c].filter((r) => r.status === 200 && r.body.duplicate)).toHaveLength(2);
    for (let i = 0; i < 100 && latestJob(dir, id).state !== "ready"; i++) await new Promise((r) => setTimeout(r, 25));
    expect(jobsFor(dir, id).length).toBe(before + 1);
    expect(fs.readdirSync(path.join(dir, "intake", id)).filter((f) => f.startsWith("ai-run-")).length).toBe(jobsFor(dir, id).length); // one AI run per job
  });
  it("refuses a new run for a CV that already has a result unless it is confirmed, so a late click cannot start one", async () => {
    const before = jobsFor(dir, id).length, r = await assess(id, slow(50));
    expect([r.status, r.body.needsConfirm, r.body.problems]).toEqual([409, true, ["This CV already has an assessment. Confirm to run a new one; earlier results are kept."]]);
    expect(jobsFor(dir, id).length).toBe(before);
  });
  it("records a job interrupted by a server stop as failed, keeps finished results, and does not restart it", () => {
    const d = path.join(dir, "intake", id, "jobs"), stuck = { schema: "assessment-job/1", jobId: "job-stuck", intakeId: id, state: "processing", createdAt: "2026-01-09T00:00:00.000Z", startedAt: "2026-01-09T00:00:01.000Z", finishedAt: null, assessmentId: null, runId: null, error: null, problems: [] };
    fs.writeFileSync(path.join(d, "job-stuck.json"), JSON.stringify(stuck));
    const ready = jobsFor(dir, id).filter((j) => j.state === "ready").map((j) => j.jobId), runsBefore = fs.readdirSync(path.join(dir, "intake", id)).length;
    recoverJobs(dir); // a new server process: the folder is checked again on first use
    expect(jobsFor(dir, id).find((j) => j.jobId === "job-stuck")).toMatchObject({ state: "failed", error: "Processing was interrupted. No completed assessment is available from this job. Earlier results are kept. AI usage may already have occurred." });
    expect(jobsFor(dir, id).filter((j) => j.state === "ready").map((j) => j.jobId)).toEqual(ready);
    expect(fs.readdirSync(path.join(dir, "intake", id)).length).toBe(runsBefore);
  });
});

/* A real forced stop: a separate server process (the same middleware, synthetic route) is killed with SIGKILL at a chosen
   point of an assessment job, then this process reconciles the job as a restarted server would. No AI is called. */
describe("forced interruption of a background job (SIGKILL, synthetic route)", () => {
  const PROJECT = path.resolve(import.meta.dirname, "../.."), verify = (i, j) => completedJobResult(dir, lib, i, j);
  const child = (id, when) => {
    const f = path.join(root, "kill-child.mjs");
    fs.writeFileSync(f, `import fs from "node:fs"; import { Readable } from "node:stream";
const [P, dir, id, fixture, when] = process.argv.slice(2);
const { createServer } = await import(P + "/node_modules/vite/dist/node/index.js");
const v = await createServer({ root: P, configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", logLevel: "silent" });
const m = async (x) => v.ssrLoadModule(x), lib = { ...(await m("/src/scoring/extraction.ts")), ...(await m("/src/scoring/blinding.ts")), ...(await m("/src/scoring/run.ts")), buildVersions: (await m("/src/scoring/versions.ts")).buildVersions };
const ai = await m("/src/scoring/aiAssessment.ts"), { createScoringMiddleware } = await import(P + "/scripts/scoring/private-data.mjs"), { routeFromEnv } = await import(P + "/scripts/scoring/ai-route.mjs");
const link = fs.linkSync;
fs.linkSync = (a, b) => {
  if (when === "before-assessment" && b.includes("/runs/inputs/")) process.kill(process.pid, "SIGKILL"); // job has named the assessment; nothing saved
  link(a, b);
  if (when === "after-assessment" && b.includes("/runs/records/")) process.kill(process.pid, "SIGKILL"); // assessment and its run record saved; job not completed
};
const route = routeFromEnv({ SCORING_AI_ROUTE: "synthetic-test", SCORING_AI_FIXTURE: fixture, SCORING_AI_DELAY_MS: when === "during-ai" ? "5000" : "0" });
if (when === "during-ai") setTimeout(() => process.kill(process.pid, "SIGKILL"), 800);
const mw = createScoringMiddleware({ dir, port: ${PORT}, lib, ai, route, root: P });
const r = Readable.from([Buffer.from(JSON.stringify({ confirmNew: true }))]);
Object.assign(r, { method: "POST", url: "/__scoring/intake/" + id + "/assess", socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:${PORT}", origin: "${ORIGIN}", "content-type": "application/json" } });
mw(r, { statusCode: 0, setHeader() {}, end() {} }, () => {});
setTimeout(() => process.exit(3), 20000); // not killed: the test fails
`);
    return spawnSync(process.execPath, [f, PROJECT, dir, id, fixture("kill", output()), when], { encoding: "utf8", timeout: 60000 });
  };
  const aiRuns = (id) => fs.readdirSync(path.join(dir, "intake", id)).filter((f) => f.startsWith("ai-run-"));
  let id;
  beforeAll(async () => { id = (await upload("normal")).body.id; await review(id); });

  it("after the assessment was saved but before the job was completed: Ready for review with that assessment, no new AI call", async () => {
    const records = snapshot(path.join(dir, "runs")), runsBefore = aiRuns(id).length;
    const c = child(id, "after-assessment");
    expect(c.signal).toBe("SIGKILL");
    const stuck = latestJob(dir, id);
    expect(stuck).toMatchObject({ state: "processing", savingAssessmentId: `${id}-a1`, assessmentId: null });
    expect(fs.existsSync(path.join(dir, "runs/inputs", `${id}-a1.input.json`))).toBe(true);
    expect(aiRuns(id).length).toBe(runsBefore); // killed before the AI run record was written
    recoverJobs(dir, undefined, verify); // the restarted server
    const job = latestJob(dir, id);
    expect(job).toMatchObject({ jobId: stuck.jobId, state: "ready", assessmentId: `${id}-a1`, runId: null, error: null });
    expect(jobsFor(dir, id)).toHaveLength(1);
    expect(aiRuns(id).length).toBe(runsBefore); // nothing was run again
    const a = loadPrivateData(dir, lib).assessments.find((x) => x.id === `${id}-a1`);
    expect(a.status).not.toBe("blocked");
    expect(a.producedBy).toMatch(/\(ai-proposed\)/); // still an AI draft for review
    const after = snapshot(path.join(dir, "runs"));
    for (const [f, h] of Object.entries(records)) expect(after[f], f).toBe(h); // earlier records unchanged
    expect((await call({ url: "/__scoring/intake" })).body.intakes.find((x) => x.id === id).job.state).toBe("ready");
    expect((await assess(id)).status).toBe(409); // a new run still needs confirmation
  }, 90000);

  it("after the job named the assessment but before it was saved: interrupted, nothing saved", () => {
    const records = snapshot(path.join(dir, "runs")), runsBefore = aiRuns(id).length;
    expect(child(id, "before-assessment").signal).toBe("SIGKILL");
    const stuck = latestJob(dir, id);
    expect(stuck).toMatchObject({ state: "processing", savingAssessmentId: `${id}-a2` });
    recoverJobs(dir, undefined, verify);
    expect(latestJob(dir, id)).toMatchObject({ jobId: stuck.jobId, state: "failed", assessmentId: null, error: INTERRUPTED });
    /* Earlier records unchanged; the only new file is the half-written temporary file the kill left (never read as an assessment). */
    const after = snapshot(path.join(dir, "runs")), added = Object.keys(after).filter((f) => !(f in records));
    for (const [f, h] of Object.entries(records)) expect(after[f], f).toBe(h);
    expect(added.every((f) => f.endsWith(".tmp"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "runs/inputs", `${id}-a2.input.json`))).toBe(false);
    expect(aiRuns(id).length).toBe(runsBefore);
    expect(jobsFor(dir, id).find((j) => j.state === "ready").assessmentId).toBe(`${id}-a1`); // the earlier result is kept
  }, 90000);

  it("during the AI step: interrupted, nothing saved, not restarted", () => {
    const records = snapshot(path.join(dir, "runs")), runsBefore = aiRuns(id).length, jobsBefore = jobsFor(dir, id).length;
    expect(child(id, "during-ai").signal).toBe("SIGKILL");
    expect(latestJob(dir, id)).toMatchObject({ state: "processing", savingAssessmentId: null });
    recoverJobs(dir, undefined, verify);
    expect(latestJob(dir, id)).toMatchObject({ state: "failed", error: INTERRUPTED });
    expect(jobsFor(dir, id)).toHaveLength(jobsBefore + 1);
    const after = snapshot(path.join(dir, "runs"));
    for (const [f, h] of Object.entries(records)) expect(after[f], f).toBe(h);
    expect(Object.keys(after).filter((f) => !(f in records) && !f.endsWith(".tmp"))).toEqual([]);
    expect(aiRuns(id).length).toBe(runsBefore);
  }, 90000);

  it("does not credit a job with an assessment it did not save (an earlier one, or one claimed by another job's AI run)", () => {
    const d = path.join(dir, "intake", id, "jobs"), base = { schema: "assessment-job/1", intakeId: id, state: "processing", createdAt: "2099-01-01T00:00:00.000Z", startedAt: "2099-01-01T00:00:01.000Z", finishedAt: null, assessmentId: null, runId: null, error: null, problems: [] };
    fs.writeFileSync(path.join(d, "job-zz-old.json"), JSON.stringify({ ...base, jobId: "job-zz-old", savingAssessmentId: `${id}-a1` })); // saved before this job started
    fs.writeFileSync(path.join(d, "job-zz-other.json"), JSON.stringify({ ...base, jobId: "job-zz-other", startedAt: "2000-01-01T00:00:00.000Z", savingAssessmentId: `${id}-a1` }));
    const runFile = path.join(dir, "intake", id, "ai-run-zz-other.json");
    fs.writeFileSync(runFile, JSON.stringify({ runId: "ai-run-zz-other", jobId: "job-someone-else", assessmentId: `${id}-a1` }));
    recoverJobs(dir, undefined, verify);
    fs.rmSync(runFile);
    expect(jobsFor(dir, id).filter((j) => j.jobId.startsWith("job-zz-")).map((j) => [j.jobId, j.state, j.assessmentId])).toEqual([["job-zz-old", "failed", null], ["job-zz-other", "failed", null]]);
  });
});

describe("Claude command-line route (fake command, no model call)", () => {
  const fake = (body) => { const f = path.join(root, `fake-claude-${crypto.randomBytes(3).toString("hex")}.sh`); fs.writeFileSync(f, `#!/bin/sh\nprintf '%s\\n' "$@" > "${f}.args"\nenv > "${f}.env"\ncat > "${f}.stdin"\ncat <<'JSON'\n${body}\nJSON\n`, { mode: 0o700 }); return f; };
  it("runs with no tools, the required output, no saved session and a spending cap, and without API keys", async () => {
    const f = fake(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "", structured_output: output(), total_cost_usd: 0.12, modelUsage: { "claude-sonnet-test-0": {} }, num_turns: 1 }));
    process.env.ANTHROPIC_API_KEY = "sk-test-should-not-pass";
    try {
      const r = await claudeCli({ bin: f, model: "sonnet", cap: 1, timeoutMs: 20000 }).run({ system: "S", user: "U <cv>data</cv>", schema: { type: "object" } });
      expect([r.ok, r.meta.models, r.meta.costUsd]).toEqual([true, ["claude-sonnet-test-0"], 0.12]);
      const args = fs.readFileSync(`${f}.args`, "utf8").split("\n");
      for (const [k, v] of [["--tools", ""], ["--model", "sonnet"], ["--max-budget-usd", "1"], ["--output-format", "json"], ["--setting-sources", "local"]]) expect(args[args.indexOf(k) + 1], k).toBe(v);
      for (const k of ["-p", "--no-session-persistence", "--json-schema", "--disable-slash-commands", "--strict-mcp-config"]) expect(args).toContain(k);
      expect(fs.readFileSync(`${f}.env`, "utf8")).not.toMatch(/ANTHROPIC_API_KEY/);
      expect(fs.readFileSync(`${f}.stdin`, "utf8")).toBe("U <cv>data</cv>");
    } finally { delete process.env.ANTHROPIC_API_KEY; }
  });
  it("fails clearly on a spending cap, a usage limit or missing structured output, without retrying", async () => {
    const run1 = (body) => claudeCli({ bin: fake(body), model: "sonnet", cap: 1, timeoutMs: 20000 }).run({ system: "S", user: "U", schema: {} });
    expect((await run1(JSON.stringify({ subtype: "error_max_budget_usd", is_error: true }))).error).toMatch(/reached its \$1 spending cap/);
    expect((await run1(JSON.stringify({ subtype: "success", is_error: true, result: "Claude usage limit reached" }))).error).toMatch(/usage or rate limit/);
    expect((await run1(JSON.stringify({ subtype: "success", is_error: false, result: "I cannot do that." }))).error).toMatch(/did not return the required structured output/);
    expect((await run1("not json")).ok).toBe(false);
  });
  it("is chosen only when configured, with a bounded cap", () => {
    expect(routeFromEnv({}).route).toBeNull();
    expect(routeFromEnv({ SCORING_AI_ROUTE: "claude-cli", SCORING_AI_MAX_USD: "50" }).reason).toMatch(/between 0 and 5/);
    expect(routeFromEnv({ SCORING_AI_ROUTE: "claude-cli" }).route.isAi).toBe(true);
    expect(routeFromEnv({ SCORING_AI_ROUTE: "synthetic-test", SCORING_AI_FIXTURE: "x" }).route.isAi).toBe(false);
  });
});
