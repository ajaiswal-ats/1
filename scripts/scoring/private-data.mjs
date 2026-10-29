/* Scoring test: the local server side of the portal's scoring-test mode, and the shared file access for the run command.
   Used only by vite.scoring.config.mjs (the dev server, bound to 127.0.0.1) and local scripts; never part of `vite build`.

   Private folder (default docs/reference/scoring-inputs/prototype; source files are relative to its parent folder):
     config/manifest.json + config/*.json   frozen rubrics, each checked against its recorded SHA-256
     mapping.json                           Candidate A–D labels → source CV file and fingerprint (stays on this server)
     runs/inputs/<id>.input.json            one run input per candidate–role assessment (src/scoring/run.ts)
     runs/records/<runId>.json              immutable run records: never overwritten
     reviews.json                           reviewer corrections and client-view revisions, bound to an assessment state
     reviews.checkpoint.json                the count and last chain hash of each list, rewritten with every append
     runs/provenance-log.json (+ checkpoint) provenance changes (schema upgrades, extraction adoption), even when the
                                            numerical result is unchanged
   History integrity: each entry carries a hash chained to the previous one, and the checkpoint records the last hash and
   the count. This detects an entry altered, reordered or removed (including the newest ones) against the retained
   checkpoint. It is not authentication (the reviewer name is free text), and it does not prevent someone with file
   access from rewriting the whole chain and its checkpoint together.
     fictional-example.json                 the invented demonstration (no real source)
   Every assessment is validated on each request and fails closed: a blocked assessment is sent as its label and the
   reasons only (no ratings, evidence or results). Problems name fields, never private text. Nothing is logged. */
import fs from "node:fs";
import path from "node:path";
import { INTAKE, assessIntake, createIntake, intakeIds, intakeLabels, intakeSummary, intakeText, reviewExtraction, roleSources } from "./intake.mjs";
import { routeFromEnv } from "./ai-route.mjs";
import { ensureRunner, latestJob, startJob } from "./jobs.mjs";
import crypto from "node:crypto";
import { isPrivatePath } from "../dev/private-paths.mjs";

export const DEFAULT_DIR = "docs/reference/scoring-inputs/prototype";
const MAX_BODY = 40_000;

export const sha256Text = (s) => crypto.createHash("sha256").update(s).digest("hex");
const sha256File = (f) => (fs.existsSync(f) && fs.statSync(f).isFile() ? crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex") : null);
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const norm = (s) => s.replace(/\s+/g, " ").trim();

/** Writes JSON atomically (temporary file, then rename), readable by the owner only. */
export function writePrivateJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Writes a new file that must not exist yet: atomic, and refuses to overwrite (a hard link fails if the name exists). */
export function writeNewPrivateJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  try { fs.linkSync(tmp, file); } finally { fs.unlinkSync(tmp); }
}

/** Page texts of an extraction file ("=== PAGE n of m ===" blocks), whitespace-normalised as documented in run.ts. */
export function pagesOf(file) {
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8").split(/^=== PAGE \d+ of \d+ ===$/m).slice(1).map(norm);
}

/** The frozen rubrics in the manifest, each with its actual and recorded fingerprints. */
export function loadRubrics(dir) {
  const manifest = readJson(path.join(dir, "config/manifest.json"));
  return manifest.frozenConfigs.map((m) => {
    const file = path.join(dir, m.file), actual = sha256File(file);
    let config = null;
    try { config = actual ? readJson(file) : null; } catch { config = null; }
    return { id: config?.id ?? null, version: config?.version ?? null, sha256: actual, manifestSha256: m.sha256, config, recordedAt: m.recordedAt, cvsOpenedBefore: m.cvsOpenedBefore, file: m.file };
  });
}

/** The validation context for run inputs: source files are relative to the private folder's parent. */
export function contextFor(dir, rubrics) {
  const sources = path.dirname(dir);
  return {
    fileSha: (f) => sha256File(path.join(sources, f)),
    pages: (f) => pagesOf(path.join(sources, f)),
    rubrics: rubrics.filter((r) => r.config).map((r) => ({ id: r.id, version: r.version, sha256: r.sha256, manifestSha256: r.manifestSha256, config: r.config })),
    hash: sha256Text,
  };
}

export const inputFiles = (dir) => { const d = path.join(dir, "runs/inputs"); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".input.json")).sort().map((f) => path.join(d, f)) : []; };
export function runRecords(dir) {
  const d = path.join(dir, "runs/records");
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".json")).sort().map((f) => { try { return readJson(path.join(d, f)); } catch { return null; } }).filter(Boolean) : [];
}
const readReviews = (dir) => { const f = path.join(dir, "reviews.json"); const r = fs.existsSync(f) ? readJson(f) : {}; return { corrections: r.corrections ?? [], clientViews: r.clientViews ?? [] }; };
/* Checkpoints: the count and last chain hash of each list, so removing the newest entries is detected too. */
const head = (list) => ({ count: list.length, head: list.length ? list[list.length - 1].chainSha256 : "" });
const checkpointFile = (file) => file.replace(/\.json$/, ".checkpoint.json");
function checkpointProblems(file, lists, name) {
  const cp = checkpointFile(file), has = fs.existsSync(cp), any = Object.values(lists).some((l) => l.length);
  if (!has) return any || fs.existsSync(file) ? [`${name} has no checkpoint`] : [];
  const c = readJson(cp);
  const same = (x, y) => x?.count === y.count && x?.head === y.head;
  return Object.entries(lists).some(([k, l]) => !same(c[k], head(l))) ? [`${name} does not match its checkpoint (entries removed or rewritten)`] : [];
}
/** Writes a chained list file and its checkpoint (both atomic). */
function writeChained(file, value) {
  writePrivateJson(file, value);
  writePrivateJson(checkpointFile(file), Object.fromEntries(Object.entries(value).filter(([, l]) => Array.isArray(l)).map(([k, l]) => [k, head(l)])));
}
/** Problems with the reviewer history's hash chains and checkpoint (an altered, removed or reordered entry). */
const historyProblems = (lib, reviews, dir) => [
  ...lib.chainProblems(reviews.corrections, sha256Text, "reviewer correction"), ...lib.chainProblems(reviews.clientViews, sha256Text, "client-view revision"),
  ...checkpointProblems(path.join(dir, "reviews.json"), { corrections: reviews.corrections, clientViews: reviews.clientViews }, "the reviewer history")];

