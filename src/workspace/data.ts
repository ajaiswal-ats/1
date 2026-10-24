/* Workspace data for the Supabase portal: the signed-in member's roles, published submissions, the people behind them and
   their stage moves, read with the member's own session (row-level security decides what is returned). Read-only.
   Every row is checked: a missing field, an unknown stage or status, a link to a row that was not returned, or a row of
   another client is an error. Nothing is filled in, and nothing comes from the demo's fictional data.
   Not in the database yet (shown as not connected): next steps and "waiting on you", requirement evidence, interviews,
   outcomes, notes, role descriptions and requirements, and the search records behind Hiring progress.

   Paging: the API returns at most a capped number of rows per request (Supabase's "Max rows", 1,000 by default) without
   saying so, so every table is read in pages with deterministic keyset paging: ordered by its unique key (id), each page
   asking for keys after the last one seen, until a page comes back empty (correct even if the server's cap is smaller
   than the page size). A page that does not move past the cursor, or is not in key order, or reaching the page limit,
   stops the load with an error: partial data is never returned as complete.
   Limitation: the pages are separate requests, not one snapshot. A row added while the pages are read may or may not be
   included: roles, people and submissions have random UUID keys, so a new one can sort before the cursor and be missed
   until the next load; history entries have increasing ids, so a new one sorts last but is still only included if it
   exists when the last page is read. Nothing already there is lost or repeated. The next load (every refresh after a
   change, and every sign-in) reads the current data; history gaps are shown as such (see history()). */
import type { RoleStatus, Stage } from "../data/fixtures";
import { days } from "../lib/dates";

export interface DbRole { id: string; title: string; location: string; status: RoleStatus; openedOn: string; recruiterName: string }
export interface DbPerson { id: string; name: string; headline: string; location: string }
/** `version` goes up by one with every change; a stage move must send the version it was based on. */
export interface DbSubmission { id: string; roleId: string; personId: string; stage: Stage; sharedOn: string; version: number }
export interface DbMove { submissionId: string; toStage: Stage; occurredOn: string }
/** One history entry. `actorMemberId` is recorded only for portal moves; seeded history has none. */
export interface DbEvent {
  submissionId: string; version: number; kind: "shared" | "stage_move"; toStage: Stage; occurredOn: string;
  actorKind: "client" | "revenue_optics"; actorMemberId: string | null;
}
export interface Workspace { clientId: string; roles: DbRole[]; people: Map<string, DbPerson>; subs: DbSubmission[]; moves: DbMove[]; events: DbEvent[] }

interface Result { data: Record<string, unknown>[] | null; error: unknown }
export interface PageQuery extends PromiseLike<Result> {
  order(col: string, opts: { ascending: boolean }): PageQuery;
  gt(col: string, value: string | number): PageQuery;
  limit(n: number): PageQuery;
}
/** The parts of the supabase-js query builder used here (so tests can pass a fake). */
export interface WorkspaceDb { from(table: string): { select(cols: string): PageQuery } }

/** Rows per request. A server cap below this only means more pages. */
export const PAGE_SIZE = 1000;
/** Safety limit per table (with the default cap, 200,000 rows). Reaching it is an error, never a partial result. */
export const MAX_PAGES = 200;

