/* The milestone 2 migration, rollback and SQL Editor access tests, run offline on the real milestone 1 + 2 schema. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProject, snapshot } from "./fake-supabase.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const report = async (db, file) => { try { await db.exec(read(file)); return "no report"; } catch (e) { return e.message; } };

describe("milestone 2 SQL", () => {
  it("the post-migration check is all OK after the migration, and runs (with STOP rows) without it", async () => {
    const p = await createProject();
    const rows = (await p.db.query(read("supabase/checks/m2_post_migration.sql"))).rows;
    expect(rows.filter((r) => r.result !== "OK"), JSON.stringify(rows, null, 1)).toEqual([]);
    expect(rows).toHaveLength(13);
    const before = (await (await createProject({ m2: false })).db.query(read("supabase/checks/m2_post_migration.sql"))).rows;
    expect(before.filter((r) => r.result === "STOP").length).toBeGreaterThan(5);
  });
  it("the SQL Editor access tests all pass, and leave nothing behind", async () => {
    const p = await createProject(), before = await snapshot(p.db);
    const r = await report(p.db, "supabase/tests/m2_access_editor.sql");
    const head = r.split("\n")[0];
    expect(r.split("\n").filter((l) => l.startsWith("FAIL")), head).toEqual([]);
    expect(head).toMatch(/^ACCESS TESTS: \d+ passed, 0 failed/);
    expect(await snapshot(p.db)).toEqual(before);
  });
  it("milestone 1's access tests still all pass with milestone 2 applied", async () => {
    const p = await createProject();
    const r = await report(p.db, "supabase/tests/m1_access_editor.sql");
    expect(r.split("\n").filter((l) => l.startsWith("FAIL"))).toEqual([]);
    expect(r).toMatch(/^ACCESS TESTS: 123 passed, 0 failed/);
  });
  it("the migration refuses a second run; the rollback refuses while decisions exist, and otherwise restores milestone 1 exactly", async () => {
    const p = await createProject();
    await expect(p.db.exec(read("supabase/migrations/20261025120000_m2_decline_feedback.sql"))).rejects.toThrow(/client_notes already exists: nothing changed/);
    await p.db.exec("rollback");
    await p.db.exec("select set_config('request.jwt.claims', '', false)");
    await p.db.exec(`insert into public.submission_events (client_id, submission_id, submission_version, kind, to_stage, occurred_on, actor_kind, actor_member_id, source)
      select s.client_id, s.id, 2, 'decline', 'Declined', current_date, 'client', (select id from public.client_members where display_name = 'Maria Alvarez (test)'), 'portal'
      from public.submissions s where s.id = md5('portal-m1:submission:harbor:ab-fsr')::uuid`);
    await expect(p.db.exec(read("supabase/rollback/20261025120000_m2_down.sql"))).rejects.toThrow(/restore the baseline first/);
    await p.db.exec("rollback");
    /* One project: milestone 1 only, then milestone 2 applied and rolled back. Everything must be as before. */
    const q = await createProject({ m2: false });
    const defs = async (db) => (await db.query("select string_agg(conname || ' ' || pg_get_constraintdef(oid), '; ' order by conname) as d from pg_constraint where conrelid = 'public.submission_events'::regclass")).rows[0].d;
    const m1defs = await defs(q.db), m1 = await snapshot(q.db);
    await q.db.exec(read("supabase/migrations/20261025120000_m2_decline_feedback.sql"));
    await q.db.exec(read("supabase/rollback/20261025120000_m2_down.sql"));
    expect(await defs(q.db)).toBe(m1defs);
    expect(await snapshot(q.db)).toEqual(m1);
    expect((await q.db.query("select to_regclass('public.client_notes') is null as gone, to_regprocedure('public.client_decline(uuid, text, text, integer, uuid)') is null as fn")).rows[0]).toEqual({ gone: true, fn: true });
  });
});
