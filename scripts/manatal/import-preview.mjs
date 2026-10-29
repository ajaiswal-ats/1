/* Inbound import PREVIEW from the fake Manatal (T05): local preparation only. It reads the fake source through the
   `fetch` it is given, keeps only allowlisted fields, checks links and client mapping, compares with the last accepted
   state, and returns an in-memory preview for staff. It writes nothing (no files, no database), publishes nothing, and
   nothing in it is client-visible: every item is `unpublished`, and stage mappings are provisional staff-side labels that
   never grant visibility. It accepts only the fake source's base URL, so it cannot be pointed at Manatal.

   Rules (they describe local handling; whether Manatal behaves this way is unverified until M03):
   * Change detection compares every allowlisted field and relationship id of the match, job, candidate and organisation
     separately. Timestamps are compared as instants (ISO 8601 with an offset); a missing or invalid one is rejected.
     Different content with the same instant is a conflict, never "unchanged"; an earlier instant is stale. If any linked
     record is stale, conflicting or invalid, the whole item is rejected: no changes, no transitions, and its last accepted
     state is kept.
   * The same match id twice in one run: identical copies collapse; different content makes the run inconsistent and
     non-actionable. Neither copy is chosen.
   * A record that is absent, a failed request or an incomplete run never implies deletion, withdrawal or reassignment.
     Reassignment is flagged when the current organisation or client differs from the last accepted one (including a move
     between two organisations mapped to the same client), and the item is then routed to neither client.
   * Stage transitions are recorded only as observed between two accepted runs (previous stage → current stage). Moves
     that happened between runs and were never observed are not captured. */
import { FAKE_BASE } from "./fake-source.mjs";
import { allowlist, ext } from "./inbound-mapping.mjs";

const MISSING = Symbol("missing");
class Stop extends Error {}
const PLURAL = { organization: "organizations", job: "jobs", candidate: "candidates" };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const differing = (a, b) => Object.keys(b).filter((k) => k !== "updated_at" && !same(a?.[k], b[k]));
const ISO = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
/** A timestamp as an instant (ms), or null unless it is a real calendar date in ISO 8601 with an explicit offset. */
export function instant(v) {
  const m = typeof v === "string" ? v.match(ISO) : null;
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}
const ENTITIES = ["match", "job", "candidate", "organization"];

