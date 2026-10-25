/* Milestone 3 SQL, offline on the real milestone 1 + 2 + 3 schema and seeds: the checks and access tests, the migration's
   guards and rollback, the freeze rules (insert, update, delete and moves between parents), the separate fictional cleanup,
   and atomic replacement. PGlite runs one connection, so lock waits between concurrent sessions cannot be exercised here:
   the orderings are tested one after the other, and the lock statements themselves are checked (see the last block). */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { asUser, createProject, snapshot } from "./fake-supabase.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const MIGRATION = "supabase/migrations/20261026120000_m3_requirements_packages.sql", ROLLBACK = "supabase/rollback/20261026120000_m3_down.sql";
const REMOVE = "supabase/seed/m3_remove_fictional.sql", SEED = "supabase/seed/m3_fictional.sql";
const COUNTS = JSON.parse(read("supabase/seed/m3_counts.json"));
const report = async (db, file) => { try { await db.exec(read(file)); return "no report"; } catch (e) { return e.message; } };
const fails = async (db, sql) => { try { await db.exec(sql); return "accepted"; } catch (e) { await db.exec("rollback").catch(() => {}); return e.code === "PT409" || e.code === "P0001" ? e.message : e.code; } };
const one = async (db, sql) => Object.values((await db.query(sql)).rows[0])[0];

const S = (ref, c = "harbor") => `md5('portal-m1:submission:${c}:${ref}')::uuid`;
const P = (ref, v, c = "harbor") => `md5('portal-m3:package:${c}:${ref}:${v}')::uuid`;
const SET = (role, v, c = "harbor") => `md5('portal-m3:set:${c}:${role}:${v}')::uuid`;
const REQ = (role, v, pos, c = "harbor") => `md5('portal-m3:req:${c}:${role}:${v}:${pos}')::uuid`;
const HB = "md5('portal-m1:client:harbor')::uuid";
const m3Tables = ["role_requirement_sets", "role_requirements", "submission_packages", "requirement_evidence"];
const m3Snapshot = async (db) => Object.fromEntries(await Promise.all(m3Tables.map(async (t) => [t, await one(db, `select count(*)::int from public.${t}`)])));
/* A new draft package with complete evidence for Jordan Ellis (version 3), for replacement tests. */
const draftJe3 = `insert into public.submission_packages (id, client_id, submission_id, role_id, requirement_set_id, version, why_shared)
    values (md5('t:je3')::uuid, ${HB}, ${S("je-isl")}, md5('portal-m1:role:harbor:isl')::uuid, ${SET("isl", 1)}, 3, 'Replacement.');
  insert into public.requirement_evidence (client_id, package_id, requirement_set_id, requirement_id, status, evidence)
    select ${HB}, md5('t:je3')::uuid, ${SET("isl", 1)}, r.id, 'not_evidenced', 'Not mentioned.' from public.role_requirements r where r.set_id = ${SET("isl", 1)};`;

describe("milestone 3 SQL checks and access tests", () => {
  it("the post-migration check is all OK right after the migration, and shows STOP rows without it", async () => {
    const p = await createProject({ m3Seed: false });
    const rows = (await p.db.query(read("supabase/checks/m3_post_migration.sql"))).rows;
    expect(rows.filter((r) => r.result !== "OK"), JSON.stringify(rows, null, 1)).toEqual([]);
    expect(rows).toHaveLength(13);
    const before = (await (await createProject({ m3: false })).db.query(read("supabase/checks/m3_post_migration.sql"))).rows;
    expect(before.filter((r) => r.result === "STOP").length).toBeGreaterThan(8);
  });
  it("the post-seed check is all OK with the generated seed's numbers", async () => {
    const p = await createProject();
    const rows = (await p.db.query(read("supabase/checks/m3_post_seed.sql"))).rows;
    expect(rows.filter((r) => r.result !== "OK"), JSON.stringify(rows, null, 1)).toEqual([]);
    expect(COUNTS).toMatchObject({ sets: 7, requirements: 22, packages: 17, evidence: 67, harborVisible: { sets: 4, requirements: 17, packages: 11, evidence: 48 } });
  });
  it("the SQL Editor access tests all pass and leave nothing behind", async () => {
    const p = await createProject(), before = await snapshot(p.db);
    const r = await report(p.db, "supabase/tests/m3_access_editor.sql");
    expect(r.split("\n").filter((l) => l.startsWith("FAIL")), r.split("\n")[0]).toEqual([]);
    expect(r).toMatch(/^ACCESS TESTS: 63 passed, 0 failed/);
    expect(await snapshot(p.db)).toEqual(before);
  });
  it("milestone 1's and 2's access tests still all pass with milestone 3 applied and seeded", async () => {
    const p = await createProject();
    expect(await report(p.db, "supabase/tests/m1_access_editor.sql")).toMatch(/^ACCESS TESTS: 123 passed, 0 failed/);
    expect(await report(p.db, "supabase/tests/m2_access_editor.sql")).toMatch(/^ACCESS TESTS: \d+ passed, 0 failed/);
  });
});

