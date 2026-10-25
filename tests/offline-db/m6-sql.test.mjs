/* Milestone 6 SQL, offline on the real milestone 1-4 schema and seeds plus milestone 6: the checks and access tests, the
   migration's dependency guards, the rollback chain, the fictional cleanup, the seed's handling of published packages,
   and the validation rules. PGlite runs one connection: lock waits between concurrent sessions are not exercised here. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { asUser, createProject, snapshot } from "./fake-supabase.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const MIGRATION = "supabase/migrations/20261028120000_m6_screening_summaries.sql", ROLLBACK = "supabase/rollback/20261028120000_m6_down.sql";
const REMOVE = "supabase/seed/m6_remove_fictional.sql", SEED = "supabase/seed/m6_fictional.sql";
const report = async (db, file) => { try { await db.exec(read(file)); return "no report"; } catch (e) { return e.message; } };
const fails = async (db, sql) => { try { await db.exec(sql); return "accepted"; } catch (e) { await db.exec("rollback").catch(() => {}); return e.code === "PT409" || e.code === "P0001" ? e.message : e.code; } };
const one = async (db, sql) => Object.values((await db.query(sql)).rows[0])[0];
const P6 = (ref) => `md5('portal-m6:package:harbor:${ref}')::uuid`, P3 = (ref, v) => `md5('portal-m3:package:harbor:${ref}:${v}')::uuid`;
const HARBOR = "portal-test-harbor@example.com", NORTHWIND = "portal-test-northwind@example.com";
const counts = JSON.parse(read("supabase/seed/m6_counts.json"));
/* Everything milestone 3 froze, as rows (content and state), so "not edited" can be compared exactly. */
const m3Rows = async (db) => one(db, `select json_agg(x order by x.id)::text from (select p.id, p.state, p.version, p.why_shared, p.strengths, p.points_to_clarify, p.key_facts,
  (select json_agg(json_build_array(q.text, e.status, e.evidence, e.source_label) order by q.position) from public.requirement_evidence e join public.role_requirements q on q.id = e.requirement_id where e.package_id = p.id) ev
  from public.submission_packages p where p.id not in (select md5('portal-m6:package:harbor:' || r)::uuid from unnest(array['tb-isl','tb-rsm','je-isl','pr-isl','en-pa','so-pa','gl-rsm','ab-fsr','cm-rsm']) r)) x`);

describe("milestone 6 SQL checks and access tests", () => {
  it("the post-migration check is all OK right after the migration, and shows STOP rows without it", async () => {
    const rows = (await (await createProject({ m6: true, m6Seed: false })).db.query(read("supabase/checks/m6_post_migration.sql"))).rows;
    expect(rows.filter((r) => r.result !== "OK"), JSON.stringify(rows, null, 1)).toEqual([]);
    expect(rows).toHaveLength(10);
    const before = (await (await createProject()).db.query(read("supabase/checks/m6_post_migration.sql"))).rows;
    expect(before.filter((r) => r.result === "STOP").length).toBeGreaterThan(5);
  });
  it("the post-seed check is all OK, with and without milestone 4", async () => {
    for (const m4 of [true, false]) {
      const rows = (await (await createProject({ m4, m6: true })).db.query(read("supabase/checks/m6_post_seed.sql"))).rows;
      expect(rows.filter((r) => r.result !== "OK"), JSON.stringify(rows, null, 1)).toEqual([]);
    }
  });
  it("the SQL Editor access tests all pass and leave nothing behind", async () => {
    const p = await createProject({ m6: true }), before = await snapshot(p.db);
    const r = await report(p.db, "supabase/tests/m6_access_editor.sql");
    expect(r.split("\n").filter((l) => l.startsWith("FAIL")), r.split("\n")[0]).toEqual([]);
    expect(r).toMatch(/^ACCESS TESTS: 42 passed, 0 failed/);
    expect(await snapshot(p.db)).toEqual(before);
  });
  it("milestone 1, 2 and 4 access tests still pass with milestone 6 applied and seeded", async () => {
    const p = await createProject({ m6: true });
    expect(await report(p.db, "supabase/tests/m1_access_editor.sql")).toMatch(/^ACCESS TESTS: 123 passed, 0 failed/);
    expect(await report(p.db, "supabase/tests/m2_access_editor.sql")).toMatch(/^ACCESS TESTS: \d+ passed, 0 failed/);
    expect(await report(p.db, "supabase/tests/m4_access_editor.sql")).toMatch(/^ACCESS TESTS: 48 passed, 0 failed/);
  });
  it("milestone 3's access tests and post-seed check describe milestone 3's seed alone: run them before the milestone 6 seed", async () => {
    const p = await createProject({ m6: true, m6Seed: false });
    expect(await report(p.db, "supabase/tests/m3_access_editor.sql")).toMatch(/^ACCESS TESTS: 63 passed, 0 failed/);
    await p.db.exec(read(SEED));
    expect((await p.db.query(read("supabase/checks/m3_post_seed.sql"))).rows.filter((r) => r.result !== "OK").map((r) => r.check))
      .toEqual(["Role descriptions / sets / requirements / packages / evidence (expected 5 / 7 / 22 / 17 / 67)"]);
  });
});

