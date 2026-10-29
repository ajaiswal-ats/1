import type { PrivateData } from "./model";
import type { Correction } from "./versions";

/* The only requests the scoring page makes: same-origin calls to the local scoring server. Nothing goes to Supabase,
   Manatal, Fireflies or any other service (the page's Content-Security-Policy also allows only its own origin). */

export async function loadData(): Promise<PrivateData> {
  const r = await fetch("/__scoring/data", { cache: "no-store" });
  if (!r.ok) return { available: false, problems: ["Private scoring data is served only by the local scoring server (npm run scoring:dev)."] };
  return r.json() as Promise<PrivateData>;
}

type Expected = { assessmentFingerprint: string; assessmentVersion: number; stateSha256: string };
export async function saveCorrection(c: Omit<Correction, "at"> & { basedOn: string; expected: Expected }): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const r = await fetch("/__scoring/corrections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
  if (r.status === 201) return { ok: true };
  const body = (await r.json().catch(() => ({}))) as { problems?: string[]; error?: string };
  return { ok: false, problems: body.problems ?? [body.error ?? `Not saved (HTTP ${r.status}).`] };
}

/** Binds a reviewed client summary and evidence statuses to the current assessment state. */
export async function saveClientView(body: { assessmentId: string; describes: Expected & { rubric: { id: string; version: number; sha256: string } }; changesSha256: string; content: unknown; retained: unknown; reviewer: string; confirmed: boolean; approvedHeld?: { text: string; reason: string }[] }): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const r = await fetch("/__scoring/client-view", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (r.status === 201) return { ok: true };
  const b = (await r.json().catch(() => ({}))) as { problems?: string[]; error?: string };
  return { ok: false, problems: b.problems ?? [b.error ?? `Not saved (HTTP ${r.status}).`] };
}

