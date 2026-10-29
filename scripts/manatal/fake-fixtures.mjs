/* Fictional records for the fake Manatal (T05). Every name is invented; the contact details, file links, notes and custom
   fields are fake values included only so tests can prove the preview never keeps them. Two organisations are mapped to
   the portal's existing fictional clients (Harbor, Northwind); a third is deliberately unmapped. */
import { seedId } from "../db/api-read-lib.mjs";

export const CLIENTS = { harbor: seedId("client", "harbor"), northwind: seedId("client", "northwind") };
/** Values that must never appear in a preview, a flag or an error message. */
export const PRIVATE = ["fake.person@example.com", "+1 555 0100", "https://files.example/resume.pdf", "https://files.example/attachment.pdf",
  "Fake internal recruiter note", "Fake custom field value", "Fake salary expectation"];

const stage = (id, name) => ({ id, name, rank: id, job_pipeline: "p1" });
export const STAGES = { new: stage("s1", "New candidates"), screening: stage("s2", "Screening"), review: stage("s3", "Client review"),
  interview: stage("s4", "Client interview"), offer: stage("s5", "Offer"), hired: stage("s6", "Hired") };

/** Provisional mapping for these fixtures: Harbor and Northwind organisations only; staff-side labels by stage id. */
export const MAPPING = {
  organizations: { "org-h": CLIENTS.harbor, "org-n": CLIENTS.northwind },
  stages: { "p1:s1": null, "p1:s2": null, "p1:s3": "To review", "p1:s4": "Interview", "p1:s5": "Offer", "p1:s6": "Hired" },
};

const T0 = "2026-10-20T09:00:00Z";
const extra = { email: PRIVATE[0], phone_number: PRIVATE[1], resume: PRIVATE[2], custom_fields: { expectation: PRIVATE[6] } };

/** A fresh copy of the base records each time, so tests can change them freely. */
export function baseRecords() {
  return structuredClone({
    organizations: {
      "org-h": { id: "org-h", name: "Fictional Harbor Org", updated_at: T0, external_id: null },
      "org-n": { id: "org-n", name: "Fictional Northwind Org", updated_at: T0 },
      "org-x": { id: "org-x", name: "Fictional Unmapped Org", updated_at: T0 },
    },
    jobs: {
      "job-h1": { id: "job-h1", position_name: "Fictional Sales Lead", organization: "org-h", status: "active", updated_at: T0, description: PRIVATE[5] },
      "job-n1": { id: "job-n1", position_name: "Fictional Operations Role", organization: "org-n", status: "active", updated_at: T0 },
      "job-x1": { id: "job-x1", position_name: "Fictional Unmapped Role", organization: "org-x", status: "active", updated_at: T0 },
    },
    candidates: {
      "cand-1": { id: "cand-1", full_name: "Fictional Person One", updated_at: T0, ...extra, attachments: [PRIVATE[3]] },
      "cand-2": { id: "cand-2", full_name: "Fictional Person Two", updated_at: T0 },
      "cand-3": { id: "cand-3", full_name: "Fictional Person Three", updated_at: T0 },
    },
    matches: [
      { id: "m-1", job: "job-h1", candidate: "cand-1", organization: "org-h", job_pipeline_stage: STAGES.review, is_active: true, dropped_at: null, updated_at: T0, notes: [PRIVATE[4]], custom_fields: { decision: PRIVATE[5] } },
      { id: "m-2", job: "job-h1", candidate: "cand-2", organization: "org-h", job_pipeline_stage: STAGES.screening, is_active: true, dropped_at: null, updated_at: T0 },
      { id: "m-3", job: "job-n1", candidate: "cand-1", organization: "org-n", job_pipeline_stage: STAGES.interview, is_active: true, dropped_at: null, updated_at: T0 },
      { id: "m-4", job: "job-x1", candidate: "cand-3", organization: "org-x", job_pipeline_stage: STAGES.review, is_active: true, dropped_at: null, updated_at: T0 },
    ],
  });
}
