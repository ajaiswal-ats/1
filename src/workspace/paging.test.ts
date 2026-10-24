/* Paged workspace reads: complete under any server row cap, deterministic keyset order, visible failure instead of
   partial data, and the documented (non-snapshot) behaviour for rows added while the pages are read. */
import { describe, expect, it } from "vitest";
import { MAX_PAGES, PAGE_SIZE, history, loadWorkspace, roleRow } from "./data";
import { fakeDb } from "./fakeDb";

const C = "c1";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** n submissions (one person each, one open role), each shared and then moved twice: 3n events, 2n of them moves. */
function tables(n: number) {
  return {
    roles: [{ id: uuid(999999), client_id: C, title: "Big Role", location: "", status: "Open", opened_on: "2026-09-01", recruiter_name: "" }],
    people: Array.from({ length: n }, (_, i) => ({ id: uuid(i), client_id: C, name: `Person ${i}`, headline: "", location: "" })),
    submissions: Array.from({ length: n }, (_, i) => ({ id: uuid(100000 + i), client_id: C, role_id: uuid(999999), person_id: uuid(i), stage: "Offer", shared_on: "2026-10-08", publication: "published", version: 3 })),
    submission_events: Array.from({ length: n }, (_, i) => [1, 2, 3].map((v) => ({
      id: i * 3 + v, submission_id: uuid(100000 + i), client_id: C, submission_version: v, kind: v === 1 ? "shared" : "stage_move",
      to_stage: v === 1 ? "To review" : v === 2 ? "Interview" : "Offer", occurred_on: `2026-10-${String(7 + v).padStart(2, "0")}`, actor_kind: v === 1 ? "revenue_optics" : "client", actor_member_id: null,
    }))).flat() as Record<string, unknown>[],
  };
}
const complete = async (n: number, cap?: number) => {
  const f = fakeDb(tables(n), { cap }), ws = await loadWorkspace(f.db, C);
  return { ws, f, moved7: roleRow(ws, ws.roles[0], "2026-10-12").moved7, missing: ws.subs.filter((s) => history(ws, s, "").missing > 0).length };
};

describe("complete under a server row cap", () => {
  it("the reproduced case: 1,200 history entries with a 1,000-row cap are all read (800 moves, no false gaps)", async () => {
    const r = await complete(400, 1000);
    expect([r.ws.events.length, r.ws.moves.length, r.moved7, r.missing]).toEqual([1200, 800, 800, 0]);
    expect(r.f.requests.filter((q) => q.startsWith("submission_events"))).toHaveLength(3);   // 1,000 + 200 + an empty page
  });
  it("more than 1,000 candidates are all read, none dropped", async () => {
    const r = await complete(1100, 1000);
    expect([r.ws.subs.length, r.ws.people.size, r.ws.events.length]).toEqual([1100, 1100, 3300]);
  });
  it("a cap smaller than the page size only means more pages", async () => {
    for (const cap of [300, 7, 999]) {
      const r = await complete(400, cap);
      expect([r.ws.events.length, r.moved7, r.missing], `cap ${cap}`).toEqual([1200, 800, 0]);
    }
  });
  it("asks in deterministic key order: ordered by id, after the last id seen, in pages of the page size", async () => {
    const r = await complete(400, 1000), ev = r.f.requests.filter((q) => q.startsWith("submission_events"));
    expect(ev[0]).toMatch(/order=id gt=- limit=1000$/);
    expect(ev[1]).toMatch(/order=id gt=1000 limit=1000$/);
    expect(ev[2]).toMatch(/order=id gt=1200 limit=1000$/);
    expect(PAGE_SIZE).toBe(1000);
  });
});

describe("fails visibly rather than return partial data", () => {
  it("reaching the page limit is an error", async () => {
    await expect(loadWorkspace(fakeDb(tables(MAX_PAGES), { cap: 1 }).db, C)).rejects.toThrow(/more than 200 pages/);   // 200 people need 201 requests
  });
  it("a server that ignores the cursor (same rows again) is an error, not an endless loop", async () => {
    await expect(loadWorkspace(fakeDb(tables(5), { cap: 2, ignore: "gt" }).db, C)).rejects.toThrow(/out of order/);
  });
  it("a duplicate key (a broken cursor) is an error", async () => {
    const t = tables(5);
    t.people.push({ ...t.people[0], name: "Duplicate" });
    await expect(loadWorkspace(fakeDb(t).db, C)).rejects.toThrow(/out of order/);
  });
  it("a server that ignores the order is an error", async () => {
    const t = tables(5);
    t.people.reverse();
    await expect(loadWorkspace(fakeDb(t, { ignore: "order" }).db, C)).rejects.toThrow(/out of order/);
  });
  it("a page that fails part-way through is an error, not the pages read so far", async () => {
    const f = fakeDb(tables(400), { cap: 1000, onPage: (table, page) => { if (table === "submission_events" && page === 2) f.fail = true; } }) as ReturnType<typeof fakeDb> & { fail?: boolean };
    const failing = { from: (t: string) => { const b = f.db.from(t); return { select: (c: string) => { const q = b.select(c); const then = q.then.bind(q);
      return Object.assign(q, { then: (res: never, rej: never) => then((r) => (t === "submission_events" && f.fail ? { data: null, error: { message: "timeout" } } : r)).then(res, rej) }); } }; } };
    await expect(loadWorkspace(failing, C)).rejects.toThrow(/submission_events could not be read/);
  });
});

describe("rows added while the pages are read (documented: not a snapshot)", () => {
  it("a history entry added during paging (increasing id) is read if it exists when the last page is read; nothing is lost or repeated", async () => {
    const t = tables(400);
    const f = fakeDb(t, { cap: 1000, onPage: (table, page) => {
      if (table === "submission_events" && page === 2) t.submission_events.push({ id: 1201, submission_id: uuid(100000), client_id: C, submission_version: 4, kind: "stage_move", to_stage: "Hired", occurred_on: "2026-10-11", actor_kind: "client", actor_member_id: null });
    } });
    const ws = await loadWorkspace(f.db, C), ids = ws.events.map((e) => `${e.submissionId}:${e.version}`);
    expect(ws.events).toHaveLength(1201);
    expect(new Set(ids).size).toBe(1201);
    /* Its submission was read before the move, so the history is newer than the stage shown: said so, not hidden. */
    expect(history(ws, ws.subs.find((s) => s.id === uuid(100000))!, "").beyondCurrent).toBe(true);
  });
  it("a UUID row added during paging with a key before the cursor is missed until the next load; nothing else is lost or repeated", async () => {
    const t = tables(1500);
    const f = fakeDb(t, { cap: 1000, onPage: (table, page) => {
      if (table === "people" && page === 2) t.people.push({ id: "00000000-0000-3000-8000-000000000001", client_id: C, name: "Added meanwhile", headline: "", location: "" });   // a new key that sorts first
    } });
    const ws = await loadWorkspace(f.db, C);
    expect(ws.people.size).toBe(1500);
    expect([...ws.people.values()].some((p) => p.name === "Added meanwhile")).toBe(false);
    const next = await loadWorkspace(fakeDb(t).db, C);                     // the next load reads it
    expect([...next.people.values()].some((p) => p.name === "Added meanwhile")).toBe(true);
  });
});