/** The provenance log: append-only, chained and checkpointed like the reviewer history. */
export const PROVENANCE_LOG = "runs/provenance-log.json";
export function readProvenanceLog(dir) { const f = path.join(dir, PROVENANCE_LOG); return fs.existsSync(f) ? readJson(f).entries ?? [] : []; }
export function appendProvenanceLog(dir, lib, entry) {
  const entries = readProvenanceLog(dir), problems = [...lib.chainProblems(entries, sha256Text, "provenance log entry"), ...checkpointProblems(path.join(dir, PROVENANCE_LOG), { entries }, "the provenance log")];
  if (problems.length) throw new Error(problems.join("; "));
  writeChained(path.join(dir, PROVENANCE_LOG), { entries: lib.appendChained(entries, entry, sha256Text) });
}
/** The state a request must name as the one it was based on. */
const sameState = (expected, a) => !!expected && expected.assessmentFingerprint === a.run.assessmentFingerprint && expected.assessmentVersion === a.latestVersion && expected.stateSha256 === a.latestStateSha;

/** Validates one run input and its recorded run; returns the browser payload (blocked: label and reasons only). */
function assess(file, ctx, lib, mapping, records, reviews, history) {
  let raw = null;
  const id = path.basename(file).replace(/\.input\.json$/, "");
  try { raw = readJson(file); } catch { /* reported below */ }
  const m = mapping.candidates.find((c) => c.id === id);
  const base = { id, label: m?.label ?? id, submissionId: typeof raw?.submissionId === "string" ? raw.submissionId : id,
    role: raw?.role && typeof raw.role.id === "string" ? { id: raw.role.id, title: String(raw.role.title ?? ""), loc: String(raw.role.loc ?? ""), summary: "", resp: [] } : null,
    addedAt: m?.assignedAt ?? mapping.assignedAt ?? null, cvSha256: m?.sha256 ?? null, ...(m?.intakeId ? { intakeId: m.intakeId, attempt: m.attempt } : {}) };
  const blocked = (problems) => ({ ...base, status: "blocked", problems });
  if (!raw) return blocked(["the run input is not valid JSON"]);
  if (raw.assessmentId !== id) return blocked(["the run input's assessment ID does not match its file name"]);
  const v = lib.validateRunInput(raw, ctx);
  if (v.status === "blocked") return blocked(v.problems);
  if (!m) return blocked(["no label in the private mapping"]);
  if (m.sha256 !== v.input.sources.cv.sha256) return blocked(["the CV fingerprint differs from the one recorded when labels were assigned"]);
  if (history.length) return blocked(["the reviewer history or provenance log has been altered, reordered or truncated"]);

  /* The calculation now, and the recorded run that must match it exactly. */
  const { resultSha256 } = lib.computeRun(v.input, v.rubric, sha256Text);
  const mine = records.filter((r) => r.result?.assessmentId === id && r.result?.assessmentFingerprint === v.assessmentFingerprint);
  if (!mine.length) return blocked(["no recorded run for these exact inputs: run npm run scoring:run"]);
  if (mine.some((r) => r.resultSha256 !== sha256Text(lib.canonical(r.result)))) return blocked(["a run record for these inputs has been altered"]);
  const run = mine.filter((r) => r.resultSha256 === resultSha256).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).pop();
  if (!run) return blocked(["the recorded run result differs from the calculation for these inputs"]);

  const s = lib.currentState(v, reviews.corrections.filter((c) => c.assessmentId === id), reviews.clientViews.filter((c) => c.assessmentId === id), sha256Text);
  if (s.versionProblems.length) return blocked(["the recorded reviewer corrections do not apply to this assessment"]);
  const a = v.input.assessment, ok = (e) => ({ ...e, verified: true }), cv = s.currentClientView;
  return {
    ...base, role: v.input.role, status: v.status, notes: v.notes, kind: "real",
    configId: v.input.rubric.id, configVersion: v.input.rubric.version, producedBy: `${v.input.preparation.actor} (${v.input.preparation.method})`, createdAt: v.input.preparation.at,
    gates: a.gates.map((g) => ({ ...g, evidence: g.evidence.map(ok) })), criteria: a.criteria.map((c) => ({ ...c, evidence: c.evidence.map(ok) })), otherResults: a.otherResults.map(ok),
    constraints: a.constraints, strengths: a.strengths, gaps: a.gaps, questions: a.questions, manualReview: a.manualReview, screening: null, consistencyRules: a.consistencyRules,
    rubric: v.input.rubric,
    provenance: v.provenance,
    sources: { extraction: { method: v.input.sources.extraction.method, tool: v.input.sources.extraction.tool, toolVersion: v.input.sources.extraction.toolVersion, extractedAt: v.input.sources.extraction.extractedAt, extractedAtBasis: v.input.sources.extraction.extractedAtBasis, accuracy: v.input.sources.extraction.accuracy, note: v.input.sources.extraction.note }, roleRequirementsVersion: v.input.sources.roleRequirements.version },
    review: s.review, initialReview: s.initialReview,
    run: { runId: run.runId, createdAt: run.createdAt, resultSha256, assessmentFingerprint: v.assessmentFingerprint },
    corrections: s.versions.slice(1).map((x) => x.correction), historicalCorrections: s.historicalCorrections,
    latestVersion: s.latest.version, latestStateSha: s.latestStateSha,
    clientViews: s.clientViews,
    clientView: cv ? { ...cv.content, revision: cv.revision, preparedBy: `${cv.preparation.actor} (${cv.preparation.method})`, statusRule: cv.statusRule } : null,
  };
}

/** The recorded screening question sets (config/screening-manifest.json), each with its fingerprint checked. A changed or
    unreadable file is still returned, with the problem, so the page can say why no core set is shown. */
export function loadScreeningSets(dir) {
  const f = path.join(dir, "config/screening-manifest.json");
  if (!fs.existsSync(f)) return [];
  return (readJson(f).screeningSets ?? []).map((m) => {
    const file = path.join(dir, m.file), actual = sha256File(file);
    let set = null;
    try { set = actual ? readJson(file) : null; } catch { set = null; }
    const loadProblems = !set ? ["the question set file cannot be read"] : actual !== m.sha256 ? ["the question set has changed since it was recorded"] : [];
    return { ...(set ?? { questions: [], rules: {} }), sha256: actual, loadProblems };
  });
}