describe("migration guards and rollback", () => {
  it("refuses without milestone 2, and refuses a second run", async () => {
    const q = await createProject({ m2: false });
    expect(await fails(q.db, read(MIGRATION))).toMatch(/milestone 2 not found: nothing changed/);
    const p = await createProject({ m3Seed: false });
    expect(await fails(p.db, read(MIGRATION))).toMatch(/role_requirement_sets already exists: nothing changed/);
  });
  it("milestone 2's rollback refuses while milestone 3 is applied", async () => {
    const p = await createProject({ m3Seed: false });
    expect(await fails(p.db, read("supabase/rollback/20261025120000_m2_down.sql"))).toMatch(/milestone 3 is applied: roll it back first/);
  });
  it("the rollback refuses while content exists; after the fictional cleanup it restores milestone 2 exactly, and the migration applies again", async () => {
    const m2only = await createProject({ m3: false });
    const shape = async (db) => one(db, `select string_agg(c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by c.relname, a.attnum)
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'app_private') and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped`);
    const cons = async (db) => one(db, `select string_agg(conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid), '; ' order by conrelid::regclass::text, conname) from pg_constraint where connamespace in ('public'::regnamespace, 'app_private'::regnamespace)`);
    const fns = async (db) => one(db, `select string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text) from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace)`);
    /* One project: milestone 2 only, then milestone 3 applied, seeded, cleaned up and rolled back. All must be as before. */
    const p = m2only;
    const want = { shape: await shape(p.db), cons: await cons(p.db), fns: await fns(p.db), data: await snapshot(p.db) };
    await p.db.exec(read(MIGRATION));
    await p.db.exec(read(SEED));
    expect(await fails(p.db, read(ROLLBACK))).toMatch(/milestone 3 content exists: remove it first/);
    await p.db.exec(read(REMOVE));
    expect(await m3Snapshot(p.db)).toEqual({ role_requirement_sets: 0, role_requirements: 0, submission_packages: 0, requirement_evidence: 0 });
    await p.db.exec(read(ROLLBACK));
    expect({ shape: await shape(p.db), cons: await cons(p.db), fns: await fns(p.db), data: await snapshot(p.db) }).toEqual(want);
    await p.db.exec(read(MIGRATION));
    await p.db.exec(read(SEED));
    expect((await p.db.query(read("supabase/checks/m3_post_seed.sql"))).rows.filter((r) => r.result !== "OK")).toEqual([]);
  });
});

