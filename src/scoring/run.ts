import { calculateCv, type CvResult } from "./calculator";
import type { CriterionInput, GateInput, GateResult, ScoringConfig } from "./types";
import { buildVersions, type Correction } from "./versions";

/* Versioned assessment runs (pure: no file system, clock or network; the caller supplies fingerprints, page texts and a
   hash function). A run input binds one candidate–role assessment to its exact inputs: source CV, JD, role-requirements
   draft, extracted text, rubric, and the structured evidence, ratings and gate results. Validation fails closed: any
   missing or mismatched binding, malformed field or quote not found on its bound page blocks the assessment. Results are
   deterministic and fingerprinted independently of run IDs and timestamps.

   Integrity versus provenance. A matching fingerprint shows a file is byte-for-byte the one that was bound; it says nothing
   about whether the extracted text is an accurate extraction of the PDF, or when a fingerprint was first recorded. Those
   are provenance facts, recorded separately: extraction accuracy is always "unverified" in this version (no reproducible
   extraction record exists), and each source records when its fingerprint was first recorded, or "unknown". A run is
   "provisional" unless every provenance fact is established; no fingerprint check can promote it.

   Quote check: the quote and the bound page text are compared after collapsing every run of whitespace to one space and
   trimming. Nothing else is normalised (case, punctuation and ligatures must match). Finding a quote proves that text is
   present on that page of the bound extraction; it does not prove the interpretation, the rating, or that the extraction
   matches the PDF. */

export const INPUT_SCHEMA = "scoring-run-input/2";
export const RECORD_SCHEMA = "scoring-run-record/2";
export type Hash = (text: string) => string;
export const EVIDENCE_STATUSES = ["needs-review", "not-stated", "claimed", "separate", "conflicting"] as const;
export type EvidenceStatusId = (typeof EVIDENCE_STATUSES)[number];

/** Stable JSON: object keys sorted, arrays in order. Refuses values JSON cannot represent exactly. */
export function canonical(v: unknown): string {
  if (v === null || typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "number") { if (!Number.isFinite(v)) throw new Error("non-finite number"); return JSON.stringify(v); }
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object") return `{${Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  throw new Error(`unsupported value: ${typeof v}`);
}

export const normalise = (s: string) => s.replace(/\s+/g, " ").trim();

/** When a source's fingerprint was first recorded, and on what basis: an ISO date or date-time, or "unknown". */
export interface Recorded { when: string; basis: string }
export interface FileBinding { file: string; sha256: string; recorded: Recorded }
export interface Evidence { quote: string; page: number }
export interface ClientViewContent {
  summary: string;
  strengths: { text: string; evidence: Evidence[] }[];
  gaps: string[];
  statuses: Record<string, { status: EvidenceStatusId; reason?: string }>;
}
export interface RubricRef { id: string; version: number; sha256: string }
/** One change since the client view a reviewer started from. */
/** One change since the client view a reviewer started from: a net rating change, a correction step, or changed inputs. */
export interface ReviewChange { kind: "rating" | "correction" | "inputs"; id?: string; from?: string; to?: string; version?: number; reason?: string; note?: string }
/** Reasons for keeping earlier wording unchanged after the assessment changed. */
export interface Retained { summary?: string; strengths?: string; gaps?: string; statuses?: Record<string, string> }
/** A client-facing summary and evidence statuses, bound to the assessment state and rubric it describes. */
export interface ClientViewRevision {
  revision: number;
  describes: { assessmentFingerprint: string; assessmentVersion: number; stateSha256: string; rubric: RubricRef };
  content: ClientViewContent;
  statusRule: string;
  preparation: { method: string; actor: string; at: string };
  /** For a reviewer revision: the changes the reviewer was shown, and reasons for any wording kept unchanged. */
  review?: { baseRevision: number; changesSha256: string; changes: ReviewChange[]; retained: Retained;
    /** An initial review of the prepared draft, with no assessment change behind it. */
    initial?: boolean;
    /** Strengths held for review that the reviewer actively approved, each with a reason (revisions confirmed after this was added). */
    approvedHeld?: { text: string; reason: string }[] };
  /** For revision 1 after a schema upgrade: why it was re-bound, and the identity it described before. */
  rebinding?: { previousFingerprint: string; reason: string; at: string };
}
export interface RunInput {
  schema: typeof INPUT_SCHEMA;
  assessmentId: string;
  submissionId: string;
  role: { id: string; title: string; loc: string; summary: string; resp: string[] };
  sources: {
    cv: FileBinding;
    jd: FileBinding;
    roleRequirements: FileBinding & { version: string };
    extraction: FileBinding & { method: string; tool: string; toolVersion: string; extractedAt: string; extractedAtBasis: string; accuracy: "unverified"; note: string };
  };
  rubric: RubricRef;
  assessment: {
    gates: { id: string; result: GateResult; basis: string; evidence: Evidence[]; explanation: string; check?: { aiProposed: GateResult; status: string; reason: string } }[];
    criteria: { id: string; status: "rated" | "unknown" | "disputed"; rating?: number; basis: string; detail: string | null; evidence: Evidence[]; explanation: string; flags?: string[] }[];
    otherResults: (Evidence & { type: string })[];
    constraints: { id: string; note: string }[];
    strengths: string[]; gaps: string[]; questions: { q: string; for: string }[]; manualReview: string[];
    screening: null;
    consistencyRules: string[];
  };
  preparation: { method: string; actor: string; at: string; atBasis: string };
  provenanceNotes: string[];
  clientView: ClientViewRevision;
}

