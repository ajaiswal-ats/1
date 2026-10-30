import { calculateCv, configProblems } from "../scoring/calculator";
import type { CriterionInput, GateInput, ScoringConfig } from "../scoring/types";
import type { DbEvidenceStatus } from "../workspace/data";

export interface Inputs { gates: GateInput[]; criteria: CriterionInput[] }
export interface Question { id: string; text: string; use: "scored" | "confirms"; answerPoints: string[] }
export interface Answer { id: string; question: string; answer: string; rating: number | null; quote: string; reason: string }
export interface Requirement { id: string; text: string; tier: "must" | "pref" }
export interface SharedEvidence { requirementId: string; status: DbEvidenceStatus | ""; evidence: string; source: string }
export interface Change { id: string; source: "cv" | "screening"; evidence: string; reason: string }
export interface Review {
  decision: "forward" | "hold" | "decline"; decisionReason: string;
  whyShared: string; strengths: string[]; pointsToClarify: string[]; setId: string | null;
  evidence: SharedEvidence[]; screening: Answer[]; changes: Change[];
}
export interface AssessmentRow {
  id: string; candidate: string; client: string; role: string; revision: number;
  reviewed: boolean | null; published: boolean | null; updatedAt: string;
}
export interface Assessment extends Omit<AssessmentRow, "updatedAt"> {
  submissionId: string; rubric: ScoringConfig; inputs: Inputs; originalInputs: Inputs;
  evidence: Record<string, { quote: string; page: number }[]>; preparedBy: string;
  screeningQuestions: Question[]; review: Review | null; setId: string | null; requirements: Requirement[];
  history: { revision: number; kind: "review" | "share"; reviewer: string; reason: string; at: string; changes?: Change[] }[];
}
export interface Recruiter { userId: string; displayName: string }
export interface Gateway {
  account(): Promise<Recruiter | null>;
  list(): Promise<AssessmentRow[]>;
  get(id: string): Promise<Assessment>;
  save(assessment: Assessment, inputs: Inputs, review: Review, reason: string): Promise<void>;
  share(assessment: Assessment): Promise<void>;
}
export interface RpcClient {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}

const MESSAGES: Record<string, string> = {
  assessment_changed_reload: "This assessment changed since you opened it. Reload it before saving or sharing.",
  recruiter_access_required: "Recruiter access is not available for this account or client.",
  assessment_unavailable: "This assessment is not available to your account.",
  scoring_rules_await_approval: "The scoring rules still need approval. Your review can be saved, but the summary cannot be shared yet.",
  agreed_requirements_changed: "The agreed requirements changed. Reload and review the requirement evidence again.",
  summary_already_shared: "This version has already been shared with the client.",
  submission_not_shared: "This candidate has not been shared with the client. Share the candidate through the existing process first.",
  client_package_withdrawn: "This submission has a withdrawn client package. Recruiter sharing cannot reinstate it. Nothing was published.",
  map_every_agreed_requirement: "Review the evidence for every agreed requirement before sharing.",
  review_evidence_and_source_required: "Each requirement needs reviewed evidence and a source, unless it is not evidenced.",
  client_summary_required: "Write why this candidate is being shared and complete the client summary.",
  existing_client_content_needs_review: "Sharing stopped: existing key facts or reviewed screening summary need a publication-owner review for this assessment and the current requirements. Nothing was replaced.",
  essential_not_met: "An essential requirement is not met. Choose Hold or Do not put forward.",
  candidate_not_ready_to_share: "Resolve essential requirements and conflicting evidence, then record Put forward before sharing.",
  resolve_conflicting_evidence: "Resolve conflicting CV evidence before choosing Put forward.",
  each_correction_needs_evidence_and_reason: "Every changed rating or essential check needs its evidence and a reason.",
  screening_cannot_raise_cv_rating: "Screening evidence can lower a CV rating; new information stays in the screening assessment.",
  screening_rating_needs_answer_quote_and_reason: "Each screening rating needs a quote copied from its answer and a reason.",
  invalid_summary_items: "Use up to 20 strengths and 20 points to clarify, with 1–300 characters per item.",
  invalid_review_fields: "Some review fields are incomplete or invalid. Check the client summary and reload if needed.",
  invalid_requirement_evidence: "Check the requirement evidence and source lengths before saving.",
  review_reason_and_decision_required: "Choose a decision and write a review reason and decision reason of 10–2,000 characters each.",
};

