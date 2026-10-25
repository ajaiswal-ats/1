/* The read-only Auth and Data API checks (scripts/db/api-read-lib.mjs), run end to end against the offline stand-in for
   the current hosted baseline (milestones 1-4 and 6 seeded): every check passes; only GET data reads are sent, Auth
   requests are separate, and every session is signed out; nothing secret or candidate-related is printed; and wrong-client
   rows, hidden rows and wrong identities are caught even when the row counts are unchanged. */
import { describe, expect, it } from "vitest";
import { KEY, PASSWORDS, URL_BASE, createProject } from "./fake-supabase.mjs";
import { READS, assertReadsOnly, labelId, runChecks, seedId } from "../../scripts/db/api-read-lib.mjs";

const NW = seedId("client", "northwind");
async function run(p, tamper) {
  const lines = [], calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ method: init.method || "GET", path: new URL(url).pathname + new URL(url).search });
    const res = await p.fetch(url, init);
    const rule = tamper?.find((t) => decodeURIComponent(String(url)).includes(t.when));
    if (!rule || res.status !== 200) return res;
    const body = rule.change(await res.json());
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const fails = await runChecks({ fetch, url: URL_BASE, key: KEY, passwords: PASSWORDS, log: (l) => lines.push(l) });
  return { fails, lines, calls, failed: lines.filter((l) => l.startsWith("FAIL")) };
}

describe("against the current baseline", () => {
  it("every check passes; data requests are GET reads of tables only; Auth requests are separate; every session is signed out", async () => {
    const p = await createProject({ m6: true }), r = await run(p);
    expect(r.failed, r.failed.join("\n")).toEqual([]);
    expect(r.fails).toBe(0);
    const data = r.calls.filter((c) => c.path.startsWith("/rest/v1/")), auth = r.calls.filter((c) => c.path.startsWith("/auth/v1/"));
    expect(data.length).toBe(READS.length);
    expect(data.every((c) => c.method === "GET" && !c.path.startsWith("/rest/v1/rpc/"))).toBe(true);
    expect(auth.length + data.length).toBe(r.calls.length);
    expect(auth.filter((c) => c.method === "POST" && c.path.startsWith("/auth/v1/logout")).length).toBe(4);
    expect(r.calls.at(-1).path).toMatch(/^\/auth\/v1\/logout/);
  });
  it("prints no password, token, key or candidate text", async () => {
    const p = await createProject({ m6: true }), r = await run(p), out = r.lines.join("\n");
    for (const pw of Object.values(PASSWORDS)) expect(out).not.toContain(pw);
    expect(out).not.toContain(KEY);
    expect(out).not.toMatch(/eyJ|Bearer/);
    const names = [...(await p.db.query("select name from public.people")).rows.map((x) => x.name), "Casey Lund", "Robin Hale"];
    const text = (await p.db.query("select summary from public.screening_summaries union all select why_shared from public.submission_packages union all select evidence from public.requirement_evidence")).rows.map((x) => x.summary);
    for (const t of [...names, ...text]) expect(out).not.toContain(t);
  });
  it("the request list refuses anything but plain table reads", () => {
    expect(() => assertReadsOnly(READS)).not.toThrow();
    expect(() => assertReadsOnly([{ path: "rpc/client_move_stage?select=*" }])).toThrow(/not a plain GET read/);
    expect(() => assertReadsOnly([{ path: "submissions?select=id", method: "PATCH" }])).toThrow();
    expect(() => assertReadsOnly([{ path: "submissions", want: {} }])).toThrow();
  });
  it("against the baseline before milestone 6, the milestone 6 expectations fail (they describe the current baseline)", async () => {
    const r = await run(await createProject());
    expect(r.fails).toBeGreaterThan(0);
    expect(r.failed.some((l) => l.includes("screening_summaries"))).toBe(true);
  });
});

describe("caught even when the row counts are unchanged", () => {
  const m6pkg = (ref) => labelId(`portal-m6:package:harbor:${ref}`), m3pkg = (ref, v) => labelId(`portal-m3:package:harbor:${ref}:${v}`);
  const cases = [
    ["a Harbor package row with another client's id", { when: "submission_packages?select=id,client_id,submission_id,state", change: (b) => b.map((x, i) => (i ? x : { ...x, client_id: NW })) }, /client_id: 1 row not as expected/],
    ["a hidden (superseded) package in place of a visible one", { when: "submission_packages?select=id,client_id,submission_id,state", change: (b) => b.map((x) => (x.id === m6pkg("tb-isl") ? { ...x, id: m3pkg("tb-isl", 1) } : x)) }, /id\/submission_id pairs: 1 unexpected, 1 missing/],
    ["a package on the wrong requirement set", { when: "submission_packages?select=id,requirement_set_id", change: (b) => b.map((x, i) => (i ? x : { ...x, requirement_set_id: labelId("portal-m3:set:harbor:isl:2") })) }, /id\/requirement_set_id pairs: 1 unexpected/],
    ["an evidence row moved to another package (total still 48)", { when: "requirement_evidence?select=client_id,package_id,requirement_set_id", change: (b) => { const to = b.find((x) => x.package_id !== b[0].package_id && x.requirement_set_id === b[0].requirement_set_id); return b.map((x, i) => (i ? x : { ...x, package_id: to.package_id })); } }, /rows per package_id: 2 values with the wrong count/],
    ["two summaries swapped between packages", { when: "screening_summaries?select=id,client_id,package_id", change: (b) => b.map((x, i) => (i === 0 ? { ...x, package_id: b[1].package_id } : i === 1 ? { ...x, package_id: b[0].package_id } : x)) }, /id\/package_id pairs: 2 unexpected, 2 missing/],
    ["a recorded outcome on the wrong submission", { when: "offer_outcomes?select=client_id,submission_id,status", change: (b) => b.map((x, i) => (i ? x : { ...x, submission_id: seedId("submission", "harbor", "tb-isl") })) }, /submission_id\/status pairs: 1 unexpected, 1 missing/],
    ["Northwind: the unpublished submission's interview in place of a visible one", { when: "client_interviews?select=id,client_id,submission_id", change: (b) => b.map((x) => (x.id === labelId("portal-m4:interview:northwind:n1-ops:2") ? { ...x, id: labelId("portal-m4:interview:northwind:n2-ops:1") } : x)) }, /id\/submission_id pairs: 1 unexpected, 1 missing/],
    ["a known hidden row returned when asked for by id", { when: `submission_packages?select=id&id=eq.${m3pkg("je-isl", 2)}`, change: () => [{ id: m3pkg("je-isl", 2) }] }, /draft package\) — HTTP 200, 1 row \(expected HTTP 200, 0 rows\)/],
    ["another client's row returned when asked for by id", { when: `screening_summaries?select=id&id=eq.${labelId("portal-m6:screening:harbor:tb-isl")}`, change: () => [{ id: "x" }] }, /Harbor summary, by id\) — HTTP 200, 1 row/],
  ];
  for (const [what, rule, line] of cases) {
    it(what, async () => {
      const r = await run(await createProject({ m6: true }), [rule]);
      expect(r.failed.length, r.failed.join("\n")).toBeGreaterThan(0);
      expect(r.failed.join("\n")).toMatch(line);
      expect(r.failed.join("\n")).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);             // ids are not printed either
    });
  }
});
