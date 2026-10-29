import { calculateCv, calculateScreening, capSensitivity, type AnswerInput, type CvResult, type ScreeningResult } from "./calculator";
import type { CriterionInput, GateInput, GateResult, ScoringConfig } from "./types";
import type { ClientViewRevision, Provenance, ReviewChange, RubricRef } from "./run";
import type { ScreeningRecord, ScreeningSet } from "./screening";
import type { DecisionRecord } from "./finalReview";
import { buildVersions, type Correction, type Version } from "./versions";

/* What the local scoring server sends (see scripts/scoring/private-data.mjs), and the derived view model.
   The calculator does all arithmetic; this file only arranges inputs and results. */

export interface Evidence { quote: string; page: number; verified?: boolean }
/** `check`: a server rule check on the proposed result (the AI's proposal, the status to show, and why). */
export interface GateRecord { id: string; result: GateResult; basis: "explicit" | "interpretation"; evidence: Evidence[]; explanation: string; check?: { aiProposed: GateResult; status: string; reason: string } }
export interface CriterionRecord {
  id: string; status: "rated" | "unknown" | "disputed"; rating?: number; basis: "explicit" | "interpretation"; detail: "Full" | "Brief" | null;
  evidence: Evidence[]; explanation: string; flags?: string[];
}
export interface ScreeningQuestion { q: string; topic: string; text: string; points: string[]; answer: string | null; status: "rated" | "not-rated"; rating?: number; reason?: string; explanation: string }
/** Evidence status for the client preview: whether the evidence establishes a requirement, recorded per requirement with
    a reason. It is never derived from the numeric rating (a rating is the level shown under the rubric). */
export type EvidenceStatus = "needs-review" | "not-stated" | "claimed" | "separate" | "conflicting";
export interface ClientView {
  summary: string; preparedBy: string; statusRule: string;
  strengths: { text: string; evidence: Evidence[] }[];
  gaps: string[];
  statuses: Record<string, { status: EvidenceStatus; reason?: string }>;
}
export interface AssessmentRecord {
  id: string; kind: "real" | "fictional"; label: string; sourceFile?: string | null; sourceSha256?: string | null;
  configId: string; configVersion: number; producedBy: string; createdAt: string; notice?: string;
  gates: GateRecord[]; criteria: CriterionRecord[];
  otherResults: (Evidence & { type: string })[];
  constraints: { id: string; note: string }[];
  strengths: string[]; gaps: string[]; questions: { q: string; for: string; /** Points a good answer covers, when an answer guide has been prepared (none yet). */ answerPoints?: string[] }[]; manualReview: string[];
  screening: { set: string; questions: ScreeningQuestion[]; askedNotScored: string[] } | null;
  builtInCorrections?: Correction[];
  /** When the candidate was added to the local test (the recorded import time), not a client-sharing date. */
  addedAt?: string | null;
  /** The client view bound to the current assessment state, or null when none is current (stale or never reviewed). */
  clientView?: (ClientView & { revision?: number }) | null;
  disputedIllustration?: { criterionId: string; note: string };
  consistencyRules?: string[];
  /* From a validated run (src/scoring/run.ts); absent on the fictional example. */
  status?: "valid" | "provisional";
  notes?: string[];
  run?: { runId: string; createdAt: string; resultSha256: string; assessmentFingerprint: string };
  sources?: { extraction: { method: string; tool: string; toolVersion: string; extractedAt: string; extractedAtBasis: string; accuracy: "unverified"; note: string }; roleRequirementsVersion: string };
  /** Reviewer corrections bound to this exact assessment, and those made for earlier inputs (historical, not applied). */
  corrections?: (Correction & { basedOn?: string })[];
  historicalCorrections?: (Correction & { basedOn?: string })[];
  latestVersion?: number;
  latestStateSha?: string;
  rubric?: RubricRef;
  /** Provenance facts, separate from fingerprint integrity; never promoted by a matching hash. */
  provenance?: Provenance;
  /** When no client view is current: the revision a reviewer starts from, what changed since, and which requirements. */
  review?: { baseRevision: number; changes: ReviewChange[]; affected: string[]; changesSha256: string } | null;
  /** W6: the recruiter's final decisions (append-only), when any exist. */
  finalDecisions?: DecisionRecord | null;
  /** W2: the append-only screening record (answers, draft ratings, corrections), when one exists. */
  screeningRecord?: ScreeningRecord | null;
  /** When the current client summary is still the prepared draft: what an initial recruiter review confirms against. */
  initialReview?: { baseRevision: number; changesSha256: string } | null;
  /** Every client-view revision, marked current or historical. */
  clientViews?: (ClientViewRevision & { current: boolean })[];
}
/** An assessment that failed validation on the local server: only its label and the reasons are sent. */
export interface BlockedAssessment {
  id: string; label: string; status: "blocked"; problems: string[]; submissionId: string; addedAt: string | null;
  role: { id: string; title: string; loc: string; summary: string; resp: string[] } | null;
}
export type AssessmentPayload = (AssessmentRecord & { role?: { id: string; title: string; loc: string; summary: string; resp: string[] }; submissionId?: string; intakeId?: string; attempt?: number; cvSha256?: string | null }) | (BlockedAssessment & { intakeId?: string; attempt?: number; cvSha256?: string | null });
export const isBlocked = (a: AssessmentPayload): a is BlockedAssessment => a.status === "blocked";
export interface FrozenResult { assessmentId: string; configId: string; configVersion: number; configSha256: string; frozenAt: string; status: string; points: number; possible: number; score: number | null; band: string | null }
export type LoadedConfig = ScoringConfig & { sha256: string; frozenSha256: string; hashOk: boolean; recordedAt: string; cvsOpenedBefore: boolean };
export interface PrivateData {
  available: boolean; problems: string[];
  configs?: LoadedConfig[]; consistencyRules?: string[]; mappingRule?: string;
  assessments?: AssessmentPayload[]; fictional?: AssessmentRecord | null;
  frozen?: { results: FrozenResult[] } | null; corrections?: Correction[];
  /** Recorded core screening question sets (src/scoring/screening.ts). */
  screeningSets?: ScreeningSet[];
}

