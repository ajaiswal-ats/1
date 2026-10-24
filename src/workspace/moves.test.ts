/* Stage changes: one key per intended move, retries with the same key, confirmed success only, conflicts, uncertain
   outcomes, duplicate clicks and account changes. A fake client_move_stage stands in for the server. */
import { describe, expect, it } from "vitest";
import { MOVE_MESSAGES, createMoveController, moveTargets, type MoveRequest, type RpcOutcome } from "./moves";

const flush = () => new Promise((r) => setTimeout(r, 0));
const A = "ua:harbor", B = "ub:northwind";
const sub = { id: "s1", version: 3 };
const ok = (r: MoveRequest): RpcOutcome => ({ kind: "ok", result: { submission_id: r.submissionId, stage: r.toStage, version: r.expectedVersion + 1, event_id: 99 } });

/** A server whose answers are given one by one by the test; records every request. */
function server() {
  const calls: MoveRequest[] = [], waiting: ((o: RpcOutcome) => void)[] = [];
  const rpc = (r: MoveRequest) => { calls.push(r); return new Promise<RpcOutcome>((res) => waiting.push(res)); };
  const answer = (o: RpcOutcome | ((r: MoveRequest) => RpcOutcome)) => { const res = waiting.shift()!; res(typeof o === "function" ? o(calls[calls.length - 1 - waiting.length]) : o); };
  return { rpc, calls, answer, waiting };
}
function setup() {
  const s = server(), refreshes: number[] = [];
  let k = 0;
  const c = createMoveController(s.rpc, () => refreshes.push(1), { newKey: () => `key-${++k}`, wait: () => Promise.resolve() });
  c.sync(A);
  return { s, c, refreshes };
}

describe("a confirmed move", () => {
  it("sends the version the user saw and a new key, shows success only after the server confirms, then refreshes", async () => {
    const { s, c, refreshes } = setup();
    expect(c.move(A, sub, "Interview")).toBe(true);
    expect(s.calls).toEqual([{ submissionId: "s1", toStage: "Interview", expectedVersion: 3, key: "key-1" }]);
    expect(c.getState()).toMatchObject({ status: "saving", attempt: 0 });
    expect(refreshes).toHaveLength(0);
    s.answer(ok); await flush();
    expect(c.getState()).toEqual({ status: "saved", account: A, submissionId: "s1", toStage: "Interview" });
    expect(refreshes).toHaveLength(1);
  });
  it("ignores a second click while saving (no second request, no second key)", async () => {
    const { s, c } = setup();
    c.move(A, sub, "Interview");
    expect(c.move(A, sub, "Interview")).toBe(false);
    expect(c.move(A, { id: "s2", version: 1 }, "Offer")).toBe(false);
    expect(s.calls).toHaveLength(1);
  });
  it("a new intended move gets a new key", async () => {
    const { s, c } = setup();
    c.move(A, sub, "Interview"); s.answer(ok); await flush(); c.dismiss();
    c.move(A, { id: "s1", version: 4 }, "Offer"); s.answer(ok); await flush();
    expect(s.calls.map((x) => x.key)).toEqual(["key-1", "key-2"]);
  });
  it("an answer that does not match the request is not shown as success", async () => {
    const { s, c, refreshes } = setup();
    c.move(A, sub, "Interview");
    s.answer({ kind: "ok", result: { submission_id: "s1", stage: "Offer", version: 4, event_id: 1 } }); await flush();
    expect(c.getState()).toMatchObject({ status: "failed", message: MOVE_MESSAGES.unexpected });
    expect(refreshes).toHaveLength(1);
  });
});

describe("uncertain outcomes", () => {
  it("no answer: the same request and key are sent again automatically, and a stored success resolves it", async () => {
    const { s, c, refreshes } = setup();
    c.move(A, sub, "Interview");
    s.answer({ kind: "uncertain" }); await flush();
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1]).toEqual(s.calls[0]);
    expect(c.getState()).toMatchObject({ status: "saving", attempt: 1 });
    s.answer(ok); await flush();
    expect(c.getState().status).toBe("saved");
    expect(refreshes).toHaveLength(1);
  });
  it("still no answer: uncertain (not failed); Check again sends the same request and key once more", async () => {
    const { s, c } = setup();
    c.move(A, sub, "Interview");
    s.answer({ kind: "uncertain" }); await flush(); s.answer({ kind: "uncertain" }); await flush();
    expect(c.getState()).toMatchObject({ status: "uncertain", request: { key: "key-1", expectedVersion: 3 } });
    expect(c.move(A, { id: "s2", version: 1 }, "Offer")).toBe(false);        // blocked until resolved
    c.retry();
    expect(s.calls).toHaveLength(3);
    expect(new Set(s.calls.map((x) => JSON.stringify(x))).size).toBe(1);
    s.answer(ok); await flush();
    expect(c.getState().status).toBe("saved");
  });
  it("a request that throws counts as uncertain too", async () => {
    let n = 0;
    const c = createMoveController(async () => { n++; throw new Error("socket hang up"); }, () => {}, { wait: () => Promise.resolve() });
    c.sync(A); c.move(A, sub, "Interview"); await flush(); await flush();
    expect(n).toBe(2);
    expect(c.getState().status).toBe("uncertain");
  });
  it("leaving an unresolved move refreshes the data, so the screen shows what the server has", async () => {
    const { s, c, refreshes } = setup();
    c.move(A, sub, "Interview");
    s.answer({ kind: "uncertain" }); await flush(); s.answer({ kind: "uncertain" }); await flush();
    c.dismiss();
    expect(c.getState()).toEqual({ status: "idle" });
    expect(refreshes).toHaveLength(1);
  });
});

