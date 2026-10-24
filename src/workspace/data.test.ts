/* Workspace data: strict row checks (no filling in), and the counts the Roles and Candidates lists show. */
import { describe, expect, it } from "vitest";
import { alsoFor, countByStage, forRole, loadWorkspace, roleRow, uniquePeople, utcToday, type WorkspaceDb } from "./data";

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
    { submission_id: "s1", client_id: C, kind: "shared", to_stage: "To review", occurred_on: "2026-10-08" },
    { submission_id: "s1", client_id: C, kind: "stage_move", to_stage: "Interview", occurred_on: "2026-10-10" },
    { submission_id: "s3", client_id: C, kind: "stage_move", to_stage: "Declined", occurred_on: "2026-09-30" },
  ] as Record<string, unknown>[],
});
type Tables = ReturnType<typeof base>;
const db = (t: Tables, errors: Partial<Record<keyof Tables, unknown>> = {}): WorkspaceDb => ({
  from: (table) => ({ select: () => Promise.resolve({ data: errors[table as keyof Tables] ? null : (t[table as keyof Tables] as Record<string, unknown>[]), error: errors[table as keyof Tables] ?? null }) }),
});

describe("loadWorkspace", () => {
  it("maps the rows, sorts roles by title and submissions newest first", async () => {
    const ws = await loadWorkspace(db(base()), C);
    expect(ws.roles.map((r) => r.title)).toEqual(["Buyer", "Warehouse Lead"]);
    expect(ws.subs.map((s) => s.id)).toEqual(["s3", "s1", "s2"]);   // 8 Oct (Ann before Jo), then 20 Sep
    expect(ws.moves).toEqual([{ submissionId: "s1", toStage: "Interview", occurredOn: "2026-10-10" }, { submissionId: "s3", toStage: "Declined", occurredOn: "2026-09-30" }]);
    expect(ws.people.get("p2")).toEqual({ id: "p2", name: "Ann Lee", headline: "", location: "" });
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
      ["history for a hidden submission", (t) => { t.submission_events.push({ submission_id: "s9", client_id: C, kind: "stage_move", to_stage: "Offer", occurred_on: "2026-10-01" }); }],
      ["unexpected history kind", (t) => { t.submission_events.push({ submission_id: "s1", client_id: C, kind: "note", to_stage: "Offer", occurred_on: "2026-10-01" }); }],
    ];
    for (const [label, change] of broken) { const t = base(); change(t); await expect(loadWorkspace(db(t), C), label).rejects.toThrow(); }
    await expect(loadWorkspace(db(base(), { people: { message: "permission denied" } }), C)).rejects.toThrow();
  });
  it("an empty workspace is valid", async () => {
    const ws = await loadWorkspace(db({ roles: [], people: [], submissions: [], submission_events: [] }), C);
    expect([ws.roles.length, ws.subs.length]).toEqual([0, 0]);
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
