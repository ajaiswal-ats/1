/* The read-only Manatal harness, against a fake Manatal: explicit dummy ids only, GET only, safety stops, redaction. */
import { describe, expect, it } from "vitest";
import { BASE_URL, MAX_REQUESTS, runFeasibility, validateTargets } from "./feasibility-lib.mjs";

const TOKEN = "fake-manatal-token-0123456789";
const T = { confirm_all_records_are_dummy: true, dummy_candidate_tag: "portal-feasibility-dummy", organization_id: "501", job_id: "601", candidate_id: "701", match_id: "801" };
const PRIVATE = ["Dana Dummy", "dana@example.com", "+1 555 0100", "https://files.example/resume.pdf", "Internal recruiter note", "Secret custom value", "https://files.example/a.pdf"];

function fakeManatal(over = {}) {
  const calls = [];
  const data = {
    "/matches/801/": { id: 801, job: 601, candidate: 701, organization: 501, is_active: true, job_pipeline_stage: { id: 9, name: "Client review", rank: 3, job_pipeline: 4 },
      interview_at: null, dropped_at: null, updated_at: "2026-10-20T10:00:00Z", external_id: null, custom_fields: { client_decision: "Secret custom value" } },
    "/candidates/701/": { id: 701, full_name: "Dana Dummy", email: "dana@example.com", phone_number: "+1 555 0100", resume: "https://files.example/resume.pdf",
      candidate_tags: [{ name: "portal-feasibility-dummy" }], updated_at: "2026-10-20T09:00:00Z", custom_fields: { note: "Secret custom value" } },
    "/jobs/601/": { id: 601, position_name: "Dummy job", organization: 501, status: "active", updated_at: "2026-10-19T09:00:00Z" },
    "/organizations/501/": { id: 501, name: "Dummy organisation", updated_at: "2026-10-18T09:00:00Z" },
    "/job-pipelines/4/": { id: 4, name: "Default", job_pipeline_stages: [{ id: 9, name: "Client review", rank: 3 }] },
    "/matches/801/notes/": { count: 1, next: null, previous: null, results: [{ id: 1, info: "Internal recruiter note", creator: 2, created_at: "2026-10-20T08:00:00Z" }] },
    "/matches/801/activities/": { count: 1, next: null, previous: null, results: [{ id: 3, activity_type: "interview", name: "Internal recruiter note" }] },
    "/candidates/701/attachments/": { count: 1, next: null, previous: null, results: [{ id: 5, name: "a.pdf", file: "https://files.example/a.pdf" }] },
    "/candidates/701/resume/": { count: 1, results: [{ id: 6, resume_file: "https://files.example/resume.pdf" }] },
    ...over,
  };
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.Authorization });
    const path = url.slice(BASE_URL.length), body = data[path];
    return { status: body ? 200 : 404, headers: new Map([["x-ratelimit-remaining", "99"]]), json: async () => body ?? {} };
  };
  return { fetch, calls };
}
const run = (f, targets = T) => runFeasibility({ fetch: f.fetch, token: TOKEN, targets, wait: () => Promise.resolve() });

describe("targets", () => {
  it("needs four explicit ids, the dummy confirmation and the dummy tag", () => {
    expect(validateTargets(T)).toEqual([]);
    expect(validateTargets({ ...T, confirm_all_records_are_dummy: false }).join()).toMatch(/confirm_all_records_are_dummy/);
    expect(validateTargets({ ...T, match_id: "../candidates" }).join()).toMatch(/match_id/);
    expect(validateTargets({ ...T, candidate_id: "" }).join()).toMatch(/candidate_id/);
    expect(validateTargets({ ...T, dummy_candidate_tag: "" }).join()).toMatch(/dummy_candidate_tag/);
  });
  it("invalid targets or no token: no request at all", async () => {
    const f = fakeManatal();
    await expect(runFeasibility({ fetch: f.fetch, token: TOKEN, targets: { ...T, confirm_all_records_are_dummy: false } })).rejects.toThrow(/Stopped before any request/);
    await expect(runFeasibility({ fetch: f.fetch, token: "", targets: T })).rejects.toThrow(/no API token/);
    expect(f.calls).toEqual([]);
  });
});

describe("a complete read-only run", () => {
  it("GET only, explicit ids only, no list over candidates, jobs or matches, within the request limit", async () => {
    const f = fakeManatal(), r = await run(f);
    expect(r.stopped).toBeNull();
    expect(f.calls.every((c) => c.method === "GET" && c.url.startsWith(BASE_URL) && c.auth === `Token ${TOKEN}`)).toBe(true);
    expect(f.calls.map((c) => c.url.slice(BASE_URL.length))).toEqual(["/matches/801/", "/candidates/701/", "/jobs/601/", "/organizations/501/", "/job-pipelines/4/",
      "/matches/801/notes/", "/matches/801/activities/", "/candidates/701/attachments/", "/candidates/701/resume/"]);
    expect(f.calls.length).toBeLessThanOrEqual(MAX_REQUESTS);
    expect(f.calls.some((c) => /\/(candidates|jobs|matches|organizations)\/(\?|$)/.test(c.url.slice(BASE_URL.length)))).toBe(false);
  });
  it("keeps shapes, ids, stage, timestamps and activity types; never names, contacts, note text, custom values, links or the token", async () => {
    const r = await run(fakeManatal()), text = JSON.stringify(r);
    for (const p of [...PRIVATE, TOKEN]) expect(text, p).not.toContain(p);
    expect(r.findings.match).toMatchObject({ id_types: { job: "number", candidate: "number", organization: "number" }, job_pipeline_stage: { name: "Client review", rank: 3 },
      milestones: { interview_at: null, updated_at: "2026-10-20T10:00:00Z" }, custom_field_keys: ["client_decision"] });
    expect(r.findings.candidate).toMatchObject({ has_dummy_tag: true, id_type: "number" });
    expect(r.findings.candidate.shape).toMatchObject({ full_name: "string", email: "string" });   // the field exists; its value is not kept
    expect(r.findings.match_activities.activity_types).toEqual(["interview"]);
    expect(r.findings.candidate_resume.has_resume_file).toBe(true);
    expect(r.requests[0].rate_limit_headers).toEqual({ "x-ratelimit-remaining": "99" });
  });
});

describe("safety stops", () => {
  it("a candidate without the dummy tag: stops at once, keeps nothing about it, sends nothing more", async () => {
    const f = fakeManatal({ "/candidates/701/": { id: 701, full_name: "Real Person", email: "real@example.com", candidate_tags: [{ name: "vip" }] } });
    const r = await run(f);
    expect(r.stopped).toMatch(/dummy tag/);
    expect(f.calls).toHaveLength(2);
    expect(JSON.stringify(r)).not.toMatch(/Real Person|real@example.com/);
    expect(r.findings).toEqual({});
  });
  it("a match that links another candidate or job: stops before reading the candidate", async () => {
    const f = fakeManatal({ "/matches/801/": { id: 801, job: 601, candidate: 999, organization: 501 } });
    const r = await run(f);
    expect(r.stopped).toMatch(/does not link the configured/);
    expect(f.calls).toHaveLength(1);
  });
  it("a job of another organisation: stops", async () => {
    const r = await run(fakeManatal({ "/jobs/601/": { id: 601, organization: 999 } }));
    expect(r.stopped).toMatch(/does not belong to the configured organisation/);
  });
  it("an error answer stops the run (no retries)", async () => {
    const f = fakeManatal({ "/matches/801/": undefined });
    const r = await run(f);
    expect(r.stopped).toMatch(/match: HTTP 404/);
    expect(f.calls).toHaveLength(1);
  });
});