describe("conflicts and refusals", () => {
  it("a stale version is a conflict: refreshed, not retried against the newer version", async () => {
    const { s, c, refreshes } = setup();
    c.move(A, sub, "Offer");
    s.answer({ kind: "error", code: "version_conflict" }); await flush();
    expect(c.getState()).toEqual({ status: "conflict", account: A, submissionId: "s1" });
    expect(s.calls).toHaveLength(1);
    expect(refreshes).toHaveLength(1);
  });
  it("refusals get their own message and a refresh", async () => {
    for (const [code, message] of [["move_not_permitted", MOVE_MESSAGES.notPermitted], ["submission_not_found", MOVE_MESSAGES.notFound], ["not_a_client_member", MOVE_MESSAGES.access], ["42501", MOVE_MESSAGES.access], ["idempotency_key_reused", MOVE_MESSAGES.other]]) {
      const { s, c, refreshes } = setup();
      c.move(A, sub, "Offer"); s.answer({ kind: "error", code }); await flush();
      expect(c.getState(), code).toMatchObject({ status: "failed", message });
      expect(refreshes, code).toHaveLength(1);
    }
  });
});

describe("account changes", () => {
  it("a late success after sign-out or an account switch is ignored: no message, no refresh", async () => {
    for (const next of [null, B]) {
      const { s, c, refreshes } = setup();
      c.move(A, sub, "Interview");
      c.sync(next);
      expect(c.getState()).toEqual({ status: "idle" });
      s.answer(ok); await flush();
      expect(c.getState()).toEqual({ status: "idle" });
      expect(refreshes).toHaveLength(0);
    }
  });
  it("an automatic retry does not continue for a previous account", async () => {
    const s = server();
    let release!: () => void;
    const c = createMoveController(s.rpc, () => {}, { wait: () => new Promise<void>((r) => { release = r; }) });
    c.sync(A); c.move(A, sub, "Interview");
    s.answer({ kind: "uncertain" }); await flush();
    c.sync(B); release(); await flush();
    expect(s.calls).toHaveLength(1);
    expect(c.getState()).toEqual({ status: "idle" });
  });
  it("a move for another account than the signed-in one is refused", () => {
    const { s, c } = setup();
    expect(c.move(B, sub, "Interview")).toBe(false);
    expect(s.calls).toHaveLength(0);
  });
});

describe("development test-run record (dev server only; not used in production)", () => {
  it("records each request, with its exact key, before sending it, and its outcome after", async () => {
    const s = server(), log: string[] = [];
    const c = createMoveController((r) => { log.push(`send ${r.key}`); return s.rpc(r); }, () => {}, {
      newKey: () => "key-1", wait: () => Promise.resolve(),
      record: async (e) => { log.push(e.phase === "sent" ? `record ${e.key} v${e.expected_version} ${e.seen_stage}→${e.to_stage} #${e.attempt}` : `outcome ${e.key} ${e.outcome}`); },
    });
    c.sync(A);
    c.move(A, { id: "s1", version: 3, stage: "Interview" }, "Offer");
    await flush();
    s.answer({ kind: "uncertain" }); await flush(); await flush();
    s.answer(ok); await flush();
    expect(log).toEqual(["record key-1 v3 Interview→Offer #0", "send key-1", "outcome key-1 uncertain", "record key-1 v3 Interview→Offer #1", "send key-1", "outcome key-1 ok"]);
  });
  it("if the record cannot be saved, nothing is sent", async () => {
    const s = server();
    const c = createMoveController(s.rpc, () => {}, { record: async () => { throw new Error("dev server down"); } });
    c.sync(A); c.move(A, { id: "s1", version: 3, stage: "Interview" }, "Offer"); await flush();
    expect(s.calls).toHaveLength(0);
    expect(c.getState()).toMatchObject({ status: "failed", message: MOVE_MESSAGES.notRecorded });
  });
  it("records the outcome even when the account changed meanwhile (the server may have saved it)", async () => {
    const s = server(), outcomes: string[] = [];
    const c = createMoveController(s.rpc, () => {}, { record: async (e) => { if (e.phase === "outcome") outcomes.push(e.outcome); } });
    c.sync(A); c.move(A, { id: "s1", version: 3, stage: "Interview" }, "Offer"); await flush();
    c.sync(B); s.answer(ok); await flush();
    expect(outcomes).toEqual(["ok"]);
    expect(c.getState()).toEqual({ status: "idle" });
  });
});

describe("provisional move rule (development only)", () => {
  const role = (status: "Open" | "On hold" | "Closed") => ({ id: "r", title: "R", location: "", status, openedOn: "2026-10-01", recruiterName: "" });
  const at = (stage: "To review" | "Interview" | "Offer" | "Hired" | "Declined") => ({ id: "s", roleId: "r", personId: "p", stage, sharedOn: "2026-10-01", version: 1 });
  it("open roles only; not from Offer, Hired or Declined; any other stage", () => {
    expect(moveTargets(at("To review"), role("Open"))).toEqual(["Interview", "Offer", "Hired"]);
    expect(moveTargets(at("Interview"), role("Open"))).toEqual(["To review", "Offer", "Hired"]);
    for (const st of ["Offer", "Hired", "Declined"] as const) expect(moveTargets(at(st), role("Open"))).toEqual([]);
    expect(moveTargets(at("To review"), role("On hold"))).toEqual([]);
    expect(moveTargets(at("To review"), role("Closed"))).toEqual([]);
  });
});
