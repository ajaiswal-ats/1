/* The inbound import preview (T05) against the FAKE Manatal: local behaviour only. These tests do not verify Manatal's real
   fields, ids, pagination, ordering, change signals or error formats; that is the read-only feasibility step (M03). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { FAKE_BASE, createFakeManatal } from "./fake-source.mjs";
import { CLIENTS, MAPPING, PRIVATE, STAGES, baseRecords } from "./fake-fixtures.mjs";
import { createMapping } from "./inbound-mapping.mjs";
import { previewImport } from "./import-preview.mjs";
import { BASE_URL } from "./feasibility-lib.mjs";

const mapping = createMapping(MAPPING);
const noWait = async () => {};
const T1 = "2026-10-21T09:00:00Z", T2 = "2026-10-22T09:00:00Z", T3 = "2026-10-23T09:00:00Z", T_OLD = "2026-10-19T09:00:00Z";
async function run(records, { known = null, ...opts } = {}, fake = {}) {
  const src = createFakeManatal({ records, ...fake });
  const p = await previewImport({ fetch: src.fetch, wait: opts.wait ?? noWait, mapping, known, ...opts });
  return { p, calls: src.calls };
}
const item = (p, id) => p.items.find((i) => i.match === `manatal:match:${id}`);
const accepted = async (records) => (await run(records)).p.state;

afterEach(() => vi.restoreAllMocks());

describe("first import and repeats", () => {
  it("first import: mapped items for Harbor and Northwind only, all unpublished and not client-visible", async () => {
    const { p } = await run(baseRecords());
    expect([p.complete, p.actionable, p.stopped]).toEqual([true, true, null]);
    expect(p.items.map((i) => [i.match, i.status, i.clientId])).toEqual([
      ["manatal:match:m-1", "new", CLIENTS.harbor], ["manatal:match:m-2", "new", CLIENTS.harbor],
      ["manatal:match:m-3", "new", CLIENTS.northwind], ["manatal:match:m-4", "excluded", null]]);
    expect(item(p, "m-1").stage).toEqual({ key: "p1:s3", staffLabel: "To review", provisional: true });
    expect(item(p, "m-2").stage.staffLabel).toBeNull();                         // early stage: not shared, still only a label
    expect(p.items.every((i) => i.publication === "unpublished" && i.clientVisible === false)).toBe(true);
    expect(p.mapping).toMatch(/provisional/);
  });
  it("a repeat import with no change: everything unchanged, no transitions, the same accepted state", async () => {
    const first = await accepted(baseRecords());
    const { p } = await run(baseRecords(), { known: first });
    expect(p.items.filter((i) => i.clientId).map((i) => i.status)).toEqual(["unchanged", "unchanged", "unchanged"]);
    expect(p.items.flatMap((i) => i.transitions)).toEqual([]);
    expect(p.state).toEqual(first);
  });
});

describe("change detection", () => {
  it("a newer match with a new stage is a change with one observed transition; repeated legitimate moves are kept as separate transitions", async () => {
    const r = baseRecords();
    let state = await accepted(r);
    const moves = [[STAGES.interview, T1], [STAGES.review, T2], [STAGES.interview, T3]], seen = [];
    for (const [s, at] of moves) {
      Object.assign(r.matches[0], { job_pipeline_stage: s, updated_at: at });
      const { p } = await run(r, { known: state });
      expect(item(p, "m-1").status).toBe("changed");
      seen.push(...item(p, "m-1").transitions);
      state = p.state;
    }
    expect(seen.map((t) => `${t.from}→${t.to}`)).toEqual(["p1:s3→p1:s4", "p1:s4→p1:s3", "p1:s3→p1:s4"]);
    expect(new Set(seen.map((t) => t.id)).size).toBe(3);                         // Interview → To review → Interview: both entries into Interview kept
  });
  it("only observed transitions: two moves between runs show as one transition from the last accepted stage", async () => {
    const r = baseRecords(), state = await accepted(r);
    Object.assign(r.matches[0], { job_pipeline_stage: STAGES.offer, updated_at: T2 });   // review → interview → offer happened between runs
    const { p } = await run(r, { known: state });
    expect(item(p, "m-1").transitions.map((t) => `${t.from}→${t.to}`)).toEqual(["p1:s3→p1:s5"]);
  });
  it("an older record is stale: flagged and not applied", async () => {
    const r = baseRecords(), state = await accepted(r);
    Object.assign(r.matches[0], { job_pipeline_stage: STAGES.hired, updated_at: T_OLD });
    const { p } = await run(r, { known: state });
    expect(item(p, "m-1").status).toBe("stale");
    expect(item(p, "m-1").transitions).toEqual([]);
    expect(p.state.matches["m-1"].match.job_pipeline_stage.id).toBe("s3");
  });
  it("regression: same timestamp, different content is a conflict, never unchanged, and is not applied", async () => {
    const r = baseRecords(), state = await accepted(r);
    r.matches[0].job_pipeline_stage = STAGES.offer;                              // updated_at unchanged
    const { p } = await run(r, { known: state });
    expect(item(p, "m-1").status).toBe("conflict");
    expect(item(p, "m-1").flags.join()).toMatch(/match: content changed without a timestamp change \(job_pipeline_stage\)/);
    expect(item(p, "m-1").transitions).toEqual([]);
    expect(p.state.matches["m-1"]).toEqual(state.matches["m-1"]);
  });
  it("regression: job and candidate changes are detected without a match timestamp change, each on its own record", async () => {
    const r = baseRecords(), state = await accepted(r);
    Object.assign(r.jobs["job-h1"], { position_name: "Fictional Sales Lead (renamed)", updated_at: T1 });
    Object.assign(r.candidates["cand-2"], { full_name: "Fictional Person Two (renamed)", updated_at: T1 });
    const { p } = await run(r, { known: state });
    expect([item(p, "m-1").status, item(p, "m-1").changes]).toEqual(["changed", { job: ["position_name"] }]);
    expect([item(p, "m-2").status, item(p, "m-2").changes]).toEqual(["changed", { job: ["position_name"], candidate: ["full_name"] }]);
    expect(item(p, "m-3").status).toBe("unchanged");
    /* A job edit with an unchanged job timestamp is a conflict too. */
    const r2 = baseRecords(), s2 = await accepted(r2);
    r2.jobs["job-n1"].status = "on_hold";
    expect(item((await run(r2, { known: s2 })).p, "m-3").status).toBe("conflict");
  });
});