export interface RubricCandidate { id: string; version: number; sha256: string; manifestSha256: string; config: ScoringConfig }
export interface ValidationContext {
  /** SHA-256 of a file in the private inputs folder, or null when it does not exist. */
  fileSha(file: string): string | null;
  /** Whitespace-normalised page texts of an extraction file, or null when it does not exist. */
  pages(file: string): string[] | null;
  rubrics: RubricCandidate[];
  hash: Hash;
}
/** Provenance, separate from integrity: each fact is established, or stated as not established. */
export interface Provenance {
  integrity: "all bound files match their fingerprints";
  extractionAccuracy: "unverified";
  sources: { source: string; recorded: Recorded; timing: "before preparation" | "after preparation" | "unknown" }[];
  reasons: string[];
}
export type Validation =
  | { status: "blocked"; problems: string[]; notes: string[] }
  | { status: "valid" | "provisional"; problems: []; notes: string[]; input: RunInput; rubric: ScoringConfig; assessmentFingerprint: string; provenance: Provenance };

/* ---- schema ---------------------------------------------------------------------------------------------------- */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => typeof v === "string" && v.trim() !== "";
const hex = (v: unknown) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const date = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));
const whenOk = (v: unknown) => v === "unknown" || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) && date(v));
function evidenceOk(list: unknown, where: string, p: string[]) {
  if (!Array.isArray(list)) { p.push(`${where}: evidence must be a list`); return; }
  list.forEach((e, i) => { if (!isObj(e) || !str(e.quote) || !Number.isInteger(e.page) || (e.page as number) < 1) p.push(`${where}: evidence ${i + 1} needs a quote and a page number`); });
}
function binding(v: unknown, name: string, p: string[]) {
  if (!isObj(v) || !str(v.file) || !hex(v.sha256)) { p.push(`${name}: a file and its SHA-256 are required`); return; }
  if (!isObj(v.recorded) || !whenOk(v.recorded.when) || !str(v.recorded.basis)) p.push(`${name}: recorded (when: a date or "unknown", basis) is required`);
}
const rubricRefOk = (r: unknown) => isObj(r) && str(r.id) && Number.isInteger(r.version) && hex(r.sha256);