describe("dependencies, rollback and the fictional cleanup", () => {
  it("needs milestone 3 (not 4); refuses a second run; milestone 3's rollback refuses while milestone 6 is applied; milestone 4's does not depend on it", async () => {
    expect(await fails((await createProject({ m3: false, m4: false })).db, read(MIGRATION))).toMatch(/milestone 3 not found: nothing changed/);
    const without4 = await createProject({ m4: false });
    expect(await fails(without4.db, read(MIGRATION))).toBe("accepted");
    expect(await fails(without4.db, read(MIGRATION))).toMatch(/screening_summaries already exists: nothing changed/);
    expect(await fails(without4.db, read("supabase/rollback/20261026120000_m3_down.sql"))).toMatch(/milestone 6 is applied: roll it back first/);
    const p = await createProject({ m6: true });
    await p.db.exec(read("supabase/seed/m4_remove_fictional.sql"));
    expect(await fails(p.db, read("supabase/rollback/20261027120000_m4_down.sql"))).toBe("accepted");
    expect(await one(p.db, "select count(*)::int from public.screening_summaries")).toBe(9);
  });
  it("the rollback refuses while summaries exist; after the cleanup it restores the schema exactly, and the migration applies again", async () => {
    const p = await createProject();
    const shape = async () => one(p.db, `select string_agg(c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by c.relname, a.attnum)
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'app_private') and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped`);
    const cons = async () => one(p.db, `select string_agg(conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid), '; ' order by conrelid::regclass::text, conname) from pg_constraint where connamespace in ('public'::regnamespace, 'app_private'::regnamespace)`);
    const fns = async () => one(p.db, `select string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text) from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace)`);
    const pols = async () => one(p.db, "select string_agg(tablename || '.' || policyname, ',' order by tablename, policyname) from pg_policies");
    const want = { shape: await shape(), cons: await cons(), fns: await fns(), pols: await pols() };
    await p.db.exec(read(MIGRATION));
    await p.db.exec(read(SEED));
    expect(await fails(p.db, read(ROLLBACK))).toMatch(/screening summaries exist: remove them first/);
    await p.db.exec(read(REMOVE));
    await p.db.exec(read(ROLLBACK));
    expect({ shape: await shape(), cons: await cons(), fns: await fns(), pols: await pols() }).toEqual(want);
    await p.db.exec(read(MIGRATION));
    expect((await p.db.query(read("supabase/checks/m6_post_migration.sql"))).rows.filter((r) => r.result !== "OK").map((r) => r.check))
      .toEqual(["Fictional baseline unchanged: submissions / events / memberships / packages (expected 15 / 26 / 3 / 17)"]);   // the seed's package versions stay
  });
  it("the cleanup removes only summaries; milestone 3's cleanup and seed then restore its seeded rows exactly", async () => {
    const p = await createProject({ m6: true });
    await p.db.exec(read(REMOVE));
    expect(await one(p.db, "select count(*)::int from public.screening_summaries")).toBe(0);
    expect(await one(p.db, "select count(*)::int from public.submission_packages")).toBe(counts.packages);
    const plain = await createProject();
    await p.db.exec(read("supabase/seed/m3_remove_fictional.sql"));
    await p.db.exec(read("supabase/seed/m3_fictional.sql"));
    expect(await m3Rows(p.db)).toEqual(await m3Rows(plain.db));
    expect(await one(p.db, "select count(*)::int from public.submission_packages")).toBe(17);
  });
  it("milestone 6 rows do not block milestone 3's cleanup or milestone 1's reset; they go with their packages", async () => {
    const p = await createProject({ m6: true });
    expect(await fails(p.db, "delete from public.submission_packages")).toBe("package_frozen");
    await p.db.exec(read("supabase/seed/m3_remove_fictional.sql"));
    expect(await one(p.db, "select count(*)::int from public.screening_summaries")).toBe(0);
    await p.db.exec(read("supabase/seed/m1_reset_fictional.sql"));
  });
});

