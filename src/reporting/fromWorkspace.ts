/* Hiring progress in Supabase mode: the report rows, built from the same workspace snapshot the Candidates and Roles pages
   read (src/workspace/data.ts), so every count comes from the same published submissions and the same history.

   * Stage history: the "shared" entry, then every stage move and decline, in version order. Feedback entries do not
     change the stage and are not moves; interviews held and recorded outcomes are facts, not moves.
   * "you" on a move means the client team (any member), never necessarily the signed-in member.
   * Revenue Optics' search records are not connected and not fetched: `search: null` (Not available, never 0).
   * Only submissions currently shared with the client are here (row-level security); withdrawn or unshared ones are not
     counted, and nothing tries to restore them.
   * Nothing is filled in: a history that does not add up (a missing entry, a first entry that is not the share on the
     shared date, dates going backwards, or a current stage the history does not reach) is an error, not a guess. */
import type { ClientInterviewStatus, InterviewHeld, StageMove } from "../data/fixtures";
import type { DbInterview, Workspace } from "../workspace/data";
import type { ReportData, ReportSub } from "./metrics";

export class ReportDataError extends Error {}

const INTERVIEW: Record<DbInterview["status"], ClientInterviewStatus> = { requested: "requested", scheduled: "scheduled", held: "held", cancelled: "none" };

/** The report rows, or null when milestone 4 (interviews held and recorded outcomes) is not on the database. */
export function reportData(ws: Workspace): ReportData | null {
  if (!ws.steps) return null;
  const steps = ws.steps, moves: StageMove[] = [], held: InterviewHeld[] = [];
  const subs = ws.subs.map((s): ReportSub => {
    const fail = (why: string): never => { throw new ReportDataError(`Submission ${s.id}: ${why}`); };
    const evs = ws.events.filter((e) => e.submissionId === s.id).sort((a, b) => a.version - b.version);
    if (evs.length !== s.version || evs.some((e, i) => e.version !== i + 1)) fail("its history is incomplete");
    const [first] = evs;
    if (first.kind !== "shared" || first.toStage !== "To review" || first.occurredOn !== s.sharedOn) fail("its history does not start with the share on the shared date");
    let stage = first.toStage, last = first.occurredOn;
    for (const e of evs.slice(1)) {
      if (e.occurredOn < last) fail("its history goes back in time");
      last = e.occurredOn;
      if (e.kind !== "stage_move" && e.kind !== "decline") continue;          // feedback: not a move
      moves.push({ sid: s.id, to: e.toStage, d: e.occurredOn, by: e.actorKind === "client" ? "you" : "ro" });
      stage = e.toStage;
    }
    if (stage !== s.stage) fail("its history does not reach its current stage");
    const rounds = steps.interviews.get(s.id) ?? [];
    for (const r of rounds) if (r.status === "held") held.push({ sid: s.id, d: r.heldOn ?? fail("a held interview has no date") });
    const outs = steps.outcomes.get(s.id) ?? [], o = outs.find((x) => x.status === "offer_accepted") ?? outs.find((x) => x.status === "offer_made");
    const current = rounds.at(-1);
    return {
      id: s.id, role: s.roleId, stage: s.stage, shared: s.sharedOn,
      client: { status: current ? INTERVIEW[current.status] : "none" },
      outcome: o ? { status: o.status === "offer_accepted" ? "Offer accepted" : "Offer made", d: o.recordedOn } : null,
    };
  });
  return { roles: ws.roles.map((r) => ({ id: r.id, title: r.title, status: r.status, opened: r.openedOn })), subs, moves, search: null, held, recorded: true };
}
