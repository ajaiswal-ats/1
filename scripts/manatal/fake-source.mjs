/* An in-memory FAKE Manatal for local tests of the inbound preview (T05). It is not Manatal and proves nothing about
   Manatal's real behaviour: it only imitates field and path names that Manatal documents (match, job, candidate and
   organisation records; paginated lists as {count, next, previous, results}; 404 and 429 statuses), and it can be told to
   misbehave (faults, changing pages, duplicates) so the preview's local handling can be tested. Real field types, id types,
   ordering, pagination, error bodies and rate-limit headers are unverified until the read-only feasibility tests (M03).

   It is reachable only through the `fetch` function it returns, on a fixed fake base URL that cannot resolve. Nothing here
   touches the network, reads credentials or writes anywhere. */

export const FAKE_BASE = "https://fake-manatal.invalid/open/v3";

const json = (status, body) => ({ status, json: async () => body });
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

/** `records`: { organizations, jobs, candidates } keyed by id, and `matches` as an ordered list.
    `pageSize`: matches per list page. `pages`: optional explicit list pages (arrays of matches), for drift and duplicates.
    `next`: optional (page, total) => next URL or null, to test links that leave the base or loop.
    `faults`: [{ when: (call) => boolean, status?, body?, throw? }], checked in order before answering; `call` is
    { n, path, page }. Every request is recorded in `calls`. */
export function createFakeManatal({ records, pageSize = 2, pages = null, next = null, faults = [] }) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    if (typeof url !== "string" || !url.startsWith(`${FAKE_BASE}/`)) throw new Error("fake Manatal: not a fake URL");
    const u = new URL(url), path = u.pathname.slice(new URL(FAKE_BASE).pathname.length), page = Number(u.searchParams.get("page") || 1);
    const call = { n: calls.length + 1, path, page, method: init.method ?? "GET", headers: { ...(init.headers ?? {}) } };
    calls.push(call);
    for (const f of faults) {
      if (!f.when(call)) continue;
      if (f.throw) throw new Error(f.throw);
      return json(f.status, f.body ?? {});
    }
    if (call.method !== "GET") return json(405, {});
    if (path === "/matches/") {
      const all = pages ?? chunk(records.matches, pageSize), total = all.length;
      if (page < 1 || page > Math.max(total, 1)) return json(404, {});
      const nextUrl = next ? next(page, total) : page < total ? `${FAKE_BASE}/matches/?page=${page + 1}&page_size=${pageSize}` : null;
      return json(200, { count: all.flat().length, next: nextUrl, previous: page > 1 ? `${FAKE_BASE}/matches/?page=${page - 1}&page_size=${pageSize}` : null, results: clone(all[page - 1] ?? []) });
    }
    const m = path.match(/^\/(organizations|jobs|candidates)\/([^/]+)\/$/);
    if (m) {
      const rec = records[m[1]]?.[decodeURIComponent(m[2])];
      return rec ? json(200, clone(rec)) : json(404, {});
    }
    return json(404, {});
  };
  return { fetch, calls };
}

const chunk = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out.length ? out : [[]]; };
