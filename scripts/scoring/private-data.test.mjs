/* The local scoring server: fail-closed validation, immutable run records, bound corrections and client views, guards
   and storage, against a temporary folder of synthetic, fictional files. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as run from "../../src/scoring/run.ts";
import * as screening from "../../src/scoring/screening.ts";
import * as finalReview from "../../src/scoring/finalReview.ts";
import { buildVersions } from "../../src/scoring/versions.ts";
import { SENTINELS, SYNTHETIC_FILES, SYNTHETIC_TEXT, syntheticInput, syntheticRubric } from "../../src/scoring/syntheticFixture.ts";
import { createScoringMiddleware, loadPrivateData, requestAllowed, runRecords, writeNewPrivateJson, writePrivateJson } from "./private-data.mjs";

const PORT = 5999, ORIGIN = `http://127.0.0.1:${PORT}`, lib = { ...run, ...screening, ...finalReview, buildVersions };
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
let root, dir;
const put = (rel, content) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); return hash(fs.readFileSync(f)); };
const putJson = (rel, v) => put(rel, JSON.stringify(v, null, 2));
const inputPath = (id = "syn-a") => path.join(dir, "runs/inputs", `${id}.input.json`);
const readInput = () => JSON.parse(fs.readFileSync(inputPath(), "utf8"));
function recordRun(id = "syn-a") {
  const v = run.validateRunInput(JSON.parse(fs.readFileSync(inputPath(id), "utf8")), { ...ctxFor(), hash });
  if (v.status === "blocked") throw new Error(v.problems.join("; "));
  const { result, resultSha256 } = run.computeRun(v.input, v.rubric, hash), runId = `run-${crypto.randomBytes(4).toString("hex")}`;
  writeNewPrivateJson(path.join(dir, "runs/records", `${runId}.json`), { runId, createdAt: new Date().toISOString(), result, resultSha256 });
  return runId;
}
let ctxFor;
let shas;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "scoring-test-")); dir = path.join(root, "prototype");
  const rubric = syntheticRubric(), v2 = { ...syntheticRubric(2), criteria: syntheticRubric(2).criteria.map((c) => (c.id === "C1" ? { ...c, weight: 1 } : c)) };
  shas = { cv: put(SYNTHETIC_FILES.cv, "synthetic cv bytes"), jd: put(SYNTHETIC_FILES.jd, "synthetic jd bytes"), req: put(SYNTHETIC_FILES.req, "synthetic requirements"), text: put(SYNTHETIC_FILES.text, SYNTHETIC_TEXT),
    rubric: putJson("prototype/config/r1.json", rubric) };
  const sha2 = putJson("prototype/config/r2.json", v2);
  /* Version 2 is listed first: the assessment names version 1 and must get exactly that. */
  putJson("prototype/config/manifest.json", { frozenConfigs: [{ file: "config/r2.json", sha256: sha2 }, { file: "config/r1.json", sha256: shas.rubric }] });
  putJson("prototype/mapping.json", { rule: "Synthetic", assignedAt: "2026-01-04T10:00:00Z", candidates: [{ id: "syn-a", label: "Candidate A", sourceFile: SYNTHETIC_FILES.cv, sha256: shas.cv }] });
  /* C1's quote contains the sentinel name (it is on page 2), so a failing check on it must not echo it. */
  const inp = syntheticInput(shas, hash);
  inp.assessment.criteria[0].evidence.push({ quote: `led by ${SENTINELS.name}`, page: 2 });
  putJson("prototype/runs/inputs/syn-a.input.json", (await import("../../src/scoring/syntheticFixture.ts")).bindClientView(inp, hash));
  const { contextFor, loadRubrics } = await import("./private-data.mjs");
  ctxFor = () => contextFor(dir, loadRubrics(dir));
  recordRun();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function req({ method = "GET", url = "/", host = `127.0.0.1:${PORT}`, origin, remote = "127.0.0.1", body, type = "application/json" } = {}) {
  const r = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))]);
  Object.assign(r, { method, url, socket: { remoteAddress: remote }, headers: { host, ...(origin ? { origin } : {}), ...(body !== undefined ? { "content-type": type } : {}) } });
  return r;
}
let clock = 0;
function call(options, extra = {}) {
  const mw = createScoringMiddleware({ dir, port: PORT, lib, root: "/work/client-portal-v1", now: () => new Date(Date.UTC(2026, 0, 10) + clock++ * 1000).toISOString(), ...extra });
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { resolve({ status: this.statusCode, headers: this.headers, body: b ? JSON.parse(b) : null }); } };
    mw(req(options), res, () => resolve({ status: "next", headers: res.headers }));
  });
}
const data = () => loadPrivateData(dir, lib);
const one = () => data().assessments[0];
const post = (url, body) => call({ method: "POST", url, origin: ORIGIN, body });
const expectedOf = (a = one()) => ({ assessmentFingerprint: a.run.assessmentFingerprint, assessmentVersion: a.latestVersion, stateSha256: a.latestStateSha });
const correction = (over = {}, a = one()) => ({ assessmentId: "syn-a", version: a.latestVersion + 1, criterionId: "C2", previous: { status: "rated", rating: 2 }, next: { status: "rated", rating: 1 }, evidence: "Synthetic", reason: "Synthetic",
  reviewer: "Tester", source: "reviewer", configId: "synthetic-rubric", configVersion: 1, basedOn: a.run.assessmentFingerprint, expected: expectedOf(a), ...over });
const ASSESSMENT_KEYS = ["gates", "criteria", "otherResults", "clientView", "clientViews", "run", "strengths", "gaps", "questions"];

describe("validated assessments", () => {
  it("serves a validated, recorded assessment under exactly its named rubric, with a current client view", async () => {
    const r = await call({ url: "/__scoring/data" });
    expect([r.status, r.headers["cache-control"]]).toEqual([200, "no-store"]);
    const a = r.body.assessments[0];
    expect([a.status, a.label, a.configVersion, a.latestVersion, a.clientView?.revision]).toEqual(["provisional", "Candidate A", 1, 1, 1]);
    expect(a.notes.join()).toMatch(/Extraction accuracy unverified/);
    expect(a.provenance.extractionAccuracy).toBe("unverified");
    expect(r.body.problems).toEqual([]);
  });

  const tampers = [
    ["changed CV", () => put(SYNTHETIC_FILES.cv, "different"), /CV file does not match/],
    ["missing job description", () => fs.rmSync(path.join(root, SYNTHETIC_FILES.jd)), /job description file is missing/],
    ["changed role requirements", () => put(SYNTHETIC_FILES.req, "edited"), /role requirements file does not match/],
    ["changed extraction", () => put(SYNTHETIC_FILES.text, SYNTHETIC_TEXT + "x"), /extracted text file does not match/],
    ["edited rubric", () => putJson("prototype/config/r1.json", { ...syntheticRubric(), status: "edited" }), /rubric synthetic-rubric v1 does not match/],
    ["edited ratings without a new run", () => putJson("prototype/runs/inputs/syn-a.input.json", { ...readInput(), assessment: { ...readInput().assessment, criteria: readInput().assessment.criteria.map((c) => (c.id === "C2" ? { ...c, rating: 1 } : c)) } }), /no recorded run for these exact inputs/],
    ["malformed input", () => put("prototype/runs/inputs/syn-a.input.json", "{"), /not valid JSON/],
    ["quote moved to the wrong page", () => { const i = readInput(); i.assessment.criteria[0].evidence[0].page = 1; putJson("prototype/runs/inputs/syn-a.input.json", i); }, /quote not found on page 1/],
    ["altered run record", () => { const f = fs.readdirSync(path.join(dir, "runs/records"))[0], p = path.join(dir, "runs/records", f), r = JSON.parse(fs.readFileSync(p, "utf8")); r.result.v1.score = 99; fs.writeFileSync(p, JSON.stringify(r)); }, /altered/],
    ["CV differs from the label mapping", () => { const m = JSON.parse(fs.readFileSync(path.join(dir, "mapping.json"), "utf8")); m.candidates[0].sha256 = hash("other"); putJson("prototype/mapping.json", m); }, /fingerprint differs from the one recorded when labels were assigned/],
  ];
  it.each(tampers)("%s: blocked on the server, with no assessment content sent", async (_, tamper, msg) => {
    tamper();
    const r = await call({ url: "/__scoring/data" }), a = r.body.assessments[0];
    expect(a.status).toBe("blocked");
    expect(a.problems.join("; ")).toMatch(msg);
    for (const k of ASSESSMENT_KEYS) expect(a, k).not.toHaveProperty(k);
    expect(JSON.stringify(r.body)).not.toMatch(/Synthetic quote|Synthetic summary of the candidate/);
    expect(r.body.problems.join()).toMatch(/Candidate A: assessment blocked/);
  });
  it("a new run for the edited inputs makes it valid again, and earlier records are kept", () => {
    const i = readInput(); i.assessment.criteria = i.assessment.criteria.map((c) => (c.id === "C2" ? { ...c, rating: 1 } : c));
    putJson("prototype/runs/inputs/syn-a.input.json", i);
    expect(one().status).toBe("blocked");
    recordRun();
    expect(one().status).toBe("provisional");
    expect(runRecords(dir)).toHaveLength(2);
    expect(one().clientView).toBeNull(); // the client view describes the earlier inputs
  });
});

describe("immutable, atomic writes", () => {
  it("never overwrites a run record and leaves no temporary files", () => {
    const f = path.join(dir, "runs/records/fixed.json");
    writeNewPrivateJson(f, { a: 1 });
    expect(() => writeNewPrivateJson(f, { a: 2 })).toThrow(/EEXIST/);
    expect(JSON.parse(fs.readFileSync(f, "utf8"))).toEqual({ a: 1 });
    expect(fs.readdirSync(path.dirname(f)).filter((x) => x.endsWith(".tmp"))).toEqual([]);
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    writePrivateJson(path.join(dir, "x.json"), { b: 1 });
    expect(fs.readdirSync(dir).filter((x) => x.endsWith(".tmp"))).toEqual([]);
  });
  it("identical inputs give the same result fingerprint in every record", () => {
    recordRun();
    const recs = runRecords(dir);
    expect(new Set(recs.map((r) => r.resultSha256)).size).toBe(1);
    expect(new Set(recs.map((r) => r.runId)).size).toBe(2);
  });
});

describe("reviewer corrections", () => {
  it("binds a correction to the assessment and makes the client view out of date", async () => {
    const r = await post("/__scoring/corrections", correction());
    expect(r.status).toBe(201);
    const a = one();
    expect([a.latestVersion, a.clientView, a.clientViews.map((v) => v.current)]).toEqual([2, null, [false]]);
    expect(fs.statSync(path.join(dir, "reviews.json")).mode & 0o777).toBe(0o600);
  });
  it("refuses a correction made for different inputs, or for a blocked assessment", async () => {
    expect((await post("/__scoring/corrections", correction({ basedOn: hash("other") }))).status).toBe(409);
    const valid = correction();
    put(SYNTHETIC_FILES.cv, "different");
    expect((await post("/__scoring/corrections", valid)).status).toBe(409);
    expect(fs.existsSync(path.join(dir, "reviews.json"))).toBe(false);
  });
  it("concurrent conflicting corrections: one is saved, the other refused, none lost silently", async () => {
    const [a, b] = await Promise.all([post("/__scoring/corrections", correction()), post("/__scoring/corrections", correction({ next: { status: "unknown" } }))]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "reviews.json"), "utf8")).corrections).toHaveLength(1);
    const c = await post("/__scoring/corrections", correction({ previous: { status: "rated", rating: 1 }, next: { status: "rated", rating: 2 } }));
    expect(c.status).toBe(201); // made from the refreshed state
    expect(JSON.parse(fs.readFileSync(path.join(dir, "reviews.json"), "utf8")).corrections).toHaveLength(2);
  });
  it.each([["missing reason", { reason: "" }], ["wrong previous value", { previous: { status: "rated", rating: 3 } }], ["out of range", { next: { status: "rated", rating: 7 } }]])("rejects %s and writes nothing", async (_, over) => {
    expect((await post("/__scoring/corrections", correction(over))).status).toBe(422);
    expect(fs.existsSync(path.join(dir, "reviews.json"))).toBe(false);
  });
});

