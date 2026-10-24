/* Workspace data: strict row checks (no filling in), and the counts the Roles and Candidates lists show. */
import { describe, expect, it } from "vitest";
import { alsoFor, countByStage, forRole, loadWorkspace, roleRow, uniquePeople, utcToday, type WorkspaceDb } from "./data";
import { fakeDb } from "./fakeDb";

const C = "client-1";
const base = () => ({
  roles: [
    { id: "r1", client_id: C, title: "Warehouse Lead", location: "Reno, NV", status: "Open", opened_on: "2026-10-01", recruiter_name: "Alex Kim" },
    { id: "r2", client_id: C, title: "Buyer", location: "", status: "On hold", opened_on: "2026-09-01", recruiter_name: "" },
  ],
  people: [
    { id: "p1", client_id: C, name: "Jo Doe", headline: "Ops · Example Co", location: "Reno, NV" },
    { id: "p2", client_id: C, name: "Ann Lee", headline: "", location: "" },
  ],
  submissions: [
    { id: "s1", client_id: C, role_id: "r1", person_id: "p1", stage: "Interview", shared_on: "2026-10-08", publication: "published", version: 1 },
    { id: "s2", client_id: C, role_id: "r2", person_id: "p1", stage: "To review", shared_on: "2026-09-20", publication: "published", version: 1 },
    { id: "s3", client_id: C, role_id: "r1", person_id: "p2", stage: "Declined", shared_on: "2026-10-08", publication: "published", version: 1 },
  ],
  submission_events: [
    { id: 1, submission_id: "s1", client_id: C, submission_version: 1, kind: "shared", to_stage: "To review", occurred_on: "2026-10-08", actor_kind: "revenue_optics", actor_member_id: null },
    { id: 2, submission_id: "s1", client_id: C, submission_version: 2, kind: "stage_move", to_stage: "Interview", occurred_on: "2026-10-10", actor_kind: "client", actor_member_id: "m-me" },
    { id: 3, submission_id: "s3", client_id: C, submission_version: 2, kind: "stage_move", to_stage: "Declined", occurred_on: "2026-09-30", actor_kind: "client", actor_member_id: null },
  ] as Record<string, unknown>[],
});
type Tables = ReturnType<typeof base>;
const db = (t: Tables, errors: Partial<Record<keyof Tables, unknown>> = {}): WorkspaceDb => fakeDb(t as unknown as Record<string, Record<string, unknown>[]>, { errors }).db;

describe("loadWorkspace", () => {
  it("maps the rows, sorts roles by title and submissions newest first", async () => {
    const ws = await loadWorkspace(db(base()), C);
    expect(ws.roles.map((r) => r.title)).toEqual(["Buyer", "Warehouse Lead"]);
    expect(ws.subs.map((s) => s.id)).toEqual(["s3", "s1", "s2"]);   // 8 Oct (Ann before Jo), then 20 Sep
    expect(ws.moves).toEqual([{ submissionId: "s1", toStage: "Interview", occurredOn: "2026-10-10" }, { submissionId: "s3", toStage: "Declined", occurredOn: "2026-09-30" }]);
    expect(ws.people.get("p2")).toEqual({ id: "p2", name: "Ann Lee", headline: "", location: "" });
    expect(ws.events.filter((e) => e.submissionId === "s1").map((e) => [e.version, e.kind, e.actorKind, e.actorMemberId])).toEqual([[1, "shared", "revenue_optics", null], [2, "stage_move", "client", "m-me"]]);
  });
  it("stops, rather than show or fill in anything, on bad or foreign rows", async () => {
    const broken: [string, (t: Tables) => void][] = [
      ["another client's role", (t) => { t.roles[0].client_id = "client-2"; }],
      ["another client's history", (t) => { t.submission_events[0].client_id = "client-2"; }],
      ["unknown stage", (t) => { t.submissions[0].stage = "Shortlisted"; }],
      ["unknown status", (t) => { t.roles[0].status = "Paused"; }],
      ["missing name", (t) => { t.people[0].name = ""; }],
      ["missing title", (t) => { delete (t.roles[0] as Record<string, unknown>).title; }],
      ["bad date", (t) => { t.submissions[0].shared_on = "8 Oct"; }],
      ["unpublished row", (t) => { t.submissions[0].publication = "unpublished"; }],
      ["role not returned", (t) => { t.roles.splice(0, 1); }],
      ["person not returned", (t) => { t.people.splice(1, 1); }],
      ["history for a hidden submission", (t) => { t.submission_events.push({ id: 9, submission_id: "s9", client_id: C, submission_version: 2, kind: "stage_move", to_stage: "Offer", occurred_on: "2026-10-01", actor_kind: "client", actor_member_id: null }); }],
      ["history entry without a version", (t) => { delete t.submission_events[1].submission_version; }],
      ["two history entries with the same version", (t) => { t.submission_events[1].submission_version = 1; }],
      ["unknown actor", (t) => { t.submission_events[1].actor_kind = "robot"; }],
      ["a Revenue Optics entry with a client member", (t) => { t.submission_events[0].actor_member_id = "m-me"; }],
      ["unexpected history kind", (t) => { t.submission_events.push({ id: 10, submission_id: "s1", client_id: C, submission_version: 3, kind: "note", to_stage: "Offer", occurred_on: "2026-10-01", actor_kind: "client", actor_member_id: null }); }],
    ];
    for (const [label, change] of broken) { const t = base(); change(t); await expect(loadWorkspace(db(t), C), label).rejects.toThrow(); }
    await expect(loadWorkspace(db(base(), { people: { message: "permission denied" } }), C)).rejects.toThrow();
  });
  it("an empty workspace is valid", async () => {
    const ws = await loadWorkspace(db({ roles: [], people: [], submissions: [], submission_events: [] }), C);
    expect([ws.roles.length, ws.subs.length]).toEqual([0, 0]);
  });
});

