/* The signed-in user's membership and client, read with the user's own session (row-level security returns only an
   active membership of this user, and only its client). Read-only. Rows are checked strictly: a missing or malformed field
   is an error, never filled in from the demo data. */
import type { Account } from "./session";

interface Result<T> { data: T[] | null; error: unknown }
/** The parts of the supabase-js query builder used here (so tests can pass a fake). */
export interface Db {
  from(table: string): { select(cols: string): { eq(col: string, value: string): { limit(n: number): PromiseLike<Result<Record<string, unknown>>> } } };
}

const str = (v: unknown, allowEmpty = false): v is string => typeof v === "string" && (allowEmpty || v.trim() !== "");

export async function loadAccount(db: Db, userId: string): Promise<Account> {
  const m = await db.from("client_members").select("id, client_id, display_name, job_title").eq("user_id", userId).limit(2);
  if (m.error || !m.data) throw new Error("membership could not be read");
  if (m.data.length === 0) return { kind: "none" };
  if (m.data.length > 1) throw new Error("more than one membership");
  const row = m.data[0];
  if (!str(row.id) || !str(row.client_id) || !str(row.display_name) || !str(row.job_title, true)) throw new Error("membership is incomplete");

  const c = await db.from("clients").select("id, name").eq("id", row.client_id).limit(2);
  if (c.error || !c.data || c.data.length !== 1) throw new Error("client could not be read");
  const client = c.data[0];
  if (client.id !== row.client_id || !str(client.name)) throw new Error("client is incomplete");

  return { kind: "active", member: { id: row.id, clientId: row.client_id, displayName: row.display_name, jobTitle: row.job_title }, client: { id: client.id, name: client.name } };
}
