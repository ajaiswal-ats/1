/* Next steps, "Waiting on you", interview status and requirement support for Supabase mode (milestone 4), derived from
   recorded facts only: the submission's stage and history, its client interview rounds, recorded offer outcomes, linked
   interview feedback, the visible summary package, and the same PROVISIONAL permission rules the action controls use
   (moves.ts). One derivation feeds every count, filter, ordering and label, so they cannot disagree. Pure; no React.

   Rules that matter:
   * A task ("Waiting on you") is generated only when the signed-in member can perform it with the controls shown.
   * The interview is not the stage: at Interview with no recorded round there is no interview, and a scheduled date
     passing does not make it held.
   * The current round is the highest round, whatever its status. A cancelled newer round is current, so an older round's
     missing feedback is not reactivated.
   * Feedback completes a round only when linked to it (in the portal) or recorded on it by Revenue Optics. General
     feedback is a note only. Nothing is matched by date.
   * Order between a fact and a client change comes from versions: a fact carries the submission version it was recorded
     at; a client change with a higher version came after it. Dates are not used to order same-day events.
   * Missing information is shown as missing ("Awaiting shared summary", "No client interview recorded", "Next step not
     recorded"), never as "No action needed". */
import { days, fd, fdw } from "../lib/dates";
import { roleFor, type DbEvent, type DbInterview, type DbSubmission, type Workspace } from "./data";
import { canDecline, canGiveFeedback, moveTargets } from "./moves";

export type NextKind = "review" | "feedback" | "scheduled" | "scheduling" | "offer" | "followup" | "moved" | "moved-outcome" | "hired" | "closed"
  | "awaiting-summary" | "not-recorded";
export interface DbNextStep {
  who: "you" | "ro" | "none"; kind: NextKind; cls: "you" | "sched" | "ro" | "done";
  /** When the waiting started (tasks and Revenue Optics steps), for "waiting N days" and ordering. */
  since: string | null; short: string; long: string; sub: string;
}

export const AWAITING_SUMMARY = "Awaiting shared summary";
export const NO_INTERVIEW = "No client interview recorded";
export const NOT_RECORDED = "Next step not recorded";

const eventsOf = (ws: Workspace, s: DbSubmission) => ws.events.filter((e) => e.submissionId === s.id).sort((a, b) => a.version - b.version);

/** The current interview round: the highest round, whatever its status. */
export const currentRound = (ws: Workspace, s: DbSubmission): DbInterview | null => ws.steps?.interviews.get(s.id)?.at(-1) ?? null;

/** A round's feedback, if completed: recorded on the round by Revenue Optics, or given in the portal and linked to it.
    `version`: the submission version it belongs to (for ordering). */
export function roundFeedback(ws: Workspace, i: DbInterview): { on: string; version: number } | null {
  if (i.feedbackRecordedOn) return { on: i.feedbackRecordedOn, version: i.asOfVersion };
  const noteId = ws.steps?.feedbackLinks.get(i.id), note = noteId ? ws.notes?.find((n) => n.id === noteId) : undefined;
  const ev = note ? ws.events.find((e) => e.id === note.eventId) : undefined;
  return ev ? { on: ev.occurredOn, version: ev.version } : null;
}

/** The round the signed-in member can give interview feedback for now, if any: the current round, held, not completed,
    and the provisional feedback permission (role open or on hold; stage Interview or Offer). The action panel uses this
    same function to link its feedback to the round. */
export function feedbackTask(ws: Workspace, s: DbSubmission): DbInterview | null {
  const i = currentRound(ws, s);
  if (!i || i.status !== "held" || roundFeedback(ws, i)) return null;
  return ws.notes !== null && canGiveFeedback(s, roleFor(ws, s)) ? i : null;
}

/** Whether any review action (a stage change or a decline) is available with the controls' provisional rules. */
const canReview = (ws: Workspace, s: DbSubmission) => { const r = roleFor(ws, s); return moveTargets(s, r).length > 0 || (ws.notes !== null && canDecline(s, r)); };