/** Shape checks only (no file access). Problems name fields, never their private content. */
export function schemaProblems(raw: unknown): string[] {
  const p: string[] = [];
  if (!isObj(raw)) return ["the run input is not an object"];
  if (raw.schema !== INPUT_SCHEMA) p.push(`schema must be ${INPUT_SCHEMA}`);
  for (const k of ["assessmentId", "submissionId"]) if (!str(raw[k])) p.push(`${k} is required`);
  const role = raw.role;
  if (!isObj(role) || !str(role.id) || !str(role.title) || typeof role.loc !== "string" || typeof role.summary !== "string" || !Array.isArray(role.resp)) p.push("role (id, title, loc, summary, resp) is required");
  const s = raw.sources;
  if (!isObj(s)) p.push("sources are required");
  else {
    binding(s.cv, "sources.cv", p); binding(s.jd, "sources.jd", p); binding(s.roleRequirements, "sources.roleRequirements", p); binding(s.extraction, "sources.extraction", p);
    if (isObj(s.roleRequirements) && !str(s.roleRequirements.version)) p.push("sources.roleRequirements.version is required");
    const x = s.extraction;
    if (isObj(x)) {
      if (!str(x.method) || !str(x.tool) || !str(x.toolVersion) || !whenOk(x.extractedAt) || !str(x.extractedAtBasis) || typeof x.note !== "string") p.push("sources.extraction needs method, tool, toolVersion, extractedAt (a date or \"unknown\"), extractedAtBasis and note");
      /* No input may declare its own extraction verified: that needs a reproducible extraction record, which does not exist yet. */
      if (x.accuracy !== "unverified") p.push("sources.extraction.accuracy must be \"unverified\": verified extraction needs a reproducible extraction record, which this version does not have");
      if ("verifiedAgainstSource" in x) p.push("sources.extraction.verifiedAgainstSource is not accepted: extraction accuracy cannot be self-declared");
    }
  }
  if (!rubricRefOk(raw.rubric)) p.push("rubric (id, version, sha256) is required");
  const a = raw.assessment;
  if (!isObj(a)) p.push("assessment is required");
  else {
    if (!Array.isArray(a.gates)) p.push("assessment.gates must be a list");
    else a.gates.forEach((g, i) => {
      if (!isObj(g) || !str(g.id) || !["Pass", "Fail", "Unknown"].includes(g.result as string) || !str(g.explanation)) p.push(`gate ${i + 1}: id, result (Pass/Fail/Unknown) and explanation are required`);
      else evidenceOk(g.evidence, `gate ${g.id}`, p);
    });
    if (!Array.isArray(a.criteria)) p.push("assessment.criteria must be a list");
    else a.criteria.forEach((c, i) => {
      if (!isObj(c) || !str(c.id) || !["rated", "unknown", "disputed"].includes(c.status as string) || !str(c.explanation)) p.push(`criterion ${i + 1}: id, status and explanation are required`);
      else { if (c.status === "rated" && !Number.isInteger(c.rating)) p.push(`criterion ${c.id}: a rated criterion needs a whole-number rating`); evidenceOk(c.evidence, `criterion ${c.id}`, p); }
    });
    if (Array.isArray(a.otherResults)) { a.otherResults.forEach((o, i) => { if (!isObj(o) || !str(o.type)) p.push(`other result ${i + 1}: type is required`); }); evidenceOk(a.otherResults, "other results", p); }
    else p.push("assessment.otherResults must be a list");
    for (const k of ["constraints", "strengths", "gaps", "questions", "manualReview", "consistencyRules"]) if (!Array.isArray(a[k])) p.push(`assessment.${k} must be a list`);
    if (a.screening !== null) p.push("assessment.screening must be null: no screening answers are supported in a CV run");
  }
  const prep = raw.preparation;
  if (!isObj(prep) || !str(prep.method) || !str(prep.actor) || !date(prep.at) || !str(prep.atBasis)) p.push("preparation (method, actor, at, atBasis) is required");
  if (!Array.isArray(raw.provenanceNotes)) p.push("provenanceNotes must be a list");
  p.push(...clientViewProblems(raw.clientView, "clientView"));
  return p;
}

/** Shape checks for a client-view revision (content quotes and statuses are checked against the rubric separately). */
export function clientViewProblems(v: unknown, where = "client view"): string[] {
  const p: string[] = [];
  if (!isObj(v)) return [`${where} is required`];
  if (!Number.isInteger(v.revision) || (v.revision as number) < 1) p.push(`${where}: revision must be a whole number from 1`);
  const d = v.describes;
  if (!isObj(d) || !hex(d.assessmentFingerprint) || !Number.isInteger(d.assessmentVersion) || !hex(d.stateSha256) || !rubricRefOk(d.rubric)) p.push(`${where}: describes (assessmentFingerprint, assessmentVersion, stateSha256, rubric) is required`);
  const c = v.content;
  if (!isObj(c) || !str(c.summary) || !Array.isArray(c.strengths) || !Array.isArray(c.gaps) || !isObj(c.statuses)) p.push(`${where}: content (summary, strengths, gaps, statuses) is required`);
  else {
    c.strengths.forEach((s, i) => { if (!isObj(s) || !str(s.text)) p.push(`${where}: strength ${i + 1} needs text`); else { evidenceOk(s.evidence, `${where} strength ${i + 1}`, p); if (Array.isArray(s.evidence) && !s.evidence.length) p.push(`${where}: strength ${i + 1} needs at least one quote`); } });
    c.gaps.forEach((g, i) => { if (!str(g)) p.push(`${where}: gap ${i + 1} is empty`); });
    for (const [k, s] of Object.entries(c.statuses)) if (!isObj(s) || !EVIDENCE_STATUSES.includes(s.status as EvidenceStatusId)) p.push(`${where}: ${k} has an invalid evidence status`);
  }
  if (typeof v.statusRule !== "string") p.push(`${where}: statusRule is required`);
  const prep = v.preparation;
  if (!isObj(prep) || !str(prep.method) || !str(prep.actor) || !date(prep.at)) p.push(`${where}: preparation (method, actor, at) is required`);
  return p;
}

