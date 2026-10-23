/* Stage-change tests through the hosted Auth and Data API, with the four existing test users, the public key and the users'
   own sessions only. Every write is a call to client_move_stage (plus one direct PATCH that must be refused).
   Each run keeps a local record (supabase/runs/, gitignored) of its request keys, target submissions and their baseline
   stage, version and updated_at. The record holds no password, token or key. restoreSql(record) turns it into a SQL Editor
   script that undoes only what this run is proven to have written. Nothing here runs the restore. */
import crypto from "node:crypto";
import { USERS, jwtPayload, scrubber, seedId } from "./api-read-lib.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STAGES = ["To review", "Interview", "Offer", "Hired", "Declined"];

/** Submissions the run may address, with the seed's baseline. Unpublished ones cannot be read through the API, so their
    baseline comes from the seed; the restore checks it against the database history before changing anything. */
export const TARGETS = {
  "ab-fsr": { client: "harbor", stage: "To review", version: 1, moves: true },
  "en-pa": { client: "harbor", stage: "To review", version: 1, moves: true },
  "pr-isl": { client: "harbor", stage: "To review", version: 1, moves: true },
  "tb-isl": { client: "harbor", stage: "To review", version: 1 },
  "tb-rsm": { client: "harbor", stage: "Interview", version: 2 },
  "zz-isl": { client: "harbor", stage: "To review", version: 1, unpublished: true },
  "n1-ops": { client: "northwind", stage: "To review", version: 1 },
  "n2-ops": { client: "northwind", stage: "To review", version: 1, unpublished: true },
};
export const targetId = (ref) => seedId("submission", TARGETS[ref].client, ref);

/** The planned steps, in order. `pair` sends two requests at the same moment. Expected status and message per request. */
export const STEPS = [
  { id: "A1", what: "permitted move To review → Interview (Aisha Bello)", reqs: [{ who: "harbor", ref: "ab-fsr", to: "Interview", v: 1, key: "K1" }], want: [{ status: 200, stage: "Interview", version: 2 }] },
  { id: "A2", what: "retry: same key, same request, returns the first result", reqs: [{ who: "harbor", ref: "ab-fsr", to: "Interview", v: 1, key: "K1" }], want: [{ status: 200, sameAs: "A1" }] },
  { id: "A3", what: "same key, different request, is refused", reqs: [{ who: "harbor", ref: "ab-fsr", to: "Offer", v: 1, key: "K1" }], want: [{ status: 409, message: "idempotency_key_reused" }] },
  { id: "A4", what: "stale version is refused", reqs: [{ who: "harbor", ref: "ab-fsr", to: "Offer", v: 1, key: "K2" }], want: [{ status: 409, message: "version_conflict" }] },
  { id: "B", what: "two conflicting moves at the same moment (Elena Novak): one wins, one gets version_conflict", pair: "conflict",
    reqs: [{ who: "harbor", ref: "en-pa", to: "Interview", v: 1, key: "K3" }, { who: "harbor", ref: "en-pa", to: "Offer", v: 1, key: "K4" }] },
  { id: "C", what: "the same request twice at the same moment (Priya Raman): both get the same result, one change", pair: "duplicate",
    reqs: [{ who: "harbor", ref: "pr-isl", to: "Interview", v: 1, key: "K5" }, { who: "harbor", ref: "pr-isl", to: "Interview", v: 1, key: "K5" }] },
  { id: "D7", what: "Harbor cannot move a Northwind submission", reqs: [{ who: "harbor", ref: "n1-ops", to: "Interview", v: 1, key: "K6" }], want: [{ status: 404, message: "submission_not_found" }] },
  { id: "D8", what: "Northwind cannot move a Harbor submission", reqs: [{ who: "northwind", ref: "tb-isl", to: "Interview", v: 1, key: "K7" }], want: [{ status: 404, message: "submission_not_found" }] },
  { id: "D9a", what: "Harbor cannot move its unpublished submission", reqs: [{ who: "harbor", ref: "zz-isl", to: "Interview", v: 1, key: "K8" }], want: [{ status: 404, message: "submission_not_found" }] },
  { id: "D9b", what: "Northwind cannot move its unpublished submission", reqs: [{ who: "northwind", ref: "n2-ops", to: "Interview", v: 1, key: "K9" }], want: [{ status: 404, message: "submission_not_found" }] },
  { id: "D10a", what: "the inactive member cannot move", reqs: [{ who: "harborInactive", ref: "ab-fsr", to: "Offer", v: 2, key: "K10" }], want: [{ status: 403, message: "not_a_client_member" }] },
  { id: "D10b", what: "a user without a membership cannot move", reqs: [{ who: "noMembership", ref: "ab-fsr", to: "Offer", v: 2, key: "K11" }], want: [{ status: 403, message: "not_a_client_member" }] },
  { id: "D11", what: "a signed-out visitor cannot move", reqs: [{ who: "anon", ref: "ab-fsr", to: "Offer", v: 2, key: "K12" }], want: [{ status: [401, 403], code: "42501" }] },
  { id: "D12", what: "[provisional] no move on an on-hold role", reqs: [{ who: "harbor", ref: "tb-rsm", to: "Offer", v: 2, key: "K13" }], want: [{ status: 403, message: "move_not_permitted" }] },
  { id: "D13", what: "a direct edit of the stage is refused", patch: { who: "harbor", ref: "ab-fsr", body: { stage: "Hired" } }, want: [{ status: [401, 403], code: "42501" }] },
];