describe("client view confirmation", () => {
  const edited = () => ({ ...readInput().clientView.content, summary: "Rewritten synthetic summary after review.", gaps: ["New synthetic gap after review."],
    statuses: { ...readInput().clientView.content.statuses, C2: { status: "not-stated" } } });
  const confirm = (over = {}, a = one()) => ({ assessmentId: "syn-a", describes: { ...expectedOf(a), rubric: a.rubric }, changesSha256: a.review?.changesSha256,
    content: edited(), retained: { strengths: "The quoted strength is unaffected by the C2 change." }, reviewer: "Reviewer", confirmed: true, ...over });
  it("binds a reviewed view to the current state explicitly", async () => {
    await post("/__scoring/corrections", correction());
    const r = await post("/__scoring/client-view", confirm());
    expect(r.status).toBe(201);
    const a = one();
    expect([a.clientView?.revision, a.clientViews.map((v) => v.current)]).toEqual([2, [false, true]]);
    expect(a.clientView.preparedBy).toBe("Reviewer (reviewer-confirmed)");
  });
  it("refuses a stale binding, a missing confirmation, unknown statuses and quotes not on the page", async () => {
    const stale = confirm();
    await post("/__scoring/corrections", correction());
    expect((await post("/__scoring/client-view", stale)).status).toBe(409);
    expect((await post("/__scoring/client-view", confirm({ confirmed: false }))).status).toBe(422);
    const content = readInput().clientView.content;
    expect((await post("/__scoring/client-view", confirm({ content: { ...content, statuses: { ...content.statuses, C2: { status: "met" } } } }))).status).toBe(422);
    expect((await post("/__scoring/client-view", confirm({ content: { ...content, strengths: [{ text: "x", evidence: [{ quote: "not there", page: 1 }] }] } }))).status).toBe(422);
    expect(one().clientView).toBeNull();
  });
});

describe("re-confirmation after evidence or ratings change", () => {
  /* C1 becomes Unknown: the strength and summary built on C1 may now be wrong, and C1's status must be reconsidered. */
  const c1 = (a = one()) => correction({ criterionId: "C1", previous: { status: "rated", rating: 3 }, next: { status: "unknown" } }, a);
  const send = (over = {}) => { const a = one(); return post("/__scoring/client-view", { assessmentId: "syn-a", describes: { ...expectedOf(a), rubric: a.rubric }, changesSha256: a.review.changesSha256,
    content: readInput().clientView.content, retained: {}, reviewer: "Reviewer", confirmed: true, ...over }); };
  it("shows the reviewer what changed and which requirements are affected", async () => {
    await post("/__scoring/corrections", c1());
    const rv = one().review;
    expect(rv.baseRevision).toBe(1);
    expect(rv.affected).toEqual(["C1"]);
    expect(rv.changes.map((c) => [c.kind, c.id, c.from, c.to])).toEqual([["rating", "C1", "3", "Unknown"], ["correction", "C1", "3", "Unknown"]]);
  });
  it("refuses to re-approve the old summary, strength, gaps and C1 status without reasons", async () => {
    await post("/__scoring/corrections", c1());
    const r = await send();
    expect(r.status).toBe(422);
    const p = r.body.problems.join(" | ");
    for (const x of [/summary is unchanged/, /strengths are unchanged/, /gaps are unchanged/, /C1 changed in the assessment but its evidence status is unchanged/]) expect(p).toMatch(x);
    expect(one().clientView).toBeNull();
  });
  it("records approvals of held strengths only with a reason, for a strength actually kept; confirming without one records none", async () => {
    await post("/__scoring/corrections", c1());
    const retained = { summary: "Summary still accurate after the C1 change.", strengths: "The quote still supports this strength.", gaps: "The gaps do not depend on C1.", statuses: { C1: "Reviewed: still shown as needs review." } };
    const kept = readInput().clientView.content.strengths[0].text;
    for (const approvedHeld of [[{ text: kept, reason: "short" }], [{ text: "Not a kept synthetic strength.", reason: "Synthetic reason long enough." }], [{ text: kept, reason: "Synthetic reason long enough." }, { text: kept, reason: "Synthetic reason long enough." }], "not a list"]) {
      const r = await send({ retained, approvedHeld });
      expect(r.status).toBe(422);
      expect(r.body.problems.join(" ")).toMatch(/approved held strength/);
    }
    expect(one().clientView).toBeNull(); // nothing was stored
    expect((await send({ retained })).status).toBe(201);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "reviews.json"), "utf8")).clientViews[0].review.approvedHeld).toEqual([]);
  });
  it("stores a valid approval with the confirmation", async () => {
    await post("/__scoring/corrections", c1());
    const retained = { summary: "Summary still accurate after the C1 change.", strengths: "The quote still supports this strength.", gaps: "The gaps do not depend on C1.", statuses: { C1: "Reviewed: still shown as needs review." } };
    const kept = readInput().clientView.content.strengths[0].text;
    expect((await send({ retained, approvedHeld: [{ text: kept, reason: "  Synthetic: confirmed in the call.  " }] })).status).toBe(201);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "reviews.json"), "utf8")).clientViews[0].review.approvedHeld).toEqual([{ text: kept, reason: "Synthetic: confirmed in the call." }]);
  });
  it("records a deliberate decision to keep wording, with its reasons, in an immutable revision", async () => {
    await post("/__scoring/corrections", c1());
    const retained = { summary: "Summary still accurate after the C1 change.", strengths: "The quote still supports this strength.", gaps: "The gaps do not depend on C1.", statuses: { C1: "Reviewed: still shown as needs review." } };
    expect((await send({ retained })).status).toBe(201);
    const stored = JSON.parse(fs.readFileSync(path.join(dir, "reviews.json"), "utf8")).clientViews[0];
    expect(stored.review.retained).toEqual(retained);
    expect(stored.review.changes.length).toBe(2);
    expect(stored.describes.rubric).toEqual(one().rubric);
    expect(one().clientView.revision).toBe(2);
    /* Earlier revisions cannot be edited: changing the stored revision is detected and blocks the assessment. */
    const before = one(), f = path.join(dir, "reviews.json"), raw = JSON.parse(fs.readFileSync(f, "utf8"));
    raw.clientViews[0].content.summary = "Silently edited.";
    fs.writeFileSync(f, JSON.stringify(raw));
    expect(one()).toMatchObject({ status: "blocked", problems: ["the reviewer history or provenance log has been altered, reordered or truncated"] });
    expect((await post("/__scoring/corrections", correction({}, before))).status).toBe(409);
  });
  it("refuses a confirmation when nothing changed, the change list differs, or the rubric is not the bound one", async () => {
    expect((await post("/__scoring/client-view", { assessmentId: "syn-a", describes: { ...expectedOf(), rubric: one().rubric }, changesSha256: "0".repeat(64), content: readInput().clientView.content, reviewer: "R", confirmed: true })).status).toBe(409);
    await post("/__scoring/corrections", c1());
    expect((await send({ changesSha256: "0".repeat(64) })).status).toBe(409);
    expect((await send({ describes: { ...expectedOf(), rubric: { ...one().rubric, version: 2 } } })).status).toBe(409);
  });
});

describe("stale writes from two open sessions", () => {
  it("a session that loaded before another's correction cannot correct or confirm with its old state", async () => {
    const sessionA = one(), sessionB = one();
    expect((await post("/__scoring/corrections", correction({}, sessionA))).status).toBe(201);
    const late = await post("/__scoring/corrections", correction({ criterionId: "I1", previous: { status: "unknown" }, next: { status: "rated", rating: 1 } }, sessionB));
    expect(late.status).toBe(409);
    expect(late.body.problems.join()).toMatch(/changed since it was opened. Refresh/);
    const lateConfirm = await post("/__scoring/client-view", { assessmentId: "syn-a", describes: { ...expectedOf(sessionB), rubric: sessionB.rubric }, changesSha256: "0".repeat(64), content: readInput().clientView.content, reviewer: "B", confirmed: true });
    expect(lateConfirm.status).toBe(409);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "reviews.json"), "utf8")).corrections).toHaveLength(1);
    /* After refreshing, session B's change is accepted on top of A's. */
    expect((await post("/__scoring/corrections", correction({ criterionId: "I1", previous: { status: "unknown" }, next: { status: "rated", rating: 1 } }))).status).toBe(201);
  });
  it("a correction made before the inputs changed and were re-run is refused", async () => {
    const before = one();
    const i = readInput(); i.assessment.criteria = i.assessment.criteria.map((c) => (c.id === "I1" ? { ...c, explanation: "Revised synthetic explanation." } : c));
    putJson("prototype/runs/inputs/syn-a.input.json", i);
    recordRun();
    expect((await post("/__scoring/corrections", correction({}, before))).status).toBe(409);
  });
});

describe("no candidate text in errors or logs (synthetic sentinels)", () => {
  const leaks = (text) => Object.values(SENTINELS).filter((x) => text.includes(x) || text.includes(x.split(" ")[1]));
  it("blocked payloads, problems and error responses never contain CV text", async () => {
    const i = readInput(); i.assessment.criteria[0].evidence[1].page = 1; // the sentinel quote is now on the wrong page
    putJson("prototype/runs/inputs/syn-a.input.json", i);
    const r = await call({ url: "/__scoring/data" });
    expect(r.body.assessments[0].status).toBe("blocked");
    expect(r.body.assessments[0].problems.join()).toMatch(/criterion C1 quote 2: quote not found on page 1/);
    expect(leaks(JSON.stringify(r.body))).toEqual([]);
    const c = await post("/__scoring/corrections", { assessmentId: "syn-a", evidence: SENTINELS.name });
    expect(leaks(JSON.stringify(c.body))).toEqual([]);
  });
  it("a refused client view does not echo the submitted quote", async () => {
    await post("/__scoring/corrections", correction());
    const a = one(), r = await post("/__scoring/client-view", { assessmentId: "syn-a", describes: { ...expectedOf(a), rubric: a.rubric }, changesSha256: a.review.changesSha256,
      content: { ...readInput().clientView.content, summary: "Rewritten.", gaps: [], statuses: { ...readInput().clientView.content.statuses, C2: { status: "not-stated" } }, strengths: [{ text: "x", evidence: [{ quote: SENTINELS.email, page: 2 }] }] }, retained: {}, reviewer: "R", confirmed: true });
    expect(r.status).toBe(422);
    expect(r.body.problems.join()).toMatch(/strength 1 quote 1: quote not found on page 2/);
    expect(leaks(JSON.stringify(r.body))).toEqual([]);
  });
  it("the run command prints labels and outcomes only, for valid and blocked inputs", () => {
    const run = () => spawnSync(process.execPath, ["scripts/scoring/run-assessments.mjs"], { env: { ...process.env, SCORING_PRIVATE_DIR: dir }, encoding: "utf8" });
    const ok = run();
    expect([ok.status, ok.stdout]).toEqual([0, expect.stringMatching(/^Candidate A: PROVISIONAL · scored 83 Strong · result [0-9a-f]{12} · run-/)]);
    const i = readInput(); i.assessment.criteria[0].evidence[1].page = 1;
    putJson("prototype/runs/inputs/syn-a.input.json", i);
    const bad = run();
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/Candidate A: BLOCKED — criterion C1 quote 2: quote not found on page 1/);
    expect(leaks(ok.stdout + ok.stderr + bad.stdout + bad.stderr)).toEqual([]);
  }, 30000);
});