export function createGateway(client: RpcClient): Gateway {
  async function call(name: string, args?: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await client.rpc(name, args);
    if (error) {
      if (["PGRST202", "42883"].includes(error.code ?? "")) throw new Error("The recruiter workspace is not configured on this database yet. Its database migration must be reviewed and applied separately.");
      throw new Error(MESSAGES[error.message ?? ""] ?? "The request could not be completed. Reload to check whether it was saved before trying again.");
    }
    return data;
  }
  return {
    async account() {
      const data = await call("recruiter_account") as Recruiter | null;
      if (data !== null && (!data.userId || !data.displayName)) throw new Error("Recruiter access could not be checked.");
      return data;
    },
    async list() {
      const data = await call("recruiter_assessments");
      if (!Array.isArray(data) || data.some((x) => !x || typeof x.id !== "string" || typeof x.candidate !== "string" || typeof x.client !== "string" || typeof x.role !== "string")) throw new Error("The assessment list could not be read.");
      return data as AssessmentRow[];
    },
    async get(id) { return checkAssessment(await call("recruiter_assessment", { p_id: id })); },
    async save(a, inputs, review, reason) {
      await call("recruiter_save_review", { p_id: a.id, p_expected_revision: a.revision, p_inputs: inputs, p_review: review, p_reason: reason });
    },
    async share(a) { await call("recruiter_share_summary", { p_id: a.id, p_expected_revision: a.revision }); },
  };
}

/** Refuse incomplete or mismatched records; never substitute a different rubric or example assessment. */
export function checkAssessment(value: unknown): Assessment {
  const a = value as Assessment;
  try {
    if (!a || typeof a.id !== "string" || !Number.isInteger(a.revision) || a.revision < 1
      || !a.rubric || !Array.isArray(a.rubric.criteria) || !Array.isArray(a.rubric.gates)
      || !Array.isArray(a.requirements) || !Array.isArray(a.screeningQuestions) || !Array.isArray(a.history)
      || !a.evidence || configProblems(a.rubric).length
      || calculateCv(a.rubric, a.inputs.gates, a.inputs.criteria).status === "invalid"
      || calculateCv(a.rubric, a.originalInputs.gates, a.originalInputs.criteria).status === "invalid") throw new Error();
    return a;
  } catch { throw new Error("The assessment is incomplete or its scoring rules do not match. Nothing has been substituted."); }
}

export function initialReview(a: Assessment): Review {
  const r = a.review;
  return {
    decision: r?.decision ?? "hold", decisionReason: r?.decisionReason ?? "", whyShared: r?.whyShared ?? "",
    strengths: r?.strengths ?? [], pointsToClarify: r?.pointsToClarify ?? [], setId: a.setId,
    evidence: a.requirements.map((q) => (r?.setId === a.setId ? r.evidence.find((e) => e.requirementId === q.id) : null)
      ?? { requirementId: q.id, status: "", evidence: "", source: "" }),
    screening: a.screeningQuestions.map((q) => r?.screening.find((x) => x.id === q.id)
      ?? { id: q.id, question: q.text, answer: "", rating: null, quote: "", reason: "" }),
    changes: [],
  };
}

export function shareProblems(a: Assessment): string[] {
  const p: string[] = [], r = a.review;
  if (!a.rubric.approved) p.push("Scoring rules await approval.");
  if (!a.reviewed || !r) p.push("Save a recruiter review of the current assessment.");
  if (a.published || a.history.some((h) => h.kind === "share" && h.revision === a.revision)) p.push("This version has already been shared.");
  if (r?.decision !== "forward") p.push("Record a decision to put the candidate forward.");
  if (a.inputs.gates.some((g) => g.result === "Fail")) p.push("An essential requirement is not met.");
  if (a.inputs.criteria.some((c) => c.status === "disputed")) p.push("Conflicting CV evidence needs resolving.");
  if (!a.setId || r?.setId !== a.setId || !a.requirements.length) p.push("Review the role's current agreed requirements.");
  if (!r?.whyShared.trim()) p.push("Write why the candidate is being shared.");
  if (a.requirements.some((q) => { const e = r?.evidence.find((x) => x.requirementId === q.id); return !e?.status || !e.evidence.trim() || (e.status !== "not_evidenced" && !e.source.trim()); })) p.push("Complete the evidence and sources for every agreed requirement.");
  return p;
}