describe("rejected items keep their accepted state (review findings)", () => {
  const rejected = (p, state, id) => {
    expect(item(p, id).changes).toEqual({});
    expect(item(p, id).transitions).toEqual([]);
    expect(p.state.matches[id]).toEqual(state.matches[id]);
  };
  it("a newer match with a stale linked job is rejected as a whole: no changes, no transition, previous state kept", async () => {
    const r = baseRecords(), state = await accepted(r);
    Object.assign(r.matches[0], { job_pipeline_stage: STAGES.interview, updated_at: T1 });
    Object.assign(r.jobs["job-h1"], { position_name: "Fictional Older Title", updated_at: T_OLD });
    const { p } = await run(r, { known: state });
    expect(item(p, "m-1").status).toBe("stale");
    rejected(p, state, "m-1");
  });
  it("a newer match with a conflicting linked candidate is rejected as a whole", async () => {
    const r = baseRecords(), state = await accepted(r);
    Object.assign(r.matches[0], { job_pipeline_stage: STAGES.interview, updated_at: T1 });
    r.candidates["cand-1"].full_name = "Fictional Person One (edited, same timestamp)";
    const { p } = await run(r, { known: state });
    expect(item(p, "m-1").status).toBe("conflict");
    rejected(p, state, "m-1");
  });
  it("timestamps compare as instants: the same instant with another offset is unchanged, an earlier instant is stale, a later one is a change", async () => {
    const r = baseRecords(), state = await accepted(r);                          // match updated_at 2026-10-20T09:00:00Z
    r.matches[0].updated_at = "2026-10-20T14:30:00+05:30";                       // same instant, no content change
    expect(item((await run(r, { known: state })).p, "m-1").status).toBe("unchanged");
    Object.assign(r.matches[0], { job_pipeline_stage: STAGES.interview });          // same instant, content changed
    const same = (await run(r, { known: state })).p;
    expect(item(same, "m-1").status).toBe("conflict");
    rejected(same, state, "m-1");
    r.matches[0].updated_at = "2026-10-20T10:00:00+05:30";                       // 04:30Z: earlier, though it sorts later as text
    const earlier = (await run(r, { known: state })).p;
    expect(item(earlier, "m-1").status).toBe("stale");
    rejected(earlier, state, "m-1");
    r.matches[0].updated_at = "2026-10-20T08:00:00-05:00";                       // 13:00Z: later, though it sorts earlier as text
    const later = (await run(r, { known: state })).p;
    expect([item(later, "m-1").status, item(later, "m-1").transitions.length]).toEqual(["changed", 1]);
  });
  it("invalid or missing timestamps are flagged and never accepted, on first import or later", async () => {
    for (const bad of ["not a date", "2026-13-45T09:00:00Z", "2026-10-20T09:00:00", null]) {
      const r = baseRecords();
      r.matches[0].updated_at = bad;
      const first = (await run(r)).p;
      expect(item(first, "m-1").status, String(bad)).toBe("invalid");
      expect(first.state.matches["m-1"]).toBeUndefined();
      const r2 = baseRecords(), state = await accepted(r2);
      Object.assign(r2.matches[0], { job_pipeline_stage: STAGES.interview, updated_at: bad });
      const later = (await run(r2, { known: state })).p;
      expect(item(later, "m-1").status, String(bad)).toBe("invalid");
      rejected(later, state, "m-1");
    }
  });
  it("a move between two organisations mapped to the same client is still a reassignment, routed to neither", async () => {
    const r = baseRecords(), local = createMapping({ ...MAPPING, organizations: { ...MAPPING.organizations, "org-h2": CLIENTS.harbor } });
    r.organizations["org-h2"] = { id: "org-h2", name: "Fictional Harbor Second Org", updated_at: "2026-10-20T09:00:00Z" };
    const src0 = createFakeManatal({ records: r }), state = (await previewImport({ fetch: src0.fetch, wait: noWait, mapping: local })).state;
    Object.assign(r.jobs["job-h1"], { organization: "org-h2", updated_at: T1 });
    for (const m of r.matches.filter((x) => x.job === "job-h1")) Object.assign(m, { organization: "org-h2", updated_at: T1 });
    const p = await previewImport({ fetch: createFakeManatal({ records: r }).fetch, wait: noWait, mapping: local, known: state });
    for (const id of ["m-1", "m-2"]) {
      expect(item(p, id)).toMatchObject({ status: "reassigned", clientId: null, candidate: null });
      rejected(p, state, id);
    }
  });
});