describe("freeze rules: insert, update, delete and moving between parents", () => {
  it("published content, its evidence, agreed requirements and their sets cannot be changed by any route", async () => {
    const p = await createProject(), before = await snapshot(p.db);
    const cases = {
      "edit published text": `update public.submission_packages set why_shared = 'x' where id = ${P("ab-fsr", 1)}`,
      "edit published list": `update public.submission_packages set strengths = '{}' where id = ${P("ab-fsr", 1)}`,
      "edit published key facts": `update public.submission_packages set key_facts = '[]' where id = ${P("ab-fsr", 1)}`,
      "change published_at": `update public.submission_packages set published_at = now() - interval '1 day' where id = ${P("ab-fsr", 1)}`,
      "move a package to another submission": `update public.submission_packages set submission_id = ${S("tb-isl")} where id = ${P("ab-fsr", 1)}`,
      "move a package to another set": `update public.submission_packages set requirement_set_id = ${SET("isl", 2)} where id = ${P("je-isl", 2)}`,
      "move a draft package's evidence to a published package": `update public.requirement_evidence set package_id = ${P("je-isl", 1)} where package_id = ${P("je-isl", 2)}`,
      "edit evidence": `update public.requirement_evidence set source_label = null, status = 'not_evidenced' where package_id = ${P("ab-fsr", 1)}`,
      "add evidence": `insert into public.requirement_evidence (client_id, package_id, requirement_set_id, requirement_id, status, evidence) values (${HB}, ${P("ab-fsr", 1)}, ${SET("fsr", 1)}, ${REQ("fsr", 1, 1)}, 'not_evidenced', 'x')`,
      "delete evidence": `delete from public.requirement_evidence where package_id = ${P("ab-fsr", 1)}`,
      "delete a published package": `delete from public.submission_packages where id = ${P("ab-fsr", 1)}`,
      "delete a withdrawn package": `delete from public.submission_packages where id = ${P("do-rsm", 1)}`,
      "delete the submission": `delete from public.submissions where id = ${S("ab-fsr")}`,
      "delete the role": `delete from public.roles where id = md5('portal-m1:role:harbor:fsr')::uuid`,
      "delete the client": `delete from public.clients where id = ${HB}`,
      "edit an agreed requirement": `update public.role_requirements set text = 'x' where id = ${REQ("fsr", 1, 1)}`,
      "add a requirement to an agreed set": `insert into public.role_requirements (client_id, set_id, position, text, tier) values (${HB}, ${SET("fsr", 1)}, 9, 'x', 'must')`,
      "delete an agreed requirement": `delete from public.role_requirements where id = ${REQ("fsr", 1, 4)}`,
      "move a draft requirement into an agreed set": `update public.role_requirements set set_id = ${SET("fsr", 1)} where set_id = ${SET("isl", 2)}`,
      "relabel an agreed set": `update public.role_requirement_sets set label = 'x' where id = ${SET("fsr", 1)}`,
      "move an agreed set to another role": `update public.role_requirement_sets set role_id = md5('portal-m1:role:harbor:isl')::uuid where id = ${SET("fsr", 1)}`,
      "un-agree a set": `update public.role_requirement_sets set status = 'draft', agreed_on = null where id = ${SET("fsr", 1)}`,
      "delete an agreed set": `delete from public.role_requirement_sets where id = ${SET("fsr", 1)}`,
      "insert a set as agreed": `insert into public.role_requirement_sets (client_id, role_id, version, label, status, agreed_on) values (${HB}, md5('portal-m1:role:harbor:fsr')::uuid, 9, 'x', 'agreed', current_date)`,
      "insert a package as published": `insert into public.submission_packages (client_id, submission_id, role_id, requirement_set_id, version, state, why_shared, published_at) values (${HB}, ${S("ab-fsr")}, md5('portal-m1:role:harbor:fsr')::uuid, ${SET("fsr", 1)}, 9, 'published', 'x', now())`,
      "republish a withdrawn package": `update public.submission_packages set state = 'published' where id = ${P("do-rsm", 1)}`,
      "skip draft to superseded": `update public.submission_packages set state = 'superseded' where id = ${P("je-isl", 2)}`,
      "publish incomplete evidence directly": `update public.submission_packages set state = 'published' where id = ${P("je-isl", 2)}`,
      "republish a package on superseded requirements": `update public.submission_packages set state = 'paused' where id = md5('portal-m3:package:northwind:n1-ops:1')::uuid; update public.submission_packages set state = 'published' where id = md5('portal-m3:package:northwind:n1-ops:1')::uuid`,
    };
    const got = {};
    for (const [name, sql] of Object.entries(cases)) got[name] = await fails(p.db, `begin; ${sql}; commit;`);
    expect(got).toEqual({
      "edit published text": "package_frozen", "edit published list": "package_frozen", "edit published key facts": "package_frozen", "change published_at": "package_frozen",
      "move a package to another submission": "package_keys_are_fixed", "move a package to another set": "package_keys_are_fixed",
      "move a draft package's evidence to a published package": "evidence_keys_are_fixed", "edit evidence": "package_frozen", "add evidence": "package_frozen", "delete evidence": "package_frozen",
      "delete a published package": "package_frozen", "delete a withdrawn package": "package_frozen", "delete the submission": "package_frozen",
      "delete the role": "requirements_frozen", "delete the client": "requirements_frozen",
      "edit an agreed requirement": "requirements_frozen", "add a requirement to an agreed set": "requirements_frozen", "delete an agreed requirement": "requirements_frozen",
      "move a draft requirement into an agreed set": "requirement_keys_are_fixed", "relabel an agreed set": "requirements_frozen", "move an agreed set to another role": "set_keys_are_fixed",
      "un-agree a set": "requirements_frozen", "delete an agreed set": "requirements_frozen", "insert a set as agreed": "set_must_start_as_draft",
      "insert a package as published": "package_must_start_as_draft", "republish a withdrawn package": "package_state_change_not_allowed",
      "skip draft to superseded": "package_state_change_not_allowed", "publish incomplete evidence directly": "evidence_incomplete",
      "republish a package on superseded requirements": "set_not_agreed",
    });
    expect(await snapshot(p.db)).toEqual(before);
  });
  it("drafts stay editable: content, evidence and requirements change; a draft package or set deletes with its children", async () => {
    const p = await createProject();
    await p.db.exec(`update public.submission_packages set why_shared = 'Edited draft.', key_facts = '[{"label": "Notice period", "value": "2 weeks"}]' where id = ${P("je-isl", 2)}`);
    await p.db.exec(`update public.requirement_evidence set evidence = 'Edited.' where package_id = ${P("je-isl", 2)}`);
    await p.db.exec(`update public.role_requirements set text = 'Edited draft requirement' where set_id = ${SET("isl", 2)}`);
    expect(await one(p.db, `select why_shared from public.submission_packages where id = ${P("je-isl", 2)}`)).toBe("Edited draft.");
    await p.db.exec(`delete from public.submission_packages where id = ${P("je-isl", 2)}`);
    expect(await one(p.db, `select count(*)::int from public.requirement_evidence where package_id = ${P("je-isl", 2)}`)).toBe(0);
    await p.db.exec(`delete from public.role_requirement_sets where id = ${SET("isl", 2)}`);
    expect(await one(p.db, `select count(*)::int from public.role_requirements where set_id = ${SET("isl", 2)}`)).toBe(0);
  });
  it("text rules: whitespace-only or untrimmed text, empty list items, malformed key facts, and a missing source are refused", async () => {
    const p = await createProject();
    const upd = (set) => fails(p.db, `begin; update public.submission_packages set ${set} where id = ${P("je-isl", 2)}; commit;`);
    expect(await upd(`why_shared = E'\\t\\n'`)).toBe("23514");
    expect(await upd(`why_shared = ' padded'`)).toBe("23514");
    expect(await upd(`strengths = array['ok', '']`)).toBe("23514");
    expect(await upd(`strengths = array['ok', null]`)).toBe("23514");
    expect(await upd(`key_facts = '{"label": "x", "value": "y"}'`)).toBe("23514");
    expect(await upd(`key_facts = '[{"label": "x"}]'`)).toBe("23514");
    expect(await upd(`key_facts = '[{"label": "x", "value": "y", "extra": 1}]'`)).toBe("23514");
    expect(await upd(`key_facts = '[{"label": "x", "value": "y"}, {"label": "x", "value": "z"}]'`)).toBe("23514");
    expect(await fails(p.db, `begin; update public.requirement_evidence set status = 'supported', source_label = null where package_id = ${P("je-isl", 2)}; commit;`)).toBe("23514");
    expect(await fails(p.db, `begin; update public.requirement_evidence set status = 'not_evidenced', source_label = null where package_id = ${P("je-isl", 2)}; commit;`)).toBe("accepted");
    expect(await fails(p.db, `begin; update public.roles set summary = E' \\n' where id = md5('portal-m1:role:harbor:isl')::uuid; commit;`)).toBe("23514");
    expect(await fails(p.db, `begin; update public.roles set responsibilities = '{}' where id = md5('portal-m1:role:harbor:isl')::uuid; commit;`)).toBe("23514");
  });
});