describe("the seed and published packages", () => {
  it("publishes a new version per target with the same reviewed content; milestone 3's published versions are superseded, their content unchanged", async () => {
    const before = await createProject(), after = await createProject({ m6: true });
    const content = (db) => m3Rows(db).then((s) => s.replace(/"state":"[a-z]+",/g, ""));
    expect(await content(after.db)).toEqual(await content(before.db));
    expect(await one(after.db, `select string_agg(p.state, ',' order by p.state) from public.submission_packages p where p.id in (${P3("tb-isl", 1)}, ${P6("tb-isl")})`)).toBe("published,superseded");
    expect(await one(after.db, `select version from public.submission_packages where id = ${P6("je-isl")}`)).toBe(3);         // Jordan Ellis already has a draft version 2
    expect(await one(after.db, `select state from public.submission_packages where id = ${P3("je-isl", 2)}`)).toBe("draft");
  });
  it("Harbor sees the same Summary packages and evidence as before, plus 9 summaries; Northwind sees none", async () => {
    const before = await createProject(), after = await createProject({ m6: true });
    const vis = async (p, who, t) => (await asUser(p.db, p.ids[who], `select count(*)::int n from public.${t}`)).rows[0].n;
    for (const t of ["submission_packages", "requirement_evidence"]) expect(await vis(after, HARBOR, t), t).toBe(await vis(before, HARBOR, t));
    expect([await vis(after, HARBOR, "screening_summaries"), await vis(after, NORTHWIND, "screening_summaries")]).toEqual([9, 0]);
    const ev = async (p) => (await asUser(p.db, p.ids[HARBOR], "select json_agg(x order by x.submission_id, x.requirement_id)::text j from (select p.submission_id, e.requirement_id, e.status, e.evidence, e.source_label from public.requirement_evidence e join public.submission_packages p on p.id = e.package_id) x")).rows[0].j;
    expect(await ev(after)).toEqual(await ev(before));
  });
  it("refuses, changing nothing, when run twice or when a target's published package is not milestone 3's version 1", async () => {
    const p = await createProject({ m6: true }), before = await snapshot(p.db);
    expect(await fails(p.db, read(SEED))).toMatch(/screening summaries already exist: nothing inserted/);
    expect(await snapshot(p.db)).toEqual(before);
    const q = await createProject({ m6: true, m6Seed: false });
    await q.db.exec(`update public.submission_packages set state = 'paused' where id = ${P3("en-pa", 1)}`);
    const b2 = await snapshot(q.db);
    expect(await fails(q.db, read(SEED))).toMatch(/the milestone 3 packages are not as seeded: nothing inserted/);
    expect(await snapshot(q.db)).toEqual(b2);
  });
});
