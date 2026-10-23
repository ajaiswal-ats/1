/* Checks for the rollback order and what each kind of failure leaves, without a database. */
import { describe, expect, it } from "vitest";
import { runRollback } from "./rollback-lib.mjs";

const harness = ({ dropFails = false, deleteFails = false, noKey = false } = {}) => {
  const calls = [], log = [];
  const opts = {
    dropDatabaseObjects: async () => { calls.push("drop"); if (dropFails) throw new Error("drop failed"); },
    deleteTestUsers: noKey ? null : async () => { calls.push("delete users"); if (deleteFails) throw new Error("HTTP 500"); return 4; },
    log: (m) => log.push(m),
  };
  return { calls, log, run: () => runRollback(opts) };
};

describe("rollback", () => {
  it("drops the database objects before deleting Auth users", async () => {
    const h = harness();
    expect(await h.run()).toEqual({ ok: true, step: "done" });
    expect(h.calls).toEqual(["drop", "delete users"]);
  });
  it("if the database step fails, no Auth user is touched and nothing changed", async () => {
    const h = harness({ dropFails: true });
    expect(await h.run()).toEqual({ ok: false, step: "database" });
    expect(h.calls).toEqual(["drop"]);
    expect(h.log.join("\n")).toMatch(/Nothing was changed/);
  });
  it("if Auth deletion stops part-way, it says the database is clean and how to finish", async () => {
    const h = harness({ deleteFails: true });
    expect(await h.run()).toEqual({ ok: false, step: "auth" });
    expect(h.log.join("\n")).toMatch(/database is already clean/);
    expect(h.log.join("\n")).toMatch(/npm run db:users -- --delete/);
  });
  it("without a service role key, the database step runs and the Auth step is skipped with instructions", async () => {
    const h = harness({ noKey: true });
    expect(await h.run()).toEqual({ ok: true, step: "database-only" });
    expect(h.calls).toEqual(["drop"]);
    expect(h.log.join("\n")).toMatch(/npm run db:users -- --delete/);
  });
});
