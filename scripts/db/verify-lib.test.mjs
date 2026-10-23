/* Checks for the verification query and its judgement, without a database. */
import { describe, expect, it } from "vitest";
import { GUARDED, VERIFY_SQL, assess } from "./verify-lib.mjs";

describe("verification query", () => {
  const lines = VERIFY_SQL.split("\n");
  it.each(GUARDED)("%s: %s is only read inside the branch that runs when it exists and is readable", (label, table) => {
    const uses = lines.map((l, i) => [l, i]).filter(([l]) => l.includes(table));
    for (const [l, i] of uses) {
      const isGuardCheck = l.includes(`to_regclass('${table}')`) && !/\bfrom\s/.test(l.replace(/to_regclass\('[^']+'\)/g, ""));
      const isGuardedRead = /\bfrom\s/.test(l) && /^\\if :\w+_readable$/.test(lines[i - 1]);
      expect(isGuardCheck || isGuardedRead, `line ${i + 1}: ${l}`).toBe(true);
    }
    expect(uses.filter(([l]) => /\bfrom\s/.test(l))).toHaveLength(1);
  });
  it("names no guarded table inside a CASE, and stays in a read-only transaction", () => {
    expect(VERIFY_SQL).not.toMatch(/case\s+when[^;]*supabase_migrations/is);
    expect(VERIFY_SQL.trim().split("\n")[0]).toBe("begin transaction read only;");
    expect(VERIFY_SQL.trim().split("\n").at(-1)).toBe("rollback;");
    expect(VERIFY_SQL).not.toMatch(/\b(insert|update|delete|create|drop|alter|grant|revoke|truncate)\b/i);
  });
});

describe("judging the results", () => {
  const empty = { server: "postgres · PostgreSQL 17", user_schemas: "", public_relations: "", public_functions: "", public_types: "0", policies: "0",
    auth_users: "0", storage_buckets: "0", storage_objects: "0", migration_history: "absent" };
  const refs = { url: "abcd1234", db: "abcd1234" };
  const verdict = (v, r = refs) => Object.fromEntries(assess(v, r).map(([label, , ok]) => [label, ok]));
  it("an empty project passes, with no migration history table at all", () => {
    expect(Object.values(verdict(empty)).every(Boolean)).toBe(true);
  });
  it("migration history: absent or 0 is fine; any recorded migration stops", () => {
    expect(verdict({ ...empty, migration_history: "0" })["migration history"]).toBe(true);
    expect(verdict({ ...empty, migration_history: "3" })["migration history"]).toBe(false);
  });
  it("a table that exists but cannot be read stops the check instead of passing or crashing", () => {
    expect(verdict({ ...empty, auth_users: "not readable" })["auth users"]).toBe(false);
    expect(verdict({ ...empty, migration_history: "not readable" })["migration history"]).toBe(false);
  });
  it("no auth.users table means this is not a normal Supabase project: stop", () => {
    expect(verdict({ ...empty, auth_users: "absent" })["auth users"]).toBe(false);
  });
  it("existing data, or mismatched project references, stop", () => {
    expect(verdict({ ...empty, public_relations: "profiles (r)" })["tables, views or sequences in public"]).toBe(false);
    expect(verdict({ ...empty, auth_users: "2" })["auth users"]).toBe(false);
    expect(verdict(empty, { url: "abcd1234", db: "zzzz9999" })["project reference in SUPABASE_DB_URL"]).toBe(false);
  });
  it("a value missing from the results stops", () => {
    const { storage_objects, ...partial } = empty;
    expect(verdict(partial)["storage files"]).toBe(false);
  });
});