/** When the submission entered its current stage (the history entry that changed the stage to it). */
function enteredStageOn(evs: DbEvent[], s: DbSubmission): string {
  let on = s.sharedOn, prev: string | null = null;
  for (const e of evs) { if (e.toStage !== prev && e.toStage === s.stage) on = e.occurredOn; prev = e.toStage; }
  return on;
}

const wait = (since: string | null, today: string) => { const n = since ? Math.max(0, days(since, today)) : 0; return n === 1 ? "1 day" : `${n} days`; };

/** The next step, or null when milestone 4 (or 3) is not on the database (shown as not connected). */
export function deriveNext(ws: Workspace, s: DbSubmission, today: string): DbNextStep | null {
  if (!ws.steps || !ws.content) return null;
  const evs = eventsOf(ws, s), iv = currentRound(ws, s), outs = ws.steps.outcomes.get(s.id) ?? [];
  const made = outs.find((o) => o.status === "offer_made"), accepted = outs.find((o) => o.status === "offer_accepted");
  const fb = iv ? roundFeedback(ws, iv) : null;
  const factVersion = Math.max(0, iv?.asOfVersion ?? 0, fb?.version ?? 0, ...outs.map((o) => o.asOfVersion));
  /* The latest stage change; it counts as the client's own only if the client made it (a later Revenue Optics change wins). */
  const lastMove = [...evs].reverse().find((e) => e.kind === "stage_move"), lastClientMove = lastMove?.actorKind === "client" ? lastMove : undefined;
  const step = (who: DbNextStep["who"], kind: NextKind, cls: DbNextStep["cls"], short: string, long = short, sub = "", since: string | null = null): DbNextStep =>
    ({ who, kind, cls, since, short, long, sub });
  const notRecorded = () => step("ro", "not-recorded", "ro", NOT_RECORDED);
  const movedOutcome = (since: string | null) => step("ro", "moved-outcome", "ro", `${s.stage} stage saved · status not recorded`, `${s.stage} stage saved`,
    `Whether an offer was ${s.stage === "Hired" ? "accepted" : "made"} is not recorded yet. Revenue Optics records that separately.`, since);

  if (s.stage === "Declined") return step("none", "closed", "ro", "No action needed");
  /* A task the member can do now comes first: before a newer client stage change (for example a move to Offer after the
     round was held) and before what Revenue Optics has not recorded (for example the outcome at Offer). */
  if (iv && feedbackTask(ws, s)) {
    const dd = wait(iv.heldOn, today);
    return step("you", "feedback", "you", `Your feedback · ${dd}`, "Share interview feedback", `Interview held ${fd(iv.heldOn!)} · waiting ${dd}`, iv.heldOn);
  }
  /* The client's own stage change, newer (by version) than every recorded fact, is the latest thing that happened. */
  if (lastClientMove && lastClientMove.version > factVersion) {
    return s.stage === "Offer" || s.stage === "Hired" ? movedOutcome(lastClientMove.occurredOn)
      : step("ro", "moved", "ro", "Recruiter to follow up", "Stage saved · recruiter to follow up", "", lastClientMove.occurredOn);
  }
  if (s.stage === "Hired") {
    if (!accepted) return movedOutcome(null);
    const start = ws.content.packages.get(s.id)?.keyFacts.find((f) => f.label === "Start date")?.value;
    return step("none", "hired", "done", "Offer accepted (recorded)", "Offer accepted, recorded by Revenue Optics", `Recorded ${fd(accepted.recordedOn)}${start ? ` · starts ${start}` : ""}`);
  }
  if (s.stage === "Offer") {
    const o = made ?? accepted;
    return o ? step("ro", "offer", "ro", "Offer made (recorded)", "Offer made, recorded by Revenue Optics", `Recorded ${fd(o.recordedOn)} · Revenue Optics is following up`, o.recordedOn) : movedOutcome(null);
  }
  if (iv) {
    if (iv.status === "held") {
      if (fb) return step("ro", "followup", "ro", "Revenue Optics following up", "Revenue Optics is following up on your feedback", `Feedback shared ${fd(fb.on)}`, fb.on);
      return notRecorded();                                                // held, no feedback, and no task the member can do
    }
    if (iv.status === "scheduled") {
      return step("none", "scheduled", "sched", `Interview ${fdw(iv.scheduledOn!)}`, `Interview ${fdw(iv.scheduledOn!)}${iv.timeText ? `, ${iv.timeText}` : ""}`, iv.interviewers ? `With ${iv.interviewers}` : "");
    }
    if (iv.status === "requested") {
      return step("ro", "scheduling", "ro", "Revenue Optics arranging", "Revenue Optics is arranging the interview", iv.suggestedTimes ? `You suggested: ${iv.suggestedTimes}` : "", iv.requestedOn);
    }
    return notRecorded();                                                  // cancelled: what happens next is not recorded
  }
  if (s.stage === "To review") {
    if (!canReview(ws, s)) return notRecorded();
    if (!ws.content.packages.has(s.id)) return step("ro", "awaiting-summary", "ro", AWAITING_SUMMARY);
    const since = enteredStageOn(evs, s), dd = wait(since, today);
    return step("you", "review", "you", `Your review · ${dd}`, "Review and decide", `Shared ${fd(s.sharedOn)} · waiting ${dd}`, since);
  }
  return notRecorded();
}