/* ---- fingerprints and results ------------------------------------------------------------------------------------ */

/** The assessment's identity: the bound files, rubric, ratings, gates, evidence and preparation. Provenance metadata (when
    a fingerprint was first recorded, extraction tool notes) is excluded: stating an unknown fact does not change what was
    assessed. The client view is excluded too. */
export const assessmentFingerprint = (input: RunInput, hash: Hash) => {
  const f = (b: FileBinding) => ({ file: b.file, sha256: b.sha256 });
  return hash(canonical({ assessmentId: input.assessmentId, submissionId: input.submissionId, roleId: input.role.id, rubric: input.rubric, assessment: input.assessment,
    sources: { cv: f(input.sources.cv), jd: f(input.sources.jd), roleRequirements: { ...f(input.sources.roleRequirements), version: input.sources.roleRequirements.version }, extraction: f(input.sources.extraction) },
    preparation: { method: input.preparation.method, actor: input.preparation.actor, at: input.preparation.at } }));
};

export const inputsOf = (input: RunInput): CriterionInput[] =>
  input.assessment.criteria.map((c) => (c.status === "rated" ? { id: c.id, status: "rated", rating: c.rating! } : { id: c.id, status: c.status }));
export const gatesOf = (input: RunInput): GateInput[] => input.assessment.gates.map((g) => ({ id: g.id, result: g.result }));

/** The state of one assessment version: its fingerprint, version number, effective ratings and gate results. */
export const stateSha = (fingerprint: string, version: number, inputs: CriterionInput[], gates: GateInput[], hash: Hash) =>
  hash(canonical({ assessmentFingerprint: fingerprint, version, inputs, gates }));

const timingOf = (when: string, prepared: string): Provenance["sources"][number]["timing"] =>
  when === "unknown" ? "unknown" : Date.parse(when) < Date.parse(prepared) ? "before preparation" : "after preparation";

/** Provenance facts, never inferred from fingerprints. Anything not established makes the run provisional. */
export function provenanceOf(input: RunInput): Provenance {
  const s = input.sources, prepared = input.preparation.at;
  const sources = ([["CV", s.cv], ["job description", s.jd], ["role requirements", s.roleRequirements], ["extracted text", s.extraction]] as const)
    .map(([source, b]) => ({ source, recorded: b.recorded, timing: timingOf(b.recorded.when, prepared) }));
  const reasons = ["Extraction accuracy unverified: the extracted text matches its recorded fingerprint, but it has not been shown to be an accurate extraction of the CV."];
  for (const x of sources) if (x.timing !== "before preparation") reasons.push(`The ${x.source} fingerprint was ${x.timing === "unknown" ? "recorded at an unknown time" : "first recorded after the assessment was prepared"}.`);
  return { integrity: "all bound files match their fingerprints", extractionAccuracy: "unverified", sources, reasons };
}

/** The deterministic part of a run: the same validated inputs and rubric always give the same object and fingerprint.
    It holds no run ID or timestamp. */
export function computeRun(input: RunInput, rubric: ScoringConfig, hash: Hash) {
  const fp = assessmentFingerprint(input, hash), r: CvResult = calculateCv(rubric, gatesOf(input), inputsOf(input)), prov = provenanceOf(input);
  const result = {
    schema: RECORD_SCHEMA, assessmentId: input.assessmentId, submissionId: input.submissionId, assessmentFingerprint: fp,
    rubric: input.rubric, provenanceStatus: "provisional", provenanceReasons: prov.reasons,
    v1: { status: r.status, reason: r.reason, points: r.points, possible: r.possible, score: r.score, band: r.band, capApplied: r.capApplied, capReasons: r.capReasons,
      overall: r.overall, critical: r.critical, failedGates: r.failedGates, unknownGates: r.unknownGates, disputed: r.disputed, errors: r.errors },
    v1StateSha256: stateSha(fp, 1, inputsOf(input), gatesOf(input), hash),
  };
  return { result, resultSha256: hash(canonical(result)) };
}

