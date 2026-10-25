/* Workspace data for the Supabase portal: the signed-in member's roles, published submissions, the people behind them and
   their stage moves, read with the member's own session (row-level security decides what is returned). Read-only.
   Every row is checked: a missing field, an unknown stage or status, a link to a row that was not returned, or a row of
   another client is an error. Nothing is filled in, and nothing comes from the demo's fictional data.
   Not in the database yet (shown as not connected): next steps and "waiting on you", interviews, outcomes, and the search
   records behind Hiring progress. Role descriptions, agreed requirements and published candidate summaries (milestone 3)
   are read when the database has them; without milestone 3 they are shown as not connected. A database with only part of
   milestone 3, or one that refuses or fails any of its reads, is an error, never "not connected".

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
import type { ReqTier, RoleStatus, Stage } from "../data/fixtures";
import { days } from "../lib/dates";

export interface DbRole { id: string; title: string; location: string; status: RoleStatus; openedOn: string; recruiterName: string }
export interface DbPerson { id: string; name: string; headline: string; location: string }
/** `version` goes up by one with every change; a stage move must send the version it was based on. */
export interface DbSubmission { id: string; roleId: string; personId: string; stage: Stage; sharedOn: string; version: number }
export interface DbMove { submissionId: string; toStage: Stage; occurredOn: string }
/** One history entry. `actorMemberId` is recorded only for portal moves; seeded history has none. */
export interface DbEvent {
  id: number; submissionId: string; version: number; kind: "shared" | "stage_move" | "decline" | "feedback"; toStage: Stage; occurredOn: string;
  actorKind: "client" | "revenue_optics"; actorMemberId: string | null;
}
/** A client's decline note or interview feedback (milestone 2). Each belongs to exactly one history entry: the same
    submission, kind and author. Add-only; it says nothing about delivery to Manatal (not connected). */
export interface DbNote {
  id: string; submissionId: string; eventId: number; kind: "decline" | "feedback";
  about: string | null; text: string; category: string | null; authorMemberId: string; createdAt: string;
}
/** A role's description (milestone 3; not versioned). Null or empty parts were not provided and are not shown. */
export interface DbRoleInfo { summary: string | null; responsibilities: string[]; jobDescription: string | null; holdNote: string | null }
export interface DbRequirement { id: string; position: number; text: string; tier: ReqTier }
/** A role's agreed requirement set: the only set the database returns to clients. Requirements in position order. */
export interface DbRequirementSet { id: string; roleId: string; version: number; label: string; agreedOn: string; requirements: DbRequirement[] }
export type DbEvidenceStatus = "supported" | "partly_supported" | "not_evidenced" | "confirmed_not_met";
/** `source` is null when none was recorded (only allowed for unevidenced rows); it is never made up. */
export interface DbEvidence { requirementId: string; status: DbEvidenceStatus; evidence: string; source: string | null }
/** A submission's published package (the Summary tab), with exactly one evidence row per requirement of its set. */
export interface DbPackage {
  id: string; submissionId: string; version: number; setId: string; whyShared: string; strengths: string[]; pointsToClarify: string[];
  keyFacts: { label: string; value: string }[]; evidence: Map<string, DbEvidence>;
}
/** Milestone 3 content. Sets are keyed by role, packages by submission; a missing entry means nothing is shared. */
export interface DbContent { roleInfo: Map<string, DbRoleInfo>; sets: Map<string, DbRequirementSet>; packages: Map<string, DbPackage> }
/** `notes` is null when the database has no client notes yet (milestone 2 not applied): decisions are then unavailable.
    `content` is null when milestone 3 is not applied: descriptions, requirements and summaries are then not connected. */
