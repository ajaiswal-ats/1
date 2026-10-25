/* Read-only Manatal feasibility harness (milestone "Manatal feasibility", step 1). It reads ONLY explicitly configured dummy
   records, by id, with GET requests to a fixed allowlist of endpoints, and keeps only the shape of each answer: ids, field
   names and types, pipeline stage, activity types and timestamps. It never lists candidates, jobs or matches, never
   writes, and never keeps names, contact details, note text, custom-field values or file links.
   Evidence base: ../ats-research/manatal-portal-integration-findings.md §4, §7 and evidence/manatal-api-notes.md §2–§5.
   Not run until a Manatal admin has created the dummy records and the business owner has approved the tests. */

export const BASE_URL = "https://api.manatal.com/open/v3";   // [Doc] api-notes: https://api.manatal.com/open/v3/{ENDPOINT}
export const MAX_REQUESTS = 9;                              // well under the documented 100 requests per 60 s per token
const ID = /^[A-Za-z0-9-]{1,64}$/;                         // ids are inserted into paths: nothing else is allowed
const MILESTONES = ["submitted_at", "interview_at", "offer_at", "hired_at", "dropped_at", "created_at", "updated_at"];

/** The only requests the harness can make. Each names the configured id it needs; nothing else reaches a URL. */
export const ENDPOINTS = {
  match: (t) => `/matches/${t.match_id}/`,
  candidate: (t) => `/candidates/${t.candidate_id}/`,
  job: (t) => `/jobs/${t.job_id}/`,
  organization: (t) => `/organizations/${t.organization_id}/`,
  pipeline: (_t, ctx) => `/job-pipelines/${ctx.pipelineId}/`,
  matchNotes: (t) => `/matches/${t.match_id}/notes/`,
  matchActivities: (t) => `/matches/${t.match_id}/activities/`,
  candidateAttachments: (t) => `/candidates/${t.candidate_id}/attachments/`,
  candidateResume: (t) => `/candidates/${t.candidate_id}/resume/`,
};

/** Checks the targets file: four explicit ids, an explicit confirmation that all four records are dummies, and the tag. */
export function validateTargets(t) {
  const problems = [];
  if (!t || typeof t !== "object") return ["targets file is not an object"];
  if (t.confirm_all_records_are_dummy !== true) problems.push("confirm_all_records_are_dummy must be true (a Manatal admin created these four records for this test)");
  for (const k of ["organization_id", "job_id", "candidate_id", "match_id"]) if (!ID.test(String(t[k] ?? ""))) problems.push(`${k} must be the explicit id of the dummy record`);
  if (typeof t.dummy_candidate_tag !== "string" || t.dummy_candidate_tag.trim().length < 6) problems.push("dummy_candidate_tag must name the tag the admin put on the dummy candidate");
  return problems;
}

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const shape = (o) => (o && typeof o === "object" && !Array.isArray(o) ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, typeOf(o[k])])) : typeOf(o));
const idOf = (v) => (v && typeof v === "object" ? v.id : v);
const same = (a, b) => a !== undefined && a !== null && String(a) === String(b);
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && k in o).map((k) => [k, o[k]]));
/** Paginated lists: {count, next, previous, results} [Doc]; only counts and field names are kept. */
const listShape = (body) => ({ top_level: shape(body), count: body?.count ?? (Array.isArray(body) ? body.length : null),
  result_fields: Array.isArray(body?.results ?? body) && (body.results ?? body)[0] ? shape((body.results ?? body)[0]) : null });