/* ---- validation ------------------------------------------------------------------------------------------------ */

/** Validates a run input against its bound files and rubric. Fails closed; problems never quote private text. */
export function validateRunInput(raw: unknown, ctx: ValidationContext): Validation {
  const schema = schemaProblems(raw), notes: string[] = [];
  if (schema.length) return { status: "blocked", problems: schema, notes };
  const input = raw as RunInput, p: string[] = [];

  /* Rubric: exactly the id and version the assessment names, with matching fingerprints. Never another version. */
  const named = ctx.rubrics.filter((r) => r.id === input.rubric.id && r.version === input.rubric.version);
  if (named.length !== 1) p.push(named.length ? `rubric ${input.rubric.id} v${input.rubric.version} is listed more than once` : `rubric ${input.rubric.id} v${input.rubric.version} is not in the manifest`);
  const rubric = named.length === 1 ? named[0] : null;
  if (rubric && (rubric.sha256 !== rubric.manifestSha256 || rubric.sha256 !== input.rubric.sha256)) p.push(`rubric ${input.rubric.id} v${input.rubric.version} does not match its recorded fingerprint`);

  /* Source files: present, and exactly the bound bytes (integrity only). */
  for (const [name, b] of [["CV", input.sources.cv], ["job description", input.sources.jd], ["role requirements", input.sources.roleRequirements], ["extracted text", input.sources.extraction]] as const) {
    const sha = ctx.fileSha(b.file);
    if (sha === null) p.push(`${name} file is missing`);
    else if (sha !== b.sha256) p.push(`${name} file does not match its recorded fingerprint`);
  }
  if (p.length) return { status: "blocked", problems: p, notes };

  /* Structure against the exact rubric: every gate and included criterion once, nothing else, ratings in range. */
  const cfg = rubric!.config, gateIds = cfg.gates.map((g) => g.id), inc = cfg.criteria.filter((c) => c.included);
  const seenG = input.assessment.gates.map((g) => g.id), seenC = input.assessment.criteria.map((c) => c.id);
  if (seenG.length !== new Set(seenG).size || gateIds.some((g) => !seenG.includes(g)) || seenG.some((g) => !gateIds.includes(g))) p.push("gate results do not match the rubric's must-haves exactly");
  if (seenC.length !== new Set(seenC).size || inc.some((c) => !seenC.includes(c.id)) || seenC.some((c) => !inc.some((x) => x.id === c))) p.push("criteria do not match the rubric's included criteria exactly");
  for (const c of input.assessment.criteria) {
    const d = inc.find((x) => x.id === c.id);
    if (d && c.status === "rated" && (c.rating! < 0 || c.rating! > d.max || d.unavailableLevels?.includes(c.rating!))) p.push(`criterion ${c.id}: rating outside the rubric's available levels`);
  }
  if (input.role.id !== cfg.role.id) p.push("role does not match the rubric's role");

  /* Quotes: each must appear on its stated page of the bound extraction. */
  const pages = ctx.pages(input.sources.extraction.file)!;
  const check = (e: Evidence, where: string) => {
    if (e.page > pages.length) p.push(`${where}: page ${e.page} is beyond the extracted text (${pages.length} pages)`);
    else if (!pages[e.page - 1].includes(normalise(e.quote))) p.push(`${where}: quote not found on page ${e.page}`);
  };
  input.assessment.gates.forEach((g) => g.evidence.forEach((e, i) => check(e, `gate ${g.id} quote ${i + 1}`)));
  input.assessment.criteria.forEach((c) => c.evidence.forEach((e, i) => check(e, `criterion ${c.id} quote ${i + 1}`)));
  input.assessment.otherResults.forEach((e, i) => check(e, `other result ${i + 1}`));
  if (p.length) return { status: "blocked", problems: p, notes };

  /* Integrity passed. Provenance stays provisional: extraction accuracy cannot be verified in this version. */
  const provenance = provenanceOf(input);
  notes.push(...provenance.reasons, ...input.provenanceNotes);
  return { status: "provisional", problems: [], notes, input, rubric: cfg, assessmentFingerprint: assessmentFingerprint(input, ctx.hash), provenance };
}

