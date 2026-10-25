/* Client actions in the Supabase portal, without React: stage changes (client_move_stage), and from milestone 2 the
   client decisions decline (client_decline) and interview feedback (client_add_feedback).
   Rules:
   * One idempotency key per intended action (submission, action and its content, the version the user saw). Every retry
     of that action reuses the same key and the same request, so the server applies it at most once and returns the first result.
   * Success is shown only when the server confirms it; then the lists are refreshed from the database.
   * A stale version is a conflict: the data is refreshed and the user decides again. It is never retried against the
     newer version automatically.
   * No answer (network failure, timeout, server unavailable) is an uncertain outcome, not a failure: the same request is
     sent again once automatically, then on request ("Check again").
   * Only one move is in progress at a time, and a second click while saving does nothing.
   * Sign-out or a change of account discards everything in progress; late answers are ignored.
   Saving a stage or a decision notifies nobody and does not update Manatal: neither is connected. A saved decision is the
   portal's own record; it carries no delivery status. */
import type { Stage } from "../data/fixtures";
import type { DbRole, DbSubmission } from "./data";

export type MoveTarget = Exclude<Stage, "Declined">;
export type ActionKind = "move" | "decline" | "feedback";
/** One intended action. `toStage` is the stage the server must report afterwards: the move's target, Declined for a
    decline, or the unchanged current stage for feedback. Decision text is sent to the server only, never recorded. */
export interface MoveRequest {
  action?: ActionKind; submissionId: string; toStage: Stage; expectedVersion: number; key: string; seenStage?: Stage;
  note?: string; category?: string | null; about?: string | null; text?: string;
  /** Interview feedback for this round (milestone 4): it completes the round's feedback task. Without it, feedback is general. */
  interviewId?: string | null;
}
export type Intent = { action: "move"; toStage: MoveTarget } | { action: "decline"; note: string; category: string | null }
  | { action: "feedback"; about: string | null; text: string; interviewId?: string | null };
/** Development-only test-run record entry (see scripts/dev/move-record-lib.mjs). No session token or password is ever in it. */
export type MoveRecordEntry =
  | { phase: "sent"; action: ActionKind; key: string; submission_id: string; expected_version: number; seen_stage: Stage | undefined; to_stage: Stage; attempt: number }
  | { phase: "outcome"; key: string; submission_id: string; outcome: string };
export interface MoveResult { submission_id: string; stage: string; version: number; event_id: number; note_id?: string; interview_id?: string }
/** What one call of client_move_stage came back with. `uncertain`: no usable answer, so it may or may not have been saved. */
export type RpcOutcome = { kind: "ok"; result: MoveResult } | { kind: "error"; code: string } | { kind: "uncertain" };
export type MoveRpc = (r: MoveRequest) => Promise<RpcOutcome>;

export type MoveState =
  | { status: "idle" }
  | { status: "saving"; account: string; request: MoveRequest; attempt: number }
  | { status: "uncertain"; account: string; request: MoveRequest }
  | { status: "saved"; account: string; submissionId: string; action: ActionKind; toStage: Stage }
  | { status: "conflict"; account: string; submissionId: string }
  | { status: "failed"; account: string; submissionId: string; message: string };

export const MOVE_MESSAGES = {
  conflict: "This candidate changed since you opened the page. The latest stage is shown now. Review it, then choose again.",
  notPermitted: "This change is not allowed for this candidate right now. The latest information is shown now.",
  notFound: "This candidate is no longer available to you. The latest information is shown now.",
  access: "Your access to this workspace has changed. Sign out, then sign in again.",
  other: "The change could not be saved. Nothing was changed. Try again, or contact your Revenue Optics recruiter.",
  unexpected: "The server's answer did not match the change you asked for. The latest information is shown now.",
  notRecorded: "Development test-run record could not be saved, so the change was not sent.",
};

/** PROVISIONAL development rule, mirroring client_move_stage (not production-approved; decision D3): open roles only,
    no moves out of Offer, Hired or Declined, and any other stage including Offer and Hired. The server decides. */