/* W2: one append-only screening record per assessment (answers, draft-rating proposals, recruiter corrections). */
const screeningFile = (dir, id) => path.join(dir, "screening", `${id}.json`);
export function readScreening(dir, id) { const f = screeningFile(dir, id); return fs.existsSync(f) ? readJson(f) : null; }
/* W6: the recruiter's final decisions, one append-only file per assessment, separate from every AI suggestion. */
const decisionsFile = (dir, id) => path.join(dir, "decisions", `${id}.json`);
export function readDecisions(dir, id) { const f = decisionsFile(dir, id); return fs.existsSync(f) ? readJson(f) : null; }

/** Loads, validates and checks everything the page needs. Problems are reported, never silently repaired. */
export function loadPrivateData(dir, lib) {
  if (!fs.existsSync(dir)) return { available: false, problems: ["The private scoring folder is not present on this computer."] };
  const problems = [], rubrics = loadRubrics(dir), ctx = contextFor(dir, rubrics);
  for (const r of rubrics) if (r.sha256 !== r.manifestSha256) problems.push(`${r.file} does not match its recorded fingerprint; assessments that name it are blocked.`);
  const labels = readJson(path.join(dir, "mapping.json")), mapping = { ...labels, candidates: [...labels.candidates, ...intakeLabels(dir)] }, records = runRecords(dir), reviews = readReviews(dir), provLog = readProvenanceLog(dir);
  const history = [...historyProblems(lib, reviews, dir), ...lib.chainProblems(provLog, sha256Text, "provenance log entry"), ...checkpointProblems(path.join(dir, PROVENANCE_LOG), { entries: provLog }, "the provenance log")];
  problems.push(...history);
  const assessments = inputFiles(dir).map((f) => assess(f, ctx, lib, mapping, records, reviews, history)).map((a) => (a.status === "blocked" ? a : { ...a, screeningRecord: readScreening(dir, a.id), finalDecisions: readDecisions(dir, a.id) }));
  for (const a of assessments) if (a.status === "blocked") problems.push(`${a.label}: assessment blocked (${a.problems.join("; ")}).`);
  const fictional = fs.existsSync(path.join(dir, "fictional-example.json")) ? readJson(path.join(dir, "fictional-example.json")) : null;
  /* The invented example uses the rubric its file names, when that rubric is intact. */
  const fr = fictional && rubrics.find((r) => r.config && r.sha256 === r.manifestSha256 && r.id === fictional.builtInCorrections?.[0]?.configId && r.version === fictional.builtInCorrections?.[0]?.configVersion);
  const frozenFile = path.join(dir, "frozen-results.json");
  return {
    available: true, problems, mappingRule: mapping.rule,
    configs: rubrics.filter((r) => r.config).map((r) => ({ ...r.config, sha256: r.sha256, frozenSha256: r.manifestSha256, hashOk: r.sha256 === r.manifestSha256, recordedAt: r.recordedAt, cvsOpenedBefore: r.cvsOpenedBefore })),
    assessments,
    fictional: fictional && fr ? { ...fictional, configId: fr.id, configVersion: fr.version, createdAt: "", status: "valid", clientViews: [], clientView: null } : null,
    frozen: fs.existsSync(frozenFile) ? readJson(frozenFile) : null,
    screeningSets: loadScreeningSets(dir),
  };
}

/** Request guard: loopback only, the Host this server is bound to, and same-origin for writes. Prevents DNS rebinding and cross-site posts. */
export function requestAllowed(req, port) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`], remote = req.socket?.remoteAddress ?? "";
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote)) return false;
  if (!hosts.includes(req.headers.host)) return false;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.origin;
    if (!origin || !hosts.map((h) => `http://${h}`).includes(origin)) return false;
  }
  return true;
}

const isPlainContent = (c) => !!c && typeof c === "object" && Array.isArray(c.strengths);
const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
};

/** A PDF upload (raw bytes), up to 10 MB. */
function readRaw(req, max = 10_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > max) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** The completed result an interrupted job saved, or null. It counts only when it is the exact assessment the job said it
    was saving, for the same CV, prepared after the job started, not claimed by another job's AI run record, and it passes
    the same checks the page applies (loadPrivateData). The AI run record may be missing if the stop came before it. */
export function completedJobResult(dir, lib, intakeId, job) {
  const aid = job.savingAssessmentId;
  if (typeof aid !== "string" || !aid.startsWith(`${intakeId}-a`)) return null;
  const a = loadPrivateData(dir, lib).assessments?.find((x) => x.id === aid);
  if (!a || a.status === "blocked" || a.intakeId !== intakeId || !job.startedAt || !(a.createdAt >= job.startedAt)) return null;
  const d = path.join(dir, INTAKE, intakeId), runs = fs.readdirSync(d).filter((f) => /^ai-run-.*\.json$/.test(f)).map((f) => readJson(path.join(d, f))).filter((r) => r.assessmentId === aid);
  if (runs.some((r) => r.jobId && r.jobId !== job.jobId)) return null;
  return { assessmentId: aid, runId: runs.find((r) => r.jobId === job.jobId)?.runId ?? null, finishedAt: a.createdAt };
}

/** Writes a validated new assessment and its run record, after the same checks the loader applies. */
export function writeNewAssessment(dir, lib, assessmentId, input) {
  const ctx = contextFor(dir, loadRubrics(dir)), v = lib.validateRunInput(input, ctx);
  if (v.status === "blocked") throw new Error(v.problems.join("; "));
  const file = path.join(dir, "runs/inputs", `${assessmentId}.input.json`);
  writeNewPrivateJson(file, input);
  const { result, resultSha256 } = lib.computeRun(v.input, v.rubric, sha256Text), createdAt = new Date().toISOString();
  const runId = `run-${createdAt.replace(/[-:.]/g, "")}-${assessmentId}-${crypto.randomBytes(3).toString("hex")}`;
  writeNewPrivateJson(path.join(dir, "runs/records", `${runId}.json`), { runId, createdAt, inputFile: path.basename(file), inputFileSha256: sha256Text(fs.readFileSync(file)), result, resultSha256 });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { reject(new Error("not JSON")); } });
    req.on("error", reject);
  });
}

/* One write at a time per private folder: each request re-reads, validates against the latest state and writes before
   the next starts, so concurrent requests cannot lose a reviewer's change (the second is validated against the first).
   Single local server process assumed; the run command never writes reviews.json. */
const queues = new Map();
export function serialised(dir, task) {
  const next = (queues.get(dir) ?? Promise.resolve()).then(task, task);
  queues.set(dir, next.catch(() => {}));
  return next;
}