/** Checks a client-view revision's content against the rubric and the bound extraction. */
export function clientContentProblems(content: ClientViewContent, rubric: ScoringConfig, pages: string[]): string[] {
  const p: string[] = [], ids = [...rubric.gates.map((g) => g.id), ...rubric.criteria.filter((c) => c.included).map((c) => c.id)];
  for (const id of ids) if (!content.statuses[id] || !EVIDENCE_STATUSES.includes(content.statuses[id].status)) p.push(`${id} has no recorded evidence status`);
  for (const k of Object.keys(content.statuses)) if (!ids.includes(k)) p.push(`${k} is not a requirement in this rubric`);
  content.strengths.forEach((s, i) => s.evidence.forEach((e, j) => {
    if (e.page > pages.length || !pages[e.page - 1].includes(normalise(e.quote))) p.push(`strength ${i + 1} quote ${j + 1}: quote not found on page ${e.page}`);
  }));
  return p;
}

/* ---- current state, review and history ---------------------------------------------------------------------- */

type BoundCorrection = Correction & { basedOn?: string };
const correctionText = (s: Correction["previous"]) => (s.status === "gate" ? s.result : stateText({ id: "", ...s } as CriterionInput));
const stateText = (i: CriterionInput | undefined) => (!i ? "—" : i.status === "rated" ? String(i.rating) : i.status === "unknown" ? "Unknown" : "Disputed");

/** The assessment's current state: corrections bound to this exact assessment build the versions; corrections made for
    other inputs are kept aside as historical. A client view is current only if it describes the latest state and the
    exact rubric, and is the latest revision. */
export function currentState(v: Extract<Validation, { input: RunInput }>, corrections: BoundCorrection[], storedViews: ClientViewRevision[], hash: Hash) {
  const fp = v.assessmentFingerprint, mine = corrections.filter((c) => c.assessmentId === v.input.assessmentId);
  const bound = mine.filter((c) => c.basedOn === fp), historicalCorrections = mine.filter((c) => c.basedOn !== fp);
  const { versions, problems } = buildVersions(v.rubric, inputsOf(v.input), bound, gatesOf(v.input));
  const latest = versions[versions.length - 1], gates = latest.gates;
  const latestStateSha = stateSha(fp, latest.version, latest.inputs, gates, hash);
  /* `storedViews` are this assessment's reviewer revisions, in order; revision 1 is the one in the run input. */
  const revisions = [v.input.clientView, ...storedViews];
  const isCurrent = (r: ClientViewRevision) => r.describes.assessmentFingerprint === fp && r.describes.assessmentVersion === latest.version && r.describes.stateSha256 === latestStateSha
    && !!r.describes.rubric && r.describes.rubric.id === v.input.rubric.id && r.describes.rubric.version === v.input.rubric.version && r.describes.rubric.sha256 === v.input.rubric.sha256;
  const views = revisions.map((r) => ({ ...r, current: isCurrent(r) }));
  const lastView = views[views.length - 1];

  /* What changed since the latest revision: the basis a reviewer must see before confirming a new one. */
  const base = revisions[revisions.length - 1], changes: ReviewChange[] = [], affected = new Set<string>();
  if (!lastView.current) {
    if (base.describes.assessmentFingerprint !== fp || base.describes.assessmentVersion > latest.version) {
      changes.push({ kind: "inputs", note: `The assessment inputs changed after revision ${base.revision} was prepared; every part must be reviewed.` });
      for (const g of gates) affected.add(g.id);
      for (const c of latest.inputs) affected.add(c.id);
    } else {
      const from = versions.find((x) => x.version === base.describes.assessmentVersion)!;
      for (const c of latest.inputs) {
        const was = from.inputs.find((x) => x.id === c.id);
        if (stateText(was) !== stateText(c)) { affected.add(c.id); changes.push({ kind: "rating", id: c.id, from: stateText(was), to: stateText(c) }); }
      }
      for (const g of gates) {
        const was = from.gates.find((x) => x.id === g.id)?.result ?? "—";
        if (was !== g.result) { affected.add(g.id); changes.push({ kind: "rating", id: g.id, from: was, to: g.result }); }
      }
      for (const x of versions.filter((x) => x.version > from.version && x.correction)) changes.push({ kind: "correction", id: x.correction!.criterionId, version: x.version, reason: x.correction!.reason, from: correctionText(x.correction!.previous), to: correctionText(x.correction!.next) });
    }
  }
  const review = lastView.current ? null : { baseRevision: base.revision, changes, affected: [...affected], changesSha256: hash(canonical({ baseRevision: base.revision, changes, stateSha256: latestStateSha })) };
  /* An initial review: the current summary is still the prepared draft (no recruiter has confirmed it), with no assessment
     change to review. The token binds a confirmation to this revision and state, so a stale one is refused. */
  const initialReview = lastView.current && lastView.preparation.method !== "reviewer-confirmed"
    ? { baseRevision: lastView.revision, changesSha256: hash(canonical({ kind: "initial", baseRevision: lastView.revision, stateSha256: latestStateSha })) } : null;
  return { fingerprint: fp, versions, versionProblems: problems, latest, latestStateSha, historicalCorrections, clientViews: views, currentClientView: lastView.current ? lastView : null, review, initialReview };
}

