/* W7 evaluation pack. Local only; no network; prints labels and file names inside the private folder only.

     npm run scoring:eval-pack -- --preview [<candidate id> ...]
       Shows which assessment would be frozen for each named supplied candidate (all four when none is named), or why
       none can be. Writes nothing.
     npm run scoring:eval-pack -- --baseline [<candidate id> ...]
       Records the comparison baseline for each named candidate, before reviewers start. The candidate's assessments are
       grouped as in the recruiter portal (identical recorded CV fingerprint), and the latest one, which the portal shows,
       must be a valid automated draft: a blocked, hand-prepared or ambiguous latest assessment is refused with the reason,
       never replaced by an earlier one. The baseline records the candidate label and exact assessment ID, its version and
       state, the fingerprints of its run input, run record, rules, JD, CV, role requirements and extracted text, and a
       copy of that assessment, covered by a whole-record fingerprint that is checked every time the baseline is read or
       used (change detection, not tamper-proof security). One write-once file per candidate
       (evaluation/w7/baseline/<id>.json): an incomplete or changed baseline is refused, never replaced. The later
       comparison reads the AI assessment from this baseline, not from whichever assessment is current then.
     npm run scoring:eval-pack -- [<candidate id> ...] [--reviewer 1|2] [--draft]
       Writes a blank review sheet for each named candidate (all four when none is named) and reviewer slot (both when
       none is named) to evaluation/w7/reviewer-<n>/<id>.csv, owner-only. A sheet needs that candidate's baseline, with
       the same rules, JD and CV. The sheet holds the rules and source fingerprints only: no AI assessment, no other
       reviewer's answers and no CV text. An existing sheet is never overwritten. --draft writes to evaluation/w7-draft/
       instead (no baseline needed), for reviewing the format.
   Unknown candidate IDs, unknown options and reviewer slots other than 1 or 2 are refused before anything is written. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DEFAULT_DIR, loadPrivateData, loadRubrics, sha256Text, writeNewPrivateJson } from "./private-data.mjs";

export const BASELINE_SCHEMA = "evaluation-baseline/2";
const PACK = "evaluation/w7", DRAFT = "evaluation/w7-draft", SLOTS = ["1", "2"];
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const sha256File = (f) => (fs.existsSync(f) && fs.statSync(f).isFile() ? crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex") : null);

/** The supplied candidates (labelled when the pack was set up), not assessments added later through intake. */
export const suppliedCandidates = (dir) => readJson(path.join(dir, "mapping.json")).candidates.filter((c) => !c.intakeId);

/** Parses the command's arguments against the supplied candidates. Returns { ids, slots, draft, baseline } or { problems }. */
export function parsePackArgs(argv, known) {
  const problems = [], ids = [], slots = [];
  let draft = false, baseline = false, preview = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--reviewer") {
      const s = argv[++i];
      if (s === undefined || s.startsWith("--")) { problems.push("--reviewer needs a slot: 1 or 2"); if (s !== undefined) i--; }
      else if (!SLOTS.includes(s)) problems.push(`unknown reviewer slot "${s}": use 1 or 2`);
      else if (!slots.includes(s)) slots.push(s);
    } else if (a === "--draft") draft = true;
    else if (a === "--baseline") baseline = true;
    else if (a === "--preview") preview = true;
    else if (a.startsWith("-")) problems.push(`unknown option "${a}"`);
    else if (!known.includes(a)) problems.push(`unknown candidate ID "${a}": use ${known.join(", ")}`);
    else if (!ids.includes(a)) ids.push(a);
  }
  if (baseline && (slots.length || draft)) problems.push("--baseline records the baseline only: it takes no --reviewer or --draft");
  if (preview && (slots.length || draft || baseline)) problems.push("--preview only shows the selection: it takes no other option");
  return problems.length ? { problems } : { ids: ids.length ? ids : [...known], slots: slots.length ? slots : [...SLOTS], draft, baseline, preview };
}