/** The scoring endpoints and guards. `lib` is src/scoring/run.ts plus buildVersions from versions.ts. */
export function createScoringMiddleware({ dir, port, lib, ai = null, route = routeFromEnv(), root = process.cwd(), now = () => new Date().toISOString(),
  /* Draft screening ratings: a synthetic route when SCORING_SCREENING_FIXTURE is set (tests), otherwise the CV route. */
  screeningRoute = (process.env.SCORING_SCREENING_FIXTURE ? routeFromEnv({ SCORING_AI_ROUTE: "synthetic-test", SCORING_AI_FIXTURE: process.env.SCORING_SCREENING_FIXTURE }) : route).route ?? null }) {
  const verifyJob = (intakeId, job) => completedJobResult(dir, lib, intakeId, job);
  return async (req, res, next) => {
    const url = (req.url ?? "/").split("?")[0];
    if (!requestAllowed(req, port)) return send(res, 403, { error: "Local scoring server: request refused." });
    /* The page may connect only to this server (and Vite's local reload socket): no hosted service can be reached. */
    res.setHeader("Content-Security-Policy", "connect-src 'self' ws://127.0.0.1:* ws://localhost:*; form-action 'none'; base-uri 'none'");
    /* No private or non-app file is served as a static file (the same boundary as the normal dev server). */
    if (isPrivatePath(req.url, root)) return send(res, 404, { error: "Not served." });
    if (!url.startsWith("/__scoring/")) return next();

    try {
      if (url === "/__scoring/data" && req.method === "GET") return send(res, 200, loadPrivateData(dir, lib));

      if (url === "/__scoring/corrections" && req.method === "POST") {
        if (!/^application\/json/.test(req.headers["content-type"] ?? "")) return send(res, 415, { error: "JSON only." });
        const body = await readBody(req);
        return await serialised(dir, () => {
          const data = loadPrivateData(dir, lib), target = data.assessments?.find((a) => a.id === body.assessmentId);
          if (!target) return send(res, 404, { problems: ["No such assessment (the fictional example cannot be corrected)."] });
          if (target.status === "blocked") return send(res, 409, { problems: ["This assessment is blocked; corrections are not accepted until it validates."] });
          /* Revalidated now, inside the write queue: the request must name the exact state it was made from. */
          if (!sameState(body.expected, target) || body.basedOn !== target.run.assessmentFingerprint) return send(res, 409, { problems: ["The assessment has changed since it was opened. Refresh, review the current version and try again."] });
          const config = data.configs.find((c) => c.id === target.configId && c.version === target.configVersion);
          const { expected: _expected, ...fields } = body;
          void _expected;
          const correction = { ...fields, at: now() };
          const inputs = target.criteria.map((c) => (c.status === "rated" ? { id: c.id, status: "rated", rating: c.rating } : { id: c.id, status: c.status }));
          const { problems } = lib.buildVersions(config, inputs, [...target.corrections, correction], target.gates.map((g) => ({ id: g.id, result: g.result })));
          if (problems.length) return send(res, 422, { problems });
          const reviews = readReviews(dir);
          writeChained(path.join(dir, "reviews.json"), { ...reviews, corrections: lib.appendChained(reviews.corrections, correction, sha256Text) });
          return send(res, 201, { correction });
        });
      }

      /* W6: the recruiter's final review. It records a person's decision only: nothing is accepted, rejected, moved,
         published or notified, no threshold is applied and no score changes. Stale saves are refused. */
      if (url === "/__scoring/final-decision" && req.method === "POST") {
        if (!/^application\/json/.test(req.headers["content-type"] ?? "")) return send(res, 415, { error: "JSON only." });
        const body = await readBody(req);
        return await serialised(dir, () => {
          const data = loadPrivateData(dir, lib), a = data.assessments?.find((x) => x.id === body.assessmentId);
          if (!a || a.status === "blocked") return send(res, 404, { problems: ["No such assessment."] });
          const rec = a.finalDecisions ?? { schema: "final-decisions/1", assessmentId: a.id, entries: [] };
          if (body.expectedRevision !== rec.entries.length) return send(res, 409, { problems: ["Another decision has been recorded since this page was opened. Refresh and review it; nothing was saved."] });
          if (!sameState(body.expected, a)) return send(res, 409, { problems: ["The CV assessment has changed since this page was opened. Refresh and review the current version; nothing was saved."] });
          const sKey = lib.screeningKey(a.screeningRecord);
          if (body.expectedScreeningKey !== sKey) return send(res, 409, { problems: ["The screening evidence (answers, ratings or CV-check findings) has changed since this page was opened. Refresh and review it; nothing was saved."] });
          if (!Object.keys(lib.DECISIONS).includes(body.decision)) return send(res, 422, { problems: ["Choose a decision."] });
          if (typeof body.reason !== "string" || body.reason.trim().length < 10) return send(res, 422, { problems: ["Give a reason for the decision (at least 10 characters)."] });
          if (typeof body.reviewer !== "string" || !body.reviewer.trim()) return send(res, 422, { problems: ["Type your name."] });
          const config = data.configs.find((c) => c.id === a.configId && c.version === a.configVersion);
          const inputs = a.criteria.map((c) => (c.status === "rated" ? { id: c.id, status: "rated", rating: c.rating } : { id: c.id, status: c.status }));
          const { versions } = lib.buildVersions(config, inputs, a.corrections, a.gates.map((g) => ({ id: g.id, result: g.result })));
          const open = lib.openItems(config, a, versions[versions.length - 1], a.screeningRecord);
          if (body.decision === "forward" && lib.failedEssentials(open).length) return send(res, 422, { problems: [lib.FORWARD_BLOCKED] });
          if (open.length && body.acknowledgedOpenItems !== true) return send(res, 422, { problems: ["Some essential requirements or conflicts are still open. Confirm that you have seen them before recording a decision."] });
          const entry = { kind: "finalDecision", revision: rec.entries.length + 1, at: now(), reviewer: body.reviewer.trim(), decision: body.decision, reason: body.reason.trim(),
            cv: { version: a.latestVersion, stateSha256: a.latestStateSha }, screeningRevision: a.screeningRecord?.entries?.length ?? 0, openItems: open, acknowledgedOpenItems: open.length > 0, screeningKey: sKey };
          writePrivateJson(decisionsFile(dir, a.id), { ...rec, entries: [...rec.entries, entry] });
          return send(res, 201, { revision: entry.revision });
        });
      }

      /* W2: screening answers, draft ratings and corrections (recruiter tools; append-only; stale saves refused). */
      const sm = url.match(/^\/__scoring\/screening\/(answers|propose|correct|summarise|summary|claims|claim-decision)$/);
      if (sm && req.method === "POST") {
        if (!/^application\/json/.test(req.headers["content-type"] ?? "")) return send(res, 415, { error: "JSON only." });
        const body = await readBody(req);
        return await serialised(dir, async () => {
          const data = loadPrivateData(dir, lib), a = data.assessments?.find((x) => x.id === body.assessmentId);
          if (!a || a.status === "blocked") return send(res, 404, { problems: ["No such assessment."] });
          const config = data.configs.find((c) => c.id === a.configId && c.version === a.configVersion);
          const rec = a.screeningRecord ?? { schema: "screening-record/1", assessmentId: a.id, entries: [] }, state = lib.currentScreening(rec);
          if (body.expectedRevision !== state.revision) return send(res, 409, { problems: ["The screening record has changed since this page was opened. Refresh and try again; nothing was saved."] });
          /* The question set: the one the answers were first saved with, or the current one for these rules. */
          const recorded = state.answers?.set, sets = data.screeningSets ?? [];
          const set = recorded ? sets.find((s) => s.id === recorded.id && s.version === recorded.version && s.sha256 === recorded.sha256 && !s.loadProblems.length) : lib.coreSetFor(sets, config).set;
          if (!set) return send(res, 409, { problems: [recorded ? "The question set these answers were saved with is no longer available unchanged." : "No core question set is available for these rules."] });
          const followUps = lib.followUpsFor(a, set), add = (entry) => { writePrivateJson(screeningFile(dir, a.id), { ...rec, entries: [...rec.entries, { ...entry, revision: state.revision + 1, at: now() }] }); };
          const kind = sm[1];
          if (kind === "answers") {
            const s = body.set ?? {};
            if (s.id !== set.id || s.version !== set.version || s.sha256 !== set.sha256) return send(res, 409, { problems: ["The question set has changed since this page was opened. Refresh and try again; nothing was saved."] });
            if (typeof body.by !== "string" || !body.by.trim()) return send(res, 422, { problems: ["Type your name."] });
            const ids = new Set(set.questions.map((q) => q.id)), fkeys = new Map(followUps.map((f, i) => [lib.followUpKey(i, f.text), f.text]));
            const str = (x, max) => typeof x === "string" && x.length <= max;
            const answers = body.answers ?? {}, fu = body.followUps ?? {}, excerpt = body.excerpt ?? "", excerptFor = body.excerptFor ?? [];
            const problems = [...Object.entries(answers).filter(([k, v]) => !ids.has(k) || !str(v, 5000)).map(([k]) => `answer ${k} is not a core question, or is too long`),
              ...Object.entries(fu).filter(([k, v]) => !fkeys.has(k) || !str(v, 5000)).map(([k]) => `follow-up ${k.split(":")[0]} is not one of this candidate's follow-ups, or is too long`),
              ...(str(excerpt, 20000) ? [] : ["the call excerpt is too long"]),
              ...(Array.isArray(excerptFor) && excerptFor.every((k) => ids.has(k)) ? [] : ["the call excerpt can only be linked to core questions"])];
            if (problems.length) return send(res, 422, { problems });
            const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v.trim()));
            add({ kind: "answers", by: body.by.trim(), set: { id: set.id, version: set.version, sha256: set.sha256 }, answers: clean(answers),
              followUps: Object.fromEntries(Object.entries(clean(fu)).map(([k, v]) => [k, { question: fkeys.get(k), answer: v }])), excerpt: excerpt.trim(),
              /* The excerpt answers only the questions the recruiter linked it to (none when there is no excerpt). */
              excerptFor: excerpt.trim() ? [...new Set(excerptFor)] : [] });
            return send(res, 201, { revision: state.revision + 1 });
          }
          if (!state.answers) return send(res, 409, { problems: ["Save the answers first."] });
          if (kind === "propose") {
            if (!screeningRoute) return send(res, 503, { problems: ["No route is configured for draft ratings."] });
            if (screeningRoute.isAi && body.confirmCost !== true)
              return send(res, 409, { needsConfirm: true, problems: [`This sends the saved answers to ${screeningRoute.label}. It uses AI and may cost money or allowance. Confirm before it runs.`] });
            const result = await screeningRoute.run(lib.proposalPrompt(set, state.answers, followUps));
            if (!result.ok) return send(res, 502, { problems: [`No draft ratings were prepared: ${result.error}`] });
            const { ratings, dropped } = lib.validateProposal(result.output, set, state.answers, followUps);
            add({ kind: "proposal", route: screeningRoute.label, isAi: !!screeningRoute.isAi, answersRevision: state.answers.revision, ratings, dropped });
            return send(res, 201, { revision: state.revision + 1, rated: Object.keys(ratings).length, dropped });
          }
          /* W4: CV claims against the saved answers. Proposals change nothing; a recruiter accepts or dismisses each with a
             reason. An accepted correction is an ordinary CV correction (source "screening call"), validated and written
             exactly as /__scoring/corrections does, so the calculator rescores it and the client summary goes out of date. */
          const cvNow = () => { const inputs = a.criteria.map((c) => (c.status === "rated" ? { id: c.id, status: "rated", rating: c.rating } : { id: c.id, status: c.status }));
            const { versions } = lib.buildVersions(config, inputs, a.corrections, a.gates.map((g) => ({ id: g.id, result: g.result })));
            return lib.cvRequirements(config, a, versions[versions.length - 1]); };
          if (kind === "claims") {
            if (!screeningRoute) return send(res, 503, { problems: ["No route is configured for the CV check."] });
            if (!set.questions.some((q) => lib.answerSources(q.id, state.answers, followUps).length) && !Object.values(state.answers.followUps).some((f) => f.answer.trim()))
              return send(res, 409, { problems: ["No question has an answer yet, so there is nothing to compare with the CV."] });
            if (screeningRoute.isAi && body.confirmCost !== true)
              return send(res, 409, { needsConfirm: true, problems: [`This sends the saved answers and the CV assessment to ${screeningRoute.label}. It uses AI and may cost money or allowance. Confirm before it runs.`] });
            const reqs = cvNow(), labels = new Map([...config.gates.map((g) => [g.id, g.label]), ...config.criteria.map((c) => [c.id, c.label])]);
            const rules = { gates: config.gates.map((g) => ({ id: g.id, rule: g.testRule ?? "" })), criteria: config.criteria.filter((c) => c.included).map((c) => ({ id: c.id, max: c.max, levels: c.anchors, unavailable: c.unavailableLevels ?? [] })) };
            const result = await screeningRoute.run(lib.claimsPrompt(set, state.answers, followUps, reqs, labels, rules));
            if (!result.ok) return send(res, 502, { problems: [`No CV check was prepared: ${result.error}`] });
            const { items, dropped } = lib.checkClaims(result.output, set, state.answers, followUps, reqs);
            add({ kind: "claimReview", route: screeningRoute.label, isAi: !!screeningRoute.isAi, answersRevision: state.answers.revision, items, dropped, output: result.output ?? null });
            return send(res, 201, { revision: state.revision + 1, items: items.length, dropped });
          }
          if (kind === "claim-decision") {
            const { review, decisionOf } = lib.currentClaims(rec);
            if (!review || review.revision !== body.claimReviewRevision) return send(res, 409, { problems: ["These proposals have been replaced by a newer CV check. Refresh and review the current one."] });
            const item = review.items.find((x) => x.id === body.itemId);
            if (!item) return send(res, 404, { problems: ["No such proposal."] });
            if (decisionOf(review, item.id)) return send(res, 409, { problems: ["This proposal has already been decided; it cannot be accepted or dismissed twice."] });
            if (review.answersRevision !== state.answers.revision) return send(res, 409, { problems: ["The screening answers have changed since this proposal was made. Prepare a new CV check."] });
            if (!["accepted", "dismissed"].includes(body.decision)) return send(res, 422, { problems: ["Accept or dismiss the proposal."] });
            if (typeof body.reviewer !== "string" || !body.reviewer.trim()) return send(res, 422, { problems: ["Type your name."] });
            if (typeof body.reason !== "string" || body.reason.trim().length < 10) return send(res, 422, { problems: ["Give a short reason (at least 10 characters)."] });
            let correctionVersion = null;
            if (body.decision === "accepted") {
              const now_ = cvNow().find((r) => r.id === item.requirementId);
              if (!now_ || JSON.stringify(now_.state) !== JSON.stringify(item.cvState)) return send(res, 409, { problems: ["The CV assessment has changed for this requirement since the proposal was made. Prepare a new CV check."] });
              /* Checked again for proposals saved before these rules: no upward skill change from the call, and a CV quote
                 wherever the CV records evidence. */
              if (item.proposal.type === "correction" && lib.raisesSkill(now_, now_.state, item.proposal.next))
                return send(res, 422, { problems: ["Call evidence cannot raise a CV skill rating or make an unconfirmed skill rated. Dismiss this proposal; the answer stays with the screening."] });
              if (!item.cvQuote && now_.evidence.length) return send(res, 422, { problems: ["The CV records evidence for this requirement, but the proposal does not cite it. Dismiss it and prepare a new CV check."] });
              const next = item.proposal.type === "correction" ? item.proposal.next : now_.kind === "criterion" ? { status: "disputed" } : null;
              if (!next) return send(res, 422, { problems: ["An essential requirement has no conflict state under the rules. Dismiss this proposal, or record a correction yourself."] });
              const src = item.callSource.followUp ? `follow-up ${item.callSource.followUp.split(":")[0].slice(1)}` : item.callSource.questionId;
              const correction = { assessmentId: a.id, version: a.latestVersion + 1, criterionId: item.requirementId, previous: item.cvState, next,
                evidence: `Screening call (${src}): "${item.callQuote}". CV: ${item.cvQuote ? `"${item.cvQuote}" (page ${item.cvPage})` : "not stated in the CV"}.`,
                reason: body.reason.trim(), reviewer: body.reviewer.trim(), source: "screening call", configId: config.id, configVersion: config.version, basedOn: a.run.assessmentFingerprint, at: now() };
              const inputs = a.criteria.map((c) => (c.status === "rated" ? { id: c.id, status: "rated", rating: c.rating } : { id: c.id, status: c.status }));
              const { problems } = lib.buildVersions(config, inputs, [...a.corrections, correction], a.gates.map((g) => ({ id: g.id, result: g.result })));
              if (problems.length) return send(res, 422, { problems });
              const reviews = readReviews(dir);
              writeChained(path.join(dir, "reviews.json"), { ...reviews, corrections: lib.appendChained(reviews.corrections, correction, sha256Text) });
              correctionVersion = correction.version;
            }
            add({ kind: "claimDecision", reviewer: body.reviewer.trim(), claimReviewRevision: review.revision, itemId: item.id, decision: body.decision, reason: body.reason.trim(), correctionVersion });
            return send(res, 201, { revision: state.revision + 1, correctionVersion });
          }
          /* W3: a draft call summary from the saved answers only (invalid items dropped), or a recruiter's edited and
             confirmed summary (refused if anything is invalid). Both are bound to the current answers and ratings. */
          if (kind === "summarise") {
            if (!screeningRoute) return send(res, 503, { problems: ["No route is configured for draft summaries."] });
            if (!set.questions.some((q) => lib.answerSources(q.id, state.answers, followUps).length)) return send(res, 409, { problems: ["No question has an answer yet, so there is nothing to summarise."] });
            if (screeningRoute.isAi && body.confirmCost !== true)
              return send(res, 409, { needsConfirm: true, problems: [`This sends the saved answers to ${screeningRoute.label}. It uses AI and may cost money or allowance. Confirm before it runs.`] });
            const result = await screeningRoute.run(lib.summaryPrompt(set, rec, followUps));
            if (!result.ok) return send(res, 502, { problems: [`No draft summary was prepared: ${result.error}`] });
            const { content, problems } = lib.checkSummary(result.output, set, state.answers, followUps);
            add({ kind: "summaryDraft", route: screeningRoute.label, isAi: !!screeningRoute.isAi, stateKey: lib.stateKey(rec, set), content, dropped: problems, output: result.output ?? null });
            return send(res, 201, { revision: state.revision + 1, dropped: problems });
          }
          if (kind === "summary") {
            if (typeof body.reviewer !== "string" || !body.reviewer.trim()) return send(res, 422, { problems: ["Type your name."] });
            if (body.confirmed !== true) return send(res, 422, { problems: ["Confirm that you have reviewed the summary against the answers."] });
            const { content, problems } = lib.checkSummary(body.content, set, state.answers, followUps, "review");
            if (problems.length) return send(res, 422, { problems });
            add({ kind: "summaryReview", reviewer: body.reviewer.trim(), stateKey: lib.stateKey(rec, set), content, basedOnRevision: Number.isInteger(body.basedOnRevision) ? body.basedOnRevision : null });
            return send(res, 201, { revision: state.revision + 1 });
          }
          /* A recruiter's correction of one scored question: a whole rating 1 to 5 with a word-for-word quote, or "Not rated". */
          const q = set.questions.find((x) => x.id === body.questionId);
          if (!q || q.use !== "scored") return send(res, 422, { problems: ["Only scored core questions can be rated."] });
          if (typeof body.reviewer !== "string" || !body.reviewer.trim()) return send(res, 422, { problems: ["Type your name."] });
          if (typeof body.reason !== "string" || body.reason.trim().length < 10) return send(res, 422, { problems: ["Give a short reason (at least 10 characters)."] });
          const to = body.rating === null ? null : body.rating, sources = lib.answerSources(q.id, state.answers, followUps);
          if (to !== null) {
            if (!Number.isInteger(to) || to < 1 || to > 5) return send(res, 422, { problems: ["The rating must be a whole number from 1 to 5, or Not rated."] });
            if (!sources.length) return send(res, 422, { problems: ["This question has no answer, so it cannot be rated."] });
            if (typeof body.quote !== "string" || !lib.quotedFrom(body.quote, sources)) return send(res, 422, { problems: ["The quote must be copied word for word from the answer given."] });
          }
          add({ kind: "correction", reviewer: body.reviewer.trim(), questionId: q.id, from: state.ratingOf(q.id).rating, to, quote: to === null ? "" : body.quote.replace(/\s+/g, " ").trim(), reason: body.reason.trim(), answersRevision: state.answers.revision });
          return send(res, 201, { revision: state.revision + 1 });
        });
      }

      /* A reviewer binds client-facing content to the current assessment state explicitly. */
      if (url === "/__scoring/client-view" && req.method === "POST") {
        if (!/^application\/json/.test(req.headers["content-type"] ?? "")) return send(res, 415, { error: "JSON only." });
        const body = await readBody(req);
        return await serialised(dir, () => {
          const data = loadPrivateData(dir, lib), target = data.assessments?.find((a) => a.id === body.assessmentId);
          if (!target) return send(res, 404, { problems: ["No such assessment."] });
          if (target.status === "blocked") return send(res, 409, { problems: ["This assessment is blocked; its client view cannot be confirmed."] });
          const d = body.describes ?? {}, r = target.rubric;
          if (!sameState(d, target) || !d.rubric || d.rubric.id !== r.id || d.rubric.version !== r.version || d.rubric.sha256 !== r.sha256)
            return send(res, 409, { problems: ["The assessment has changed since this view was opened. Refresh and review it again."] });
          /* Either a review after the assessment changed, or an initial review of the prepared draft (no rating change). */
          const pending = target.review ?? target.initialReview, initial = !target.review && !!target.initialReview;
          if (!pending) return send(res, 409, { problems: ["The client summary has already been reviewed for the current assessment; there is nothing to confirm."] });
          if (body.changesSha256 !== pending.changesSha256) return send(res, 409, { problems: ["The summary or the assessment has changed since this form was opened. Refresh and review it again."] });
          if (body.confirmed !== true || typeof body.reviewer !== "string" || !body.reviewer.trim()) return send(res, 422, { problems: ["A reviewer name and explicit confirmation are required."] });
          const config = data.configs.find((c) => c.id === target.configId && c.version === target.configVersion);
          const input = readJson(path.join(dir, "runs/inputs", `${target.id}.input.json`));
          const base = target.clientViews.find((v) => v.revision === pending.baseRevision);
          const revision = { revision: Math.max(...target.clientViews.map((v) => v.revision)) + 1,
            describes: { assessmentFingerprint: d.assessmentFingerprint, assessmentVersion: d.assessmentVersion, stateSha256: d.stateSha256, rubric: { id: r.id, version: r.version, sha256: r.sha256 } },
            content: body.content, statusRule: input.clientView.statusRule, preparation: { method: "reviewer-confirmed", actor: body.reviewer.trim(), at: now() },
            review: { baseRevision: pending.baseRevision, changesSha256: pending.changesSha256, changes: initial ? [] : target.review.changes, retained: initial ? {} : body.retained ?? {}, ...(initial ? { initial: true } : {}),
              /* Held strengths the reviewer actively approved, with reasons; a held strength without one stays held (consistency.ts). */
              approvedHeld: Array.isArray(body.approvedHeld) ? body.approvedHeld.map((x) => ({ text: x?.text, reason: typeof x?.reason === "string" ? x.reason.trim() : x?.reason })) : body.approvedHeld ?? [] } };
          const shape = lib.clientViewProblems(revision);
          const problems = shape.length ? shape : [
            ...lib.clientContentProblems(body.content, config, pagesOf(path.join(path.dirname(dir), input.sources.extraction.file)) ?? []),
            /* Kept wording needs a reason only after the assessment changed; an initial review approves the draft as it is. */
            ...(initial ? [] : lib.retentionProblems(base.content, body.content, target.review.affected, body.retained)),
            ...(isPlainContent(body.content) ? lib.heldApprovalProblems(revision.review.approvedHeld, body.content) : [])];
          if (problems.length) return send(res, 422, { problems });
          const reviews = readReviews(dir);
          writeChained(path.join(dir, "reviews.json"), { ...reviews, clientViews: lib.appendChained(reviews.clientViews, { assessmentId: target.id, ...revision }, sha256Text) });
          return send(res, 201, { revision: revision.revision });
        });
      }

      /* Scoped reset: archives this prototype's reviewer corrections and client-view revisions only. Run inputs, run
         records, rubrics and any portal state (browser storage, the demo, Supabase) are untouched. */
      if (url === "/__scoring/reset" && req.method === "POST") {
        const body = await readBody(req);
        if (body.scope !== "scoring-test-reviewer-corrections") return send(res, 400, { error: "Unknown reset scope." });
        return await serialised(dir, () => {
          const file = path.join(dir, "reviews.json");
          let archived = null;
          if (fs.existsSync(file)) {
            archived = `reviews.reset-${now().replace(/[:.]/g, "-")}.json`;
            fs.renameSync(file, path.join(dir, archived));
            if (fs.existsSync(checkpointFile(file))) fs.renameSync(checkpointFile(file), path.join(dir, archived.replace(/\.json$/, ".checkpoint.json")));
          }
          return send(res, 200, { archived });
        });
      }
      /* ---- CV intake and AI-proposed assessment (local recruiter workflow) ---- */
      const m = url.match(/^\/__scoring\/intake(?:\/(in-[\w-]+)(?:\/(text|extraction-review|assess))?)?$/);
      if (m && ai) {
        const [, id, action] = m, known = id ? intakeIds(dir).includes(id) : true, clock = () => new Date(now());
        if (!known) return send(res, 404, { problems: ["No such CV."] });
        if (!id && req.method === "GET") {
          ensureRunner(dir, now, verifyJob); // after a restart: unfinished jobs are reconciled before they are shown
          const rubrics = loadRubrics(dir);
          return send(res, 200, {
            route: route.route ? { configured: true, label: route.route.label, isAi: route.route.isAi } : { configured: false, reason: route.reason },
            roles: roleSources(dir).map((s) => { const r = rubrics.find((x) => x.id === s.config.id && x.version === s.config.version);
              return { id: s.config.id, version: s.config.version, title: r?.config?.role.title ?? s.config.id, location: r?.config?.role.loc ?? "", approved: !!r?.config?.approved, intact: !!r && r.sha256 === r.manifestSha256, roleSetup: s.roleRequirements.version }; }),
            intakes: intakeIds(dir).map((x) => ({ ...intakeSummary(dir, x, lib), job: latestJob(dir, x) })).reverse(),
          });
        }
        if (!id && req.method === "POST") {
          if (!/^application\/pdf/.test(req.headers["content-type"] ?? "")) return send(res, 415, { problems: ["Choose a PDF file."] });
          const pdf = await readRaw(req);
          return await serialised(dir, () => {
            try { return send(res, 201, createIntake({ dir, pdf, fileName: decodeURIComponent(String(req.headers["x-file-name"] ?? "")), role: { id: String(req.headers["x-role-id"] ?? ""), version: Number(req.headers["x-role-version"]) }, lib, now: clock })); }
            catch (e) { return send(res, 422, { problems: [e instanceof Error ? e.message : "The CV could not be added."] }); }
          });
        }
        if (action === "text" && req.method === "GET") return send(res, 200, intakeText(dir, id, lib) ?? { pages: [] });
        if (action === "extraction-review" && req.method === "POST") {
          const body = await readBody(req);
          if (typeof body.reviewer !== "string" || !body.reviewer.trim()) return send(res, 422, { problems: ["Type your name."] });
          if (!["matches", "differences found"].includes(body.result)) return send(res, 422, { problems: ["Say whether the text matches the PDF."] });
          return await serialised(dir, () => {
            try { return send(res, 201, reviewExtraction({ dir, id, reviewer: body.reviewer, result: body.result, notes: String(body.notes ?? "").slice(0, 1000), lib, now: clock })); }
            catch (e) { return send(res, 422, { problems: [e instanceof Error ? e.message : "The review could not be saved."] }); }
          });
        }
        /* Starts a background job (or returns the one already running for this CV) and answers at once: the page can be
           left or refreshed; it reads the job's state from the list above. */
        if (action === "assess" && req.method === "POST") {
          if (!route.route) return send(res, 503, { problems: [route.reason] });
          const s = intakeSummary(dir, id, lib);
          if (s.extraction.status !== "completed") return send(res, 422, { problems: ["The CV text could not be extracted, so it cannot be assessed."] });
          if (s.review.status !== "matches") return send(res, 422, { problems: [s.review.status === "differences" ? "The extraction review found differences. Fix or replace the CV before assessing it." : "Review the extracted text against the PDF before assessing."] });
          /* A CV that already has a result needs an explicit request for a new run, so a stray or late click cannot start
             another AI run by accident. A request while a job is running still returns that job. */
          const body = /^application\/json/.test(req.headers["content-type"] ?? "") ? await readBody(req) : {};
          const last = latestJob(dir, id), running = last && ["queued", "processing"].includes(last.state);
          if (!running && (last?.state === "ready" || s.runs.some((x) => x.outcome === "valid")) && body.confirmNew !== true)
            return send(res, 409, { needsConfirm: true, problems: ["This CV already has an assessment. Confirm to run a new one; earlier results are kept."] });
          const r = startJob({ dir, intakeId: id, now, verify: verifyJob, execute: ({ jobId, saving }) => assessIntake({ dir, id, route: route.route, lib, ai, now: clock, run: { rubrics: loadRubrics(dir), hash: sha256Text }, writeRun: (aid, input) => writeNewAssessment(dir, lib, aid, input), jobId, saving }) });
          return send(res, r.duplicate ? 200 : 202, r);
        }
      }
      return send(res, 404, { error: "Unknown scoring endpoint." });
    } catch (e) {
      return send(res, 400, { error: e instanceof Error && /too large|not JSON/.test(e.message) ? `Request ${e.message}.` : "Request failed." });
    }
  };
}