export const inputsOf = (a: AssessmentRecord): CriterionInput[] =>
  a.criteria.map((c) => (c.status === "rated" ? { id: c.id, status: "rated", rating: c.rating! } : { id: c.id, status: c.status }));
export const gatesOf = (a: AssessmentRecord): GateInput[] => a.gates.map((g) => ({ id: g.id, result: g.result }));

/** The exact rubric an assessment names (id and version, with an intact fingerprint); never another version. */
export const configFor = (configs: LoadedConfig[] | undefined, a: Pick<AssessmentRecord, "configId" | "configVersion">) =>
  configs?.find((c) => c.id === a.configId && c.version === a.configVersion && c.hashOk) ?? null;

export interface AssessmentView {
  record: AssessmentRecord;
  config: LoadedConfig;
  versions: (Version & { result: CvResult })[];
  versionProblems: string[];
  latest: Version & { result: CvResult };
  sensitivity: ReturnType<typeof capSensitivity>;
  screening: ScreeningResult;
  /** Whether version 1 still calculates to the result frozen when it was created. */
  frozenCheck: "match" | "mismatch" | "not frozen";
  disputedWhatIf: CvResult | null;
}

/** `stored`: the corrections bound to this assessment (the server sends only those as `corrections`). */
export function viewOf(a: AssessmentRecord, config: LoadedConfig, stored: Correction[], frozen: FrozenResult[]): AssessmentView {
  if (a.configId !== config.id || a.configVersion !== config.version) throw new Error(`${a.label}: not calculated under the rubric it names`);
  const corrections = [...(a.builtInCorrections ?? []), ...stored.filter((c) => c.assessmentId === a.id)];
  const { versions, problems } = buildVersions(config, inputsOf(a), corrections, gatesOf(a));
  const withResults = versions.map((v) => ({ ...v, result: calculateCv(config, v.gates, v.inputs) }));
  const latest = withResults[withResults.length - 1];
  const answers: AnswerInput[] | null = a.screening ? a.screening.questions.map((q) => (q.status === "rated" ? { q: q.q, status: "rated", rating: q.rating! } : { q: q.q, status: "not-rated", reason: q.reason ?? "" })) : null;
  const f = frozen.find((x) => x.assessmentId === a.id && x.configId === config.id && x.configVersion === config.version);
  const v1 = withResults[0].result;
  const frozenCheck = !f ? "not frozen" : f.status === v1.status && f.points === v1.points && f.possible === v1.possible && f.score === v1.score && f.band === v1.band && f.configSha256 === config.sha256 ? "match" : "mismatch";
  const d = a.disputedIllustration;
  const disputedWhatIf = d ? calculateCv(config, versions[0].gates, versions[0].inputs.map((i) => (i.id === d.criterionId ? { id: i.id, status: "disputed" } : i))) : null;
  return { record: a, config, versions: withResults, versionProblems: problems, latest, sensitivity: capSensitivity(config, latest.gates, latest.inputs), screening: calculateScreening(config.policy, answers), frozenCheck, disputedWhatIf };
}

/** Plain text for a CV result, used in lists and panels. Never a ranking or a decision. */
export function resultText(r: CvResult): string {
  if (r.status === "scored") return `${r.score} · ${r.band}${r.capApplied ? " (capped)" : ""}`;
  if (r.status === "insufficient") return "Insufficient evidence — no score";
  if (r.status === "disputed") return "Disputed — review required";
  if (r.status === "stopped") return "Must-have not met — stopped";
  return "Invalid inputs — no score";
}