/** `known`: the `state` of the last accepted preview (or null). Returns the preview; never throws for source problems. */
export async function previewImport({ fetch, wait, mapping, known = null, baseUrl = FAKE_BASE, pageSize = 2, maxPages = 20, maxRequests = 200, retries = 3, backoffMs = [1000, 2000, 4000] }) {
  if (baseUrl !== FAKE_BASE) throw new Error("T05 preview runs only against the fake source");
  if (typeof fetch !== "function" || fetch === globalThis.fetch) throw new Error("T05 preview needs the fake source's fetch");
  if (typeof wait !== "function") throw new Error("T05 preview needs a wait function");
  const out = { source: "fake", mapping: mapping.status, complete: false, actionable: false, stopped: null, requests: 0, waits: [],
    duplicatesCollapsed: 0, items: [], flags: [], notSeen: [], state: null };

  const get = async (url, what) => {
    for (let attempt = 0; ; attempt++) {
      if (out.requests >= maxRequests) throw new Stop("request limit reached");
      out.requests++;
      let r;
      try { r = await fetch(url, { method: "GET", headers: { Accept: "application/json" } }); }
      catch { if (attempt < retries) { await pause(attempt); continue; } throw new Stop(`${what}: no response after ${attempt + 1} attempts`); }
      if (r.status === 200) { try { return await r.json(); } catch { throw new Stop(`${what}: unreadable response`); } }
      if (r.status === 404) return MISSING;
      if (r.status === 401 || r.status === 403) throw new Stop(`${what}: HTTP ${r.status}, access refused (not retried)`);
      if ((r.status === 429 || r.status >= 500) && attempt < retries) { await pause(attempt); continue; }
      throw new Stop(`${what}: HTTP ${r.status} after ${attempt + 1} attempts`);
    }
  };
  const pause = async (attempt) => { const ms = backoffMs[Math.min(attempt, backoffMs.length - 1)]; out.waits.push(ms); await wait(ms); };
  const cache = new Map();
  const record = async (type, id) => {
    if (id === null) return null;
    const key = `${type}:${id}`;
    if (!cache.has(key)) {
      const body = await get(`${baseUrl}/${PLURAL[type]}/${encodeURIComponent(id)}/`, `${type} ${id}`);
      const rec = body === MISSING ? null : allowlist(type, body);
      cache.set(key, rec && rec.id === id ? rec : null);
    }
    return cache.get(key);
  };

  const prevAll = known?.matches ?? {}, next = { ...prevAll };
  let inconsistent = false;
  try {
    /* 1. Every page of matches, following only the source's own `next` links, once each, up to a page limit. */
    const seen = new Map(), conflicting = new Set(), visited = new Set();
    let url = `${baseUrl}/matches/?page=1&page_size=${pageSize}`, pages = 0;
    while (url) {
      if (typeof url !== "string" || !url.startsWith(`${baseUrl}/matches/`)) throw new Stop("a next-page link points outside the source");
      if (visited.has(url)) throw new Stop("the page links loop");
      if (++pages > maxPages) throw new Stop("page limit reached");
      visited.add(url);
      const body = await get(url, `match list page ${pages}`);
      if (body === MISSING || !Array.isArray(body?.results)) throw new Stop(`match list page ${pages}: missing or not a list`);
      for (const raw of body.results) {
        const m = allowlist("match", raw);
        if (m.id === null) { out.flags.push({ type: "invalid", reason: "a match without a usable id" }); continue; }
        if (!seen.has(m.id)) seen.set(m.id, m);
        else if (same(seen.get(m.id), m)) out.duplicatesCollapsed++;
        else conflicting.add(m.id);
      }
      url = body.next ?? null;
    }
    for (const id of conflicting) out.flags.push({ type: "conflicting duplicate", match: ext("match", id), reason: "the same match id with different content in one run; neither copy used" });
    inconsistent = conflicting.size > 0;

    /* 2. Each match with its job, candidate and organisation, checked and compared with the last accepted state. */
    for (const m of seen.values()) {
      if (conflicting.has(m.id)) continue;
      const item = { match: ext("match", m.id), clientId: null, status: null, stage: null, title: null, candidate: null, transitions: [], changes: {}, flags: [],
        publication: "unpublished", clientVisible: false };
      out.items.push(item);
      const job = await record("job", m.job), candidate = await record("candidate", m.candidate);
      const organization = await record("organization", m.organization ?? job?.organization ?? null);
      const missing = [["job", job], ["candidate", candidate], ["organisation", organization]].filter(([, r]) => !r).map(([n]) => n);
      if (missing.length) { item.status = "invalid"; item.flags.push(`linked ${missing.join(", ")} not returned (not treated as deleted)`); continue; }
      if (m.organization !== null && job.organization !== m.organization) { item.status = "invalid"; item.flags.push("the job belongs to a different organisation than the match"); continue; }
      const cur = { match: m, job, candidate, organization }, clientId = mapping.clientFor(organization.id), prev = prevAll[m.id];
      if (prev && (prev.clientId !== clientId || prev.organization.id !== organization.id)) {
        item.status = "reassigned";
        item.flags.push("the organisation or client differs from the last accepted run: routed to neither client, needs staff review");
        continue;
      }
      if (clientId === null) { item.status = "excluded"; item.flags.push("organisation not mapped to a portal client"); continue; }
      const badTime = ENTITIES.filter((k) => instant(cur[k].updated_at) === null);
      if (badTime.length) { item.status = "invalid"; item.flags.push(`missing or invalid timestamp: ${badTime.join(", ")} (not accepted)`); continue; }
      item.clientId = clientId;
      item.title = job.position_name;
      item.candidate = { id: ext("candidate", candidate.id), name: candidate.full_name };
      const stage = mapping.stageFor(m.job_pipeline_stage);
      item.stage = { key: stage.key, staffLabel: stage.label, provisional: true };
      if (!stage.known) item.flags.push("unknown pipeline stage (not mapped by name)");
      if (m.is_active === false || m.dropped_at) item.flags.push("inactive or dropped in the source: needs staff review (not mapped to Declined)");
      if (!prev) { item.status = "new"; next[m.id] = { ...cur, clientId }; continue; }

      /* Each linked record on its own; the item is accepted only if none is rejected. */
      const accepted = { ...prev }, changes = {}, outcome = {};
      for (const k of ENTITIES) {
        const a = prev[k], b = cur[k], fields = differing(a, b), ta = instant(a.updated_at), tb = instant(b.updated_at);
        if (!fields.length && tb === ta) continue;
        if (ta === null) { outcome[k] = "invalid"; item.flags.push(`${k}: the last accepted timestamp is invalid`); }
        else if (tb < ta) { outcome[k] = "stale"; item.flags.push(`${k}: older than the last accepted version, not applied`); }
        else if (tb === ta) { outcome[k] = "conflict"; item.flags.push(`${k}: content changed without a timestamp change (${fields.join(", ")})`); }
        else { outcome[k] = "changed"; accepted[k] = b; if (fields.length) changes[k] = fields; }
      }
      const kinds = Object.values(outcome);
      item.status = kinds.includes("conflict") ? "conflict" : kinds.includes("invalid") ? "invalid" : kinds.includes("stale") ? "stale"
        : Object.keys(changes).length ? "changed" : "unchanged";
      if (!["unchanged", "changed"].includes(item.status)) continue;          // rejected: no changes, no transitions, state kept
      item.changes = changes;
      if (outcome.match === "changed") {
        const from = mapping.stageFor(prev.match.job_pipeline_stage).key, to = stage.key;
        if (from !== to) item.transitions.push({ id: `${item.match}|${from}|${to}|${m.updated_at}`, from, to, observedAt: m.updated_at });
      }
      next[m.id] = { ...accepted, clientId };
    }
    /* 3. Matches known before but not listed now: reported only. Nothing is inferred from their absence. */
    for (const id of Object.keys(prevAll)) if (!seen.has(id)) out.notSeen.push(ext("match", id));
    out.complete = true;
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    out.stopped = e.message;
  }
  out.actionable = out.complete && !inconsistent;
  out.state = out.actionable ? { matches: next } : null;   // an incomplete or inconsistent run never becomes the new baseline
  return out;
}
