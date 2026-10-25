/* Milestone 4 SQL, offline on the real milestone 1-4 schema and seeds: the checks and access tests, the migration's guards
   and rollback, the separate fictional cleanup, round rules, version anchoring, and feedback links. PGlite runs one
   connection: lock waits between concurrent sessions are not exercised here. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { asUser, createProject, snapshot } from "./fake-supabase.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const MIGRATION = "supabase/migrations/20261027120000_m4_interviews_outcomes.sql", ROLLBACK = "supabase/rollback/20261027120000_m4_down.sql";
const REMOVE = "supabase/seed/m4_remove_fictional.sql", SEED = "supabase/seed/m4_fictional.sql";
const report = async (db, file) => { try { await db.exec(read(file)); return "no report"; } catch (e) { return e.message; } };
const fails = async (db, sql) => { try { await db.exec(sql); return "accepted"; } catch (e) { await db.exec("rollback").catch(() => {}); return e.code === "PT409" || e.code === "P0001" ? e.message : e.code; } };
const one = async (db, sql) => Object.values((await db.query(sql)).rows[0])[0];
const S = (ref, c = "harbor") => `md5('portal-m1:submission:${c}:${ref}')::uuid`;
const I = (ref, n, c = "harbor") => `md5('portal-m4:interview:${c}:${ref}:${n}')::uuid`;
const HB = "md5('portal-m1:client:harbor')::uuid";
const HARBOR = "portal-test-harbor@example.com";

describe("milestone 4 SQL checks and access tests", () => {
  it("the post-migration check is all OK right after the migration, and shows STOP rows without it", async () => {
    const rows = (await (await createProject({ m4Seed: false })).db.query(read("supabase/checks/m4_post_migration.sql"))).rows;
    expect(rows.filter((r) => r.result !== "OK"), JSON.stringify(rows, null, 1)).toEqual([]);
    expect(rows).toHaveLength(12);
    const before = (await (await createProject({ m4: false })).db.query(read("supabase/checks/m4_post_migration.sql"))).rows;
    expect(before.filter((r) => r.result === "STOP").length).toBeGreaterThan(7);
  });
  it("the post-seed check is all OK", async () => {
    const rows = (await (await createProject()).db.query(read("supabase/checks/m4_post_seed.sql"))).rows;
    expect(rows.filter((r) => r.result !== "OK"), JSON.stringify(rows, null, 1)).toEqual([]);
  });
  it("the SQL Editor access tests all pass and leave nothing behind", async () => {
    const p = await createProject(), before = await snapshot(p.db);
    const r = await report(p.db, "supabase/tests/m4_access_editor.sql");
    expect(r.split("\n").filter((l) => l.startsWith("FAIL")), r.split("\n")[0]).toEqual([]);
    expect(r).toMatch(/^ACCESS TESTS: 48 passed, 0 failed/);
    expect(await snapshot(p.db)).toEqual(before);
  });
  it("milestone 1-3 access tests still all pass with milestone 4 applied and seeded", async () => {
    const p = await createProject();
    expect(await report(p.db, "supabase/tests/m1_access_editor.sql")).toMatch(/^ACCESS TESTS: 123 passed, 0 failed/);
    expect(await report(p.db, "supabase/tests/m2_access_editor.sql")).toMatch(/^ACCESS TESTS: \d+ passed, 0 failed/);
    expect(await report(p.db, "supabase/tests/m3_access_editor.sql")).toMatch(/^ACCESS TESTS: 63 passed, 0 failed/);
  });
});

describe("migration guards, rollback and the fictional cleanup", () => {
  it("refuses without milestone 3 and on a second run; milestone 3's rollback refuses while milestone 4 is applied", async () => {
    expect(await fails((await createProject({ m3: false })).db, read(MIGRATION))).toMatch(/milestone 3 not found: nothing changed/);
    const p = await createProject({ m4Seed: false });
    expect(await fails(p.db, read(MIGRATION))).toMatch(/client_interviews already exists: nothing changed/);
    expect(await fails(p.db, read("supabase/rollback/20261026120000_m3_down.sql"))).toMatch(/milestone 4 is applied: roll it back first/);
  });
  it("the rollback refuses while rows exist; after the cleanup it restores milestone 3 exactly, and the migration applies again", async () => {
    const p = await createProject({ m4: false });
    const shape = async () => one(p.db, `select string_agg(c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by c.relname, a.attnum)
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'app_private') and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped`);
    const cons = async () => one(p.db, `select string_agg(conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid), '; ' order by conrelid::regclass::text, conname) from pg_constraint where connamespace in ('public'::regnamespace, 'app_private'::regnamespace)`);
    const fns = async () => one(p.db, `select string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text) from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace)`);
    const want = { shape: await shape(), cons: await cons(), fns: await fns(), data: await snapshot(p.db) };
    await p.db.exec(read(MIGRATION));
    await p.db.exec(read(SEED));
    expect(await fails(p.db, read(ROLLBACK))).toMatch(/milestone 4 rows exist: remove them first/);
    await p.db.exec(read(REMOVE));
    await p.db.exec(read(ROLLBACK));
    expect({ shape: await shape(), cons: await cons(), fns: await fns(), data: await snapshot(p.db) }).toEqual(want);
    await p.db.exec(read(MIGRATION));
    await p.db.exec(read(SEED));
    expect((await p.db.query(read("supabase/checks/m4_post_seed.sql"))).rows.filter((r) => r.result !== "OK")).toEqual([]);
  });
  it("the cleanup removes only milestone 4 rows: round-linked feedback stays as a general note", async () => {
    const p = await createProject();
    await asUser(p.db, p.ids[HARBOR], `select public.client_add_interview_feedback(${S("tb-rsm")}, ${I("tb-rsm", 1)}, null, 'Linked.', 2, gen_random_uuid())`);
    const notes = await one(p.db, "select count(*)::int from public.client_notes");
    await p.db.exec(read(REMOVE));
    expect(await one(p.db, "select (select count(*) from public.client_interviews) + (select count(*) from public.offer_outcomes) + (select count(*) from public.interview_feedback)")).toBe(0);
    expect(await one(p.db, "select count(*)::int from public.client_notes")).toBe(notes);
  });
  it("milestone 4 rows do not block milestone 1's reset (after milestone 3's cleanup); they go with their submissions", async () => {
    const p = await createProject();
    await p.db.exec(read("supabase/seed/m3_remove_fictional.sql"));
    await p.db.exec(read("supabase/seed/m1_reset_fictional.sql"));
    expect(await one(p.db, "select count(*)::int from public.client_interviews")).toBe(0);
  });
});

describe("rounds, version anchoring and links", () => {
  it("as_of_version is the submission's version when the fact is recorded; recording a fact does not change that version", async () => {
    const p = await createProject();
    const v = await one(p.db, `select version from public.submissions where id = ${S("pr-isl")}`);
    await p.db.exec(`insert into public.client_interviews (id, client_id, submission_id, round, status, requested_on, as_of_version) values (md5('t:pr1')::uuid, ${HB}, ${S("pr-isl")}, 1, 'requested', '2026-10-12', 42)`);
    expect(await one(p.db, "select as_of_version from public.client_interviews where id = md5('t:pr1')::uuid")).toBe(v);
    expect(await one(p.db, `select version from public.submissions where id = ${S("pr-isl")}`)).toBe(v);
    /* A client change (version up), then a status change: the new status is anchored after the client change. */
    await asUser(p.db, p.ids[HARBOR], `select public.client_move_stage(${S("pr-isl")}, 'Interview', ${v}, gen_random_uuid())`);
    await p.db.exec("update public.client_interviews set status = 'scheduled', scheduled_on = '2026-10-20' where id = md5('t:pr1')::uuid");
    expect(await one(p.db, "select as_of_version from public.client_interviews where id = md5('t:pr1')::uuid")).toBe(v + 1);
    /* An outcome too, and outcomes cannot be changed afterwards. */
    await p.db.exec(`insert into public.offer_outcomes (client_id, submission_id, status, recorded_on, as_of_version) values (${HB}, ${S("pr-isl")}, 'offer_made', '2026-10-12', 1)`);
    expect(await one(p.db, `select as_of_version from public.offer_outcomes where submission_id = ${S("pr-isl")}`)).toBe(v + 1);
  });
  it("round rules: numbering, one open round, cancelled and held are final, recorded feedback only on held rounds", async () => {
    const p = await createProject(), before = await snapshot(p.db);
    const ins = (ref, round, status, extra = "") => `insert into public.client_interviews (client_id, submission_id, round, status${extra ? ", " + extra.split("=")[0] : ""}, as_of_version) values (${HB}, ${S(ref)}, ${round}, '${status}'${extra ? ", " + extra.split("=")[1] : ""}, 1)`;
    expect(await fails(p.db, `begin; ${ins("ab-fsr", 2, "requested")}; commit;`)).toBe("interview_round_out_of_order");
    expect(await fails(p.db, `begin; ${ins("ab-fsr", 1, "cancelled")}; commit;`)).toBe("interview_must_start_open_or_held");
    expect(await fails(p.db, `begin; ${ins("ab-fsr", 1, "held")}; commit;`)).toBe("23514");                                 // held needs held_on
    expect(await fails(p.db, `begin; ${ins("ab-fsr", 1, "scheduled")}; commit;`)).toBe("23514");                            // scheduled needs a date
    expect(await fails(p.db, `begin; ${ins("so-pa", 2, "requested")}; commit;`)).toBe("interview_previous_round_open");     // so-pa already has an open round
    expect(await fails(p.db, `begin; update public.client_interviews set feedback_recorded_on = '2026-10-12' where id = ${I("je-isl", 1)}; commit;`)).toBe("interview_not_held");
    expect(await fails(p.db, `begin; update public.client_interviews set status = 'held', held_on = '2026-10-12' where id = md5('portal-m4:interview:northwind:n1-ops:2')::uuid; commit;`)).toBe("interview_cancelled_is_final");
    expect(await fails(p.db, `begin; update public.client_interviews set status = 'cancelled' where id = ${I("tb-rsm", 1)}; commit;`)).toBe("interview_held_is_final");
    expect(await fails(p.db, `begin; update public.client_interviews set round = 5 where id = ${I("tb-rsm", 1)}; commit;`)).toBe("interview_keys_are_fixed");
    expect(await fails(p.db, `begin; update public.client_interviews set feedback_recorded_on = '2026-10-01' where id = ${I("tb-rsm", 1)}; commit;`)).toBe("23514");   // before it was held
    expect(await snapshot(p.db)).toEqual(before);
  });
  it("a new round, open or held, needs the current round held or cancelled first; nothing changes when refused", async () => {
    const p = await createProject(), before = await snapshot(p.db);
    const ins = (sub, round, status, cols, vals, c = "harbor") => `insert into public.client_interviews (client_id, submission_id, round, status, ${cols}, as_of_version) values (md5('portal-m1:client:${c}')::uuid, ${S(sub, c)}, ${round}, '${status}', ${vals}, 1)`;
    const held = (sub, round, c) => ins(sub, round, "held", "held_on", "'2026-10-16'", c);
    /* Samuel: round 1 requested. Jordan: round 1 scheduled. */
    expect(await fails(p.db, `begin; ${held("so-pa", 2)}; commit;`)).toBe("interview_previous_round_open");
    expect(await fails(p.db, `begin; ${held("je-isl", 2)}; commit;`)).toBe("interview_previous_round_open");
    expect(await fails(p.db, `begin; ${ins("je-isl", 2, "requested", "requested_on", "'2026-10-16'")}; commit;`)).toBe("interview_previous_round_open");
    expect(await snapshot(p.db)).toEqual(before);
    /* After a held round (Taylor) and after a cancelled round (Northwind's round 2), a new round can be added. */
    await p.db.exec(`begin; ${held("tb-rsm", 2)}; commit;`);
    await p.db.exec(`begin; ${held("n1-ops", 3, "northwind")}; commit;`);
    expect(await one(p.db, `select count(*)::int from public.client_interviews where (submission_id, round) in ((${S("tb-rsm")}, 2), (${S("n1-ops", "northwind")}, 3))`)).toBe(2);
  });
  it("links: only the current, held, uncompleted round, to feedback given after it was held; links never change", async () => {
    const p = await createProject();
    /* General feedback first (after the round was held), then a newer round 2: round 1 is no longer current. */
    await asUser(p.db, p.ids[HARBOR], `select public.client_add_feedback(${S("tb-rsm")}, null, 'General.', 2, gen_random_uuid())`);
    const note = await one(p.db, `select id from public.client_notes where submission_id = ${S("tb-rsm")}`);
    const link = (iv) => `begin; insert into public.interview_feedback (interview_id, note_id, client_id, submission_id) values (${iv}, '${note}', ${HB}, ${S("tb-rsm")}); commit;`;
    /* A note written before the round was recorded as held does not count for it (same day or not). */
    await p.db.exec(`insert into public.client_interviews (id, client_id, submission_id, round, status, held_on, as_of_version) values (md5('t:tb2')::uuid, ${HB}, ${S("tb-rsm")}, 2, 'held', '2026-10-12', 1)`);
    expect(await fails(p.db, link("md5('t:tb2')::uuid"))).toBe("feedback_before_interview_held");
    expect(await fails(p.db, link(I("tb-rsm", 1)))).toBe("interview_not_current");
    /* Owner links the general note to round 2 cannot happen (before held); a new linked feedback for round 2 works through the function. */
    const r = await asUser(p.db, p.ids[HARBOR], `select public.client_add_interview_feedback(${S("tb-rsm")}, md5('t:tb2')::uuid, null, 'For round 2.', 3, gen_random_uuid())::text as r`);
    expect(JSON.parse(r.rows[0].r)).toMatchObject({ stage: "Interview", version: 4 });
    expect(await fails(p.db, "begin; update public.interview_feedback set created_at = now(); commit;")).toBe("feedback_link_is_fixed");
  });
});