/** Runs step 1. `fetch` and `wait` are passed in for offline tests. Returns the report; throws on any safety stop. */
export async function runFeasibility({ fetch, token, targets, wait = (ms) => new Promise((r) => setTimeout(r, ms)), spacingMs = 700, timeoutMs = 15000 }) {
  const problems = validateTargets(targets);
  if (problems.length) throw new Error(`Stopped before any request: ${problems.join("; ")}`);
  if (!token || typeof token !== "string") throw new Error("Stopped before any request: no API token");
  const report = { purpose: "Manatal feasibility step 1: read-only shape of explicitly selected dummy records", startedAt: new Date().toISOString(),
    targets: pick(targets, ["organization_id", "job_id", "candidate_id", "match_id"]), requests: [], findings: {}, stopped: null };
  let count = 0;
  const get = async (name, ctx = {}) => {
    if (!(name in ENDPOINTS)) throw new Error(`not an allowlisted endpoint: ${name}`);
    if (count >= MAX_REQUESTS) throw new Error("request limit reached");
    const path = ENDPOINTS[name](targets, ctx);
    if (!/^\/[a-z-]+\/[A-Za-z0-9-]{1,64}\/([a-z-]+\/)?$/.test(path)) throw new Error(`refused path ${path}`);
    if (count > 0) await wait(spacingMs);
    count++;
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let r;
    try { r = await fetch(`${BASE_URL}${path}`, { method: "GET", headers: { Authorization: `Token ${token}`, Accept: "application/json" }, signal: ctrl.signal }); }
    finally { clearTimeout(timer); }
    const headers = {};
    r.headers?.forEach?.((v, k) => { if (/rate|retry-after|limit/i.test(k)) headers[k] = v; });
    let body = null;
    try { body = await r.json(); } catch { body = null; }
    report.requests.push({ endpoint: name, path, status: r.status, rate_limit_headers: headers });
    if (r.status < 200 || r.status >= 300) throw new Error(`${name}: HTTP ${r.status}`);
    return body;
  };
  try {
    /* 1. The match first: it holds only ids, the stage and dates. Its links must be exactly the configured records. */
    const m = await get("match");
    const links = { job: idOf(m?.job), candidate: idOf(m?.candidate), organization: idOf(m?.organization) };
    if (!same(links.job, targets.job_id) || !same(links.candidate, targets.candidate_id) || (links.organization != null && !same(links.organization, targets.organization_id)))
      throw new Error("the match does not link the configured job, candidate and organisation: stopped");
    /* 2. The candidate's tag before anything else about it: no tag, nothing kept and no further request. */
    const c = await get("candidate");
    const tags = (Array.isArray(c?.candidate_tags) ? c.candidate_tags : []).map((x) => (x && typeof x === "object" ? x.name ?? x.tag ?? x.label : x));
    if (!tags.includes(targets.dummy_candidate_tag)) throw new Error("the candidate does not carry the configured dummy tag: stopped, and nothing about it was kept");
    report.findings.match = { shape: shape(m), id_types: Object.fromEntries(Object.entries(links).map(([k, v]) => [k, typeOf(v)])),
      job_pipeline_stage: pick(m.job_pipeline_stage ?? {}, ["id", "name", "rank", "job_pipeline"]), is_active: m.is_active ?? null,
      milestones: pick(m, MILESTONES), external_id_present: m.external_id !== undefined && m.external_id !== null,
      custom_field_keys: m.custom_fields && typeof m.custom_fields === "object" ? Object.keys(m.custom_fields).sort() : null };
    report.findings.candidate = { shape: shape(c), id_type: typeOf(c.id), has_dummy_tag: true, updated_at: c.updated_at ?? null,
      external_id_present: c.external_id !== undefined && c.external_id !== null,
      custom_field_keys: c.custom_fields && typeof c.custom_fields === "object" ? Object.keys(c.custom_fields).sort() : null };
    /* 3. Job and organisation: the job must belong to the configured organisation. */
    const j = await get("job");
    if (!same(idOf(j?.organization ?? j?.organization_id), targets.organization_id)) throw new Error("the job does not belong to the configured organisation: stopped");
    report.findings.job = { shape: shape(j), status: j.status ?? null, updated_at: j.updated_at ?? null, external_id_present: j.external_id != null };
    const o = await get("organization");
    report.findings.organization = { shape: shape(o), id_type: typeOf(o.id), updated_at: o.updated_at ?? null, external_id_present: o.external_id != null };
    /* 4. The pipeline the match's stage belongs to (stage names and ranks only). */
    const pipelineId = m.job_pipeline_stage?.job_pipeline;
    if (pipelineId != null && ID.test(String(pipelineId))) {
      const p = await get("pipeline", { pipelineId });
      const stages = p?.job_pipeline_stages ?? [];
      report.findings.pipeline = { shape: shape(p), stages: (Array.isArray(stages) ? stages : []).map((s) => pick(s, ["id", "name", "rank"])) };
    }
    /* 5. Lists on the dummy match and candidate: counts, field names and activity types only. */
    const notes = await get("matchNotes");
    report.findings.match_notes = listShape(notes);
    const acts = await get("matchActivities"), list = Array.isArray(acts?.results ?? acts) ? (acts.results ?? acts) : [];
    report.findings.match_activities = { ...listShape(acts), activity_types: list.map((a) => a?.activity_type).filter(Boolean) };
    report.findings.candidate_attachments = listShape(await get("candidateAttachments"));
    const resume = await get("candidateResume");
    report.findings.candidate_resume = { shape: shape(resume?.results?.[0] ?? resume), has_resume_file: Boolean((resume?.results?.[0] ?? resume)?.resume_file) };
  } catch (e) {
    report.stopped = String(e.message || e).split(token).join("<hidden>");
  }
  report.finishedAt = new Date().toISOString();
  return report;
}
