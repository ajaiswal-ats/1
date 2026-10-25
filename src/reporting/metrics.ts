/* Hiring progress calculations, ported from client-workspace-v1-visual-2h (rRecords, reachedIdx, nowStage, stays,
   sharedStays, rModel, stageAudit, roRows, wkWeeks, wkTrend, wkScheduled). Pure functions of a Dataset; no React.

   Scope rules, as in 2h:
   - The role selector ("all" or one role id) applies to every chart.
   - Pipeline, Time in stage and Weekly movement always include roles that are on hold now (their events already happened).
   - Only Candidates by role has "Include on-hold roles" (off by default).

   Two sources: the demo passes its Dataset; Supabase mode passes rows built from the workspace snapshot
   (src/reporting/fromWorkspace.ts) with `search: null`, because Revenue Optics' Sourced and Screened records are not
   connected (and not fetched). Then every Sourced, Screened and "not progressed before sharing" value is null (shown as
   Not available), never 0, and the same rules apply to everything after sharing. */
import type { Actor, ClientInterviewStatus, InterviewHeld, Role, SearchRecord, Stage, StageMove, Submission } from "../data/fixtures";
import { countByStage } from "../domain/candidates";
import { WEEKS, avg, days, inRange } from "../lib/dates";

export type RoleFilter = "all" | string;

export type ReportRole = Pick<Role, "id" | "title" | "status" | "opened">;
export type ReportSub = Pick<Submission, "id" | "role" | "stage" | "shared" | "outcome"> & { client: { status: ClientInterviewStatus } };
/** What the reports read. `search: null`: search records are not connected. `recorded`: the rows are what the portal has
    recorded for the signed-in client (Supabase mode): moves marked "you" are by the client team, not necessarily the
    signed-in member, and Weekly shows recorded activity only. */
export interface ReportData {
  roles: ReportRole[];
  subs: ReportSub[];
  moves: StageMove[];
  search: SearchRecord[] | null;
  held: InterviewHeld[];
  recorded?: boolean;
}

export const FUNNEL = ["Sourced", "Screened", "Submitted", "Interview", "Offer", "Hired"] as const;
export type FunnelStage = (typeof FUNNEL)[number];
/** Stages that happen in Revenue Optics' search, before a candidate is shared (shown in grey). */
export const isSearchStage = (s: FunnelStage) => s === "Sourced" || s === "Screened";

const STAGE_IDX: Partial<Record<Stage, number>> = { "To review": 2, Interview: 3, Offer: 4, Hired: 5 };
const STAY_KEY: Partial<Record<Stage, StayStage>> = { "To review": "Submitted", Interview: "Interview", Offer: "Offer" };

export type StayStage = "Sourced" | "Screened" | "Submitted" | "Interview" | "Offer";
export const TIMED_STAGES: StayStage[] = ["Sourced", "Screened", "Submitted", "Interview", "Offer"];

export interface Stay {
  stage: StayStage;
  start: string;
  end: string | null;
  /** Who made the move that ended the stay (null for search stays and open stays). */
  endedBy: Actor | null;
}

/** A search record, linked to its submission once shared. Without search records, one record per shared submission with
    no search dates (`so` null). */
export interface PipelineRecord extends Omit<SearchRecord, "so"> {
  so: string | null;
  sub: ReportSub | null;
}

/** Roles the role selector covers (including on-hold roles). */
export function rolesInScope(data: ReportData, filter: RoleFilter): ReportRole[] {
  return filter === "all" ? data.roles.slice() : data.roles.filter((r) => r.id === filter);
}

export function records(data: ReportData, filter: RoleFilter): PipelineRecord[] {
  const ids = rolesInScope(data, filter).map((r) => r.id);
  if (!data.search) return data.subs.filter((s) => ids.includes(s.role)).map((s) => ({ role: s.role, so: null, sc: null, sid: s.id, cl: null, sub: s }));
  return data.search.filter((x) => ids.includes(x.role)).map((x) => ({ ...x, sub: x.sid ? data.subs.find((s) => s.id === x.sid) ?? null : null }));
}

export function movesOf(data: ReportData, sid: string) {
  return data.moves.filter((m) => m.sid === sid).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}

/** Furthest stage reached (index into FUNNEL). Passing a later stage counts as passing the earlier ones;
    moving back never lowers it. */
export function reachedIndex(data: ReportData, x: PipelineRecord): number {
  if (!x.sub) return x.sc ? 1 : 0;
  let i = 2;
  movesOf(data, x.sub.id).forEach((m) => { const k = STAGE_IDX[m.to]; if (k != null) i = Math.max(i, k); });
  const k = STAGE_IDX[x.sub.stage];
  return k != null ? Math.max(i, k) : i;
}

/** Where the record is now. */
export function nowStage(x: PipelineRecord): FunnelStage | "Declined by you" | "Not progressed" {
  if (x.sub) return x.sub.stage === "To review" ? "Submitted" : x.sub.stage === "Declined" ? "Declined by you" : x.sub.stage;
  if (x.cl) return "Not progressed";
  return x.sc ? "Screened" : "Sourced";
}