export const waitingOnYou = (ws: Workspace, s: DbSubmission, today: string) => deriveNext(ws, s, today)?.who === "you";
export const waitingCount = (ws: Workspace, list: DbSubmission[], today: string) => list.filter((s) => waitingOnYou(ws, s, today)).length;

/** The one ordering for lists, boards and role pages: waiting on you first, then the longest waiting (stable otherwise). */
export function ordered(ws: Workspace, list: DbSubmission[], today: string): DbSubmission[] {
  const key = new Map(list.map((s) => { const n = deriveNext(ws, s, today); return [s.id, [n?.who === "you" ? 1 : 0, n?.since ? days(n.since, today) : 0] as const]; }));
  return list.slice().sort((a, b) => key.get(b.id)![0] - key.get(a.id)![0] || key.get(b.id)![1] - key.get(a.id)![1]);
}

/** Interview status label and its chip class, from the current round. */
export function interviewLabel(ws: Workspace, s: DbSubmission): [string, string] | null {
  if (!ws.steps) return null;
  const i = currentRound(ws, s);
  if (!i) return ["c-mute", NO_INTERVIEW];
  if (i.status === "requested") return ["c-mute", "Interview requested"];
  if (i.status === "scheduled") return ["c-info", `Interview ${fdw(i.scheduledOn!)}`];
  if (i.status === "cancelled") return ["c-mute", "Interview cancelled"];
  if (roundFeedback(ws, i)) return ["c-ok", "Interview held · feedback given"];
  return feedbackTask(ws, s) ? ["c-warn", "Interview held · feedback due"] : ["c-mute", "Interview held"];
}

/** The recorded offer outcome line, as on the candidate page (null when there is nothing to say). */
export function offerStatus(ws: Workspace, s: DbSubmission): string | null {
  const outs = ws.steps?.outcomes.get(s.id) ?? [], o = outs.find((x) => x.status === "offer_accepted") ?? outs.find((x) => x.status === "offer_made");
  if (o) return `${o.status === "offer_accepted" ? "Offer accepted" : "Offer made"} · recorded by Revenue Optics ${fd(o.recordedOn)}`;
  return ws.steps && (s.stage === "Offer" || s.stage === "Hired") ? "Not recorded yet" : null;
}

/** "N of M must-haves supported", from the visible package's evidence (milestone 3); null when no summary is shared. */
export function requirementLine(ws: Workspace, s: DbSubmission): string | null {
  const pkg = ws.content?.packages.get(s.id), set = ws.content?.sets.get(s.roleId);
  if (!pkg || !set) return null;
  const must = set.requirements.filter((q) => q.tier === "must");
  return `${must.filter((q) => pkg.evidence.get(q.id)?.status === "supported").length} of ${must.length} must-haves supported`;
}