/** A new run record: fresh random idempotency keys, nothing sent yet. */
export function newRecord(projectRef, now = new Date()) {
  const keys = Object.fromEntries([...new Set(STEPS.flatMap((s) => (s.reqs || []).map((r) => r.key)))].map((k) => [k, crypto.randomUUID()]));
  return { runId: crypto.randomUUID(), project: projectRef, createdAt: now.toISOString(), keys, baseline: {}, requests: [], checks: [], finished: false };
}

/** Planned (step, request) pairs with their resolved key and submission id, for the record and the plan printout. */
export const plannedRequests = (record) => STEPS.flatMap((s) => (s.reqs || []).map((r, i) => ({ step: s.id, n: i, who: r.who, ref: r.ref, submission_id: targetId(r.ref), to_stage: r.to, expected_version: r.v, key: record.keys[r.key], keyName: r.key })));

/** Runs the tests. `fetch`, `log` and `save` (called with the record after every change) are passed in for offline tests. */
export async function runMoves({ fetch, url, key, passwords, log, record, save }) {
  const base = url.replace(/\/$/, ""), sessions = {};
  const say = (line) => log(scrubber([key, ...Object.values(passwords), ...Object.values(sessions).flatMap((x) => [x.access, x.refresh])])(line));
  let fails = 0;
  const result = (ok, line) => { if (!ok) fails++; record.checks.push({ ok, line }); save(record); say(`${ok ? "PASS" : "FAIL"}  ${line}`); };
  const call = async (path, init = {}) => {
    try {
      const r = await fetch(`${base}${path}`, init);
      const text = await r.text();
      let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = null; }
      return { status: r.status, body };
    } catch (e) { return { status: 0, body: { code: "network", message: String(e?.message || e) } }; }
  };
  const headers = (who) => (who === "anon" ? { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}) } : { apikey: key, Authorization: `Bearer ${sessions[who].access}` });
  const get = (who, path) => call(`/rest/v1/${path}`, { headers: headers(who) });
  const subs = async (who) => { const r = await get(who, "submissions?select=id,ref,stage,version,updated_at"); return r.status === 200 && Array.isArray(r.body) ? r.body : null; };
  const events = async (who) => { const r = await get(who, "submission_events?select=submission_id,submission_version,source"); return r.status === 200 && Array.isArray(r.body) ? r.body : null; };
  const summary = (b) => (b && typeof b === "object" && !Array.isArray(b) ? Object.fromEntries(["submission_id", "stage", "version", "event_id", "code", "message", "details"].filter((k) => k in b).map((k) => [k, b[k]])) : b);

  /* Records the request as sent before it goes out, so a lost response still counts as possibly written. */
  const move = async (p) => {
    const entry = { step: p.step, n: p.n, who: p.who, ref: p.ref, submission_id: p.submission_id, to_stage: p.to_stage, expected_version: p.expected_version, key: p.key, state: "sent", sentAt: new Date().toISOString() };
    record.requests.push(entry); save(record);
    const r = await call("/rest/v1/rpc/client_move_stage", { method: "POST", headers: { ...headers(p.who), "Content-Type": "application/json" },
      body: JSON.stringify({ p_submission_id: p.submission_id, p_to_stage: p.to_stage, p_expected_version: p.expected_version, p_idempotency_key: p.key }) });
    Object.assign(entry, { state: r.status === 0 ? "unknown" : "answered", status: r.status, response: summary(r.body) }); save(record);
    return r;
  };
  const matches = (want, r, results) => {
    if (![want.status].flat().includes(r.status)) return false;
    if (want.message && r.body?.message !== want.message) return false;
    if (want.code && r.body?.code !== want.code) return false;
    if (want.stage && (r.body?.stage !== want.stage || r.body?.version !== want.version)) return false;
    if (want.sameAs && JSON.stringify(r.body) !== JSON.stringify(results[want.sameAs])) return false;
    return true;
  };
  const show = (r) => `HTTP ${r.status}${r.body?.message ? ` ${r.body.message}` : r.body?.stage ? ` ${r.body.stage} v${r.body.version}` : ""}`;
  const state = async (who, ref) => (await subs(who))?.find((s) => s.ref === ref);
  const countEvents = async (who, ref) => (await events(who))?.filter((e) => e.submission_id === targetId(ref)).length;

  try {
    say("— Sign-in (public key only) —");
    for (const u of USERS) {
      const r = await call("/auth/v1/token?grant_type=password", { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ email: u.email, password: passwords[u.key] }) });
      const p = r.status === 200 ? jwtPayload(r.body?.access_token || "") : null;
      const ok = r.status === 200 && p?.role === "authenticated" && p?.sub === r.body?.user?.id;
      if (ok) sessions[u.key] = { access: r.body.access_token, refresh: r.body.refresh_token };
      result(ok, `[${u.label}] sign in — HTTP ${r.status}${r.body?.error_code ? ` ${r.body.error_code}` : ""}`);
    }
    if (Object.keys(sessions).length !== USERS.length) { say("Stopped before any move: not every test user could sign in."); return fails; }

    /* Pre-flight (reads only): the targets must be at the seed baseline and no portal move may exist yet. */
    say("— Pre-flight (reads only) —");
    const h = await subs("harbor"), he = await events("harbor"), n = await subs("northwind"), ne = await events("northwind");
    const problems = [];
    if (!h || !he || !n || !ne) problems.push("could not read the baseline");
    else {
      for (const [ref, t] of Object.entries(TARGETS)) {
        if (t.unpublished) { record.baseline[ref] = { submission_id: targetId(ref), client: t.client, stage: t.stage, version: t.version, updated_at: null, source: "seed" }; continue; }
        const row = (t.client === "harbor" ? h : n).find((s) => s.ref === ref);
        if (!row) { problems.push(`${ref} not visible`); continue; }
        if (row.id !== targetId(ref)) problems.push(`${ref} has an unexpected id`);
        if (row.stage !== t.stage || row.version !== t.version) problems.push(`${ref} is ${row.stage} v${row.version}, expected ${t.stage} v${t.version}`);
        record.baseline[ref] = { submission_id: row.id, client: t.client, stage: row.stage, version: row.version, updated_at: row.updated_at, source: "api" };
      }
      if (he.length !== 23 || he.some((e) => e.source !== "seed")) problems.push(`Harbor history has ${he.length} events (expected 23, all from the seed)`);
      if (ne.length !== 1 || ne.some((e) => e.source !== "seed")) problems.push(`Northwind history has ${ne.length} events (expected 1, from the seed)`);
    }
    save(record);
    result(!problems.length, `targets are at the seed baseline and no portal move exists${problems.length ? ` — ${problems.join("; ")}` : ""}`);
    if (problems.length) { say("Stopped before any move: the data is not at the fictional baseline. Nothing was written."); return fails; }

    say("— Moves —");
    const planned = plannedRequests(record), results = {};
    for (const s of STEPS) {
      if (s.patch) {
        const r = await call(`/rest/v1/submissions?id=eq.${targetId(s.patch.ref)}`, { method: "PATCH", headers: { ...headers(s.patch.who), "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(s.patch.body) });
        record.requests.push({ step: s.id, who: s.patch.who, ref: s.patch.ref, submission_id: targetId(s.patch.ref), patch: s.patch.body, state: "answered", status: r.status, response: summary(r.body) }); save(record);
        const after = await state("harbor", s.patch.ref);
        result(matches(s.want[0], r, results) && after?.stage === "Interview" && after?.version === 2, `${s.id} ${s.what} — ${show(r)}${r.body?.code ? ` ${r.body.code}` : ""}; ${s.patch.ref} is ${after?.stage} v${after?.version}`);
        continue;
      }
      const reqs = planned.filter((p) => p.step === s.id);
      if (!s.pair) {
        const r = await move(reqs[0]);
        results[s.id] = r.body;
        result(matches(s.want[0], r, results), `${s.id} ${s.what} — ${show(r)}`);
        if (s.id === "A1" || s.id === "A2") { const c = await countEvents("harbor", "ab-fsr"); result(c === 2, `${s.id} ab-fsr has 2 history events (1 shared + 1 move) — ${c}`); }
        if (s.id === "A4") { const a = await state("harbor", "ab-fsr"); result(a?.stage === "Interview" && a?.version === 2, `A4 the refused requests left ab-fsr at Interview v2 — ${a?.stage} v${a?.version}`); }
        continue;
      }
      const [r1, r2] = await Promise.all(reqs.map((p) => move(p)));
      const ref = reqs[0].ref, after = await state("harbor", ref), c = await countEvents("harbor", ref);
      if (s.pair === "conflict") {
        const won = [r1, r2].filter((r) => r.status === 200), lost = [r1, r2].filter((r) => r.status === 409 && r.body?.message === "version_conflict");
        const winner = won[0] ? reqs[[r1, r2].indexOf(won[0])].to_stage : null;
        result(won.length === 1 && lost.length === 1 && after?.stage === winner && after?.version === 2 && c === 2,
          `${s.id} ${s.what} — ${show(r1)} / ${show(r2)}; ${ref} is ${after?.stage} v${after?.version} with ${c} events`);
      } else {
        result(r1.status === 200 && r2.status === 200 && JSON.stringify(r1.body) === JSON.stringify(r2.body) && after?.stage === "Interview" && after?.version === 2 && c === 2,
          `${s.id} ${s.what} — ${show(r1)} / ${show(r2)}, same result ${JSON.stringify(r1.body) === JSON.stringify(r2.body)}; ${ref} is ${after?.stage} v${after?.version} with ${c} events`);
      }
    }

    say("— After the moves (reads only) —");
    const h2 = await subs("harbor"), he2 = await events("harbor"), n2 = await subs("northwind"), ne2 = await events("northwind");
    const portal = he2?.filter((e) => e.source === "portal").length;
    result(he2?.length === 26 && portal === 3, `Harbor history has 26 events (23 + 3 moves) — ${he2?.length}, ${portal} from the portal`);
    for (const ref of ["tb-isl", "tb-rsm"]) { const x = h2?.find((s) => s.ref === ref); result(x?.stage === TARGETS[ref].stage && x?.version === TARGETS[ref].version, `${ref} unchanged — ${x?.stage} v${x?.version}`); }
    const n1 = n2?.find((s) => s.ref === "n1-ops");
    result(n1?.stage === "To review" && n1?.version === 1 && ne2?.length === 1, `Northwind unchanged — n1-ops ${n1?.stage} v${n1?.version}, ${ne2?.length} event(s)`);
  } finally {
    say("— Sign-out —");
    for (const u of USERS.filter((x) => sessions[x.key])) {
      const r = await call("/auth/v1/logout?scope=local", { method: "POST", headers: { apikey: key, Authorization: `Bearer ${sessions[u.key].access}` } });
      result(r.status === 204 || r.status === 200, `[${u.label}] sign out — HTTP ${r.status}`);
    }
    record.finished = true; save(record);
  }
  return fails;
}

/* ---------------------------------------------------------------------------------------------------------------- */

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Checks a record before turning it into SQL: only well-formed ids, refs, stages and timestamps get through. */
export function validateRecord(record) {
  const bad = [];
  if (!UUID_RE.test(record?.runId || "")) bad.push("runId");
  for (const [ref, b] of Object.entries(record?.baseline || {})) {
    if (!(ref in TARGETS)) { bad.push(`baseline ${ref}: unknown submission`); continue; }
    if (b.submission_id !== targetId(ref)) bad.push(`baseline ${ref}: id`);
    if (!STAGES.includes(b.stage) || !Number.isInteger(b.version) || b.version < 1) bad.push(`baseline ${ref}: stage/version`);
    if (b.updated_at !== null && !TS_RE.test(b.updated_at)) bad.push(`baseline ${ref}: updated_at`);
  }
  for (const r of record?.requests || []) {
    if (r.patch) continue;
    if (!UUID_RE.test(r.key || "") || !(r.ref in TARGETS) || r.submission_id !== targetId(r.ref)) { bad.push(`request ${r.step}`); continue; }
    if (!record.baseline?.[r.ref]) bad.push(`request ${r.step}: no baseline for ${r.ref}`);
  }
  if (bad.length) throw new Error(`run record is not valid: ${bad.join(", ")}`);
}

/** SQL Editor script that undoes only this run's proven changes, or refuses and changes nothing. */
export function restoreSql(record) {
  validateRecord(record);
  const keys = [...new Map(record.requests.filter((r) => !r.patch).map((r) => [`${r.key}:${r.submission_id}`, r])).values()];
  const base = Object.entries(record.baseline);
  const keyRows = keys.map((r) => `(${q(r.key)}::uuid, ${q(r.submission_id)}::uuid, ${q(r.step)})`).join(",\n      ");
  const baseRows = base.map(([ref, b]) => `(${q(b.submission_id)}::uuid, ${q(ref)}, ${q(b.stage)}, ${b.version}, ${b.updated_at ? `${q(b.updated_at)}::timestamptz` : "null::timestamptz"})`).join(",\n      ");
  const keysCte = keys.length ? `values ${keyRows}` : "select null::uuid, null::uuid, null::text where false";
  const baseCte = base.length ? `values ${baseRows}` : "select null::uuid, null::text, null::text, null::int, null::timestamptz where false";
  const sent = record.requests.filter((r) => !r.patch);
  return `-- GENERATED by scripts/db/api-moves.mjs for API move run ${record.runId} (project ${record.project}, started ${record.createdAt}).
-- Restores the fictional baseline after that run, and nothing else. Review before running; run it yourself in the SQL Editor.
--
-- What it can change, and only if every check passes:
-- * app_private.idempotency_keys: deletes the rows created by this run's ${keys.length} request key(s) listed below (matched by key and submission).
-- * public.submission_events: deletes only the events those key rows point to (portal moves by a test member).
-- * public.submissions: sets the submissions those events belong to back to their recorded baseline stage, version and updated_at.
-- Never touched: seed events, memberships, users, roles, people, other submissions, or anything in Auth.
--
-- It refuses, and changes nothing, if: a key row does not match its event; a portal move or key exists in the fictional
-- clients that this run did not make; a target submission has history after the baseline that is not this run's; its
-- history up to the baseline differs from the record; or its current stage/version does not match its history.
-- Requests in the record: ${sent.length} sent (${sent.filter((r) => r.state === "answered" && r.status === 200).length} answered 200, ${sent.filter((r) => r.state === "unknown" || r.state === "sent").length} with no answer). Requests with no answer may or may not have been written; the key lookup decides.
-- Safe to run again: once restored, it finds nothing of this run and changes nothing.
-- The file is one DO statement (atomic) followed by a read-only check, which is what the editor shows.
do $restore$
declare
  problems text[] := '{}';
  r record;
  n int;
  n_found int;
begin
  if to_regclass('public.submission_events') is null then raise exception 'RESTORE REFUSED: milestone 1 tables not found. Nothing was changed.'; end if;

  create temp table restore_keys (key uuid not null, submission_id uuid not null, step text not null) on commit drop;
  insert into restore_keys ${keysCte};
  create temp table restore_baseline (submission_id uuid primary key, ref text not null, stage text not null, version int not null, updated_at timestamptz) on commit drop;
  insert into restore_baseline ${baseCte};

  -- This run's writes, positively identified: key rows made by this run's requests, and the event each one points to.
  create temp table restore_found on commit drop as
    select k.member_id, k.submission_id, k.key, (k.result->>'event_id')::bigint as event_id, (k.result->>'version')::int as version, k.result->>'stage' as stage
      from app_private.idempotency_keys k join restore_keys rk on rk.key = k.key and rk.submission_id = k.submission_id
     where k.action = 'move_stage';
  select count(*) into n_found from restore_found;

  for r in select f.*, b.ref from restore_found f left join restore_baseline b using (submission_id) loop
    if r.ref is null then problems := problems || format('key %s is on a submission with no recorded baseline', r.key); end if;
    if not exists (select 1 from public.client_members m join auth.users u on u.id = m.user_id
                    where m.id = r.member_id and lower(u.email) like 'portal-test-%@example.com') then
      problems := problems || format('key %s (%s) was not made by a fictional test member', r.key, r.ref);
    end if;
    if not exists (select 1 from public.submission_events e
                    where e.id = r.event_id and e.submission_id = r.submission_id and e.submission_version = r.version and e.to_stage = r.stage
                      and e.kind = 'stage_move' and e.source = 'portal' and e.actor_kind = 'client' and e.actor_member_id = r.member_id) then
      problems := problems || format('key %s (%s) does not match an event it created', r.key, r.ref);
    end if;
  end loop;

  -- Anything in the fictional clients that looks like a portal move but is not this run's: refuse rather than guess.
  for r in select e.id, s.ref, e.submission_version from public.submission_events e join public.submissions s on s.id = e.submission_id
            join public.clients c on c.id = e.client_id
           where c.ref in ('harbor', 'northwind') and e.source = 'portal' and e.id not in (select event_id from restore_found) loop
    problems := problems || format('event %s (%s version %s) is a portal move not made by this run', r.id, r.ref, r.submission_version);
  end loop;
  for r in select k.key, s.ref from app_private.idempotency_keys k join public.submissions s on s.id = k.submission_id join public.clients c on c.id = s.client_id
           where c.ref in ('harbor', 'northwind')
             and not exists (select 1 from restore_found f where f.key = k.key and f.submission_id = k.submission_id and f.member_id = k.member_id) loop
    problems := problems || format('idempotency key %s (%s) was not made by this run', r.key, r.ref);
  end loop;

  -- Each recorded submission: history intact up to the baseline, nothing after it except this run, stage/version consistent.
  for r in
    select b.*, s.id is not null as present, s.stage as cur_stage, s.version as cur_version,
           (select count(*) from public.submission_events e where e.submission_id = b.submission_id) as n_all,
           (select max(e.submission_version) from public.submission_events e where e.submission_id = b.submission_id) as max_v,
           (select e.to_stage from public.submission_events e where e.submission_id = b.submission_id order by e.submission_version desc limit 1) as last_stage,
           (select count(*) from public.submission_events e where e.submission_id = b.submission_id and e.submission_version <= b.version) as n_base,
           (select e.to_stage from public.submission_events e where e.submission_id = b.submission_id and e.submission_version <= b.version order by e.submission_version desc limit 1) as base_stage,
           (select count(*) from public.submission_events e where e.submission_id = b.submission_id and e.submission_version > b.version) as n_after,
           (select count(*) from public.submission_events e join restore_found f on f.event_id = e.id where e.submission_id = b.submission_id and e.submission_version > b.version) as n_after_run,
           (select count(*) from restore_found f where f.submission_id = b.submission_id) as n_run
      from restore_baseline b left join public.submissions s on s.id = b.submission_id
  loop
    if not r.present then problems := problems || format('%s no longer exists', r.ref); continue; end if;
    if r.cur_version <> r.max_v or r.cur_version <> r.n_all or r.cur_stage <> r.last_stage then
      problems := problems || format('%s is %s v%s, which does not match its history (changed outside the portal action)', r.ref, r.cur_stage, r.cur_version);
    end if;
    if r.n_base <> r.version or r.base_stage is distinct from r.stage then
      problems := problems || format('%s: its history up to version %s no longer ends at %s', r.ref, r.version, r.stage);
    end if;
    if r.n_after <> r.n_after_run then
      problems := problems || format('%s has %s change(s) after the baseline that are not from this run', r.ref, r.n_after - r.n_after_run);
    end if;
    if r.n_run <> r.n_after_run then
      problems := problems || format('%s: %s of this run''s events are not newer than the baseline', r.ref, r.n_run - r.n_after_run);
    end if;
  end loop;

  if cardinality(problems) > 0 then
    raise exception 'RESTORE REFUSED. Nothing was changed.%', E'\\n' || array_to_string(problems, E'\\n');
  end if;

  -- Undo, in dependency order, touching only the rows identified above.
  delete from app_private.idempotency_keys k using restore_found f
   where k.member_id = f.member_id and k.action = 'move_stage' and k.submission_id = f.submission_id and k.key = f.key;
  get diagnostics n = row_count;
  if n <> n_found then raise exception 'RESTORE STOPPED: deleted % key rows, expected %. Nothing was changed.', n, n_found; end if;

  delete from public.submission_events e using restore_found f where e.id = f.event_id;
  get diagnostics n = row_count;
  if n <> n_found then raise exception 'RESTORE STOPPED: deleted % events, expected %. Nothing was changed.', n, n_found; end if;

  update public.submissions s set stage = b.stage, version = b.version, updated_at = coalesce(b.updated_at, s.updated_at)
    from restore_baseline b
   where s.id = b.submission_id and b.submission_id in (select submission_id from restore_found);

  -- Inside the same statement: every recorded submission is back at its baseline and consistent with its history.
  for r in select b.ref from restore_baseline b join public.submissions s on s.id = b.submission_id
            where s.stage <> b.stage or s.version <> b.version
               or s.version <> (select count(*) from public.submission_events e where e.submission_id = s.id)
               or s.stage <> (select e.to_stage from public.submission_events e where e.submission_id = s.id order by e.submission_version desc limit 1) loop
    raise exception 'RESTORE STOPPED: % is not back at its baseline. Nothing was changed.', r.ref;
  end loop;
end
$restore$;

-- Read-only result (what the editor shows). Every row should say OK.
with run_keys(key, submission_id, step) as (${keysCte}),
baseline(submission_id, ref, stage, version, updated_at) as (${baseCte}),
rows_out(ord, check_name, value, ok) as (
  select 1, b.ref || ': back at the baseline (' || b.stage || ' v' || b.version || ')', s.stage || ' v' || s.version,
         s.stage = b.stage and s.version = b.version
           and s.version = (select count(*) from public.submission_events e where e.submission_id = s.id)
    from baseline b join public.submissions s on s.id = b.submission_id
  union all
  select 2, 'This run''s idempotency keys remaining', (select count(*) from app_private.idempotency_keys k join run_keys r on r.key = k.key and r.submission_id = k.submission_id)::text,
         not exists (select 1 from app_private.idempotency_keys k join run_keys r on r.key = k.key and r.submission_id = k.submission_id)
  union all
  select 3, 'Portal moves in the fictional clients', (select count(*) from public.submission_events where source = 'portal')::text,
         not exists (select 1 from public.submission_events where source = 'portal')
  union all
  select 4, 'Submissions / events / memberships (baseline 15 / 26 / 3)',
         (select count(*) from public.submissions) || ' / ' || (select count(*) from public.submission_events) || ' / ' || (select count(*) from public.client_members),
         (select count(*) from public.submissions) = 15 and (select count(*) from public.submission_events) = 26 and (select count(*) from public.client_members) = 3
)
select check_name as "check", value, case when ok then 'OK' else 'STOP' end as result from rows_out order by ord, check_name;
`;
}