/** Stays after sharing, built from the full move history. Sharing is the first entry into To review.
    Every entry into To review, Interview or Offer starts a stay, which ends at the next saved move in any direction.
    Moving back starts a new stay in the earlier stage. A skipped stage gets no stay and no days.
    Hired and Declined are end states with no stay. */
export function sharedStays(data: ReportData, sid: string, shared: string): Stay[] {
  const ev = [{ to: "To review" as Stage, d: shared, by: null as Actor | null }, ...movesOf(data, sid)];
  const out: Stay[] = [];
  ev.forEach((e, i) => {
    const k = STAY_KEY[e.to]; if (!k) return;
    const nx = ev[i + 1];
    out.push({ stage: k, start: e.d, end: nx ? nx.d : null, endedBy: nx ? nx.by : null });
  });
  return out;
}

export function stays(data: ReportData, x: PipelineRecord): Stay[] {
  const out: Stay[] = x.so ? [{ stage: "Sourced", start: x.so, end: x.sc || (x.cl && !x.sc ? x.cl : null), endedBy: null }] : [];
  if (x.sc) out.push({ stage: "Screened", start: x.sc, end: x.sub ? x.sub.shared : x.cl, endedBy: null });
  if (x.sub) out.push(...sharedStays(data, x.sub.id, x.sub.shared));
  return out;
}

export interface TimeRow {
  s: StayStage;
  /** Average days over completed stays, or null when none have ended. */
  avg: number | null;
  /** Completed stays. */
  n: number;
  /** Stays still open. */
  open: number;
  /** Average days so far for open stays. */
  openAvg: number | null;
  /** Completed stays that ended with the client's own move. */
  byYou: number;
  /** False for Sourced and Screened without search records: every number is then unknown, not 0. */
  available: boolean;
}

export interface PipelineModel {
  recs: PipelineRecord[];
  /** Per FUNNEL stage; null when not available (Sourced and Screened without search records). */
  reached: (number | null)[];
  now: (number | null)[];
  /** Declined, split by who made the decline (the latest move to Declined); not progressed before sharing (null when not available). */
  closed: { dec: number; decBy: { you: number; ro: number }; np: number | null };
  time: TimeRow[];
  /** Offers recorded by Revenue Optics. */
  offers: { made: number; acc: number };
}

/** Whether a funnel or timed stage has data: Sourced and Screened need search records. */
const known = (data: ReportData, s: FunnelStage) => data.search !== null || !isSearchStage(s);

export function pipelineModel(data: ReportData, filter: RoleFilter, today: string): PipelineModel {
  const recs = records(data, filter), subsIn = recs.flatMap((x) => (x.sub ? [x.sub] : []));
  const reached = FUNNEL.map((s, i) => (known(data, s) ? recs.filter((x) => reachedIndex(data, x) >= i).length : null));
  const now = FUNNEL.map((s) => (known(data, s) ? recs.filter((x) => nowStage(x) === s).length : null));
  const declined = recs.filter((x) => nowStage(x) === "Declined by you");
  const decliner = (x: PipelineRecord) => movesOf(data, x.sub!.id).filter((m) => m.to === "Declined").at(-1)?.by;
  const closed = { dec: declined.length, decBy: { you: declined.filter((x) => decliner(x) === "you").length, ro: declined.filter((x) => decliner(x) === "ro").length },
    np: data.search ? recs.filter((x) => nowStage(x) === "Not progressed").length : null };
  const all = recs.flatMap((x) => stays(data, x));
  const time = TIMED_STAGES.map((s): TimeRow => {
    const done = all.filter((t) => t.stage === s && t.end), open = all.filter((t) => t.stage === s && !t.end);
    return { s, avg: avg(done.map((t) => days(t.start, t.end!))), n: done.length, open: open.length,
      openAvg: avg(open.map((t) => days(t.start, today))), byYou: done.filter((t) => t.endedBy === "you").length, available: known(data, s) };
  });
  const offers = { made: subsIn.filter((c) => c.outcome).length, acc: subsIn.filter((c) => c.outcome?.status === "Offer accepted").length };
  return { recs, reached, now, closed, time, offers };
}

/** Fewer completed stays than this are marked "few". */
export const FEW_STAYS = 3;
export const isFew = (t: TimeRow) => t.n > 0 && t.n < FEW_STAYS;
/** "Waiting for client decision" only when every completed To review stay ended with the client's own move. */
export const waitingForClient = (t: TimeRow) => t.s === "Submitted" && t.n > 0 && t.byYou === t.n;

export interface AuditRow {
  stage: StayStage;
  /** Null when not available (Sourced and Screened without search records). */
  reached: number | null;
  now: number | null;
  /** Candidates who actually entered the stage. */
  entered: number;
  /** Candidates counted as reached because they were moved straight past it (0 when not available). */
  skipped: number;
  /** All stays in the stage (re-entries included). */
  entries: number;
  completed: number;
  ongoing: number;
}