const baselineFile = (dir, id) => path.join(dir, PACK, "baseline", `${id}.json`);
const HEX = /^[0-9a-f]{64}$/;
const text = (v) => typeof v === "string" && v.trim().length > 0;
const at = (o, p) => p.split(".").reduce((x, k) => (x && typeof x === "object" ? x[k] : undefined), o);
/** Every field a complete baseline must have, with its check. */
const REQUIRED = [
  ["schema", (v) => v === BASELINE_SCHEMA], ["pack", text], ["recordedAt", text], ["candidate.id", text], ["candidate.label", text],
  ["assessmentId", text], ["preparedHow", text], ["selection.rule", text], ["selection.group", (v) => Array.isArray(v) && v.length > 0],
  ["rules.id", text], ["rules.version", Number.isInteger], ["rules.sha256", (v) => HEX.test(v)],
  ...["runInput", "runRecord", "cv", "jd", "roleRequirements", "extractedText"].flatMap((k) => [[`sources.${k}.file`, text], [`sources.${k}.sha256`, (v) => HEX.test(v)]]),
  ["ai.runId", text], ["ai.runCreatedAt", text], ["ai.resultSha256", (v) => HEX.test(v)], ["ai.assessmentFingerprint", (v) => HEX.test(v)],
  ["ai.version", (v) => Number.isInteger(v) && v >= 1], ["ai.stateSha256", (v) => HEX.test(v)],
  ["ai.assessment.gates", Array.isArray], ["ai.assessment.criteria", Array.isArray], ["ai.assessment.otherResults", Array.isArray], ["ai.assessment.corrections", Array.isArray],
  ["recordSha256", (v) => HEX.test(v)],
];
/** The whole-record fingerprint: every field except the fingerprint itself. Detects a changed, added or removed field;
    it is change detection, not tamper-proof security (anyone who can edit the file can also recompute it). */
const recordSha = (lib, b) => { const { recordSha256, ...rest } = b; return sha256Text(lib.canonical(rest)); };

/** The recorded baseline for one candidate, checked for completeness and against its whole-record fingerprint every time
    it is read; { problems } if it is missing, incomplete or changed. Never repaired or replaced here. */
export function readBaseline(dir, lib, id) {
  const f = baselineFile(dir, id);
  if (!fs.existsSync(f)) return { problems: ["no baseline is recorded for this candidate"] };
  let b; try { b = readJson(f); } catch { return { problems: ["the baseline is not valid JSON"] }; }
  const missing = REQUIRED.filter(([p, ok]) => !ok(at(b, p))).map(([p]) => p);
  if (missing.length) return { problems: [`the baseline is incomplete or malformed (${missing.join(", ")})`] };
  if (b.candidate.id !== id) return { problems: ["the baseline does not belong to this candidate"] };
  if (b.recordSha256 !== recordSha(lib, b)) return { problems: ["the baseline has changed since it was recorded (its whole-record fingerprint does not match)"] };
  return { baseline: b };
}

const preparedHow = (a) => (a.status === "blocked" ? "Unavailable" : /\(ai-proposed\)/.test(a.producedBy) ? "AI draft" : "Prepared by hand with an AI assistant");
const time = (a) => Date.parse(a.status === "blocked" ? a.addedAt ?? "" : a.createdAt || a.addedAt || "");
export const SELECTION_RULE = "The candidate's assessments are grouped as in the recruiter portal (identical recorded CV fingerprint). The latest one, which the portal shows, must be a valid automated (AI) draft; otherwise nothing is selected.";

/** The assessment the recruiter portal shows for a supplied candidate, if it is a valid automated draft and unambiguous:
    { assessment, group } or { problems }. An earlier hand-prepared or automated assessment is never used instead. */
export function selectAssessment(data, lib, candidateId) {
  const supplied = new Set(data.assessments.filter((a) => !a.intakeId).map((a) => a.id));
  const g = lib.groupCandidates(data.assessments).find((x) => x.items.some((a) => a.id === candidateId));
  if (!g) return { problems: ["no assessment is recorded for this candidate"] };
  const group = g.items.map((a) => ({ assessmentId: a.id, preparedHow: preparedHow(a), status: a.status, createdAt: a.status === "blocked" ? null : a.createdAt }));
  if (!g.key.startsWith("cv:")) return { problems: ["this candidate's CV fingerprint is not recorded, so its assessments cannot be grouped"], group };
  if (g.items.filter((a) => supplied.has(a.id)).length > 1) return { problems: ["more than one supplied candidate has this identical CV; which one is meant is ambiguous"], group };
  const latest = g.latest, blocked = g.items.filter((a) => a.status === "blocked");
  /* A blocked assessment has no trustworthy preparation time (the portal orders it by when its CV was added), so it may be
     newer than the one shown: refuse rather than guess. */
  if (blocked.length && blocked.some((a) => a !== latest)) return { problems: [`an assessment of this CV is blocked (${blocked.map((a) => `${a.id}: ${a.problems.join("; ")}`).join(" | ")}), so which assessment is the latest cannot be confirmed`], group };
  if (g.items.some((a) => a !== latest && time(a) === time(latest)) || Number.isNaN(time(latest))) return { problems: ["the latest assessment cannot be identified: two assessments have the same time, or a time is missing"], group };
  if (latest.status === "blocked") return { problems: [`the latest assessment shown for this candidate (${latest.id}) is blocked: ${latest.problems.join("; ")}`], group };
  if (preparedHow(latest) !== "AI draft") return { problems: [`the latest assessment shown for this candidate (${latest.id}) is not an automated draft; an earlier assessment is not used instead`], group };
  return { assessment: latest, group };
}

