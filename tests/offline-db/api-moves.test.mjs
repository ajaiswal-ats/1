/* The API move tests and their restore SQL, run end to end against the offline stand-in (no network, no hosted project). */
import { describe, expect, it } from "vitest";
import { KEY, PASSWORDS, URL_BASE, asUser, createProject, snapshot } from "./fake-supabase.mjs";
import { newRecord, restoreSql, runMoves, targetId, validateRecord } from "../../scripts/db/api-moves-lib.mjs";
import { seedId } from "../../scripts/db/api-read-lib.mjs";

async function run(project, { fetch = project.fetch } = {}) {
  const record = newRecord("abcdefghijklmnopqrst"), lines = [], saved = [];
  const fails = await runMoves({ fetch, url: URL_BASE, key: KEY, passwords: PASSWORDS, log: (l) => lines.push(l), record, save: (r) => saved.push(JSON.stringify(r)) });
  return { record, lines, saved, fails };
}
const restore = async (db, record) => {
  const results = await db.exec(restoreSql(record));
  return results.at(-1).rows;
};
const refused = async (db, record) => {
  try { await db.exec(restoreSql(record)); return null; } catch (e) { return e.message; }
};
const allOk = (rows) => rows.every((r) => r.result === "OK");
describe("a complete run", () => {
  it("passes every check, writes exactly 3 moves, and keeps no secret in the record or output", async () => {
    const p = await createProject();
    const { record, lines, saved, fails } = await run(p);
    expect(lines.filter((l) => l.startsWith("FAIL"))).toEqual([]);
    expect(fails).toBe(0);
    const n = (await p.db.query("select (select count(*) from public.submission_events where source = 'portal')::int as e, (select count(*) from app_private.idempotency_keys)::int as k")).rows[0];
    expect(n).toEqual({ e: 3, k: 3 });
    const text = [...lines, ...saved].join("\n");
    for (const s of [KEY, ...Object.values(PASSWORDS), "eyJ"]) expect(text).not.toContain(s);
    expect(record.requests.filter((r) => !r.patch).every((r) => /^[0-9a-f-]{36}$/.test(r.key) && r.state === "answered")).toBe(true);
    expect(record.baseline["ab-fsr"]).toMatchObject({ stage: "To review", version: 1, source: "api" });
    expect(record.baseline["ab-fsr"].updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("is undone exactly by its restore SQL, which is then safe to run again", async () => {
    const p = await createProject();
    const before = await snapshot(p.db);
    const { record } = await run(p);
    expect(await snapshot(p.db)).not.toEqual(before);
    expect(allOk(await restore(p.db, record))).toBe(true);
    expect(await snapshot(p.db)).toEqual(before);   // seed events, memberships, updated_at: all identical
    expect(allOk(await restore(p.db, record))).toBe(true);
    expect(await snapshot(p.db)).toEqual(before);
  });
});

describe("partial runs", () => {
  it("network lost part-way: restores what was written, and only that", async () => {
    const p = await createProject();
    const before = await snapshot(p.db);
    let calls = 0;
    const fetch = async (url, init) => { if (url.includes("/rpc/") && ++calls >= 3) throw new Error("network down"); return p.fetch(url, init); };
    const { record, fails } = await run(p, { fetch });
    expect(fails).toBeGreaterThan(0);
    expect(record.requests.some((r) => r.state === "unknown")).toBe(true);
    expect((await p.db.query("select count(*)::int as n from public.submission_events where source = 'portal'")).rows[0].n).toBe(1);
    expect(allOk(await restore(p.db, record))).toBe(true);
    expect(await snapshot(p.db)).toEqual(before);
  });

  it("a response lost after the server wrote the move: the key lookup still finds and restores it", async () => {
    const p = await createProject();
    const before = await snapshot(p.db);
    let lost = false;
    const fetch = async (url, init) => { const r = await p.fetch(url, init); if (url.includes("/rpc/") && !lost) { lost = true; throw new Error("response lost"); } return r; };
    const { record } = await run(p, { fetch });
    expect(record.requests.find((r) => r.step === "A1").state).toBe("unknown");
    expect(allOk(await restore(p.db, record))).toBe(true);
    expect(await snapshot(p.db)).toEqual(before);
  });

  it("stopped at sign-in (wrong password): no move is sent and the restore finds nothing to do", async () => {
    const p = await createProject();
    const before = await snapshot(p.db);
    const record = newRecord("abcdefghijklmnopqrst");
    const fails = await runMoves({ fetch: p.fetch, url: URL_BASE, key: KEY, passwords: { ...PASSWORDS, harbor: "typo" }, log: () => {}, record, save: () => {} });
    expect(fails).toBeGreaterThan(0);
    expect(record.requests).toEqual([]);
    expect(allOk(await restore(p.db, record))).toBe(true);
    expect(await snapshot(p.db)).toEqual(before);
  });
});

describe("the restore refuses, and changes nothing, when", () => {
  const setup = async () => { const p = await createProject(); const { record } = await run(p); return { p, record }; };

  it("a later move on a target is not from this run", async () => {
    const { p, record } = await setup();
    await asUser(p.db, p.ids["portal-test-harbor@example.com"], "select public.client_move_stage($1, 'Offer', 2, gen_random_uuid())", [targetId("ab-fsr")]);
    const after = await snapshot(p.db);
    expect(await refused(p.db, record)).toMatch(/RESTORE REFUSED[\s\S]*ab-fsr has 1 change\(s\) after the baseline that are not from this run/);
    expect(await snapshot(p.db)).toEqual(after);
  });

  it("an unrelated portal move exists elsewhere in the fictional clients", async () => {
    const { p, record } = await setup();
    await asUser(p.db, p.ids["portal-test-harbor@example.com"], "select public.client_move_stage($1, 'To review', 2, gen_random_uuid())", [seedId("submission", "harbor", "so-pa")]);
    const after = await snapshot(p.db);
    expect(await refused(p.db, record)).toMatch(/portal move not made by this run[\s\S]*idempotency key .* was not made by this run/);
    expect(await snapshot(p.db)).toEqual(after);
  });

  it("a target was changed outside the portal action", async () => {
    const { p, record } = await setup();
    await p.db.exec("update public.submissions set stage = 'Hired' where ref = 'pr-isl'");
    const after = await snapshot(p.db);
    expect(await refused(p.db, record)).toMatch(/pr-isl is Hired v2, which does not match its history/);
    expect(await snapshot(p.db)).toEqual(after);
  });

  it("a seed event under a target is gone", async () => {
    const { p, record } = await setup();
    await p.db.exec("delete from public.submission_events where submission_id = md5('portal-m1:submission:harbor:tb-rsm')::uuid and submission_version = 2");
    const after = await snapshot(p.db);
    expect(await refused(p.db, record)).toMatch(/tb-rsm/);
    expect(await snapshot(p.db)).toEqual(after);
  });

  it("a key row no longer matches its event", async () => {
    const { p, record } = await setup();
    await p.db.exec("update app_private.idempotency_keys set result = jsonb_set(result, '{stage}', '\"Hired\"') where submission_id = md5('portal-m1:submission:harbor:ab-fsr')::uuid");
    const after = await snapshot(p.db);
    expect(await refused(p.db, record)).toMatch(/does not match an event it created/);
    expect(await snapshot(p.db)).toEqual(after);
  });
});

describe("a second run before the first is restored", () => {
  it("stops at pre-flight without writing, and its restore refuses because of the first run's moves", async () => {
    const p = await createProject();
    const first = await run(p);
    const mid = await snapshot(p.db);
    const second = await run(p);
    expect(second.lines.some((l) => /FAIL .*baseline/.test(l))).toBe(true);
    expect(second.record.requests).toEqual([]);
    expect(await snapshot(p.db)).toEqual(mid);
    expect(await refused(p.db, second.record)).toMatch(/portal move not made by this run/);
    expect(allOk(await restore(p.db, first.record))).toBe(true);
  });
});

describe("run records", () => {
  it("are validated before any value is put into SQL", () => {
    const record = newRecord("abcdefghijklmnopqrst");
    record.baseline["ab-fsr"] = { submission_id: targetId("ab-fsr"), client: "harbor", stage: "To review", version: 1, updated_at: null, source: "api" };
    record.requests.push({ step: "A1", ref: "ab-fsr", submission_id: targetId("ab-fsr"), key: crypto.randomUUID(), state: "sent" });
    expect(() => validateRecord(record)).not.toThrow();
    expect(() => validateRecord({ ...record, baseline: { "ab-fsr": { ...record.baseline["ab-fsr"], stage: "x'; drop table people; --" } } })).toThrow(/not valid/);
    expect(() => validateRecord({ ...record, requests: [{ ...record.requests[0], key: "not-a-uuid" }] })).toThrow(/not valid/);
    expect(() => validateRecord({ ...record, requests: [{ ...record.requests[0], submission_id: targetId("tb-isl") }] })).toThrow(/not valid/);
    expect(() => validateRecord({ ...record, baseline: { ...record.baseline, "do-rsm": { ...record.baseline["ab-fsr"] } } })).toThrow(/not valid/);
  });
});