/** Vite plugins for the scoring dev server only: the private-data middleware, and a guard that refuses any build. */
export function scoringPrivateData({ dir = process.env.SCORING_PRIVATE_DIR || DEFAULT_DIR } = {}) {
  return [
    {
      name: "scoring-private-data",
      apply: "serve",
      configureServer(server) {
        const privateDir = path.resolve(server.config.root, dir), port = server.config.server.port, route = routeFromEnv();
        /* The same validation the run command and the tests use (src/scoring/run.ts), loaded through Vite. */
        server.middlewares.use(async (req, res, next) => {
          const lib = { ...(await server.ssrLoadModule("/src/scoring/extraction.ts")), ...(await server.ssrLoadModule("/src/scoring/blinding.ts")), ...(await server.ssrLoadModule("/src/scoring/run.ts")), ...(await server.ssrLoadModule("/src/scoring/screening.ts")), ...(await server.ssrLoadModule("/src/scoring/finalReview.ts")), buildVersions: (await server.ssrLoadModule("/src/scoring/versions.ts")).buildVersions };
          const ai = await server.ssrLoadModule("/src/scoring/aiAssessment.ts");
          return createScoringMiddleware({ dir: privateDir, port, lib, ai, route, root: server.config.root })(req, res, next);
        });
      },
    },
    {
      name: "scoring-no-build",
      apply: "build",
      buildStart() { throw new Error("The scoring test configuration is for the local dev server only; it must not be built."); },
    },
  ];
}