/** What the baseline records for the selected assessment: everything the comparison needs to use exactly this version. */
function baselineOf(dir, cand, sel, now) {
  const a = sel.assessment, input = readJson(path.join(dir, "runs/inputs", `${a.id}.input.json`)), src = input.sources;
  return {
    schema: BASELINE_SCHEMA, pack: "W7", recordedAt: now,
    note: "Recorded before reviewers start. The comparison uses this AI assessment, not whichever one is current later. Not for reviewers.",
    candidate: { id: cand.id, label: cand.label }, assessmentId: a.id, preparedHow: preparedHow(a),
    selection: { rule: SELECTION_RULE, group: sel.group },
    rules: { id: input.rubric.id, version: input.rubric.version, sha256: input.rubric.sha256 },
    sources: {
      runInput: { file: `runs/inputs/${a.id}.input.json`, sha256: sha256File(path.join(dir, "runs/inputs", `${a.id}.input.json`)) },
      runRecord: { file: `runs/records/${a.run.runId}.json`, sha256: sha256File(path.join(dir, "runs/records", `${a.run.runId}.json`)) },
      cv: { file: src.cv.file, sha256: src.cv.sha256 }, jd: { file: src.jd.file, sha256: src.jd.sha256 },
      roleRequirements: { file: src.roleRequirements.file, sha256: src.roleRequirements.sha256, version: src.roleRequirements.version },
      extractedText: { file: src.extraction.file, sha256: src.extraction.sha256 },
    },
    ai: { runId: a.run.runId, runCreatedAt: a.run.createdAt, resultSha256: a.run.resultSha256, assessmentFingerprint: a.run.assessmentFingerprint, version: a.latestVersion, stateSha256: a.latestStateSha,
      assessment: { gates: a.gates, criteria: a.criteria, otherResults: a.otherResults, corrections: a.corrections, producedBy: a.producedBy, preparedAt: a.createdAt } },
  };
}

/** The selection for each named candidate, without writing anything (labels and assessment IDs only). */
export function previewSelection(dir, lib, ids) {
  const data = loadPrivateData(dir, lib), labels = new Map(suppliedCandidates(dir).map((c) => [c.id, c.label]));
  return ids.map((id) => { const s = selectAssessment(data, lib, id); return { id, label: labels.get(id) ?? id, assessmentId: s.assessment?.id ?? null, problems: s.problems ?? [], group: s.group ?? [] }; });
}

/** Records the baseline for each named candidate (write-once). Returns one line per candidate. */
export function recordBaselines(dir, lib, ids, now = new Date().toISOString()) {
  const data = loadPrivateData(dir, lib), cands = new Map(suppliedCandidates(dir).map((c) => [c.id, c])), out = [];
  for (const id of ids) {
    const cand = cands.get(id), label = cand?.label ?? id, f = baselineFile(dir, id);
    if (fs.existsSync(f)) {
      const r = readBaseline(dir, lib, id);
      out.push(r.problems ? { id, ok: false, line: `${label}: NOT RECORDED — a baseline file exists but ${r.problems.join("; ")}; it is kept for inspection and not replaced` }
        : { id, ok: true, line: `${label}: kept — baseline already recorded (${path.relative(dir, f)})` });
      continue;
    }
    const sel = selectAssessment(data, lib, id);
    if (sel.problems) { out.push({ id, ok: false, line: `${label}: NOT RECORDED — ${sel.problems.join("; ")}` }); continue; }
    const b = baselineOf(dir, cand, sel, now);
    b.recordSha256 = recordSha(lib, b);
    writeNewPrivateJson(f, b);
    out.push({ id, ok: true, line: `${label}: baseline recorded — assessment ${b.assessmentId}, version ${b.ai.version}, run ${b.ai.runId} (${path.relative(dir, f)})` });
  }
  return out;
}

/** How the current records differ from the baseline, in plain words (empty when unchanged). The baseline still applies. */
export function baselineDrift(dir, lib, id) {
  const r = readBaseline(dir, lib, id);
  if (r.problems) return r.problems;
  const b = r.baseline, data = loadPrivateData(dir, lib), sel = selectAssessment(data, lib, id), d = [];
  if (sel.problems) d.push(`the portal's current assessment for this candidate cannot be used: ${sel.problems.join("; ")}`);
  else if (sel.assessment.id !== b.assessmentId) d.push(`the portal now shows a different assessment (${sel.assessment.id}; baseline: ${b.assessmentId})`);
  const a = data.assessments.find((x) => x.id === b.assessmentId);
  if (!a || a.status === "blocked") { d.push(`the baseline's assessment (${b.assessmentId}) is now blocked or missing`); return d; }
  if (a.run.assessmentFingerprint !== b.ai.assessmentFingerprint) d.push("the baseline's assessment has been replaced since the baseline");
  if (a.latestVersion !== b.ai.version || a.latestStateSha !== b.ai.stateSha256) d.push(`the baseline's assessment is now version ${a.latestVersion} (baseline: version ${b.ai.version})`);
  if (a.configId !== b.rules.id || a.configVersion !== b.rules.version) d.push("the assessment now uses different rules");
  return d;
}

