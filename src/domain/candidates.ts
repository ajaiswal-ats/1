/* Candidate rules shared by the sidebar, the Candidates page and the reports, ported from client-workspace-v1-visual-2h
   (waitingOnYou, people, stageCounts, nextText, ivText, reqLine, filtered). Pure functions; no React. */
import type { Dataset, Role, Stage, Submission } from "../data/fixtures";
import { days, fd, fdw } from "../lib/dates";

/** Pipeline columns. Declined is shown only when asked for. */
export const STAGES: Stage[] = ["To review", "Interview", "Offer", "Hired"];

export const waitingOnYou = (c: Submission) => c.next.who === "you";
/** Unique people: one person shared for two roles counts once. */
export const people = (list: Submission[]) => new Set(list.map((c) => c.pid)).size;
export const initials = (name: string) => name.split(" ").map((x) => x[0]).join("").slice(0, 2);
/** Submissions per stage, by latest saved stage. The one definition used by the board, the lists and the reports. */
export const countByStage = (list: Pick<Submission, "stage">[], stages: readonly Stage[]) => stages.map((s) => list.filter((c) => c.stage === s).length);
export const roleOf = (data: Dataset, c: Submission) => data.roles.find((r) => r.id === c.role)!;
/** The same person's submissions for other roles. */
export const otherSubmissions = (data: Dataset, c: Submission) => data.subs.filter((x) => x.pid === c.pid && x.id !== c.id);

export interface NextStep {
  /** Who the step is with: you, scheduled, Revenue Optics, or done. */
  cls: "you" | "sched" | "ro" | "done";
  short: string;
  long: string;
  sub: string;
}

/** The next step for a submission, separate from its stage. */
export function nextStep(c: Submission, today: string): NextStep {
  const n = c.next, w = n.since ? days(n.since, today) : 0, dd = w === 1 ? "1 day" : `${w} days`;
  if (n.who === "you" && n.kind === "review") return { cls: "you", short: `Your review · ${dd}`, long: "Review and decide", sub: `Shared ${fd(c.shared)} · waiting ${dd}` };
  if (n.who === "you" && n.kind === "feedback") return { cls: "you", short: `Your feedback · ${dd}`, long: "Share interview feedback", sub: `Interview held ${fd(c.client.date!)} · waiting ${dd}` };
  if (n.kind === "scheduled") return { cls: "sched", short: `Interview ${fdw(c.client.date!)}`, long: `Interview ${fdw(c.client.date!)}, ${c.client.time}`, sub: `With ${c.client.with}` };
  if (n.kind === "scheduling") return { cls: "ro", short: "Revenue Optics arranging", long: "Revenue Optics is arranging the interview", sub: `You suggested: ${c.client.slots}` };
  if (n.kind === "offer") return { cls: "ro", short: "Offer made (recorded)", long: "Offer made, recorded by Revenue Optics", sub: `Recorded ${fd(c.outcome!.d)} · Revenue Optics is following up` };
  if (n.kind === "followup") return { cls: "ro", short: "Revenue Optics following up", long: "Revenue Optics is following up on your feedback", sub: `Feedback shared ${fd(c.client.date!)}` };
  if (n.kind === "moved") return { cls: "ro", short: "Recruiter to follow up", long: "Stage saved · recruiter to follow up", sub: "" };
  if (n.kind === "moved-outcome") return { cls: "ro", short: `${c.stage} stage saved · status not recorded`, long: `${c.stage} stage saved`,
    sub: `Whether an offer was ${c.stage === "Hired" ? "accepted" : "made"} is not recorded yet. Revenue Optics records that separately.` };
  if (n.kind === "hired") return { cls: "done", short: "Offer accepted (recorded)", long: "Offer accepted, recorded by Revenue Optics",
    sub: `Recorded ${fd(c.outcome!.d)}` + (c.facts["Start date"] ? ` · starts ${c.facts["Start date"]}` : "") };
  return { cls: "ro", short: "No action needed", long: "No action needed", sub: "" };
}

/** Interview status label and its chip class. */
export function interviewLabel(c: Submission): [string, string] {
  const k = c.client.status;
  if (k === "scheduled") return ["c-info", `Interview ${fdw(c.client.date!)}`];
  if (k === "requested") return ["c-mute", "Interview requested"];
  if (k === "held") return ["c-warn", "Interview held · feedback due"];
  if (k === "feedback") return ["c-ok", "Interview held · feedback given"];
  return c.iv ? ["c-mute", "Screening call available"] : ["c-mute", "No interview yet"];
}

/** "3 of 4 must-haves supported" */
export function requirementLine(c: Submission, role: Role): string {
  const must = role.req.filter((x) => x[1] === "must").length;
  const supported = c.req.filter((x, i) => role.req[i]?.[1] === "must" && x[0] === "sup").length;
  return `${supported} of ${must} must-haves supported`;
}

export type RoleChoice = "all" | string;
export type CandidateFilter = "all" | "you";

/** Submissions for the role choice (all roles, or one role, on hold or not). */
export const forRole = (data: Dataset, role: RoleChoice) => (role === "all" ? data.subs.slice() : data.subs.filter((c) => c.role === role));

/** The Candidates page list: role and filter applied, waiting on you first, then longest waiting. */
export function candidateList(data: Dataset, role: RoleChoice, filter: CandidateFilter, today: string): Submission[] {
  const waited = (c: Submission) => (c.next.since ? days(c.next.since, today) : 0);
  return forRole(data, role)
    .filter((c) => filter !== "you" || waitingOnYou(c))
    .sort((a, b) => Number(waitingOnYou(b)) - Number(waitingOnYou(a)) || waited(b) - waited(a));
}

/** Top-bar search: up to 6 candidates by name, and roles by title. */
export function search(data: Dataset, query: string) {
  const v = query.trim().toLowerCase();
  if (!v) return null;
  return { subs: data.subs.filter((c) => c.name.toLowerCase().includes(v)).slice(0, 6), roles: data.roles.filter((r) => r.title.toLowerCase().includes(v)) };
}

/** One role's row on the Roles page (2h rolesTable): its submissions, stage counts, items waiting on you,
    and what happened in the last 7 days (shared, and saved stage moves, including the client's own). */
export function roleSummary(data: Dataset, role: Role, today: string) {
  const subs = forRole(data, role.id), recent = (d: string) => { const n = days(d, today); return n >= 0 && n <= 6; };
  return {
    subs,
    byStage: countByStage(subs, [...STAGES, "Declined"]),
    waiting: subs.filter(waitingOnYou).length,
    shared7: subs.filter((c) => recent(c.shared)).length,
    moved7: data.moves.filter((m) => data.subs.find((s) => s.id === m.sid)?.role === role.id && recent(m.d)).length,
  };
}