export interface Workspace {
  clientId: string; roles: DbRole[]; people: Map<string, DbPerson>; subs: DbSubmission[]; moves: DbMove[]; events: DbEvent[]; notes: DbNote[] | null;
  content: DbContent | null;
}

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
const optText = (row: Record<string, unknown>, k: string) => (row[k] === null ? null : text(row, k));
const int = (row: Record<string, unknown>, k: string, min = 1) => { const v = row[k]; if (!Number.isInteger(v) || (v as number) < min) throw new Bad(`unexpected ${k}`); return v as number; };
const list = (row: Record<string, unknown>, k: string, allowNull = false): string[] => {
  const v = row[k];
  if (v === null && allowNull) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || x.trim() === "")) throw new Bad(`unexpected ${k}`);
  return v as string[];
};

/** Postgres orders uuid keys by their bytes, which for the canonical lower-case text form is plain string order. */
const after = (a: unknown, b: unknown) => (typeof a === "number" && typeof b === "number" ? a > b : typeof a === "string" && typeof b === "string" && a > b);

/** The table does not exist on this database (PostgREST: not in the schema cache, or an undefined table). */
const missingTable = (e: unknown) => ["PGRST205", "42P01"].includes(String((e as { code?: unknown } | null)?.code));

async function rows(db: WorkspaceDb, table: string, cols: string, clientId: string, key?: string): Promise<Record<string, unknown>[]>;
async function rows(db: WorkspaceDb, table: string, cols: string, clientId: string, key: string, optional: true): Promise<Record<string, unknown>[] | null>;
async function rows(db: WorkspaceDb, table: string, cols: string, clientId: string, key = "id", optional = false) {
  const all: Record<string, unknown>[] = [];
  let last: unknown = null;
  for (let page = 0; ; page++) {
    if (page === MAX_PAGES) throw new Error(`${table}: more than ${MAX_PAGES} pages; stopped rather than show part of it`);
    let q = db.from(table).select(cols).order(key, { ascending: true }).limit(PAGE_SIZE);
    if (last !== null) q = q.gt(key, last as string | number);
    const r = await q;
    if (optional && page === 0 && r.error && missingTable(r.error)) return null;   // only "not applied", never any other error
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
  const [roleRows, personRows, subRows, eventRows, noteRows, setRows, packageRows] = await Promise.all([
    rows(db, "roles", "id, client_id, title, location, status, opened_on, recruiter_name", clientId),
    rows(db, "people", "id, client_id, name, headline, location", clientId),
    rows(db, "submissions", "id, client_id, role_id, person_id, stage, shared_on, publication, version", clientId),
    rows(db, "submission_events", "id, submission_id, client_id, submission_version, kind, to_stage, occurred_on, actor_kind, actor_member_id", clientId),
    rows(db, "client_notes", "id, client_id, submission_id, event_id, kind, about, text, category, author_member_id, created_at", clientId, "id", true),
    rows(db, "role_requirement_sets", "id, client_id, role_id, version, label, status, agreed_on", clientId, "id", true),
    rows(db, "submission_packages", "id, client_id, submission_id, role_id, requirement_set_id, version, state, why_shared, strengths, points_to_clarify, key_facts", clientId, "id", true),
  ]);
  /* Milestone 3 is read only when both of its first tables exist; one without the other is a partly applied migration. */
  if ((setRows === null) !== (packageRows === null)) throw new Error("the database has only part of milestone 3; stopped rather than show part of it");
  const [infoRows, reqRows, evidenceRows] = setRows === null ? [null, null, null] : await Promise.all([
    rows(db, "roles", "id, client_id, summary, responsibilities, job_description, hold_note", clientId),
    rows(db, "role_requirements", "id, client_id, set_id, position, text, tier", clientId),
    rows(db, "requirement_evidence", "id, client_id, package_id, requirement_set_id, requirement_id, status, evidence, source_label", clientId),
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
    if (!Number.isInteger(e.id)) throw new Bad("history entry without an id");
    const ev: DbEvent = { id: e.id as number, submissionId: text(e, "submission_id"), version: e.submission_version as number, kind: oneOf(e, "kind", ["shared", "stage_move", "decline", "feedback"] as const),
      toStage: oneOf(e, "to_stage", ALL_STAGES), occurredOn: date(e, "occurred_on"), actorKind: oneOf(e, "actor_kind", ["client", "revenue_optics"] as const), actorMemberId };
    if (!subIds.has(ev.submissionId)) throw new Bad("history for a submission that was not returned");
    if (ev.actorMemberId && ev.actorKind !== "client") throw new Bad("a Revenue Optics entry with a client member");
    if ((ev.kind === "decline" || ev.kind === "feedback") && (ev.actorKind !== "client" || !ev.actorMemberId)) throw new Bad("a client decision without its member");
    if (ev.kind === "decline" && ev.toStage !== "Declined") throw new Bad("a decline that is not to Declined");
    const k = `${ev.submissionId}:${ev.version}`;
    if (seen.has(k)) throw new Bad("two history entries with the same version");
    seen.add(k);
    return ev;
  }).sort((a, b) => (a.submissionId < b.submissionId ? -1 : a.submissionId > b.submissionId ? 1 : a.version - b.version));
  /* For the reports, as in 2h: a decline is a move to Declined; feedback is not a move. */
  const moves = events.filter((e) => e.kind === "stage_move" || e.kind === "decline").map((e) => ({ submissionId: e.submissionId, toStage: e.toStage, occurredOn: e.occurredOn }));
  const byId = new Map(events.map((e) => [e.id, e])), noted = new Set<number>();
  const notes: DbNote[] | null = noteRows === null ? null : noteRows.map((n) => {
    const note: DbNote = { id: text(n, "id"), submissionId: text(n, "submission_id"), eventId: n.event_id as number, kind: oneOf(n, "kind", ["decline", "feedback"] as const),
      about: n.about === null ? null : text(n, "about"), text: text(n, "text"), category: n.category === null ? null : text(n, "category"),
      authorMemberId: text(n, "author_member_id"), createdAt: text(n, "created_at") };
    /* The database ties each note to its own history entry; check it here too rather than show a note out of place. */
    const e = byId.get(note.eventId);
    if (!e || e.submissionId !== note.submissionId || e.kind !== note.kind || e.actorMemberId !== note.authorMemberId) throw new Bad("a note that does not match its history entry");
    if (noted.has(note.eventId)) throw new Bad("two notes for one history entry");
    if ((note.kind === "decline" && note.about !== null) || (note.kind === "feedback" && note.category !== null)) throw new Bad("unexpected note field");
    noted.add(note.eventId);
    return note;
  });
  const content = setRows === null ? null : readContent(roles, subs, setRows, packageRows!, infoRows!, reqRows!, evidenceRows!);
  return {
    clientId,
    roles: roles.sort((a, b) => a.title.localeCompare(b.title)),
    people,
    subs: subs.sort((a, b) => (a.sharedOn < b.sharedOn ? 1 : a.sharedOn > b.sharedOn ? -1 : people.get(a.personId)!.name.localeCompare(people.get(b.personId)!.name))),
    moves,
    events,
    notes,
    content,
  };
}

const EVIDENCE: readonly DbEvidenceStatus[] = ["supported", "partly_supported", "not_evidenced", "confirmed_not_met"];
type Rows = Record<string, unknown>[];

/* Milestone 3 rows, checked as strictly as the rest: the database returns only agreed sets and published packages on them,
   with complete evidence; anything else (a draft, a package on another set, a missing or extra evidence row) is an error. */
function readContent(roles: DbRole[], subs: DbSubmission[], setRows: Rows, packageRows: Rows, infoRows: Rows, reqRows: Rows, evidenceRows: Rows): DbContent {
  const roleIds = new Set(roles.map((r) => r.id)), subById = new Map(subs.map((s) => [s.id, s]));
  const roleInfo = new Map<string, DbRoleInfo>();
  for (const r of infoRows) {
    const id = text(r, "id");
    if (!roleIds.has(id)) throw new Bad("a role description for a role that was not returned");
    roleInfo.set(id, { summary: optText(r, "summary"), responsibilities: list(r, "responsibilities", true), jobDescription: optText(r, "job_description"), holdNote: optText(r, "hold_note") });
  }
  const sets = new Map<string, DbRequirementSet>(), setById = new Map<string, DbRequirementSet>();
  for (const r of setRows) {
    if (r.status !== "agreed") throw new Bad("a requirement set that is not agreed was returned");
    const set: DbRequirementSet = { id: text(r, "id"), roleId: text(r, "role_id"), version: int(r, "version"), label: text(r, "label"), agreedOn: date(r, "agreed_on"), requirements: [] };
    if (!roleIds.has(set.roleId)) throw new Bad("a requirement set for a role that was not returned");
    if (sets.has(set.roleId)) throw new Bad("two agreed requirement sets for one role");
    sets.set(set.roleId, set);
    setById.set(set.id, set);
  }
  for (const r of reqRows) {
    const set = setById.get(text(r, "set_id"));
    if (!set) throw new Bad("a requirement of a set that was not returned");
    const req: DbRequirement = { id: text(r, "id"), position: int(r, "position"), text: text(r, "text"), tier: oneOf(r, "tier", ["must", "pref"] as const) };
    if (set.requirements.some((x) => x.position === req.position)) throw new Bad("two requirements in one position");
    set.requirements.push(req);
  }
  for (const set of sets.values()) set.requirements.sort((a, b) => a.position - b.position);
  const packages = new Map<string, DbPackage>(), pkgById = new Map<string, DbPackage>();
  for (const r of packageRows) {
    if (r.state !== "published") throw new Bad("a package that is not published was returned");
    const sub = subById.get(text(r, "submission_id"));
    if (!sub) throw new Bad("a package for a submission that was not returned");
    const set = setById.get(text(r, "requirement_set_id"));
    if (!set || text(r, "role_id") !== sub.roleId || set.roleId !== sub.roleId) throw new Bad("a package that is not on its role's agreed requirements");
    if (packages.has(sub.id)) throw new Bad("two published packages for one submission");
    const facts = r.key_facts;
    if (!Array.isArray(facts) || facts.some((f) => !f || typeof f !== "object" || typeof f.label !== "string" || typeof f.value !== "string" || !f.label.trim() || !f.value.trim()))
      throw new Bad("unexpected key_facts");
    const pkg: DbPackage = { id: text(r, "id"), submissionId: sub.id, version: int(r, "version"), setId: set.id, whyShared: text(r, "why_shared"),
      strengths: list(r, "strengths"), pointsToClarify: list(r, "points_to_clarify"), keyFacts: facts.map((f) => ({ label: f.label, value: f.value })), evidence: new Map() };
    packages.set(sub.id, pkg);
    pkgById.set(pkg.id, pkg);
  }
  for (const r of evidenceRows) {
    const pkg = pkgById.get(text(r, "package_id"));
    if (!pkg) throw new Bad("evidence for a package that was not returned");
    const reqId = text(r, "requirement_id"), set = setById.get(pkg.setId)!;
    if (text(r, "requirement_set_id") !== pkg.setId || !set.requirements.some((q) => q.id === reqId)) throw new Bad("evidence for a requirement outside its package's set");
    if (pkg.evidence.has(reqId)) throw new Bad("two evidence rows for one requirement");
    const ev: DbEvidence = { requirementId: reqId, status: oneOf(r, "status", EVIDENCE), evidence: text(r, "evidence"), source: optText(r, "source_label") };
    if (ev.source === null && ev.status !== "not_evidenced") throw new Bad("evidence without a source");
    pkg.evidence.set(reqId, ev);
  }
  /* Complete or not shown: a published package must have evidence for every requirement of its set. */
  for (const pkg of packages.values()) if (pkg.evidence.size !== setById.get(pkg.setId)!.requirements.length) throw new Bad("a package with incomplete evidence");
  return { roleInfo, sets, packages };
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