/** Writes the blank sheets for the named candidates and slots. Never overwrites; outside --draft, needs a matching baseline. */
export function writeSheets(dir, lib, { ids, slots, draft }, now = new Date().toISOString()) {
  const cands = new Map(suppliedCandidates(dir).map((c) => [c.id, c])), rubrics = loadRubrics(dir), out = [];
  for (const id of ids) {
    const cand = cands.get(id), label = cand.label, r = draft ? null : readBaseline(dir, lib, id), problems = [];
    if (r?.problems) { out.push({ id, ok: false, line: `${label}: NOT WRITTEN — ${r.problems.join("; ")}: record it first with --baseline` }); continue; }
    /* The sheet uses the rules and sources of the assessment the baseline froze (a format draft: the supplied one). */
    const input = readJson(path.join(dir, "runs/inputs", `${r ? r.baseline.assessmentId : id}.input.json`));
    const rubric = rubrics.find((x) => x.id === input.rubric.id && x.version === input.rubric.version);
    if (!rubric?.config || rubric.sha256 !== rubric.manifestSha256) problems.push("the assessment rules do not match their recorded fingerprint");
    for (const k of ["cv", "jd"]) if (sha256File(path.join(path.dirname(dir), input.sources[k].file)) !== input.sources[k].sha256) problems.push(`the ${k.toUpperCase()} does not match its recorded fingerprint`);
    if (r && (r.baseline.rules.sha256 !== rubric?.sha256 || r.baseline.sources.cv.sha256 !== input.sources.cv.sha256 || r.baseline.sources.jd.sha256 !== input.sources.jd.sha256))
      problems.push("the rules, JD or CV differ from the baseline");
    /* Reviewers are pointed at the supplied CV file, which must be the identical file (same fingerprint). */
    const suppliedCv = { file: cand.sourceFile, sha256: cand.sha256 };
    if (cand.sha256 !== input.sources.cv.sha256 || sha256File(path.join(path.dirname(dir), cand.sourceFile)) !== cand.sha256) problems.push("the supplied CV file is not the identical file the assessment used");
    if (problems.length) { out.push({ id, ok: false, line: `${label}: NOT WRITTEN — ${problems.join("; ")}` }); continue; }
    for (const slot of slots) {
      const file = path.join(dir, draft ? DRAFT : PACK, `reviewer-${slot}`, `${id}.csv`), rel = path.relative(dir, file);
      if (fs.existsSync(file)) { out.push({ id, slot, ok: true, line: `${label}, Reviewer ${slot}: kept — ${rel} already exists` }); continue; }
      const csv = lib.blankSheet(rubric.config, { candidate: label, reviewerSlot: `Reviewer ${slot}`, cv: suppliedCv, jd: input.sources.jd,
        roleRequirementsVersion: input.sources.roleRequirements.version, rulesSha256: rubric.sha256,
        screeningAnswers: fs.existsSync(path.join(dir, "screening", `${id}.json`)), generatedAt: now });
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(file, csv, { mode: 0o600, flag: "wx" });
      out.push({ id, slot, ok: true, line: `${label}, Reviewer ${slot}: written — ${rel}` });
    }
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const dir = path.resolve(process.env.SCORING_PRIVATE_DIR || DEFAULT_DIR);
  const opts = parsePackArgs(process.argv.slice(2), suppliedCandidates(dir).map((c) => c.id));
  if (opts.problems) { for (const p of opts.problems) console.log(`REFUSED — ${p}`); console.log("Nothing was written."); process.exit(2); }
  const { withPackLib } = await import("./lib.mjs");
  const out = await withPackLib((lib) => (opts.preview
    ? previewSelection(dir, lib, opts.ids).map((p) => ({ ok: !p.problems.length, line: `${p.label}: ${p.assessmentId ? `would freeze ${p.assessmentId}` : `NONE — ${p.problems.join("; ")}`} · group: ${p.group.map((g) => `${g.assessmentId} (${g.preparedHow})`).join(", ")}` }))
    : opts.baseline ? recordBaselines(dir, lib, opts.ids) : writeSheets(dir, lib, opts)));
  for (const o of out) console.log(o.line);
  process.exit(out.some((o) => !o.ok) ? 1 : 0);
}