describe("history checkpoint", () => {
  it("removing the newest reviewer entries (with the chain still intact) is detected through the checkpoint", async () => {
    await post("/__scoring/corrections", correction());
    await post("/__scoring/corrections", correction({ previous: { status: "rated", rating: 1 }, next: { status: "rated", rating: 2 } }));
    const f = path.join(dir, "reviews.json"), raw = JSON.parse(fs.readFileSync(f, "utf8"));
    fs.writeFileSync(f, JSON.stringify({ ...raw, corrections: raw.corrections.slice(0, 1) })); // a valid chain of one
    expect(one()).toMatchObject({ status: "blocked", problems: ["the reviewer history or provenance log has been altered, reordered or truncated"] });
  });
  it("is reset together with the reviewer history", async () => {
    await post("/__scoring/corrections", correction());
    await post("/__scoring/reset", { scope: "scoring-test-reviewer-corrections" });
    expect([fs.existsSync(path.join(dir, "reviews.checkpoint.json")), one().status]).toEqual([false, "provisional"]);
  });
});

describe("guards and reset", () => {
  it("allows only loopback, this server's Host, and same-origin writes", () => {
    expect(requestAllowed(req(), PORT)).toBe(true);
    expect(requestAllowed(req({ remote: "192.168.1.5" }), PORT)).toBe(false);
    expect(requestAllowed(req({ host: "evil.example:5999" }), PORT)).toBe(false);
    expect(requestAllowed(req({ method: "POST", origin: "http://evil.example" }), PORT)).toBe(false);
    expect(requestAllowed(req({ method: "POST" }), PORT)).toBe(false);
  });
  it("serves the portal entry with a same-origin connection policy, never private files", async () => {
    expect((await call({ url: "/" })).status).toBe("next");
    expect((await call({ url: "/__scoring/data" })).headers["content-security-policy"]).toMatch(/^connect-src 'self' ws:\/\/127\.0\.0\.1:\* ws:\/\/localhost:\*;/);
    for (const url of ["/docs/reference/x.md", "/a.pdf", "/.env.local", "/@fs/etc/passwd", "/supabase/x.sql"]) expect((await call({ url })).status, url).toBe(404);
    expect((await call({ url: "/__scoring/data", host: "attacker.test:5999" })).status).toBe(403);
  });
  it("reset archives reviewer work only; run inputs and records stay", async () => {
    await post("/__scoring/corrections", correction());
    const r = await post("/__scoring/reset", { scope: "scoring-test-reviewer-corrections" });
    expect(r.status).toBe(200);
    expect(fs.existsSync(path.join(dir, "reviews.json"))).toBe(false);
    expect([fs.existsSync(inputPath()), runRecords(dir).length, one().clientView?.revision]).toEqual([true, 1, 1]);
  });
});

/* F2: a recruiter reviews and confirms the initial prepared draft summary without changing any rating first (synthetic). */
describe("initial review of the prepared draft summary", () => {
  const initial = (over = {}, a = one()) => ({ assessmentId: "syn-a", describes: { ...expectedOf(a), rubric: a.rubric }, changesSha256: a.initialReview?.changesSha256,
    content: { ...readInput().clientView.content, summary: "Synthetic summary, edited in the initial review." }, reviewer: "Synthetic reviewer", confirmed: true, ...over });
  it("is offered for the prepared draft, with no rating change and no change list", () => {
    const a = one();
    expect(a.review).toBeNull();
    expect(a.initialReview).toEqual({ baseRevision: 1, changesSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(a.latestVersion).toBe(1);
  });
  it("confirms without a rating change: a new summary revision bound to the current assessment; ratings, scores and the original untouched", async () => {
    const before = one(), inputBefore = fs.readFileSync(inputPath()), unchanged = { ...readInput().clientView.content }; // kept wording needs no reason in an initial review
    expect((await post("/__scoring/client-view", initial({ content: unchanged }))).status).toBe(201);
    const a = one(), stored = JSON.parse(fs.readFileSync(path.join(dir, "reviews.json"), "utf8"));
    expect(stored.corrections ?? []).toEqual([]); // no rating changed
    expect(stored.clientViews).toHaveLength(1);
    expect(stored.clientViews[0]).toMatchObject({ revision: 2, preparation: { method: "reviewer-confirmed", actor: "Synthetic reviewer" }, review: { baseRevision: 1, initial: true, changes: [], retained: {}, approvedHeld: [] },
      describes: { assessmentFingerprint: before.run.assessmentFingerprint, assessmentVersion: 1, stateSha256: before.latestStateSha } });
    expect([a.clientView.revision, a.clientViews.map((v) => v.current), a.initialReview, a.review]).toEqual([2, [true, true], null, null]);
    expect([a.latestVersion, a.latestStateSha, a.run]).toEqual([before.latestVersion, before.latestStateSha, before.run]); // the same assessment state and run
    expect(a.criteria).toEqual(before.criteria);
    expect(fs.readFileSync(inputPath()).equals(inputBefore)).toBe(true); // the original AI output and run input are unchanged
  });
  it("saves an edited summary and removed strengths as the reviewer's revision", async () => {
    expect((await post("/__scoring/client-view", initial({ content: { ...readInput().clientView.content, summary: "Synthetic summary, edited in the initial review.", strengths: [] } }))).status).toBe(201);
    expect([one().clientView.summary, one().clientView.strengths]).toEqual(["Synthetic summary, edited in the initial review.", []]);
  });
  it("refuses stale confirmations: after another reviewer confirmed, after a rating correction, or with an old token", async () => {
    const opened = initial();
    expect((await post("/__scoring/client-view", initial())).status).toBe(201);
    const twice = await post("/__scoring/client-view", opened);
    expect([twice.status, twice.body.problems]).toEqual([409, ["The client summary has already been reviewed for the current assessment; there is nothing to confirm."]]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "reviews.json"), "utf8")).clientViews).toHaveLength(1);
  });
  it("refuses a confirmation opened before a rating correction", async () => {
    const opened = initial();
    expect((await post("/__scoring/corrections", correction())).status).toBe(201);
    expect((await post("/__scoring/client-view", opened)).status).toBe(409); // the state moved on
    expect((await post("/__scoring/client-view", { ...initial(), changesSha256: opened.changesSha256 })).status).toBe(409); // the old token, with a fresh state
    expect(one().clientView).toBeNull();
  });
  it("needs a name and an explicit confirmation, and validates held-strength approvals as in any review", async () => {
    expect((await post("/__scoring/client-view", initial({ confirmed: false }))).status).toBe(422);
    expect((await post("/__scoring/client-view", initial({ reviewer: " " }))).status).toBe(422);
    const kept = readInput().clientView.content.strengths[0].text;
    expect((await post("/__scoring/client-view", initial({ approvedHeld: [{ text: kept, reason: "short" }] }))).status).toBe(422);
    expect(fs.existsSync(path.join(dir, "reviews.json"))).toBe(false);
    expect((await post("/__scoring/client-view", initial({ approvedHeld: [{ text: kept, reason: "Synthetic: confirmed in the review." }] }))).status).toBe(201);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "reviews.json"), "utf8")).clientViews[0].review.approvedHeld).toEqual([{ text: kept, reason: "Synthetic: confirmed in the review." }]);
  });
});

/* W1: the recorded core screening set is loaded with its fingerprint checked (synthetic). */
describe("screening question sets", () => {
  const SET = { schema: "screening-set/1", id: "syn-screening", version: 1, rules: { id: "synthetic-rubric", version: 1 }, questions: [] };
  it("loads a recorded set, and flags one that changed since it was recorded", () => {
    expect(data().screeningSets).toEqual([]); // none recorded
    const sha = putJson("prototype/config/screening-set-v1.json", SET);
    putJson("prototype/config/screening-manifest.json", { screeningSets: [{ file: "config/screening-set-v1.json", sha256: sha }] });
    expect(data().screeningSets.map((s) => [s.id, s.version, s.loadProblems])).toEqual([["syn-screening", 1, []]]);
    putJson("prototype/config/screening-set-v1.json", { ...SET, version: 2 });
    expect(data().screeningSets[0].loadProblems).toEqual(["the question set has changed since it was recorded"]);
  });
});

/* W2: screening answers, draft ratings and corrections, end to end through the local server (invented answers; fake
   proposer routes; no AI). */