describe("client notes (milestone 2)", () => {
  const withNotes = () => {
    const t = base() as ReturnType<typeof base> & { client_notes: Record<string, unknown>[] };
    t.submission_events.push({ id: 4, submission_id: "s1", client_id: C, submission_version: 3, kind: "feedback", to_stage: "Interview", occurred_on: "2026-10-11", actor_kind: "client", actor_member_id: "m-me" });
    t.client_notes = [{ id: "n1", client_id: C, submission_id: "s1", event_id: 4, kind: "feedback", about: null, text: "Strong.", category: null, author_member_id: "m-me", created_at: "2026-10-11T09:00:00Z" }];
    return t;
  };
  const load = (t: Record<string, unknown>, errors: Record<string, unknown> = {}) => loadWorkspace(fakeDb(t as Record<string, Record<string, unknown>[]>, { errors }).db, C);
  it("loads notes tied to their history entry; a decline counts as a move for the reports, feedback does not", async () => {
    const t = withNotes();
    t.submission_events.push({ id: 5, submission_id: "s2", client_id: C, submission_version: 2, kind: "decline", to_stage: "Declined", occurred_on: "2026-10-11", actor_kind: "client", actor_member_id: "m-me" });
    t.submissions[1].stage = "Declined"; t.submissions[1].version = 2;
    const ws = await load(t);
    expect(ws.notes).toEqual([{ id: "n1", submissionId: "s1", eventId: 4, kind: "feedback", about: null, text: "Strong.", category: null, authorMemberId: "m-me", createdAt: "2026-10-11T09:00:00Z" }]);
    expect(ws.moves.map((m) => m.toStage)).toEqual(["Interview", "Declined", "Declined"]);
  });
  it("a note that does not match its history entry, or a second note for one entry, stops the load", async () => {
    for (const [label, change] of [
      ["other submission", (t: ReturnType<typeof withNotes>) => { t.client_notes[0].submission_id = "s3"; }],
      ["other kind", (t: ReturnType<typeof withNotes>) => { t.client_notes[0].kind = "decline"; }],
      ["other author", (t: ReturnType<typeof withNotes>) => { t.client_notes[0].author_member_id = "m-other"; }],
      ["no such entry", (t: ReturnType<typeof withNotes>) => { t.client_notes[0].event_id = 99; }],
      ["two notes for one entry", (t: ReturnType<typeof withNotes>) => { t.client_notes.push({ ...t.client_notes[0], id: "n2" }); }],
      ["a decline not to Declined", (t: ReturnType<typeof withNotes>) => { t.submission_events.push({ id: 6, submission_id: "s3", client_id: C, submission_version: 3, kind: "decline", to_stage: "Offer", occurred_on: "2026-10-11", actor_kind: "client", actor_member_id: "m-me" }); }],
      ["a decision without its member", (t: ReturnType<typeof withNotes>) => { t.submission_events[3].actor_member_id = null; }],
    ] as const) {
      const t = withNotes(); change(t);
      await expect(load(t), label).rejects.toThrow();
    }
  });
  it("only a missing client_notes table means 'not applied'; any other error still fails the load", async () => {
    expect((await load(base(), { client_notes: { code: "PGRST205", message: "Could not find the table" } })).notes).toBeNull();
    expect((await load(base(), { client_notes: { code: "42P01" } })).notes).toBeNull();
    await expect(load(base(), { client_notes: { code: "42501", message: "permission denied" } })).rejects.toThrow(/client_notes could not be read/);
  });
});

describe("derived counts", () => {
  it("role rows: shared, per stage (To review … Declined), last 7 days", async () => {
    const ws = await loadWorkspace(db(base()), C), [buyer, lead] = ws.roles;
    expect(roleRow(ws, lead, "2026-10-12")).toEqual({ shared: 2, byStage: [0, 1, 0, 0, 1], shared7: 2, moved7: 1 });
    expect(roleRow(ws, buyer, "2026-10-12")).toEqual({ shared: 1, byStage: [1, 0, 0, 0, 0], shared7: 0, moved7: 0 });
  });
  it("people are counted once; the same person's other roles are listed", async () => {
    const ws = await loadWorkspace(db(base()), C);
    expect(uniquePeople(ws.subs)).toBe(2);
    expect(alsoFor(ws, ws.subs.find((s) => s.id === "s1")!)).toEqual(["Buyer"]);
    expect(countByStage(forRole(ws, "r1"), ["Interview", "Declined"])).toEqual([1, 1]);
  });
  it("today is the UTC date", () => {
    expect(utcToday(new Date("2026-10-24T23:30:00-05:00"))).toBe("2026-10-25");
  });
});
