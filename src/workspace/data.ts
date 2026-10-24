/* Workspace data for the Supabase portal: the signed-in member's roles, published submissions, the people behind them and
   their stage moves, read with the member's own session (row-level security decides what is returned). Read-only.
   Every row is checked: a missing field, an unknown stage or status, a link to a row that was not returned, or a row of
   another client is an error. Nothing is filled in, and nothing comes from the demo's fictional data.
   Not in the database yet (shown as not connected): next steps and "waiting on you", requirement evidence, interviews,
   outcomes, notes, role descriptions and requirements, and the search records behind Hiring progress. */
import type { RoleStatus, Stage } from "../data/fixtures";
import { days } from "../lib/dates";

export interface DbRole { id: string; title: string; location: string; status: RoleStatus; openedOn: string; recruiterName: string }
export interface DbPerson { id: string; name: string; headline: string; location: string }
/** `version` goes up by one with every change; a stage move must send the version it was based on. */
export interface DbSubmission { id: string; roleId: string; personId: string; stage: Stage; sharedOn: string; version: number }
export interface DbMove { submissionId: string; toStage: Stage; occurredOn: string }
export interface Workspace { clientId: string; roles: DbRole[]; people: Map<string, DbPerson>; subs: DbSubmission[]; moves: DbMove[] }

interface Result { data: Record<string, unknown>[] | null; error: unknown }
/** The parts of the supabase-js query builder used here (so tests can pass a fake). */
export interface WorkspaceDb { from(table: string): { select(cols: string): PromiseLike<Result> } }

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

async function rows(db: WorkspaceDb, table: string, cols: string, clientId: string) {
  const r = await db.from(table).select(cols);
  if (r.error || !Array.isArray(r.data)) throw new Error(`${table} could not be read`);
  /* Row-level security should return only this client's rows; anything else stops the load rather than being shown. */
  if (r.data.some((x) => x.client_id !== clientId)) throw new Error(`${table} returned another client's rows`);
  return r.data;
}

export async function loadWorkspace(db: WorkspaceDb, clientId: string): Promise<Workspace> {
  const [roleRows, personRows, subRows, eventRows] = await Promise.all([
    rows(db, "roles", "id, client_id, title, location, status, opened_on, recruiter_name", clientId),
    rows(db, "people", "id, client_id, name, headline, location", clientId),
    rows(db, "submissions", "id, client_id, role_id, person_id, stage, shared_on, publication, version", clientId),
    rows(db, "submission_events", "submission_id, client_id, kind, to_stage, occurred_on", clientId),
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
  const subIds = new Set(subs.map((s) => s.id));
  const moves = eventRows.filter((e) => e.kind === "stage_move").map((e) => {
    const m = { submissionId: text(e, "submission_id"), toStage: oneOf(e, "to_stage", ALL_STAGES), occurredOn: date(e, "occurred_on") };
    if (!subIds.has(m.submissionId)) throw new Bad("history for a submission that was not returned");
    return m;
  });
  if (eventRows.some((e) => e.kind !== "stage_move" && e.kind !== "shared")) throw new Bad("unexpected history entry");
  return {
    clientId,
    roles: roles.sort((a, b) => a.title.localeCompare(b.title)),
    people,
    subs: subs.sort((a, b) => (a.sharedOn < b.sharedOn ? 1 : a.sharedOn > b.sharedOn ? -1 : people.get(a.personId)!.name.localeCompare(people.get(b.personId)!.name))),
    moves,
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

/** Today's date in UTC, the same calendar the database uses for stage moves (the reporting time zone is still open). */
export const utcToday = (now = new Date()) => now.toISOString().slice(0, 10);
