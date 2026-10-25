/* Test helper: an in-memory stand-in for the Data API's paged reads, with an optional server row cap (like Supabase's
   "Max rows"). Honours order (ascending), gt and limit as PostgREST does. `onPage` can change the tables between pages.
   A table not given does not exist (error 42P01). */
import type { PageQuery, WorkspaceDb } from "./data";

type Row = Record<string, unknown>;
export interface FakeDbOptions { cap?: number; errors?: Record<string, unknown>; onPage?: (table: string, page: number) => void; ignore?: "gt" | "order" }

export function fakeDb(tables: Record<string, Row[]>, opts: FakeDbOptions = {}) {
  const requests: string[] = [], pages: Record<string, number> = {};
  const db: WorkspaceDb = {
    from(table) {
      return {
        select(cols) {
          let orderBy: string | null = null, gt: [string, unknown] | null = null, limit = Infinity;
          const q = {
            order(col: string) { orderBy = col; return q; },
            gt(col: string, v: unknown) { gt = [col, v]; return q; },
            limit(n: number) { limit = n; return q; },
            then(resolve: (r: { data: Row[] | null; error: unknown }) => unknown, reject?: (e: unknown) => unknown) {
              const page = (pages[table] = (pages[table] ?? 0) + 1);
              requests.push(`${table} select=${cols} order=${orderBy} gt=${gt ? gt[1] : "-"} limit=${limit}`);
              opts.onPage?.(table, page);
              if (opts.errors?.[table]) return Promise.resolve({ data: null, error: opts.errors[table] }).then(resolve, reject);
              /* A table the fake was not given does not exist, as on a database without that milestone. */
              if (!(table in tables)) return Promise.resolve({ data: null, error: { code: "42P01", message: `relation "public.${table}" does not exist` } }).then(resolve, reject);
              let out = (tables[table] ?? []).slice();
              const cmp = (a: unknown, b: unknown) => (typeof a === "number" && typeof b === "number" ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
              if (orderBy && opts.ignore !== "order") out.sort((a, b) => cmp(a[orderBy!], b[orderBy!]));
              if (gt && opts.ignore !== "gt") out = out.filter((r) => cmp(r[gt![0]], gt![1]) > 0);
              out = out.slice(0, Math.min(limit, opts.cap ?? Infinity));
              return Promise.resolve({ data: out, error: null }).then(resolve, reject);
            },
          };
          return q as unknown as PageQuery;
        },
      };
    },
  };
  return { db, requests };
}