describe("screening answers and draft ratings", () => {
  const Q = (id, area, use, checks = []) => ({ id, area, use, checks, text: `Synthetic question ${id}?`, answerPoints: [`Synthetic point ${id}`], source: "Synthetic" });
  const SET = { schema: "screening-set/1", id: "syn-screening", version: 1, title: "Synthetic core set", status: "proposed", statusNote: "Synthetic.", rules: { id: "synthetic-rubric", version: 1 }, basedOn: [], scale: "1 to 5.", neverAssess: "Never rate accent.",
    questions: [Q("Q1", "Knowledge of the role", "scored"), Q("Q2", "Communication", "scored"), Q("Q3", "Ownership and results", "scored", ["C1"]), Q("Q4", "Problem solving", "scored"), Q("Q5", "Understanding of the role and why they want to move", "scored"),
      Q("Q6", "Fit with the client's working conditions", "confirms", ["G2"]), Q("Q7", "Salary, joining date and location", "confirms", ["P1"]), Q("Q8", "Ownership and results", "scored", ["C2"]), Q("Q9", "Essential requirement", "confirms", ["G1"])] };
  let setRef;
  beforeEach(() => {
    const sha = putJson("prototype/config/screening-set-v1.json", SET);
    putJson("prototype/config/screening-manifest.json", { screeningSets: [{ file: "config/screening-set-v1.json", sha256: sha }] });
    setRef = { id: SET.id, version: 1, sha256: sha };
  });
  const FU = "F1:Synthetic question?"; // syn-a's own follow-up (checks C1, so it supports Q3)
  const rev = () => screening.currentScreening(one().screeningRecord).revision;
  const save = (over = {}) => post("/__scoring/screening/answers", { assessmentId: "syn-a", expectedRevision: rev(), set: setRef, by: "Synthetic recruiter", excerpt: "",
    answers: { Q1: "I would sell in person across the territory and keep in touch with the top accounts.", Q3: "I won 12 new synthetic accounts in 2025 by prospecting.", Q9: "Yes, I hold a synthetic licence." },
    followUps: { [FU]: "Most of the 12 came from referrals at trade shows." }, ...over });
  const fake = (ratings, isAi = false) => ({ id: "fake", label: "Fake proposer (test)", isAi, run: async () => ({ ok: true, output: { ratings }, meta: {} }) });
  const propose = (ratings, over = {}, isAi = false) => call({ method: "POST", url: "/__scoring/screening/propose", origin: ORIGIN, body: { assessmentId: "syn-a", expectedRevision: rev(), ...over } }, { screeningRoute: fake(ratings, isAi) });
  const file = () => path.join(dir, "screening", "syn-a.json");

  it("saves answers with the exact question-set version, and restores them after a reload (owner-only file)", async () => {
    expect(one().screeningRecord).toBeNull();
    expect((await save()).status).toBe(201);
    const s = screening.currentScreening(one().screeningRecord); // a fresh load, as after a page refresh
    expect([s.revision, s.answers.set, s.answers.answers.Q3, s.answers.followUps[FU].answer, s.answers.by]).toEqual([1, setRef, "I won 12 new synthetic accounts in 2025 by prospecting.", "Most of the 12 came from referrals at trade shows.", "Synthetic recruiter"]);
    expect(s.answers.answers.Q2).toBeUndefined(); // not answered: no entry, never zero
    expect([fs.statSync(file()).mode & 0o777, fs.statSync(path.dirname(file())).mode & 0o777]).toEqual([0o600, 0o700]);
  });
  it("refuses a stale save, another question set, unknown questions and a missing name; nothing is written", async () => {
    await save();
    const stale = await post("/__scoring/screening/answers", { assessmentId: "syn-a", expectedRevision: 0, set: setRef, by: "B", answers: { Q1: "Later." }, followUps: {}, excerpt: "" });
    expect([stale.status, stale.body.problems[0]]).toEqual([409, "The screening record has changed since this page was opened. Refresh and try again; nothing was saved."]);
    expect((await save({ set: { ...setRef, version: 2 } })).status).toBe(409);
    expect((await save({ answers: { Q99: "x" } })).status).toBe(422);
    expect((await save({ followUps: { "F9:Not a follow-up": "x" } })).status).toBe(422);
    expect((await save({ by: " " })).status).toBe(422);
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).entries).toHaveLength(1);
  });
  it("keeps valid draft ratings with a word-for-word quote; drops invalid quotes, unanswered, confirmation-only, out-of-range and follow-up ratings", async () => {
    await save();
    const r = await propose([
      { questionId: "Q3", rating: 4, quote: "Most of the 12 came from referrals", reason: "Counts new accounts with a period and says how they were found." }, // quote from the linked follow-up
      { questionId: "Q1", rating: 3, quote: "I would sell to every client in Montana", reason: "Covers field selling." }, // not in the answer
      { questionId: "Q2", rating: 3, quote: "anything", reason: "x" }, // not answered
      { questionId: "Q9", rating: 5, quote: "Yes, I hold a synthetic licence.", reason: "Confirms the licence." }, // confirmation only
      { questionId: "Q8", rating: 7, quote: "x", reason: "x" }, // not answered, and out of range
      { questionId: "F1", rating: 4, quote: "Most of the 12", reason: "Follow-up." }, // follow-ups are never rated on their own
    ]);
    expect(r.status).toBe(201);
    const s = screening.currentScreening(one().screeningRecord);
    expect(Object.keys(s.proposal.ratings)).toEqual(["Q3"]);
    expect(s.ratingOf("Q3")).toMatchObject({ rating: 4, by: "proposal", quote: "Most of the 12 came from referrals" });
    expect(s.proposal.dropped.map((d) => [d.questionId, d.problem])).toEqual([["Q1", "the quote is not word for word in the answer given"], ["Q2", "not answered, so it cannot be rated"],
      ["Q9", "this question only confirms a requirement and is never rated"], ["Q8", "not answered, so it cannot be rated"], ["F1", "no such core question"]]);
    for (const q of ["Q1", "Q2", "Q8", "Q9"]) expect(s.ratingOf(q).rating).toBeNull(); // Not rated / Not answered, never zero
  });
  it("needs saved answers first, and an explicit cost confirmation for an AI route", async () => {
    expect((await propose([])).status).toBe(409);
    await save();
    const r = await propose([{ questionId: "Q3", rating: 4, quote: "I won 12 new synthetic accounts", reason: "Counted." }], {}, true);
    expect([r.status, r.body.needsConfirm]).toEqual([409, true]);
    expect(one().screeningRecord.entries).toHaveLength(1); // nothing was sent or saved
    expect((await propose([{ questionId: "Q3", rating: 4, quote: "I won 12 new synthetic accounts", reason: "Counted." }], { confirmCost: true }, true)).status).toBe(201);
  });
  it("lets a recruiter correct a rating with a reason and a valid quote, keeping every earlier version", async () => {
    await save();
    await propose([{ questionId: "Q3", rating: 4, quote: "I won 12 new synthetic accounts in 2025", reason: "Counted, with a period." }]);
    const fix = (over = {}) => post("/__scoring/screening/correct", { assessmentId: "syn-a", expectedRevision: rev(), questionId: "Q3", rating: 3, quote: "by prospecting", reason: "Only one way of finding customers is described.", reviewer: "Synthetic recruiter", ...over });
    expect((await fix({ reason: "short" })).status).toBe(422);
    expect((await fix({ quote: "not in the answer" })).status).toBe(422);
    expect((await fix({ questionId: "Q9" })).status).toBe(422); // confirmation-only
    expect((await fix({ questionId: "Q2" })).status).toBe(422); // not answered
    expect((await fix()).status).toBe(201);
    expect((await fix({ rating: null, quote: "", reason: "Not enough detail to rate yet." })).status).toBe(201);
    const s = screening.currentScreening(one().screeningRecord);
    expect(s.ratingOf("Q3")).toMatchObject({ rating: null, by: "recruiter" });
    expect(s.history.map((e) => [e.kind, e.kind === "correction" ? [e.from, e.to] : e.kind === "proposal" ? e.ratings.Q3?.rating : null])).toEqual([["answers", null], ["proposal", 4], ["correction", [4, 3]], ["correction", [3, null]]]);
    const stale = await post("/__scoring/screening/correct", { assessmentId: "syn-a", expectedRevision: 1, questionId: "Q3", rating: 5, quote: "by prospecting", reason: "A stale correction from an old page.", reviewer: "R" });
    expect(stale.status).toBe(409);
  });
  it("new answers start a fresh draft: earlier ratings stay in history but are not applied to the new answers", async () => {
    await save();
    await propose([{ questionId: "Q3", rating: 4, quote: "I won 12 new synthetic accounts in 2025", reason: "Counted." }]);
    expect((await save({ answers: { Q3: "I won 3 new synthetic accounts." } })).status).toBe(201);
    const s = screening.currentScreening(one().screeningRecord);
    expect([s.ratingOf("Q3").rating, s.history.length]).toEqual([null, 3]);
  });
  it("changes no CV rating, score, run input or client view", async () => {
    const before = { input: fs.readFileSync(inputPath()), a: one() };
    await save(); await propose([{ questionId: "Q3", rating: 4, quote: "I won 12 new synthetic accounts in 2025", reason: "Counted." }]);
    const after = one();
    expect(fs.readFileSync(inputPath()).equals(before.input)).toBe(true);
    expect([after.criteria, after.gates, after.run, after.latestVersion, after.clientView]).toEqual([before.a.criteria, before.a.gates, before.a.run, before.a.latestVersion, before.a.clientView]);
  });
});

/* W2 fix 1: a general call excerpt is an answer only to the questions the recruiter explicitly links it to. */
describe("screening: the call excerpt answers only the questions it is linked to", () => {
  const Q = (id, area, use, checks = []) => ({ id, area, use, checks, text: `Synthetic question ${id}?`, answerPoints: [`Synthetic point ${id}`], source: "Synthetic" });
  const SET = { schema: "screening-set/1", id: "syn-screening", version: 1, title: "Synthetic core set", status: "proposed", statusNote: "Synthetic.", rules: { id: "synthetic-rubric", version: 1 }, basedOn: [], scale: "1 to 5.", neverAssess: "Never rate accent.",
    questions: [Q("Q1", "Knowledge of the role", "scored"), Q("Q2", "Communication", "scored"), Q("Q3", "Ownership and results", "scored", ["C1"]), Q("Q4", "Problem solving", "scored"), Q("Q5", "Understanding of the role and why they want to move", "scored"),
      Q("Q6", "Fit with the client's working conditions", "confirms", ["G2"]), Q("Q7", "Salary, joining date and location", "confirms", ["P1"]), Q("Q8", "Ownership and results", "scored", ["C2"]), Q("Q9", "Essential requirement", "confirms", ["G1"])] };
  let setRef;
  beforeEach(() => { const sha = putJson("prototype/config/screening-set-v1.json", SET); putJson("prototype/config/screening-manifest.json", { screeningSets: [{ file: "config/screening-set-v1.json", sha256: sha }] }); setRef = { id: SET.id, version: 1, sha256: sha }; });
  const rev = () => screening.currentScreening(one().screeningRecord).revision;
  const NOON = "The call will start at noon tomorrow.";
  const save = (over = {}) => post("/__scoring/screening/answers", { assessmentId: "syn-a", expectedRevision: rev(), set: setRef, by: "Synthetic recruiter", answers: { Q3: "I won 12 new synthetic accounts in 2025." }, followUps: {}, excerpt: NOON, excerptFor: [], ...over });
  const fake = (ratings) => ({ id: "fake", label: "Fake proposer (test)", isAi: false, run: async (prompt) => { fake.sent = prompt.user; return { ok: true, output: { ratings }, meta: {} }; } });
  const propose = (ratings) => call({ method: "POST", url: "/__scoring/screening/propose", origin: ORIGIN, body: { assessmentId: "syn-a", expectedRevision: rev() } }, { screeningRoute: fake(ratings) });
  const correct = (over = {}) => post("/__scoring/screening/correct", { assessmentId: "syn-a", expectedRevision: rev(), questionId: "Q2", rating: 3, quote: "start at noon tomorrow", reason: "Uses the general call excerpt.", reviewer: "R", ...over });

  it("'The call will start at noon tomorrow' cannot support ratings for unanswered sales questions", async () => {
    expect((await save()).status).toBe(201);
    await propose(["Q1", "Q2", "Q4", "Q5", "Q8"].map((q) => ({ questionId: q, rating: 3, quote: "start at noon tomorrow", reason: "Uses the general call excerpt." })));
    const s = screening.currentScreening(one().screeningRecord);
    expect(Object.keys(s.proposal.ratings)).toEqual([]);
    expect(s.proposal.dropped.map((d) => [d.questionId, d.problem])).toEqual(["Q1", "Q2", "Q4", "Q5", "Q8"].map((q) => [q, "not answered, so it cannot be rated"]));
    expect(fake.sent).not.toContain("noon"); // an unlinked excerpt is not sent as an answer to any question
    const r = await correct();
    expect([r.status, r.body.problems[0]]).toEqual([422, "This question has no answer, so it cannot be rated."]);
    expect(screening.answerSources("Q2", s.answers, [])).toEqual([]);
  });
  it("an excerpt explicitly linked to a question is an answer to that question only", async () => {
    const excerpt = "Candidate: I always answer the question first and then give the numbers.";
    expect((await save({ excerpt, excerptFor: ["Q2"] })).status).toBe(201);
    await propose([{ questionId: "Q2", rating: 4, quote: "I always answer the question first", reason: "Answers directly, then gives numbers." }, { questionId: "Q4", rating: 3, quote: "I always answer the question first", reason: "x" }]);
    const s = screening.currentScreening(one().screeningRecord);
    expect([Object.keys(s.proposal.ratings), s.proposal.dropped.map((d) => d.questionId)]).toEqual([["Q2"], ["Q4"]]);
    expect(fake.sent).toContain("I always answer the question first"); // sent only with Q2
    expect((await correct({ questionId: "Q4", quote: "I always answer the question first" })).status).toBe(422);
  });
  it("refuses excerpt links to unknown questions, and keeps the links with the saved answers", async () => {
    expect((await save({ excerptFor: ["Q99"] })).status).toBe(422);
    expect((await save({ excerptFor: ["Q2", "Q9"] })).status).toBe(201);
    expect(screening.currentScreening(one().screeningRecord).answers.excerptFor).toEqual(["Q2", "Q9"]);
  });
  it("an older record with no excerpt links never treats its excerpt as an answer", () => {
    const old = { answers: {}, followUps: {}, excerpt: NOON };
    expect(screening.answerSources("Q1", old, [])).toEqual([]);
  });
});