describe("the fictional cleanup is separate and narrow", () => {
  it("without the setting, as a non-owner role with full write grants, or for another client, frozen content cannot be deleted", async () => {
    const p = await createProject();
    /* staff_writer: write grants and permissive policies on packages and evidence. evidence_writer: a policy on evidence
       only, so row-level security hides the parent package from it; the guard still sees the parent (it reads as owner). */
    await p.db.exec(`create role staff_writer nologin; create role evidence_writer nologin; create role no_helpers nologin;
      grant usage on schema public, app_private to staff_writer, evidence_writer, no_helpers;
      grant all on all tables in schema public to staff_writer, evidence_writer, no_helpers;
      grant execute on all functions in schema app_private to staff_writer, evidence_writer;
      create policy t_pkg on public.submission_packages for all to staff_writer, no_helpers using (true) with check (true);
      create policy t_ev on public.requirement_evidence for all to staff_writer, evidence_writer, no_helpers using (true) with check (true);`);
    const before = await snapshot(p.db);
    expect(await fails(p.db, `begin; delete from public.submission_packages where id = ${P("ab-fsr", 1)}; commit;`)).toBe("package_frozen");
    expect(await fails(p.db, `begin; set local role staff_writer; select set_config('app.m3_fictional_cleanup', 'on', true);
      delete from public.submission_packages where id = ${P("ab-fsr", 1)}; commit;`)).toBe("package_frozen");
    expect(await fails(p.db, `begin; set local role evidence_writer; select set_config('app.m3_fictional_cleanup', 'on', true);
      delete from public.requirement_evidence where package_id = ${P("ab-fsr", 1)}; commit;`)).toBe("package_frozen");
    expect(await fails(p.db, `begin; set local role evidence_writer; update public.requirement_evidence set evidence = 'x' where package_id = ${P("ab-fsr", 1)}; commit;`)).toBe("package_frozen");
    /* Without EXECUTE on the guard helpers, writes fail closed. */
    expect(await fails(p.db, `begin; set local role no_helpers; delete from public.requirement_evidence where package_id = ${P("je-isl", 2)}; commit;`)).toBe("42501");
    expect(await snapshot(p.db)).toEqual(before);
    /* A third (non-fictional) client with its own published package: the owner's cleanup setting does not reach it. */
    await p.db.exec(`insert into public.clients (id, ref, name) values (md5('t:client')::uuid, 'other', 'Other Co');
      insert into public.roles (id, client_id, ref, title, status, opened_on) values (md5('t:role')::uuid, md5('t:client')::uuid, 'r', 'Role', 'Open', '2026-10-01');
      insert into public.people (id, client_id, ref, name) values (md5('t:person')::uuid, md5('t:client')::uuid, 'p', 'Person');
      insert into public.submissions (id, client_id, ref, role_id, person_id, stage, shared_on, publication) values (md5('t:sub')::uuid, md5('t:client')::uuid, 's', md5('t:role')::uuid, md5('t:person')::uuid, 'To review', '2026-10-01', 'published');
      insert into public.role_requirement_sets (id, client_id, role_id, version, label) values (md5('t:set')::uuid, md5('t:client')::uuid, md5('t:role')::uuid, 1, 'Version 1');
      insert into public.role_requirements (client_id, set_id, position, text, tier) values (md5('t:client')::uuid, md5('t:set')::uuid, 1, 'Requirement', 'must');
      select app_private.agree_requirement_set(md5('t:set')::uuid, '2026-10-01');
      insert into public.submission_packages (id, client_id, submission_id, role_id, requirement_set_id, version, why_shared) values (md5('t:pkg')::uuid, md5('t:client')::uuid, md5('t:sub')::uuid, md5('t:role')::uuid, md5('t:set')::uuid, 1, 'Why.');
      insert into public.requirement_evidence (client_id, package_id, requirement_set_id, requirement_id, status, evidence) select md5('t:client')::uuid, md5('t:pkg')::uuid, md5('t:set')::uuid, id, 'not_evidenced', 'Not mentioned.' from public.role_requirements where set_id = md5('t:set')::uuid;
      select app_private.publish_package(md5('t:pkg')::uuid);`);
    const other = await m3Snapshot(p.db);
    await p.db.exec(read(REMOVE));
    expect(await m3Snapshot(p.db)).toEqual({ role_requirement_sets: 1, role_requirements: 1, submission_packages: 1, requirement_evidence: 1 });
    expect(other.submission_packages).toBe(COUNTS.packages + 1);
    expect(await fails(p.db, `begin; select set_config('app.m3_fictional_cleanup', 'on', true); delete from public.submission_packages where id = md5('t:pkg')::uuid; commit;`)).toBe("package_frozen");
  });
  it("the cleanup removes only milestone 3 content (milestones 1 and 2 untouched); the setting ends with its transaction", async () => {
    const p = await createProject();
    const m12 = async () => { const s = await snapshot(p.db); for (const t of m3Tables) delete s[`public.${t}`]; return s; };
    const roleCols = "select count(*)::int from public.roles where summary is not null or responsibilities is not null or job_description is not null or hold_note is not null";
    const before = await m12();
    expect(await one(p.db, roleCols)).toBe(5);
    await p.db.exec(read(REMOVE));
    const after = await m12();
    /* The role descriptions are cleared; every other milestone 1 and 2 row is exactly as before. */
    const strip = (s) => ({ ...s, "public.roles": JSON.parse(s["public.roles"]).map(({ summary, responsibilities, job_description, hold_note, ...r }) => r) });
    expect(strip(after)).toEqual(strip(before));
    expect(await one(p.db, roleCols)).toBe(0);
    expect(await one(p.db, "select coalesce(current_setting('app.m3_fictional_cleanup', true), '')")).toBe("");
    /* After the cleanup, milestone 1's reset works again; before it, it is refused by the frozen content. */
    const q = await createProject();
    expect(await fails(q.db, read("supabase/seed/m1_reset_fictional.sql"))).toBe("requirements_frozen");
    await q.db.exec(read(REMOVE));
    await q.db.exec(read("supabase/seed/m1_reset_fictional.sql"));
  });
});