const ALL_STAGES: Stage[] = ["To review", "Interview", "Offer", "Hired", "Declined"];
const STATUSES: RoleStatus[] = ["Open", "On hold", "Closed"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

class Bad extends Error {}
const text = (row: Record<string, unknown>, k: string, allowEmpty = false): string => {
  const v = row[k];
  if (typeof v !== "string" || (!allowEmpty && v.trim() === "")) throw new Bad(`missing ${k}`);
  return v;
};
const oneOf = <T extends string>(row: Record<string, unknown>, k: string, allowed: readonly T[]): T => {
  const v = text(row, k);
  if (!allowed.includes(v as T)) throw new Bad(`unexpected ${k}`);
  return v as T;
};
const date = (row: Record<string, unknown>, k: string) => { const v = text(row, k); if (!DATE.test(v)) throw new Bad(`unexpected ${k}`); return v; };

/** Postgres orders uuid keys by their bytes, which for the canonical lower-case text form is plain string order. */
const after = (a: unknown, b: unknown) => (typeof a === "number" && typeof b === "number" ? a > b : typeof a === "string" && typeof b === "string" && a > b);

async function rows(db: WorkspaceDb, table: string, cols: string, clientId: string, key = "id") {
  const all: Record<string, unknown>[] = [];
  let last: unknown = null;
  for (let page = 0; ; page++) {
    if (page === MAX_PAGES) throw new Error(`${table}: more than ${MAX_PAGES} pages; stopped rather than show part of it`);
    let q = db.from(table).select(cols).order(key, { ascending: true }).limit(PAGE_SIZE);
    if (last !== null) q = q.gt(key, last as string | number);
    const r = await q;
    if (r.error || !Array.isArray(r.data)) throw new Error(`${table} could not be read`);
    if (r.data.length === 0) return all;
    /* Each page must continue strictly after the cursor, in key order; otherwise paging cannot be trusted. */
    for (const x of r.data) {
      if (last !== null && !after(x[key], last)) throw new Error(`${table}: page out of order; stopped rather than show part of it`);
      last = x[key];
    }
    /* Row-level security should return only this client's rows; anything else stops the load rather than being shown. */
    if (r.data.some((x) => x.client_id !== clientId)) throw new Error(`${table} returned another client's rows`);
    all.push(...r.data);
  }
}

export async function loadWorkspace(db: WorkspaceDb, clientId: string): Promise<Workspace> {
  const [roleRows, personRows, subRows, eventRows] = await Promise.all([
    rows(db, "roles", "id, client_id, title, location, status, opened_on, recruiter_name", clientId),
    rows(db, "people", "id, client_id, name, headline, location", clientId),
    rows(db, "submissions", "id, client_id, role_id, person_id, stage, shared_on, publication, version", clientId),
    rows(db, "submission_events", "id, submission_id, client_id, submission_version, kind, to_stage, occurred_on, actor_kind, actor_member_id", clientId),
  ]);
  const roles = roleRows.map((r) => ({ id: text(r, "id"), title: text(r, "title"), location: text(r, "location", true), status: oneOf(r, "status", STATUSES),
    openedOn: date(r, "opened_on"), recruiterName: text(r, "recruiter_name", true) }));
  const people = new Map(personRows.map((p) => [text(p, "id"), { id: text(p, "id"), name: text(p, "name"), headline: text(p, "headline", true), location: text(p, "location", true) }]));
  const roleIds = new Set(roles.map((r) => r.id));
  const subs = subRows.map((s) => {
    if (s.publication !== "published") throw new Bad("unpublished submission returned");
    if (!Number.isInteger(s.version) || (s.version as number) < 1) throw new Bad("unexpected version");
    const sub = { id: text(s, "id"), roleId: text(s, "role_id"), personId: text(s, "person_id"), stage: oneOf(s, "stage", ALL_STAGES), sharedOn: date(s, "shared_on"), version: s.version as number };
    if (!roleIds.has(sub.roleId) || !people.has(sub.personId)) throw new Bad("submission links to a role or person that was not returned");
    return sub;
  });
  const subIds = new Set(subs.map((s) => s.id)), seen = new Set<string>();
  const events: DbEvent[] = eventRows.map((e) => {
    if (!Number.isInteger(e.submission_version) || (e.submission_version as number) < 1) throw new Bad("unexpected history version");
    const actorMemberId = e.actor_member_id === null || e.actor_member_id === undefined ? null : text(e, "actor_member_id");
    const ev: DbEvent = { submissionId: text(e, "submission_id"), version: e.submission_version as number, kind: oneOf(e, "kind", ["shared", "stage_move"] as const),
      toStage: oneOf(e, "to_stage", ALL_STAGES), occurredOn: date(e, "occurred_on"), actorKind: oneOf(e, "actor_kind", ["client", "revenue_optics"] as const), actorMemberId };
    if (!subIds.has(ev.submissionId)) throw new Bad("history for a submission that was not returned");
    if (ev.actorMemberId && ev.actorKind !== "client") throw new Bad("a Revenue Optics entry with a client member");
    const k = `${ev.submissionId}:${ev.version}`;
    if (seen.has(k)) throw new Bad("two history entries with the same version");
    seen.add(k);
    return ev;
  }).sort((a, b) => (a.submissionId < b.submissionId ? -1 : a.submissionId > b.submissionId ? 1 : a.version - b.version));
  const moves = events.filter((e) => e.kind === "stage_move").map((e) => ({ submissionId: e.submissionId, toStage: e.toStage, occurredOn: e.occurredOn }));
  return {
    clientId,
    roles: roles.sort((a, b) => a.title.localeCompare(b.title)),
    people,
    subs: subs.sort((a, b) => (a.sharedOn < b.sharedOn ? 1 : a.sharedOn > b.sharedOn ? -1 : people.get(a.personId)!.name.localeCompare(people.get(b.personId)!.name))),
    moves,
    events,
  };
}

/* ---- Derived views (pure) ---------------------------------------------------------------------------------------- */

export const person = (ws: Workspace, s: DbSubmission) => ws.people.get(s.personId)!;
export const roleFor = (ws: Workspace, s: DbSubmission) => ws.roles.find((r) => r.id === s.roleId)!;
export const forRole = (ws: Workspace, roleId: "all" | string) => (roleId === "all" ? ws.subs : ws.subs.filter((s) => s.roleId === roleId));
export const uniquePeople = (list: DbSubmission[]) => new Set(list.map((s) => s.personId)).size;
export const countByStage = (list: DbSubmission[], stages: readonly Stage[]) => stages.map((st) => list.filter((s) => s.stage === st).length);
/** The same person's submissions for other roles of this client. */
export const alsoFor = (ws: Workspace, s: DbSubmission) => ws.subs.filter((x) => x.personId === s.personId && x.id !== s.id).map((x) => roleFor(ws, x).title);

/** One role's row on the Roles page: shared, per stage, and what happened in the last 7 days (shared; saved stage moves). */
export function roleRow(ws: Workspace, role: DbRole, today: string) {
  const subs = forRole(ws, role.id), ids = new Set(subs.map((s) => s.id));
  const recent = (d: string) => { const n = days(d, today); return n >= 0 && n <= 6; };
  return {
    shared: subs.length,
    byStage: countByStage(subs, ALL_STAGES),
    shared7: subs.filter((s) => recent(s.sharedOn)).length,
    moved7: ws.moves.filter((m) => ids.has(m.submissionId) && recent(m.occurredOn)).length,
  };
}

export type HistoryActor = "You" | "Client team" | "Revenue Optics";
export interface HistoryEntry { version: number; date: string; actor: HistoryActor; kind: DbEvent["kind"]; toStage: Stage }
/** A submission's history in version order (oldest first), and what is known to be missing from it. "You" only when the
    recorded member is the signed-in member; another member, or a client entry with no recorded member, is "Client team". */
export function history(ws: Workspace, s: DbSubmission, memberId: string) {
  const entries: HistoryEntry[] = ws.events.filter((e) => e.submissionId === s.id).sort((a, b) => a.version - b.version).map((e) => ({
    version: e.version, date: e.occurredOn, kind: e.kind, toStage: e.toStage,
    actor: e.actorKind === "revenue_optics" ? "Revenue Optics" : e.actorMemberId !== null && e.actorMemberId === memberId ? "You" : "Client team",
  }));
  /* Every change raises the version by one and adds one entry, so versions 1 … current should all be present. */
  const have = new Set(entries.map((e) => e.version));
  const missing = Array.from({ length: s.version }, (_, i) => i + 1).filter((v) => !have.has(v)).length;
  return { entries, missing, beyondCurrent: entries.some((e) => e.version > s.version) };
}

/** Today's date in UTC, the same calendar the database uses for stage moves (the reporting time zone is still open). */
export const utcToday = (now = new Date()) => now.toISOString().slice(0, 10);