describe("links and client isolation", () => {
  it("invalid links: a missing candidate and a job of another organisation are flagged and excluded; a missing record is not a deletion", async () => {
    const r = baseRecords();
    r.matches[0].candidate = "cand-missing";
    r.matches[1].job = "job-n1";                                                 // Northwind's job on a Harbor match
    const { p } = await run(r);
    expect([item(p, "m-1").status, item(p, "m-2").status]).toEqual(["invalid", "invalid"]);
    expect(item(p, "m-1").flags[0]).toMatch(/linked candidate not returned \(not treated as deleted\)/);
    expect(item(p, "m-2").flags[0]).toMatch(/different organisation than the match/);
    expect([item(p, "m-1").clientId, item(p, "m-2").clientId]).toEqual([null, null]);
  });
  it("the same person under two clients stays two separate client items; an unmapped organisation is excluded", async () => {
    const { p } = await run(baseRecords());
    expect([item(p, "m-1").candidate.id, item(p, "m-3").candidate.id]).toEqual(["manatal:candidate:cand-1", "manatal:candidate:cand-1"]);
    expect([item(p, "m-1").clientId, item(p, "m-3").clientId]).toEqual([CLIENTS.harbor, CLIENTS.northwind]);
    expect(item(p, "m-4")).toMatchObject({ status: "excluded", clientId: null, candidate: null, title: null });
  });
  it("a job moved to another client is flagged as reassigned and routed to neither client", async () => {
    const r = baseRecords(), state = await accepted(r);
    Object.assign(r.jobs["job-h1"], { organization: "org-n", updated_at: T1 });
    for (const m of r.matches.filter((x) => x.job === "job-h1")) Object.assign(m, { organization: "org-n", updated_at: T1 });
    const { p } = await run(r, { known: state });
    for (const id of ["m-1", "m-2"]) expect(item(p, id)).toMatchObject({ status: "reassigned", clientId: null, candidate: null });
    expect(p.state.matches["m-1"].clientId).toBe(CLIENTS.harbor);                // the accepted link is kept until staff resolve it
  });
  it("unknown stages are flagged, including one whose name matches a known stage; dropped matches are flagged, not Declined", async () => {
    const r = baseRecords();
    r.matches[0].job_pipeline_stage = { id: "s99", name: "Client review", rank: 3, job_pipeline: "p1" };
    Object.assign(r.matches[2], { is_active: false, dropped_at: "2026-10-20T10:00:00Z" });
    const { p } = await run(r);
    expect(item(p, "m-1").stage).toEqual({ key: "p1:s99", staffLabel: null, provisional: true });
    expect(item(p, "m-1").flags).toContain("unknown pipeline stage (not mapped by name)");
    expect(item(p, "m-3").flags.join()).toMatch(/inactive or dropped in the source: needs staff review \(not mapped to Declined\)/);
    expect(item(p, "m-3").stage.staffLabel).toBe("Interview");
  });
  it("ids are opaque: \"007\" and \"7\" are different records", async () => {
    const r = baseRecords();
    r.candidates["007"] = { id: "007", full_name: "Fictional Zero Zero Seven", updated_at: "2026-10-20T09:00:00Z" };
    r.candidates["7"] = { id: "7", full_name: "Fictional Seven", updated_at: "2026-10-20T09:00:00Z" };
    r.matches[0].candidate = "007"; r.matches[1].candidate = 7;
    const { p } = await run(r);
    expect([item(p, "m-1").candidate.id, item(p, "m-2").candidate.id]).toEqual(["manatal:candidate:007", "manatal:candidate:7"]);
  });
});