describe("publication is atomic and safe against the other orderings", () => {
  it("publish_package replaces the published version in one transaction; a failure after it keeps the old one", async () => {
    const p = await createProject();
    await p.db.exec(draftJe3);
    await expect(p.db.exec(`begin; select app_private.publish_package(md5('t:je3')::uuid); select 1/0; commit;`)).rejects.toThrow(/division by zero/);
    await p.db.exec("rollback");
    expect((await p.db.query(`select version, state from public.submission_packages where submission_id = ${S("je-isl")} order by version`)).rows)
      .toEqual([{ version: 1, state: "published" }, { version: 2, state: "draft" }, { version: 3, state: "draft" }]);
    await p.db.exec(`select app_private.publish_package(md5('t:je3')::uuid)`);
    expect((await p.db.query(`select version, state from public.submission_packages where submission_id = ${S("je-isl")} order by version`)).rows)
      .toEqual([{ version: 1, state: "superseded" }, { version: 2, state: "draft" }, { version: 3, state: "published" }]);
    const H = p.ids["portal-test-harbor@example.com"];
    expect((await asUser(p.db, H, `select string_agg(version::text, ',') as v from public.submission_packages where submission_id = ${S("je-isl")}`)).rows[0].v).toBe("3");
  });
  it("two published versions are refused at commit (deferred), in either order, and nothing changes", async () => {
    const p = await createProject();
    await p.db.exec(draftJe3);
    const before = await snapshot(p.db);
    expect(await fails(p.db, `begin; update public.submission_packages set state = 'published' where id = md5('t:je3')::uuid; commit;`)).toBe("23P01");
    expect(await snapshot(p.db)).toEqual(before);
    /* Inside one transaction the order does not matter, as long as only one is published at commit. */
    await p.db.exec(`begin; update public.submission_packages set state = 'published' where id = md5('t:je3')::uuid;
      update public.submission_packages set state = 'superseded' where id = ${P("je-isl", 1)}; commit;`);
    expect(await one(p.db, `select string_agg(version::text, ',') from public.submission_packages where submission_id = ${S("je-isl")} and state = 'published'`)).toBe("3");
  });
  it("agree_requirement_set replaces the agreed set atomically; two agreed sets are refused at commit", async () => {
    const p = await createProject();
    await p.db.exec(`insert into public.role_requirement_sets (id, client_id, role_id, version, label) values (md5('t:fsr2')::uuid, ${HB}, md5('portal-m1:role:harbor:fsr')::uuid, 2, 'Version 2');
      insert into public.role_requirements (client_id, set_id, position, text, tier) values (${HB}, md5('t:fsr2')::uuid, 1, 'New requirement', 'must');`);
    expect(await fails(p.db, `begin; update public.role_requirement_sets set status = 'agreed', agreed_on = current_date where id = md5('t:fsr2')::uuid; commit;`)).toBe("23P01");
    expect(await fails(p.db, `begin; select app_private.agree_requirement_set(${SET("isl", 2)}, null); commit;`)).toBe("invalid_request");
    await p.db.exec(`select app_private.agree_requirement_set(md5('t:fsr2')::uuid, '2026-10-20')`);
    expect((await p.db.query(`select version, status from public.role_requirement_sets where role_id = md5('portal-m1:role:harbor:fsr')::uuid order by version`)).rows)
      .toEqual([{ version: 1, status: "superseded" }, { version: 2, status: "agreed" }]);
    /* Aisha Bello's package is on version 1, so it is hidden until re-reviewed; nothing about it changed. */
    const H = p.ids["portal-test-harbor@example.com"];
    expect((await asUser(p.db, H, `select count(*)::int as n from public.submission_packages where submission_id = ${S("ab-fsr")}`)).rows[0].n).toBe(0);
    expect(await one(p.db, `select state from public.submission_packages where id = ${P("ab-fsr", 1)}`)).toBe("published");
    expect(await fails(p.db, `begin; select app_private.agree_requirement_set(${SET("fsr", 1)}, current_date); commit;`)).toBe("set_not_draft");
    expect(await fails(p.db, `begin; insert into public.role_requirement_sets (id, client_id, role_id, version, label) values (md5('t:empty')::uuid, ${HB}, md5('portal-m1:role:harbor:fsr')::uuid, 3, 'Empty'); select app_private.agree_requirement_set(md5('t:empty')::uuid, current_date); commit;`)).toBe("set_has_no_requirements");
  });
  it("the other orderings: evidence removed before publishing makes it incomplete; evidence changed after publishing is refused", async () => {
    const p = await createProject();
    await p.db.exec(draftJe3);
    expect(await fails(p.db, `begin; delete from public.requirement_evidence where package_id = md5('t:je3')::uuid and requirement_id = ${REQ("isl", 1, 5)};
      select app_private.publish_package(md5('t:je3')::uuid); commit;`)).toBe("evidence_incomplete");
    await p.db.exec(`select app_private.publish_package(md5('t:je3')::uuid)`);
    expect(await fails(p.db, `begin; delete from public.requirement_evidence where package_id = md5('t:je3')::uuid; commit;`)).toBe("package_frozen");
    expect(await fails(p.db, `begin; update public.submission_packages set state = 'paused' where id = md5('t:je3')::uuid; update public.requirement_evidence set evidence = 'x' where package_id = md5('t:je3')::uuid; commit;`)).toBe("package_frozen");
  });
  it("the concurrency locks are in place: child writes share-lock their parent; replacements lock the submission or role first", async () => {
    const p = await createProject();
    const src = async (fn) => one(p.db, `select prosrc from pg_proc where oid = '${fn}'::regprocedure`);
    expect(await src("app_private.m3_lock_package(uuid)")).toMatch(/from public\.submission_packages where id = p_package_id for share/);
    expect(await src("app_private.m3_lock_set(uuid)")).toMatch(/from public\.role_requirement_sets where id = p_set_id for share/);
    expect(await src("app_private.evidence_guard()")).toMatch(/st := app_private\.m3_lock_package\(e\.package_id\)/);
    expect(await src("app_private.requirements_guard()")).toMatch(/st := app_private\.m3_lock_set\(r\.set_id\)/);
    expect(await src("app_private.packages_guard()")).toMatch(/set_status := app_private\.m3_lock_set\(new\.requirement_set_id\)/);
    /* The lookups run as the owner, so a writer's row-level security cannot hide a parent. */
    expect(await one(p.db, "select bool_and(prosecdef)::text from pg_proc where proname in ('m3_lock_set', 'm3_lock_package', 'm3_requirement_count', 'm3_evidence_count')")).toBe("true");
    expect(await src("app_private.publish_package(uuid)")).toMatch(/from public\.submissions where id = p\.submission_id for no key update/);
    expect(await src("app_private.agree_requirement_set(uuid, date)")).toMatch(/from public\.roles where id = s\.role_id for no key update/);
  });
});