/** Per-stage reconciliation of Pipeline and Time in stage (2h stageAudit). */
export function stageAudit(data: ReportData, filter: RoleFilter, today: string): AuditRow[] {
  const recs = records(data, filter), M = pipelineModel(data, filter, today), all = recs.flatMap((x) => stays(data, x));
  return TIMED_STAGES.map((s, i) => {
    const st = all.filter((t) => t.stage === s);
    const entered = i < 2
      ? recs.filter((x) => stays(data, x).some((t) => t.stage === s)).length
      : recs.filter((x) => x.sub && sharedStays(data, x.sub.id, x.sub.shared).some((t) => t.stage === s)).length;
    const reached = M.reached[i];
    return { stage: s, reached, now: M.now[i], entered, skipped: reached === null ? 0 : reached - entered,
      entries: st.length, completed: st.filter((t) => t.end).length, ongoing: st.filter((t) => !t.end).length };
  });
}

/* ---------- Candidates by role ---------- */

export const ROLE_CHART_STAGES = ["To review", "Interview", "Offer", "Hired"] as const;
export type RoleSort = "fewest" | "az";

export interface RoleRow {
  role: ReportRole;
  /** Counts per ROLE_CHART_STAGES. */
  by: number[];
  total: number;
  dec: number;
}

/** Whether the role chart shows a role: open roles, and on-hold roles when included. Closed roles are never shown. */
const charted = (r: ReportRole, includeOnHold: boolean) => r.status === "Open" || (includeOnHold && r.status === "On hold");

/** One row per open role (and on-hold role when included), including roles with no candidates yet. */
export function roleRows(data: ReportData, filter: RoleFilter, includeOnHold: boolean, sort: RoleSort): RoleRow[] {
  const rows = rolesInScope(data, filter).filter((r) => charted(r, includeOnHold)).map((role) => {
    const l = data.subs.filter((c) => c.role === role.id), by = countByStage(l, ROLE_CHART_STAGES);
    return { role, by, total: by.reduce((a, b) => a + b, 0), dec: countByStage(l, ["Declined"])[0] };
  });
  return sort === "fewest"
    ? rows.sort((a, b) => a.total - b.total || a.role.title.localeCompare(b.role.title))
    : rows.sort((a, b) => a.role.title.localeCompare(b.role.title));
}

/** Roles in the selection that the role chart leaves out because they are not open. */
export function hiddenRoles(data: ReportData, filter: RoleFilter, includeOnHold: boolean): ReportRole[] {
  return rolesInScope(data, filter).filter((r) => !charted(r, includeOnHold));
}

/* ---------- Weekly movement ---------- */

export interface WeekRow {
  a: string;
  b: string;
  shared: number;
  held: number;
}

const weeklySubs = (data: ReportData, filter: RoleFilter) => { const ids = rolesInScope(data, filter).map((r) => r.id); return data.subs.filter((c) => ids.includes(c.role)); };

/** Submitted (shared date) and client interviews held, per week (the demo's fixed weeks unless given). Includes roles on hold now. */
export function weeklyCounts(data: ReportData, filter: RoleFilter, weeks: [string, string][] = WEEKS): WeekRow[] {
  const subs = weeklySubs(data, filter), ids = new Set(subs.map((c) => c.id));
  return weeks.map(([a, b]) => ({ a, b, shared: subs.filter((c) => inRange(c.shared, a, b)).length,
    held: data.held.filter((i) => ids.has(i.sid) && inRange(i.d, a, b)).length }));
}

/** A measure gets a trend clause only with at least this many events across the 6 weeks. */
export const TREND_MIN = 3;

export interface TrendPart { prev: number; last: number; ok: boolean; dir: "increased" | "decreased" | "stayed level" }
export interface Trend { text: string | null; s: TrendPart; h: TrendPart }

/** Latest 3 full weeks vs the 3 before. */
export function weeklyTrend(weeks: WeekRow[]): Trend | null {
  if (weeks.length < 6) return null;
  const w = weeks.slice(-6);
  const part = (k: "shared" | "held"): TrendPart => {
    const prev = w.slice(0, 3).reduce((a, x) => a + x[k], 0), last = w.slice(3).reduce((a, x) => a + x[k], 0);
    return { prev, last, ok: prev + last >= TREND_MIN, dir: last > prev ? "increased" : last < prev ? "decreased" : "stayed level" };
  };
  const s = part("shared"), h = part("held"), bits: string[] = [];
  if (s.ok) bits.push(`submissions ${s.dir}`);
  if (h.ok) bits.push(`interviews held ${h.dir}`);
  if (!bits.length) return { text: null, s, h };
  const t = bits.join("; ");
  return { text: t.charAt(0).toUpperCase() + t.slice(1) + ".", s, h };
}

/** Client interviews scheduled now (not counted as held). */
export function scheduledCount(data: ReportData, filter: RoleFilter): number {
  return weeklySubs(data, filter).filter((c) => c.client.status === "scheduled").length;
}