export function moveTargets(sub: DbSubmission, role: DbRole): MoveTarget[] {
  if (role.status !== "Open" || sub.stage === "Offer" || sub.stage === "Hired" || sub.stage === "Declined") return [];
  return (["To review", "Interview", "Offer", "Hired"] as MoveTarget[]).filter((s) => s !== sub.stage);
}

/** PROVISIONAL development rules for client decisions, mirroring client_decline and client_add_feedback (development
    testing only; not production permissions, D3). Decline: open role; from To review, Interview or Offer. Feedback: open
    or on-hold role; at Interview or Offer (a stand-in: a stage is not an interview record). Closed roles: neither. */
export const canDecline = (sub: DbSubmission, role: DbRole) => role.status === "Open" && ["To review", "Interview", "Offer"].includes(sub.stage);
export const canGiveFeedback = (sub: DbSubmission, role: DbRole) => (role.status === "Open" || role.status === "On hold") && ["Interview", "Offer"].includes(sub.stage);

export interface MoveController {
  getState(): MoveState;
  subscribe(listener: () => void): () => void;
  /** Starts a new intended move with a new key. Ignored while another move is saving or unresolved. */
  move(account: string, sub: Pick<DbSubmission, "id" | "version"> & { stage?: Stage }, toStage: MoveTarget): boolean;
  /** Starts a new intended action (move, decline or feedback) with a new key, under the same rules as move(). */
  act(account: string, sub: Pick<DbSubmission, "id" | "version" | "stage">, intent: Intent): boolean;
  /** Sends the same unresolved request again, with the same key. */
  retry(): void;
  /** Leaves a finished (or unresolved) move; an unresolved one is abandoned and the data refreshed, so the screen shows what the server has. */
  dismiss(): void;
  /** Called on every change of account (null: signed out or no access). */
  sync(account: string | null): void;
}

/** `record`: development-only test-run recorder. When given, each request is recorded before it is sent (if that fails,
    nothing is sent) and its outcome afterwards. Not used in production. */
export interface MoveOptions { newKey?: () => string; autoRetryDelayMs?: number; wait?: (ms: number) => Promise<void>; record?: (e: MoveRecordEntry) => Promise<void> }

