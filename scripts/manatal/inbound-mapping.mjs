/* Provisional mapping for the local inbound preview (T05). Nothing here is verified against Manatal: field names follow
   Manatal's public documentation, and the stage and organisation tables are placeholders until the read-only feasibility
   tests (M03) confirm id types, links and pipeline stages.

   * Ids are opaque: kept as strings exactly as received ("007" and "7" are different), namespaced by record type.
   * Only allowlisted fields are kept, at the moment a record is received. Contact details, resumes, attachments, notes,
     custom fields and anything else are dropped and never reach a preview.
   * Stage mappings are staff-side preview labels only. No Manatal stage grants client visibility or publication. */

export const PROVISIONAL = "provisional: not verified against Manatal (feasibility step M03)";

/** The fields kept per record type. Relationship fields are reduced to the linked record's id. */
export const ALLOWED = {
  organization: ["id", "name", "updated_at"],
  job: ["id", "position_name", "organization", "status", "updated_at"],
  candidate: ["id", "full_name", "updated_at"],
  match: ["id", "job", "candidate", "organization", "job_pipeline_stage", "is_active", "dropped_at", "updated_at"],
};
const RELATIONS = new Set(["job", "candidate", "organization"]);

/** An opaque id as a string, or null when absent or not a plain id. Numbers are kept as their decimal text. */
export function opaqueId(v) {
  const x = v && typeof v === "object" ? v.id : v;
  if (typeof x === "number" && Number.isSafeInteger(x)) return String(x);
  return typeof x === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(x) ? x : null;
}
export const ext = (type, id) => `manatal:${type}:${id}`;

/** Keeps only the allowlisted fields of a record, in a fixed order; relationship fields become ids. */
export function allowlist(type, raw) {
  const out = {};
  for (const k of ALLOWED[type]) {
    const v = raw?.[k];
    if (k === "id" || RELATIONS.has(k)) out[k] = opaqueId(v);
    else if (k === "job_pipeline_stage") out[k] = v && typeof v === "object" ? { id: opaqueId(v.id), job_pipeline: opaqueId(v.job_pipeline), name: typeof v.name === "string" ? v.name : null } : null;
    else out[k] = v === undefined ? null : typeof v === "object" && v !== null ? null : v;
  }
  return out;
}

/** The mapping the preview uses: organisation id → portal client id (explicit allowlist), and
    "pipeline id:stage id" → a provisional staff label (a portal stage name, or null for "not shared with clients"). */
export function createMapping({ organizations, stages }) {
  return {
    status: PROVISIONAL,
    clientFor: (orgId) => (orgId !== null && Object.hasOwn(organizations, orgId) ? organizations[orgId] : null),
    stageFor: (s) => {
      const key = s && s.id !== null && s.job_pipeline !== null ? `${s.job_pipeline}:${s.id}` : null;
      return key !== null && Object.hasOwn(stages, key) ? { key, known: true, label: stages[key] } : { key, known: false, label: null };
    },
  };
}