/* W3: the screening-call summary, end to end through the local server (invented answers; fake summariser; no AI). */
describe("screening call summary", () => {
  const Q = (id, area, use, checks = []) => ({ id, area, use, checks, text: `Synthetic question ${id}?`, answerPoints: [`Synthetic point ${id}`], source: "Synthetic" });
  const SET = { schema: "screening-set/1", id: "syn-screening", version: 1, title: "Synthetic core set", status: "proposed", statusNote: "Synthetic.", rules: { id: "synthetic-rubric", version: 1 }, basedOn: [], scale: "1 to 5.", neverAssess: "Never rate accent.",
    questions: [Q("Q1", "Knowledge of the role", "scored"), Q("Q2", "Communication", "scored"), Q("Q3", "Ownership and results", "scored", ["C1"]), Q("Q4", "Problem solving", "scored"), Q("Q5", "Understanding of the role and why they want to move", "scored"),
      Q("Q6", "Fit with the client's working conditions", "confirms", ["G2"]), Q("Q7", "Salary, joining date and location", "confirms", ["P1"]), Q("Q8", "Ownership and results", "scored", ["C2"]), Q("Q9", "Essential requirement", "confirms", ["G1"])] };
  let setRef;
  beforeEach(() => { const sha = putJson("prototype/config/screening-set-v1.json", SET); putJson("prototype/config/screening-manifest.json", { screeningSets: [{ file: "config/screening-set-v1.json", sha256: sha }] }); setRef = { id: SET.id, version: 1, sha256: sha }; });
  const rev = () => screening.currentScreening(one().screeningRecord).revision;
  const ANSWERS = { Q1: "I visit customers across the territory every week and keep the top accounts close.", Q3: "I won 12 new synthetic accounts in 2025, mostly from referrals.", Q9: "Yes, I hold the synthetic licence." };
  const save = (answers = ANSWERS) => post("/__scoring/screening/answers", { assessmentId: "syn-a", expectedRevision: rev(), set: setRef, by: "Synthetic recruiter", answers, followUps: {}, excerpt: "", excerptFor: [] });
  const GOOD = { strengths: [{ text: "Counts new accounts with a period.", quote: "I won 12 new synthetic accounts in 2025", questionId: "Q3" }],
    concerns: [{ text: "Little detail on how the top accounts are kept close.", quote: "keep the top accounts close", questionId: "Q1" }],
    communication: { text: "Answered the questions asked and gave a counted result.", quote: "mostly from referrals", questionId: "Q3" },
    summary: ["Synthetic candidate with field sales experience.", "Strong on winning new accounts, with a count and a year.", "Account-care answers are brief.", "Check problem solving, which was not asked yet."] };
  const fake = (output, isAi = false) => ({ id: "fake", label: "Fake summariser (test)", isAi, run: async () => ({ ok: true, output, meta: {} }) });
  const summarise = (output, over = {}, isAi = false) => call({ method: "POST", url: "/__scoring/screening/summarise", origin: ORIGIN, body: { assessmentId: "syn-a", expectedRevision: rev(), ...over } }, { screeningRoute: fake(output, isAi) });
  const review = (content, over = {}) => post("/__scoring/screening/summary", { assessmentId: "syn-a", expectedRevision: rev(), content, reviewer: "Synthetic recruiter", confirmed: true, basedOnRevision: null, ...over });
  const now = () => { const rec = one().screeningRecord, set = { ...SET, sha256: setRef.sha256 }; return screening.currentSummary(rec, set); };

  it("needs saved answers with at least one answer: missing evidence gives no summary", async () => {
    expect((await summarise(GOOD)).status).toBe(409);
    expect((await save({})).status).toBe(201);
    const r = await summarise(GOOD);
    expect([r.status, r.body.problems[0]]).toEqual([409, "No question has an answer yet, so there is nothing to summarise."]);
  });
  it("keeps a valid draft, labelled as a draft and bound to the answers and ratings it describes", async () => {
    await save();
    expect((await summarise(GOOD)).status).toBe(201);
    const s = now();
    expect([s.latest.kind, s.latest.route, s.latest.content, s.latest.dropped, s.outOfDate]).toEqual(["summaryDraft", "Fake summariser (test)", GOOD, [], false]);
  });
  it("drops invalid quotes, quotes from unanswered questions, personal characteristics and a summary of the wrong length", async () => {
    await save();
    await summarise({ strengths: [GOOD.strengths[0], { text: "Great at margins.", quote: "I raised margins by 5 points", questionId: "Q8" }, { text: "Solves problems.", quote: "I won 12", questionId: "Q4" }, { text: "Very confident speaker.", quote: "I won 12", questionId: "Q3" }],
      concerns: [{ text: "Invented concern.", quote: "I never call customers", questionId: "Q1" }, { text: "No problem-solving example was given." }],
      communication: { text: "Spoke with a strong accent but answered well." }, summary: ["One line only."] });
    const s = now();
    expect(s.latest.content.strengths).toEqual([GOOD.strengths[0]]);
    expect(s.latest.content.concerns).toEqual([{ text: "No problem-solving example was given." }]);
    expect([s.latest.content.communication.text, s.latest.content.summary]).toEqual(["", []]);
    expect(s.latest.dropped).toEqual(["strength 2: Q8 was not answered, so nothing can be quoted from it", "strength 3: Q4 was not answered, so nothing can be quoted from it",
      "strength 4 describes a personal characteristic, which is never assessed", "concern 1: the quote is not word for word in the answer to Q1",
      "the communication note describes a personal characteristic, which is never assessed", "the summary must be four or five short lines"]);
  });
  it("lists unanswered questions from the answers themselves, not from the summariser, and never as failures", async () => {
    await save();
    const rec = one().screeningRecord, st = screening.currentScreening(rec);
    expect(screening.unansweredQuestions({ ...SET }, st.answers, []).map((q) => q.id)).toEqual(["Q2", "Q4", "Q5", "Q6", "Q7", "Q8"]);
  });
  it("needs a cost confirmation for an AI route before anything is sent", async () => {
    await save();
    const r = await summarise(GOOD, {}, true);
    expect([r.status, r.body.needsConfirm]).toEqual([409, true]);
    expect(now().latest).toBeNull();
    expect((await summarise(GOOD, { confirmCost: true }, true)).status).toBe(201);
  });
  it("a recruiter edits and confirms it as a new version (refused if anything is invalid); earlier versions are kept", async () => {
    await save(); await summarise(GOOD);
    expect((await review({ ...GOOD, strengths: [{ text: "Edited.", quote: "not in any answer", questionId: "Q3" }] })).status).toBe(422);
    expect((await review({ ...GOOD, communication: { text: "Seemed nervous." } })).status).toBe(422);
    expect((await review(GOOD, { confirmed: false })).status).toBe(422);
    expect((await review(GOOD, { reviewer: " " })).status).toBe(422);
    const edited = { ...GOOD, summary: [...GOOD.summary, "Next: ask about account care in more detail."] };
    expect((await review(edited)).status).toBe(201);
    const s = now();
    expect([s.latest.kind, s.latest.reviewer, s.latest.content.summary.length, s.versions.map((x) => x.kind), s.outOfDate]).toEqual(["summaryReview", "Synthetic recruiter", 5, ["summaryDraft", "summaryReview"], false]);
  });
  it("refuses a stale confirmation", async () => {
    await save(); await summarise(GOOD);
    const old = rev();
    await post("/__scoring/screening/correct", { assessmentId: "syn-a", expectedRevision: old, questionId: "Q3", rating: 4, quote: "I won 12 new synthetic accounts", reason: "Counted, with a year.", reviewer: "R" });
    const r = await review(GOOD, { expectedRevision: old });
    expect(r.status).toBe(409);
  });
  it("is out of date when a rating changes, or the answers change, until it is reviewed again", async () => {
    await save(); await summarise(GOOD);
    expect(now().outOfDate).toBe(false);
    await post("/__scoring/screening/correct", { assessmentId: "syn-a", expectedRevision: rev(), questionId: "Q3", rating: 4, quote: "I won 12 new synthetic accounts", reason: "Counted, with a year.", reviewer: "R" });
    expect(now().outOfDate).toBe(true); // a rating changed
    expect((await review(GOOD)).status).toBe(201);
    expect(now().outOfDate).toBe(false); // reviewed again
    await save({ ...ANSWERS, Q4: "I fixed a late delivery the same day." });
    expect(now().outOfDate).toBe(true); // the answers changed
  });
  it("changes no CV rating, run input or client view", async () => {
    const before = { input: fs.readFileSync(inputPath()), a: one() };
    await save(); await summarise(GOOD); await review(GOOD);
    const after = one();
    expect(fs.readFileSync(inputPath()).equals(before.input)).toBe(true);
    expect([after.criteria, after.gates, after.run, after.clientView]).toEqual([before.a.criteria, before.a.gates, before.a.run, before.a.clientView]);
  });
});

/* W3 fixes: standalone follow-up answers reach the summariser and can be quoted exactly; unanswered counts come only from
   the saved answers (synthetic answers; fake summariser; no AI). */