/** A reviewer's new revision must not silently re-approve earlier wording after the assessment changed: every part kept
    unchanged needs a recorded reason (summary, strengths, gaps, and each affected requirement's status). */
export function retentionProblems(base: ClientViewContent, next: ClientViewContent, affected: string[], retained: Retained | undefined): string[] {
  const p: string[] = [], r = retained ?? {}, same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
  const reason = (x: unknown) => typeof x === "string" && x.trim().length >= 10;
  if (next.summary.trim() === base.summary.trim() && !reason(r.summary)) p.push("the summary is unchanged: edit it, or give a reason for keeping it");
  if (next.strengths.some((s) => base.strengths.some((b) => same(b, s))) && !reason(r.strengths)) p.push("some strengths are unchanged: edit or remove them, or give a reason for keeping them");
  if (next.gaps.some((g) => base.gaps.includes(g)) && !reason(r.gaps)) p.push("some gaps are unchanged: edit or remove them, or give a reason for keeping them");
  for (const id of affected) if (base.statuses[id] && next.statuses[id] && same(base.statuses[id], next.statuses[id]) && !reason(r.statuses?.[id])) p.push(`${id} changed in the assessment but its evidence status is unchanged: change it, or give a reason for keeping it`);
  return p;
}

/** Problems with a reviewer's approvals of held strengths: each must be a strength kept in the content, once, with a reason. */
export function heldApprovalProblems(approvals: unknown, content: ClientViewContent): string[] {
  if (approvals === undefined) return [];
  if (!Array.isArray(approvals)) return ["approved held strengths must be a list"];
  const p: string[] = [], seen = new Set<string>();
  for (const [i, x] of approvals.entries()) {
    if (!isObj(x) || !str(x.text) || typeof x.reason !== "string") { p.push(`approved held strength ${i + 1} needs its text and a reason`); continue; }
    if (x.reason.trim().length < 10 || x.reason.length > 500) p.push(`approved held strength ${i + 1}: give a short reason (10 to 500 characters)`);
    if (!content.strengths.some((s) => s.text === x.text)) p.push(`approved held strength ${i + 1} is not one of the strengths kept`);
    if (seen.has(x.text as string)) p.push(`approved held strength ${i + 1} is listed twice`);
    seen.add(x.text as string);
  }
  return p;
}

/* Reviewer history is append-only and tamper-evident: each entry carries a hash chained to the previous entry. */
export const chainSha = (previous: string, entry: unknown, hash: Hash) => {
  const { chainSha256: _omit, ...rest } = entry as Record<string, unknown>;
  void _omit;
  return hash(`${previous}\n${canonical(rest)}`);
};
export function chainProblems(entries: unknown[], hash: Hash, name: string): string[] {
  let prev = "";
  for (const [i, e] of entries.entries()) {
    const expected = chainSha(prev, e, hash);
    if ((e as { chainSha256?: string }).chainSha256 !== expected) return [`${name} entry ${i + 1} has been altered or reordered`];
    prev = expected;
  }
  return [];
}
export const appendChained = <T extends object>(entries: T[], entry: T, hash: Hash): T[] => {
  const prev = entries.length ? (entries[entries.length - 1] as { chainSha256?: string }).chainSha256 ?? "" : "";
  return [...entries, { ...entry, chainSha256: chainSha(prev, entry, hash) }];
};