describe("pagination", () => {
  const pages = (r) => [[r.matches[0]], [r.matches[1]], [r.matches[2], r.matches[3]]];
  it("reads every page in order, following the source's next links", async () => {
    const r = baseRecords(), { p, calls } = await run(r, {}, { pages: pages(r) });
    expect(calls.filter((c) => c.path === "/matches/").map((c) => c.page)).toEqual([1, 2, 3]);
    expect(p.items.map((i) => i.match)).toEqual(["m-1", "m-2", "m-3", "m-4"].map((x) => `manatal:match:${x}`));
  });
  it("identical duplicates across pages collapse into one record", async () => {
    const r = baseRecords(), { p } = await run(r, {}, { pages: [[r.matches[0], r.matches[1]], [structuredClone(r.matches[1]), r.matches[2]]] });
    expect([p.duplicatesCollapsed, p.items.length, p.actionable]).toEqual([1, 3, true]);
  });
  it("regression: the same id with different content across pages makes the run inconsistent; neither copy is used", async () => {
    const r = baseRecords(), state = await accepted(r);
    const other = { ...structuredClone(r.matches[1]), job_pipeline_stage: STAGES.hired };
    for (const order of [[r.matches[1], other], [other, r.matches[1]]]) {         // first-seen and last-seen give the same result
      const { p } = await run(r, { known: state }, { pages: [[r.matches[0], order[0]], [order[1], r.matches[2]]] });
      expect([p.complete, p.actionable, p.state]).toEqual([true, false, null]);
      expect(p.flags).toContainEqual(expect.objectContaining({ type: "conflicting duplicate", match: "manatal:match:m-2" }));
      expect(item(p, "m-2")).toBeUndefined();
    }
  });
  it("a next link outside the source, a page loop, and too many pages each stop the run as incomplete", async () => {
    const r = baseRecords();
    const outside = (await run(r, {}, { next: () => `${BASE_URL}/matches/?page=2` })).p;
    const loop = (await run(r, {}, { next: () => `${FAKE_BASE}/matches/?page=1&page_size=2` })).p;
    const limit = (await run(r, { maxPages: 1 })).p;
    for (const [p, why] of [[outside, /outside the source/], [loop, /loop/], [limit, /page limit/]]) {
      expect([p.complete, p.actionable, p.state]).toEqual([false, false, null]);
      expect(p.stopped).toMatch(why);
    }
  });
});