describe("screening call summary: follow-ups and counts", () => {
  const Q = (id, area, use, checks = []) => ({ id, area, use, checks, text: `Synthetic question ${id}?`, answerPoints: [`Synthetic point ${id}`], source: "Synthetic" });
  const SET = { schema: "screening-set/1", id: "syn-screening", version: 1, title: "Synthetic core set", status: "proposed", statusNote: "Synthetic.", rules: { id: "synthetic-rubric", version: 1 }, basedOn: [], scale: "1 to 5.", neverAssess: "Never rate accent.",
    questions: [Q("Q1", "Knowledge of the role", "scored"), Q("Q2", "Communication", "scored"), Q("Q3", "Ownership and results", "scored", ["C1"]), Q("Q4", "Problem solving", "scored"), Q("Q5", "Understanding of the role and why they want to move", "scored"),
      Q("Q6", "Fit with the client's working conditions", "confirms", ["G2"]), Q("Q7", "Salary, joining date and location", "confirms", ["P1"]), Q("Q8", "Ownership and results", "scored", ["C2"]), Q("Q9", "Essential requirement", "confirms", ["G1"])] };
  /* syn-a's follow-ups: F1 checks C1 (linked to Q3); F2 is a standalone consignment question checking I1 (no core question covers it). */
  const F1 = "F1:Synthetic question?", F2 = "F2:Have you managed synthetic consignment stock at customer sites?";
  let setRef;
  beforeEach(() => {
    const i = readInput(); i.assessment.questions.push({ q: "Have you managed synthetic consignment stock at customer sites?", for: "I1" }); putJson("prototype/runs/inputs/syn-a.input.json", i); recordRun();
    const sha = putJson("prototype/config/screening-set-v1.json", SET); putJson("prototype/config/screening-manifest.json", { screeningSets: [{ file: "config/screening-set-v1.json", sha256: sha }] }); setRef = { id: SET.id, version: 1, sha256: sha };
  });
  const rev = () => screening.currentScreening(one().screeningRecord).revision;
  const save = () => post("/__scoring/screening/answers", { assessmentId: "syn-a", expectedRevision: rev(), set: setRef, by: "Synthetic recruiter", excerpt: "", excerptFor: [],
    answers: { Q1: "I visit customers across the territory every week.", Q3: "I won 12 new synthetic accounts in 2025.", Q9: "Yes, I hold the synthetic licence." },
    followUps: { [F1]: "Most of the 12 came from referrals.", [F2]: "I refilled consignment stock at eight synthetic depots every fortnight." } });
  const LINES = ["Synthetic field seller.", "Wins counted new accounts.", "Runs a regular consignment routine.", "Next: ask about margins."];
  const base = (over = {}) => ({ strengths: [{ text: "Runs a regular consignment routine.", quote: "refilled consignment stock at eight synthetic depots every fortnight", followUp: F2 }], concerns: [], communication: { text: "Answered the questions asked and gave counted results." }, summary: LINES, ...over });
  const fake = (output) => ({ id: "fake", label: "Fake summariser (test)", isAi: false, run: async (prompt) => { fake.sent = prompt.user; return { ok: true, output, meta: {} }; } });
  const summarise = (output) => call({ method: "POST", url: "/__scoring/screening/summarise", origin: ORIGIN, body: { assessmentId: "syn-a", expectedRevision: rev() } }, { screeningRoute: fake(output) });
  const review = (content) => post("/__scoring/screening/summary", { assessmentId: "syn-a", expectedRevision: rev(), content, reviewer: "Synthetic recruiter", confirmed: true, basedOnRevision: null });
  const latest = () => screening.currentSummary(one().screeningRecord, { ...SET, sha256: setRef.sha256 }).latest;

  it("sends every saved follow-up answer, including a standalone one, with a stable reference", async () => {
    await save(); await summarise(base());
    const sent = JSON.parse(fake.sent);
    expect(sent.followUps.map((f) => [f.followUp, f.answer, f.addsDetailTo])).toEqual([[F1, "Most of the 12 came from referrals.", ["Q3"]], [F2, "I refilled consignment stock at eight synthetic depots every fortnight.", []]]);
  });
  it("keeps a strength quoting the answered standalone consignment follow-up, cited by its reference", async () => {
    await save(); await summarise(base());
    expect([latest().content.strengths, latest().dropped]).toEqual([[{ text: "Runs a regular consignment routine.", quote: "refilled consignment stock at eight synthetic depots every fortnight", followUp: F2 }], []]);
  });
  it("checks a follow-up quote against that follow-up's own answer only", async () => {
    await save();
    await summarise(base({ strengths: [
      { text: "Wrong follow-up.", quote: "Most of the 12 came from referrals", followUp: F2 }, // F1's answer, cited as F2
      { text: "Core answer cited as a follow-up.", quote: "I won 12 new synthetic accounts", followUp: F2 },
      { text: "Unknown follow-up.", quote: "refilled consignment stock", followUp: "F9:Not a follow-up" },
      { text: "Valid.", quote: "Most of the 12 came from referrals", followUp: F1 }] }));
    expect(latest().content.strengths.map((s) => s.text)).toEqual(["Valid."]);
    expect(latest().dropped).toEqual(["strength 1: the quote is not word for word in the answer to follow-up 2", "strength 2: the quote is not word for word in the answer to follow-up 2", "strength 3 must name a core question or one of this candidate's follow-ups"]);
  });
  it("removes generated count claims from drafts, and shows totals from the saved answers instead", async () => {
    await save();
    await summarise(base({ summary: [...LINES.slice(0, 3), "Three scored questions were not answered yet.", "Next: ask about margins."], communication: { text: "Answered all nine questions clearly." } }));
    const l = latest();
    expect(l.content.summary).toEqual([...LINES.slice(0, 3), "Next: ask about margins."]);
    expect(l.content.communication.text).toBe("");
    expect(l.dropped).toEqual(["the communication note states a count of answered or unanswered questions; counts are shown from the saved answers", "summary line 4 states a count of answered or unanswered questions; counts are shown from the saved answers"]);
    expect(l.output.summary[3]).toBe("Three scored questions were not answered yet."); // the original output is kept
    const st = screening.currentScreening(one().screeningRecord);
    expect(screening.answerTotals({ ...SET }, st.answers, screening.followUpsFor(one(), { ...SET }))).toEqual({ scored: { answered: 2, total: 6 }, confirms: { answered: 1, total: 3 } });
  });
  it("refuses a recruiter confirmation whose count contradicts the saved answers, and accepts an accurate one", async () => {
    await save(); await summarise(base());
    const r = await review(base({ summary: [...LINES.slice(0, 3), "Three scored questions were not answered yet.", "Next: ask about margins."] }));
    expect([r.status, r.body.problems]).toEqual([422, ["summary line 4 says 3 scored questions were not answered, but the saved answers show 4"]]);
    expect((await review(base({ summary: [...LINES.slice(0, 3), "All questions were answered.", "Next: ask about margins."] }))).status).toBe(422);
    expect((await review(base({ summary: [...LINES.slice(0, 3), "Four scored questions were not answered yet.", "Next: ask about margins."] }))).status).toBe(201);
    expect(screening.currentSummary(one().screeningRecord, { ...SET, sha256: setRef.sha256 }).versions.map((v) => v.kind)).toEqual(["summaryDraft", "summaryReview"]); // earlier versions kept
  });
});

/* W4: CV claims against the saved screening evidence, end to end through the local server (invented evidence; fake
   proposer; no AI). The synthetic CV assessment: C2 rated 2 ("Synthetic quote alpha", page 1); G1 not confirmed; I1 not confirmed. */