export function createMoveController(rpc: MoveRpc, refresh: () => void, opts: MoveOptions = {}): MoveController {
  const newKey = opts.newKey ?? (() => crypto.randomUUID()), delay = opts.autoRetryDelayMs ?? 1500;
  const wait = opts.wait ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  let state: MoveState = { status: "idle" }, account: string | null = null, generation = 0;
  const listeners = new Set<() => void>();
  const set = (s: MoveState) => { state = s; listeners.forEach((l) => l()); };
  const busy = () => state.status === "saving" || state.status === "uncertain";

  const send = async (acc: string, request: MoveRequest, attempt: number) => {
    const mine = generation;
    set({ status: "saving", account: acc, request, attempt });
    if (opts.record) {
      try {
        await opts.record({ phase: "sent", action: request.action ?? "move", key: request.key, submission_id: request.submissionId, expected_version: request.expectedVersion, seen_stage: request.seenStage, to_stage: request.toStage, attempt });
      } catch {
        if (mine === generation && account === acc) set({ status: "failed", account: acc, submissionId: request.submissionId, message: MOVE_MESSAGES.notRecorded });
        return;
      }
      if (mine !== generation || account !== acc) return;
    }
    const out = await rpc(request).catch((): RpcOutcome => ({ kind: "uncertain" }));
    void opts.record?.({ phase: "outcome", key: request.key, submission_id: request.submissionId, outcome: out.kind === "error" ? `error:${out.code}` : out.kind }).catch(() => {});
    if (mine !== generation || account !== acc) return;          // signed out or switched account meanwhile
    if (out.kind === "uncertain") {
      if (attempt === 0) {
        await wait(delay);
        if (mine !== generation || account !== acc) return;
        return send(acc, request, 1);                             // same key, same request
      }
      set({ status: "uncertain", account: acc, request });
      return;
    }
    if (out.kind === "ok") {
      const r = out.result;
      const decision = (request.action ?? "move") !== "move";
      const matches = r && r.submission_id === request.submissionId && r.stage === request.toStage && r.version === request.expectedVersion + 1 && (!decision || typeof r.note_id === "string")
        && (!request.interviewId || r.interview_id === request.interviewId);
      set(matches ? { status: "saved", account: acc, submissionId: request.submissionId, action: request.action ?? "move", toStage: request.toStage }
        : { status: "failed", account: acc, submissionId: request.submissionId, message: MOVE_MESSAGES.unexpected });
      refresh();
      return;
    }
    const c = out.code;
    if (c === "version_conflict") set({ status: "conflict", account: acc, submissionId: request.submissionId });
    else set({ status: "failed", account: acc, submissionId: request.submissionId,
      message: c === "move_not_permitted" || c === "action_not_permitted" ? MOVE_MESSAGES.notPermitted : c === "submission_not_found" ? MOVE_MESSAGES.notFound
        : c === "not_a_client_member" || c === "42501" ? MOVE_MESSAGES.access : MOVE_MESSAGES.other });
    if (c !== "invalid_request") refresh();
  };

  return {
    getState: () => state,
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
    move(acc, sub, toStage) {
      if (busy() || acc !== account) return false;
      void send(acc, { submissionId: sub.id, toStage, expectedVersion: sub.version, key: newKey(), seenStage: sub.stage }, 0);
      return true;
    },
    act(acc, sub, intent) {
      if (busy() || acc !== account) return false;
      const base = { submissionId: sub.id, expectedVersion: sub.version, key: newKey(), seenStage: sub.stage };
      const request: MoveRequest = intent.action === "move" ? { ...base, action: "move", toStage: intent.toStage }
        : intent.action === "decline" ? { ...base, action: "decline", toStage: "Declined", note: intent.note, category: intent.category }
        : { ...base, action: "feedback", toStage: sub.stage, about: intent.about, text: intent.text, ...(intent.interviewId ? { interviewId: intent.interviewId } : {}) };
      void send(acc, request, 0);
      return true;
    },
    retry() { if (state.status === "uncertain" && state.account === account) void send(state.account, state.request, 1); },
    dismiss() {
      if (state.status === "saving") return;
      const wasUncertain = state.status === "uncertain";
      set({ status: "idle" });
      if (wasUncertain) refresh();
    },
    sync(acc) {
      if (acc === account) return;
      account = acc; generation++;
      if (state.status !== "idle") set({ status: "idle" });
    },
  };
}

/* ---- The call itself, through supabase-js -------------------------------------------------------------------------- */

interface RpcBuilder { abortSignal(s: AbortSignal): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null; status: number }> }
export interface RpcClient { rpc(fn: string, args: Record<string, unknown>): RpcBuilder }

/** The database function and arguments for a request. */
export function rpcCall(r: MoveRequest): [string, Record<string, unknown>] {
  const common = { p_submission_id: r.submissionId, p_expected_version: r.expectedVersion, p_idempotency_key: r.key };
  if (r.action === "decline") return ["client_decline", { ...common, p_note: r.note, p_category: r.category ?? null }];
  if (r.action === "feedback" && r.interviewId) return ["client_add_interview_feedback", { ...common, p_interview_id: r.interviewId, p_about: r.about ?? null, p_text: r.text }];
  if (r.action === "feedback") return ["client_add_feedback", { ...common, p_about: r.about ?? null, p_text: r.text }];
  return ["client_move_stage", { ...common, p_to_stage: r.toStage }];
}

/** Calls the action's database function with the user's session. No answer within `timeoutMs`, a network failure or a
    5xx answer counts as uncertain: the server may have saved it. */
export function supabaseMoveRpc(db: RpcClient, timeoutMs = 15000): MoveRpc {
  return async (r) => {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const [fn, args] = rpcCall(r);
      const { data, error, status } = await db.rpc(fn, args).abortSignal(ctrl.signal);
      if (!error) return status >= 200 && status < 300 && data ? { kind: "ok", result: data as MoveResult } : { kind: "uncertain" };
      if (!status || status >= 500 || ctrl.signal.aborted) return { kind: "uncertain" };
      return { kind: "error", code: error.code === "42501" ? "42501" : error.message || error.code || "unknown" };
    } catch {
      return { kind: "uncertain" };
    } finally {
      clearTimeout(timer);
    }
  };
}