export async function resetCorrections(): Promise<string | null> {
  const r = await fetch("/__scoring/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: "scoring-test-reviewer-corrections" }) });
  if (!r.ok) throw new Error(`Reset failed (HTTP ${r.status}).`);
  return ((await r.json()) as { archived: string | null }).archived;
}

/* ---- CV intake and AI-proposed assessment (local recruiter workflow) ---- */

export interface IntakeRun { runId: string; at: string; route: string; isAi: boolean; models: string[]; outcome: "valid" | "invalid" | "failed"; problems: string[]; warnings: string[]; assessmentId: string | null; durationMs: number | null }
export interface IntakeSummary {
  id: string; label: string; role: { id: string; version: number }; uploadedAt: string;
  extraction: { status: "completed" | "failed" | "missing"; pages?: number; messages: string[] };
  blinding: { replacements: number; itemsToCheck: number } | null;
  review: { status: "matches" | "differences" | "partly" | "not reviewed"; by: string | null; on: string | null; notes: string };
  runs: IntakeRun[];
  /** The latest background assessment job for this CV (local), or null. */
  job?: AssessmentJob | null;
}
export interface AssessmentJob { jobId: string; state: "queued" | "processing" | "ready" | "failed"; createdAt: string; startedAt: string | null; finishedAt: string | null; assessmentId: string | null; runId: string | null; error: string | null; problems: string[] }
export interface IntakeOverview {
  route: { configured: true; label: string; isAi: boolean } | { configured: false; reason: string };
  roles: { id: string; version: number; title: string; location: string; approved: boolean; intact: boolean; roleSetup: string }[];
  intakes: IntakeSummary[];
}
type Problems = { ok: false; problems: string[] };
const problemsOf = async (r: Response): Promise<Problems> => { const b = (await r.json().catch(() => ({}))) as { problems?: string[]; error?: string }; return { ok: false, problems: b.problems ?? [b.error ?? `Not done (HTTP ${r.status}).`] }; };

export async function loadIntakes(): Promise<IntakeOverview | null> {
  const r = await fetch("/__scoring/intake", { cache: "no-store" });
  return r.ok ? ((await r.json()) as IntakeOverview) : null;
}
export async function addCv(file: File, role: { id: string; version: number }): Promise<{ ok: true; intake: IntakeSummary } | Problems> {
  const r = await fetch("/__scoring/intake", { method: "POST", headers: { "Content-Type": "application/pdf", "X-Role-Id": role.id, "X-Role-Version": String(role.version), "X-File-Name": encodeURIComponent(file.name) }, body: file });
  return r.status === 201 ? { ok: true, intake: (await r.json()) as IntakeSummary } : problemsOf(r);
}
export async function intakeText(id: string): Promise<{ pages: { page: number; text: string; blinded: string; messages: string[] }[] }> {
  const r = await fetch(`/__scoring/intake/${id}/text`, { cache: "no-store" });
  return r.ok ? r.json() : { pages: [] };
}
export async function reviewText(id: string, body: { reviewer: string; result: "matches" | "differences found"; notes: string }): Promise<{ ok: true } | Problems> {
  const r = await fetch(`/__scoring/intake/${id}/extraction-review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.status === 201 ? { ok: true } : problemsOf(r);
}
/** Starts a background assessment job, or returns the one already running for this CV. Answers at once. */
export async function assessCv(id: string, confirmNew = false): Promise<{ ok: true; job: AssessmentJob; duplicate: boolean } | Problems> {
  const r = await fetch(`/__scoring/intake/${id}/assess`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmNew }) });
  const b = (await r.json().catch(() => ({}))) as { job?: AssessmentJob; duplicate?: boolean; problems?: string[]; error?: string };
  if ((r.status === 202 || r.status === 200) && b.job) return { ok: true, job: b.job, duplicate: !!b.duplicate };
  return { ok: false, problems: b.problems ?? [b.error ?? `Not started (HTTP ${r.status}).`] };
}

/* W2: screening answers, draft ratings and corrections (local scoring server; append-only; stale saves are refused). */
type ScreeningResult = { ok: true; revision: number; dropped?: { questionId: string; problem: string }[] } | { ok: false; problems: string[]; needsConfirm?: boolean };
async function screeningPost(kind: "answers" | "propose" | "correct" | "summarise" | "summary" | "claims" | "claim-decision", body: Record<string, unknown>): Promise<ScreeningResult> {
  const r = await fetch(`/__scoring/screening/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const b = (await r.json().catch(() => ({}))) as { revision?: number; dropped?: { questionId: string; problem: string }[]; problems?: string[]; error?: string; needsConfirm?: boolean };
  return r.status === 201 ? { ok: true, revision: b.revision!, dropped: b.dropped } : { ok: false, problems: b.problems ?? [b.error ?? `Not saved (HTTP ${r.status}).`], needsConfirm: b.needsConfirm };
}
export const saveScreeningAnswers = (body: { assessmentId: string; expectedRevision: number; set: { id: string; version: number; sha256: string }; answers: Record<string, string>; followUps: Record<string, string>; excerpt: string; excerptFor: string[]; by: string }) => screeningPost("answers", body);
export const proposeScreeningRatings = (body: { assessmentId: string; expectedRevision: number; confirmCost?: boolean }) => screeningPost("propose", body);
export const summariseScreening = (body: { assessmentId: string; expectedRevision: number; confirmCost?: boolean }) => screeningPost("summarise", body);
export const confirmScreeningSummary = (body: { assessmentId: string; expectedRevision: number; content: unknown; reviewer: string; confirmed: boolean; basedOnRevision: number | null }) => screeningPost("summary", body);
export const prepareClaimCheck = (body: { assessmentId: string; expectedRevision: number; confirmCost?: boolean }) => screeningPost("claims", body);
export const decideClaim = (body: { assessmentId: string; expectedRevision: number; claimReviewRevision: number; itemId: string; decision: "accepted" | "dismissed"; reason: string; reviewer: string }) => screeningPost("claim-decision", body);
export const correctScreeningRating = (body: { assessmentId: string; expectedRevision: number; questionId: string; rating: number | null; quote: string; reason: string; reviewer: string }) => screeningPost("correct", body);

/* W6: the recruiter's final decision (append-only; stale saves refused). Records a decision only: nothing is moved or published. */
export async function saveFinalDecision(body: { assessmentId: string; expectedRevision: number; expected: Expected; expectedScreeningKey: string; decision: string; reason: string; reviewer: string; acknowledgedOpenItems: boolean }): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const r = await fetch("/__scoring/final-decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (r.status === 201) return { ok: true };
  const b = (await r.json().catch(() => ({}))) as { problems?: string[]; error?: string };
  return { ok: false, problems: b.problems ?? [b.error ?? `Not saved (HTTP ${r.status}).`] };
}