describe("CV claims against the screening evidence", () => {
  const Q = (id, area, use, checks = []) => ({ id, area, use, checks, text: `Synthetic question ${id}?`, answerPoints: [`Synthetic point ${id}`], source: "Synthetic" });
  const SET = { schema: "screening-set/1", id: "syn-screening", version: 1, title: "Synthetic core set", status: "proposed", statusNote: "Synthetic.", rules: { id: "synthetic-rubric", version: 1 }, basedOn: [], scale: "1 to 5.", neverAssess: "Never rate accent.",
    questions: [Q("Q1", "Knowledge of the role", "scored"), Q("Q2", "Communication", "scored"), Q("Q3", "Ownership and results", "scored", ["C1"]), Q("Q4", "Problem solving", "scored"), Q("Q5", "Understanding of the role and why they want to move", "scored"),
      Q("Q6", "Fit with the client's working conditions", "confirms", ["G2"]), Q("Q7", "Salary, joining date and location", "confirms", ["P1"]), Q("Q8", "Ownership and results", "scored", ["C2"]), Q("Q9", "Essential requirement", "confirms", ["G1"])] };
  let setRef;
  beforeEach(() => { const sha = putJson("prototype/config/screening-set-v1.json", SET); putJson("prototype/config/screening-manifest.json", { screeningSets: [{ file: "config/screening-set-v1.json", sha256: sha }] }); setRef = { id: SET.id, version: 1, sha256: sha }; });
  const rev = () => screening.currentScreening(one().screeningRecord).revision;
  const ANSWERS = { Q8: "I never set prices; head office handled all margins. I raised margins by 4 points once.", Q9: "I hold the synthetic licence, but it is being renewed.", Q1: "I mostly sell by phone from the office." };
  const save = (answers = ANSWERS) => post("/__scoring/screening/answers", { assessmentId: "syn-a", expectedRevision: rev(), set: setRef, by: "Synthetic recruiter", answers, followUps: {}, excerpt: "", excerptFor: [] });
  /* A supported downward correction: the call says pricing was handled elsewhere, so the CV's margin rating is lowered. */
  const SUPPORTED = { requirementId: "C2", type: "correction", next: { status: "rated", rating: 1 }, cvQuote: "Synthetic quote alpha", callQuote: "head office handled all margins", questionId: "Q8", explanation: "The call says head office handled margins, so the CV overstates the candidate's own margin work." };
  /* Upward: the call would raise the CV rating (C2 2 to 3) or score an unconfirmed skill (I1). Never allowed. */
  const UPWARD = { ...SUPPORTED, next: { status: "rated", rating: 3 }, callQuote: "I raised margins by 4 points once", explanation: "The call gives a margin result with a number." };
  const CONFLICT_GATE = { requirementId: "G1", type: "conflict", callQuote: "but it is being renewed", questionId: "Q9", explanation: "Holds the licence but it is being renewed: whether it is valid now is unclear." };
  const CONFLICT_SKILL = { requirementId: "I1", type: "conflict", callQuote: "I mostly sell by phone", questionId: "Q1", explanation: "Selling mostly by phone is unclear for regular reporting in person." };
  const fake = (claims) => ({ id: "fake", label: "Fake CV checker (test)", isAi: false, run: async () => ({ ok: true, output: { claims }, meta: {} }) });
  const check = (claims) => call({ method: "POST", url: "/__scoring/screening/claims", origin: ORIGIN, body: { assessmentId: "syn-a", expectedRevision: rev() } }, { screeningRoute: fake(claims) });
  const latest = () => screening.currentClaims(one().screeningRecord);
  const decide = (itemId, decision = "accepted", over = {}) => post("/__scoring/screening/claim-decision", { assessmentId: "syn-a", expectedRevision: rev(), claimReviewRevision: latest().review.revision, itemId, decision, reason: "Checked against the call notes.", reviewer: "Synthetic recruiter", ...over });

  it("a supported downward correction: proposed only, then accepted as a new CV version (source 'screening call'); the client summary goes out of date", async () => {
    await save(); await check([SUPPORTED, CONFLICT_GATE]);
    const before = one(), input = fs.readFileSync(inputPath());
    expect(latest().review.items.map((c) => [c.id, c.requirementId, c.proposal.type, c.cvQuote, c.cvPage])).toEqual([["C1", "C2", "correction", "Synthetic quote alpha", 1], ["C2", "G1", "conflict", null, null]]);
    expect([before.latestVersion, before.corrections.length]).toEqual([1, 0]); // nothing changed by the proposal
    const r = await decide("C1");
    expect([r.status, r.body.correctionVersion]).toEqual([201, 2]);
    const a = one();
    expect(a.latestVersion).toBe(2);
    expect(a.corrections[0]).toMatchObject({ criterionId: "C2", previous: { status: "rated", rating: 2 }, next: { status: "rated", rating: 1 }, source: "screening call", reviewer: "Synthetic recruiter",
      evidence: 'Screening call (Q8): "head office handled all margins". CV: "Synthetic quote alpha" (page 1).' });
    expect(a.clientView).toBeNull(); // the existing safeguard: the client summary is out of date until reviewed
    expect(fs.readFileSync(inputPath()).equals(input)).toBe(true); // the original AI output and ratings are kept
    expect(latest().review.output.claims[0]).toEqual(SUPPORTED); // the proposer's own output is kept
  });
  it("refuses duplicate acceptance: one correction only", async () => {
    await save(); await check([SUPPORTED]);
    expect((await decide("C1")).status).toBe(201);
    const again = await decide("C1");
    expect([again.status, again.body.problems[0]]).toEqual([409, "This proposal has already been decided; it cannot be accepted or dismissed twice."]);
    expect(one().corrections).toHaveLength(1);
  });
  it("missing answers: an unanswered question is not evidence, and with no answers there is nothing to check", async () => {
    expect((await save({})).status).toBe(201);
    expect((await check([SUPPORTED])).status).toBe(409);
    await save();
    await check([{ ...SUPPORTED, questionId: "Q4", callQuote: "anything" }]); // Q4 was not answered
    expect([latest().review.items, latest().review.dropped]).toEqual([[], ["proposal 1: the question it cites was not answered, so it is not evidence"]]);
  });
  it("unresolved conflicts propose no rating: a skill conflict can be recorded as conflicting, an essential requirement only dismissed", async () => {
    await save(); await check([CONFLICT_GATE, CONFLICT_SKILL]);
    const g = await decide("C1");
    expect([g.status, g.body.problems[0]]).toEqual([422, "An essential requirement has no conflict state under the rules. Dismiss this proposal, or record a correction yourself."]);
    expect((await decide("C1", "dismissed", { reason: "The candidate will show the renewed licence." })).status).toBe(201);
    expect((await decide("C2")).status).toBe(201);
    expect(one().corrections.map((c) => [c.criterionId, c.next])).toEqual([["I1", { status: "disputed" }]]);
    expect(latest().decisions.map((d) => [d.itemId, d.decision, d.correctionVersion])).toEqual([["C1", "dismissed", null], ["C2", "accepted", 2]]);
  });
  it("drops invalid quotes and invalid values: a call quote not in the answer, a CV quote not recorded, a value the rules do not allow, or no change", async () => {
    await save();
    await check([{ ...SUPPORTED, callQuote: "raised margins by 9 points" }, { ...SUPPORTED, cvQuote: "An invented CV line" }, { ...SUPPORTED, next: { status: "rated", rating: 7 } },
      { ...SUPPORTED, next: { status: "rated", rating: 2 } }, { ...SUPPORTED, requirementId: "X9" }, { ...SUPPORTED, explanation: "Sounded confident on the phone." }]);
    expect(latest().review.items).toEqual([]);
    expect(latest().review.dropped).toEqual(["proposal 1: the call quote is not word for word in the answer it cites", "proposal 2: the CV quote is not one of this requirement's recorded quotes",
      "proposal 3: the proposed value is not valid for this requirement under the rules", "proposal 4: the proposed value is the same as the CV assessment's",
      "proposal 5 does not name a requirement in these rules", "proposal 6 describes a personal characteristic, which is never assessed"]);
  });
  it("refuses stale decisions: a replaced check, changed answers, a CV changed meanwhile, or an old page", async () => {
    await save(); await check([SUPPORTED]);
    const first = latest().review.revision;
    await check([SUPPORTED]); // a newer check replaces it
    expect((await decide("C1", "accepted", { claimReviewRevision: first })).status).toBe(409);
    await save({ ...ANSWERS, Q2: "A later answer." });
    expect((await decide("C1")).status).toBe(409); // the answers changed
    await check([SUPPORTED]);
    await post("/__scoring/corrections", correction()); // the CV assessment changes for C2 meanwhile
    const r = await decide("C1");
    expect([r.status, r.body.problems[0]]).toEqual([409, "The CV assessment has changed for this requirement since the proposal was made. Prepare a new CV check."]);
    expect((await decide("C1", "dismissed", { expectedRevision: 0 })).status).toBe(409); // an old page
  });
  it("needs a reason and a name for every decision, and a cost confirmation for an AI route", async () => {
    await save(); await check([SUPPORTED]);
    expect((await decide("C1", "accepted", { reason: "short" })).status).toBe(422);
    expect((await decide("C1", "accepted", { reviewer: " " })).status).toBe(422);
    const ai = await call({ method: "POST", url: "/__scoring/screening/claims", origin: ORIGIN, body: { assessmentId: "syn-a", expectedRevision: rev() } }, { screeningRoute: { ...fake([SUPPORTED]), isAi: true } });
    expect([ai.status, ai.body.needsConfirm]).toEqual([409, true]);
    expect(one().corrections).toHaveLength(0);
  });
});

/* W4 fixes: call evidence never raises the CV-only score; an omitted CV quote is not absent evidence (synthetic). */
describe("CV claims: no upward changes from the call; CV quotes required where the CV has evidence", () => {
  const Q = (id, area, use, checks = []) => ({ id, area, use, checks, text: `Synthetic question ${id}?`, answerPoints: [`Synthetic point ${id}`], source: "Synthetic" });
  const SET = { schema: "screening-set/1", id: "syn-screening", version: 1, title: "Synthetic core set", status: "proposed", statusNote: "Synthetic.", rules: { id: "synthetic-rubric", version: 1 }, basedOn: [], scale: "1 to 5.", neverAssess: "Never rate accent.",
    questions: [Q("Q1", "Knowledge of the role", "scored"), Q("Q2", "Communication", "scored"), Q("Q3", "Ownership and results", "scored", ["C1"]), Q("Q4", "Problem solving", "scored"), Q("Q5", "Understanding of the role and why they want to move", "scored"),
      Q("Q6", "Fit with the client's working conditions", "confirms", ["G2"]), Q("Q7", "Salary, joining date and location", "confirms", ["P1"]), Q("Q8", "Ownership and results", "scored", ["C2"]), Q("Q9", "Essential requirement", "confirms", ["G1"])] };
  let setRef;
  beforeEach(() => { const sha = putJson("prototype/config/screening-set-v1.json", SET); putJson("prototype/config/screening-manifest.json", { screeningSets: [{ file: "config/screening-set-v1.json", sha256: sha }] }); setRef = { id: SET.id, version: 1, sha256: sha }; });
  const rev = () => screening.currentScreening(one().screeningRecord).revision;
  const save = () => post("/__scoring/screening/answers", { assessmentId: "syn-a", expectedRevision: rev(), set: setRef, by: "Synthetic recruiter", followUps: {}, excerpt: "", excerptFor: [],
    answers: { Q8: "I never set prices; head office handled all margins. I raised margins by 4 points once.", Q1: "I report every visit in the CRM the same day.", Q9: "Yes, I hold the synthetic licence." } });
  const fake = (claims) => ({ id: "fake", label: "Fake CV checker (test)", isAi: false, run: async () => ({ ok: true, output: { claims }, meta: {} }) });
  const check = (claims) => call({ method: "POST", url: "/__scoring/screening/claims", origin: ORIGIN, body: { assessmentId: "syn-a", expectedRevision: rev() } }, { screeningRoute: fake(claims) });
  const latest = () => screening.currentClaims(one().screeningRecord);
  const decide = (itemId, over = {}) => post("/__scoring/screening/claim-decision", { assessmentId: "syn-a", expectedRevision: rev(), claimReviewRevision: latest().review.revision, itemId, decision: "accepted", reason: "Checked against the call notes.", reviewer: "Synthetic recruiter", ...over });
  const DOWN = { requirementId: "C2", type: "correction", next: { status: "rated", rating: 1 }, cvQuote: "Synthetic quote alpha", callQuote: "head office handled all margins", questionId: "Q8", explanation: "Head office handled margins." };

  it("drops upward proposals: a higher CV skill rating, or an unconfirmed skill becoming rated; the answer stays with the screening", async () => {
    await save();
    await check([{ ...DOWN, next: { status: "rated", rating: 3 }, callQuote: "I raised margins by 4 points once" },
      { requirementId: "I1", type: "correction", next: { status: "rated", rating: 2 }, callQuote: "I report every visit in the CRM the same day", questionId: "Q1", explanation: "Regular reporting described." }, DOWN]);
    expect(latest().review.items.map((c) => [c.requirementId, c.proposal.next])).toEqual([["C2", { status: "rated", rating: 1 }]]);
    expect(latest().review.dropped).toEqual(["proposal 1: call evidence cannot raise a CV skill rating or make an unconfirmed skill rated; it stays with the screening answers",
      "proposal 2: call evidence cannot raise a CV skill rating or make an unconfirmed skill rated; it stays with the screening answers"]);
    expect(screening.currentScreening(one().screeningRecord).answers.answers.Q1).toBe("I report every visit in the CRM the same day."); // still screening evidence
  });
  it("refuses to accept an older saved upward proposal, with a clear reason, and changes nothing", async () => {
    await save();
    const file = path.join(dir, "screening", "syn-a.json"), rec = JSON.parse(fs.readFileSync(file, "utf8"));
    rec.entries.push({ kind: "claimReview", revision: rec.entries.length + 1, at: "2026-01-10T00:00:00Z", route: "Older check", isAi: false, answersRevision: 1, dropped: [], items: [
      { id: "C1", requirementId: "C2", cvState: { status: "rated", rating: 2 }, cvQuote: "Synthetic quote alpha", cvPage: 1, callQuote: "I raised margins by 4 points once", callSource: { questionId: "Q8" }, explanation: "Older upward proposal.", proposal: { type: "correction", next: { status: "rated", rating: 3 } } },
      { id: "C2", requirementId: "C2", cvState: { status: "rated", rating: 2 }, cvQuote: null, cvPage: null, callQuote: "head office handled all margins", callSource: { questionId: "Q8" }, explanation: "Older proposal without the CV quote.", proposal: { type: "correction", next: { status: "rated", rating: 1 } } }] });
    fs.writeFileSync(file, JSON.stringify(rec), { mode: 0o600 });
    const up = await decide("C1");
    expect([up.status, up.body.problems[0]]).toEqual([422, "Call evidence cannot raise a CV skill rating or make an unconfirmed skill rated. Dismiss this proposal; the answer stays with the screening."]);
    const noQuote = await decide("C2");
    expect([noQuote.status, noQuote.body.problems[0]]).toEqual([422, "The CV records evidence for this requirement, but the proposal does not cite it. Dismiss it and prepare a new CV check."]);
    expect(one().corrections).toHaveLength(0);
    expect((await decide("C1", { decision: "dismissed", reason: "Upward changes come from screening only." })).status).toBe(201); // it can still be dismissed
  });
  it("keeps supported downward corrections, and still lets essential requirements be corrected as before", async () => {
    await save();
    await check([DOWN, { requirementId: "G1", type: "correction", next: { status: "gate", result: "Pass" }, callQuote: "Yes, I hold the synthetic licence.", questionId: "Q9", explanation: "The candidate confirms the licence." }]);
    expect(latest().review.items.map((c) => [c.requirementId, c.proposal.next])).toEqual([["C2", { status: "rated", rating: 1 }], ["G1", { status: "gate", result: "Pass" }]]);
    expect((await decide("C1")).status).toBe(201);
    expect(one().corrections.map((c) => [c.criterionId, c.next])).toEqual([["C2", { status: "rated", rating: 1 }]]);
  });
  it("requires an exact CV quote when the requirement has recorded evidence; none is needed when the CV has none", async () => {
    await save();
    await check([{ ...DOWN, cvQuote: undefined }, { requirementId: "I1", type: "conflict", callQuote: "I report every visit in the CRM the same day", questionId: "Q1", explanation: "The CV is silent; the call describes daily reporting, but nothing confirms it." }]);
    expect(latest().review.dropped).toEqual(["proposal 1: the CV records evidence for this requirement, so the proposal must cite one of its exact quotes"]);
    expect(latest().review.items.map((c) => [c.requirementId, c.cvQuote])).toEqual([["I1", null]]); // I1 has no CV evidence: genuinely absent
  });
});