describe("failures, retries and interrupted runs", () => {
  const at = (path, page) => (c) => c.path === path && (page === undefined || c.page === page);
  it("a 429 is retried after the fixed backoff and then succeeds", async () => {
    let n = 0;
    const waits = [], { p } = await run(baseRecords(), { wait: async (ms) => waits.push(ms) }, { faults: [{ when: (c) => at("/jobs/job-h1/")(c) && n++ < 2, status: 429 }] });
    expect([p.complete, p.waits, waits]).toEqual([true, [1000, 2000], [1000, 2000]]);
  });
  it("persistent 429s, 500s and network errors stop the run as incomplete after the retries", async () => {
    for (const fault of [{ status: 429 }, { status: 500 }, { throw: "socket hang up" }]) {
      const { p, calls } = await run(baseRecords(), {}, { faults: [{ when: at("/candidates/cand-1/"), ...fault }] });
      expect([p.complete, p.actionable, p.state]).toEqual([false, false, null]);
      expect(calls.filter((c) => c.path === "/candidates/cand-1/")).toHaveLength(4);   // first try + 3 retries
    }
  });
  it("401 and 403 stop at once without a retry", async () => {
    for (const status of [401, 403]) {
      const { p, calls } = await run(baseRecords(), {}, { faults: [{ when: at("/matches/", 1), status }] });
      expect(p.stopped).toMatch(new RegExp(`HTTP ${status}, access refused \\(not retried\\)`));
      expect(calls).toHaveLength(1);
    }
  });
  it("an interrupted run is incomplete and changes no state; a rerun gives the same result as an uninterrupted run", async () => {
    const r = baseRecords(), state = await accepted(r);
    Object.assign(r.matches[0], { job_pipeline_stage: STAGES.interview, updated_at: T1 });
    const cut = (await run(r, { known: state }, { faults: [{ when: at("/matches/", 2), throw: "connection reset" }] })).p;
    expect([cut.complete, cut.state, cut.notSeen]).toEqual([false, null, []]);
    const rerun = (await run(r, { known: state })).p, clean = (await run(r, { known: state })).p;
    expect(rerun).toEqual(clean);
    expect(item(rerun, "m-1").transitions).toHaveLength(1);
  });
  it("regression: a match missing from a complete run, a failed request or a cut-off page never implies deletion, withdrawal or reassignment", async () => {
    const r = baseRecords(), state = await accepted(r);
    r.matches.splice(1, 1);                                                      // m-2 no longer listed
    const { p } = await run(r, { known: state });
    expect(p.notSeen).toEqual(["manatal:match:m-2"]);
    expect(p.state.matches["m-2"]).toEqual(state.matches["m-2"]);               // kept as last accepted; nothing removed
    const failed = (await run(baseRecords(), { known: state }, { faults: [{ when: at("/jobs/job-n1/"), status: 500 }] })).p;
    const cutOff = (await run(baseRecords(), { known: state }, { faults: [{ when: at("/matches/", 2), status: 503 }] })).p;
    for (const x of [p, failed, cutOff]) {
      expect(JSON.stringify([x.items, x.flags, x.notSeen])).not.toMatch(/delet|withdraw|reassign|removed/i);
    }
    expect([failed.state, cutOff.state, cutOff.notSeen]).toEqual([null, null, []]);
  });
});

describe("safety boundaries", () => {
  it("keeps only allowlisted fields: no contact details, files, notes or custom values anywhere, including errors", async () => {
    const outputs = [(await run(baseRecords())).p, (await run(baseRecords(), {}, { faults: [{ when: (c) => c.path === "/candidates/cand-1/", status: 500 }] })).p];
    for (const p of outputs) for (const v of PRIVATE) expect(JSON.stringify(p)).not.toContain(v);
  });
  it("runs only against the fake source: no real URL, no default or global fetch, GET only, no credentials sent", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(previewImport({ fetch: createFakeManatal({ records: baseRecords() }).fetch, wait: noWait, mapping, baseUrl: BASE_URL })).rejects.toThrow(/only against the fake source/);
    await expect(previewImport({ fetch: globalThis.fetch, wait: noWait, mapping })).rejects.toThrow(/needs the fake source's fetch/);
    await expect(previewImport({ wait: noWait, mapping })).rejects.toThrow(/needs the fake source's fetch/);
    const { calls } = await run(baseRecords());
    expect(calls.every((c) => c.method === "GET" && !("Authorization" in c.headers))).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});