/* W6: the recruiter's final review (synthetic). syn-a: G1 not confirmed; G2 met; C1 3, C2 2, I1 not confirmed. */
describe("recruiter final review", () => {
  const file = () => path.join(dir, "decisions", "syn-a.json");
  const decide = (over = {}, a = one()) => post("/__scoring/final-decision", { assessmentId: "syn-a", expectedRevision: a.finalDecisions?.entries.length ?? 0, expected: expectedOf(a),
    expectedScreeningKey: finalReview.screeningKey(a.screeningRecord), decision: "hold", reason: "Licence not yet confirmed; ask before putting forward.", reviewer: "Synthetic recruiter", acknowledgedOpenItems: true, ...over });
  it("records the recruiter's decision with the reason, name, date, CV version and the open items seen", async () => {
    const r = await decide();
    expect(r.status).toBe(201);
    const e = JSON.parse(fs.readFileSync(file(), "utf8")).entries;
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ kind: "finalDecision", revision: 1, reviewer: "Synthetic recruiter", decision: "hold", reason: "Licence not yet confirmed; ask before putting forward.",
      cv: { version: 1 }, openItems: [{ id: "G1", kind: "essential", state: "Not confirmed" }], acknowledgedOpenItems: true });
    expect(e[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect([fs.statSync(file()).mode & 0o777, fs.statSync(path.dirname(file())).mode & 0o777]).toEqual([0o600, 0o700]);
  });
  it("refuses a missing reason, a missing name, an unknown decision, and unacknowledged open items; nothing is written", async () => {
    for (const over of [{ reason: "" }, { reason: "too short" }, { reviewer: " " }, { decision: "reject" }, { acknowledgedOpenItems: false }]) expect((await decide(over)).status, JSON.stringify(over)).toBe(422);
    expect(fs.existsSync(file())).toBe(false);
  });
  it("refuses stale saves: another decision recorded meanwhile, or a CV assessment that changed", async () => {
    const opened = one();
    expect((await decide({}, opened)).status).toBe(201);
    const second = await decide({ decision: "forward", reason: "A later decision from the old page." }, opened);
    expect([second.status, second.body.problems[0]]).toEqual([409, "Another decision has been recorded since this page was opened. Refresh and review it; nothing was saved."]);
    const before = one();
    await post("/__scoring/corrections", correction());
    const r = await post("/__scoring/final-decision", { assessmentId: "syn-a", expectedRevision: 1, expected: expectedOf(before), expectedScreeningKey: finalReview.screeningKey(before.screeningRecord), decision: "forward", reason: "Made before the correction was seen.", reviewer: "R", acknowledgedOpenItems: true });
    expect([r.status, r.body.problems[0]]).toEqual([409, "The CV assessment has changed since this page was opened. Refresh and review the current version; nothing was saved."]);
  });
  it("keeps every earlier decision: a new one is added, never overwriting", async () => {
    await decide();
    await decide({ decision: "forward", reason: "Licence confirmed by the candidate's document." });
    await decide({ decision: "decline", reason: "The client's location rule cannot be met." });
    const h = finalReview.decisionHistory(one().finalDecisions);
    expect([h.current.decision, h.earlier.map((d) => d.decision), h.revision]).toEqual(["decline", ["forward", "hold"], 3]);
  });
  it("changes nothing else: no score, rating, correction, client view or stage", async () => {
    const before = { input: fs.readFileSync(inputPath()), a: one() };
    await decide({ decision: "decline", reason: "Recruiter decision for the test." });
    const after = one();
    expect(fs.readFileSync(inputPath()).equals(before.input)).toBe(true);
    expect([after.criteria, after.gates, after.corrections, after.latestVersion, after.clientView, after.run]).toEqual([before.a.criteria, before.a.gates, before.a.corrections, before.a.latestVersion, before.a.clientView, before.a.run]);
    expect(fs.existsSync(path.join(dir, "reviews.json"))).toBe(false); // no correction or client-summary entry was made
  });
  it("lists conflicting information and undecided CV-check conflicts as open items", async () => {
    await post("/__scoring/corrections", correction({ criterionId: "C2", previous: { status: "rated", rating: 2 }, next: { status: "disputed" } }));
    const a = one(), cfg = data().configs.find((c) => c.id === a.configId && c.version === a.configVersion);
    const inputs = a.criteria.map((c) => (c.status === "rated" ? { id: c.id, status: "rated", rating: c.rating } : { id: c.id, status: c.status }));
    const latest = buildVersions(cfg, inputs, a.corrections, a.gates.map((g) => ({ id: g.id, result: g.result }))).versions.at(-1);
    const rec = { schema: "screening-record/1", assessmentId: "syn-a", entries: [{ kind: "claimReview", revision: 1, at: "x", route: "x", isAi: false, answersRevision: 1, dropped: [], items: [
      { id: "C1", requirementId: "I1", cvState: { status: "unknown" }, cvQuote: null, cvPage: null, callQuote: "x", callSource: { questionId: "Q1" }, explanation: "x", proposal: { type: "conflict" } }] }] };
    expect(finalReview.openItems(cfg, a, latest, rec)).toEqual([{ id: "G1", kind: "essential", state: "Not confirmed" }, { id: "C2", kind: "conflict", state: "Conflicting information" }, { id: "I1", kind: "cv-check conflict", state: "The CV and the call disagree; not yet decided" }]);
  });
});

/* W6 fixes: decisions are bound to the screening evidence; a failed essential requirement blocks "Put forward" (synthetic). */
describe("recruiter final review: screening binding and failed essential requirements", () => {
  const sfile = () => path.join(dir, "screening", "syn-a.json");
  const decide = (over = {}, a = one()) => post("/__scoring/final-decision", { assessmentId: "syn-a", expectedRevision: a.finalDecisions?.entries.length ?? 0, expected: expectedOf(a),
    expectedScreeningKey: finalReview.screeningKey(a.screeningRecord), decision: "hold", reason: "Recruiter decision for the synthetic test.", reviewer: "Synthetic recruiter", acknowledgedOpenItems: true, ...over });
  /* Another recruiter's screening activity, written as the server would (answers, then a corrected rating). */
  const screeningChange = (entries) => { fs.mkdirSync(path.dirname(sfile()), { recursive: true, mode: 0o700 }); fs.writeFileSync(sfile(), JSON.stringify({ schema: "screening-record/1", assessmentId: "syn-a", entries }), { mode: 0o600 }); };
  const ANSWERS = { kind: "answers", revision: 1, at: "2026-01-10T00:00:00Z", by: "R", set: { id: "s", version: 1, sha256: "s" }, answers: { Q1: "I visit customers weekly." }, followUps: {}, excerpt: "", excerptFor: [] };
  const RATING = { kind: "correction", revision: 2, at: "2026-01-10T00:01:00Z", reviewer: "R", questionId: "Q1", from: null, to: 3, quote: "I visit customers weekly.", reason: "Covers field selling.", answersRevision: 1 };
  const history = () => { const a = one(); return finalReview.decisionHistory(a.finalDecisions, { stateSha256: a.latestStateSha, screeningKey: finalReview.screeningKey(a.screeningRecord) }); };

  it("refuses a save when the screening evidence changed after the page was opened", async () => {
    const opened = one();
    screeningChange([ANSWERS]);
    const r = await decide({}, opened);
    expect([r.status, r.body.problems[0]]).toEqual([409, "The screening evidence (answers, ratings or CV-check findings) has changed since this page was opened. Refresh and review it; nothing was saved."]);
    expect(fs.existsSync(path.join(dir, "decisions", "syn-a.json"))).toBe(false);
  });
  it("keeps a decision made before the answers, ratings or CV-check findings changed, but marks it out of date", async () => {
    expect((await decide()).status).toBe(201);
    expect(history().outOfDate).toBe(false);
    screeningChange([ANSWERS]); // new answers
    expect([history().outOfDate, history().current.decision]).toEqual([true, "hold"]);
    expect((await decide({ decision: "decline", reason: "Reviewed again after the new answers." })).status).toBe(201);
    expect(history().outOfDate).toBe(false);
    screeningChange([ANSWERS, RATING]); // a rating changed
    expect(history().outOfDate).toBe(true);
    screeningChange([ANSWERS, RATING, { kind: "claimReview", revision: 3, at: "x", route: "x", isAi: false, answersRevision: 1, dropped: [], items: [] }]); // CV-check findings
    expect(history().outOfDate).toBe(true);
    expect(history().earlier.map((d) => d.decision)).toEqual(["hold"]); // earlier decisions kept
  });
  it("a failed essential requirement blocks 'Put forward', even with the open items acknowledged; hold and decline remain", async () => {
    await post("/__scoring/corrections", correction({ criterionId: "G1", previous: { status: "gate", result: "Unknown" }, next: { status: "gate", result: "Fail" } }));
    const r = await decide({ decision: "forward", reason: "Trying to put forward despite the failed requirement." });
    expect([r.status, r.body.problems[0]]).toEqual([422, "An essential requirement is not met. Putting the candidate forward needs a client exception, and this tool has no way to record one yet. Choose Hold or Do not put forward."]);
    expect(fs.existsSync(path.join(dir, "decisions", "syn-a.json"))).toBe(false);
    expect((await decide({ decision: "hold" })).status).toBe(201);
    expect((await decide({ decision: "decline", reason: "The licence requirement is not met." })).status).toBe(201);
  });
  it("an unconfirmed essential requirement is not treated as failed: 'Put forward' stays available once the open items are acknowledged", async () => {
    expect(one().gates.find((g) => g.id === "G1").result).toBe("Unknown");
    expect((await decide({ decision: "forward", reason: "Licence to be confirmed by the client's process.", acknowledgedOpenItems: false })).status).toBe(422);
    expect((await decide({ decision: "forward", reason: "Licence to be confirmed by the client's process." })).status).toBe(201);
  });
  it("refuses direct endpoint attempts without the screening state, or with an old one", async () => {
    const a = one(), base = { assessmentId: "syn-a", expectedRevision: 0, expected: expectedOf(a), decision: "hold", reason: "A direct attempt without the state.", reviewer: "R", acknowledgedOpenItems: true };
    expect((await post("/__scoring/final-decision", base)).status).toBe(409);
    expect((await post("/__scoring/final-decision", { ...base, expectedScreeningKey: "{}" })).status).toBe(409);
    expect(fs.existsSync(path.join(dir, "decisions", "syn-a.json"))).toBe(false);
  });
});
