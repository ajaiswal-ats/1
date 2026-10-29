/* Local background jobs for CV assessment (scoring-test server only). The request that starts an assessment returns at
   once; the existing runner (intake.mjs assessIntake) does the work in the background, one job at a time per private
   folder, so leaving or refreshing the page does not affect it. Each job's state is written to a small status file next
   to the CV, so the page can show it again after a refresh:
     intake/<intakeId>/jobs/<jobId>.json   { state: queued | processing | ready | failed, … }
   - A second request while a job for the same CV is queued or processing returns that job instead of starting another.
   - Just before the runner saves an assessment, the job records the assessment ID it is about to write
     (savingAssessmentId). A job left queued or processing by a server that stopped is reconciled when the folder is next
     used: if that exact assessment was saved and passes the same checks the page applies, the job is Ready for review;
     otherwise it is marked interrupted (failed). It is never restarted, so the AI is not called again without a new request.
   - Results are written by the runner exactly as before (new AI run record, new assessment); a job only points to them.
   Status files are operational state, not audit records: the AI run records and assessments remain the history. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { INTAKE, intakeIds } from "./intake.mjs";

const ACTIVE = new Set(["queued", "processing"]);
const runners = new Map();
const jobsDir = (dir, intakeId) => path.join(dir, INTAKE, intakeId, "jobs");
const readJob = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
function writeJob(dir, job) {
  const d = jobsDir(dir, job.intakeId), f = path.join(d, `${job.jobId}.json`), tmp = `${f}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  fs.writeFileSync(tmp, JSON.stringify(job, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, f);
}

/** Every job for one CV, oldest first. */
export function jobsFor(dir, intakeId) {
  const d = jobsDir(dir, intakeId);
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => readJob(path.join(d, f))).filter(Boolean).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)) : [];
}
/** The latest job for one CV, as the page shows it. */
export const latestJob = (dir, intakeId) => jobsFor(dir, intakeId).pop() ?? null;
export const INTERRUPTED = "Processing was interrupted. No completed assessment is available from this job. Earlier results are kept. AI usage may already have occurred.";
/** Makes sure this server process has reconciled the jobs a stopped server left unfinished. `verify(intakeId, job)`
    returns the completed result saved by that exact job ({ assessmentId, runId, finishedAt }) or null. */
export const ensureRunner = (dir, now = () => new Date().toISOString(), verify = () => null) => { runnerFor(dir, now, verify); };

function runnerFor(dir, now, verify = () => null) {
  let r = runners.get(dir);
  if (r) return r;
  r = { queue: [], busy: false };
  runners.set(dir, r);
  /* A server that stopped mid-job left it queued or processing. Use the result it saved, if valid; never rerun it. */
  for (const id of intakeIds(dir)) for (const j of jobsFor(dir, id)) if (ACTIVE.has(j.state)) {
    let done = null;
    try { done = j.savingAssessmentId ? verify(id, j) : null; } catch { done = null; }
    writeJob(dir, done ? { ...j, state: "ready", assessmentId: done.assessmentId, runId: done.runId ?? null, finishedAt: done.finishedAt ?? now(), recoveredAt: now(), error: null, problems: [] }
      : { ...j, state: "failed", finishedAt: now(), error: INTERRUPTED });
  }
  return r;
}

async function drain(dir, r, now) {
  if (r.busy) return;
  r.busy = true;
  try {
    while (r.queue.length) {
      const { job, execute } = r.queue.shift();
      writeJob(dir, Object.assign(job, { state: "processing", startedAt: now() }));
      try {
        /* The runner reports the assessment ID just before saving it, so a restart can find this job's result. */
        const out = await execute({ jobId: job.jobId, saving: (assessmentId) => writeJob(dir, Object.assign(job, { savingAssessmentId: assessmentId })) });
        Object.assign(job, out.outcome === "valid"
          ? { state: "ready", assessmentId: out.assessmentId, runId: out.runId }
          : { state: "failed", runId: out.runId ?? null, error: out.outcome === "invalid" ? "The AI draft did not pass the checks, so no assessment was made." : out.error ?? "The AI route did not return a draft.", problems: out.problems ?? [] });
      } catch (e) {
        Object.assign(job, { state: "failed", error: e instanceof Error ? e.message : "The assessment could not be run." });
      }
      writeJob(dir, Object.assign(job, { finishedAt: now() }));
    }
  } finally { r.busy = false; }
}

/** Starts an assessment job for a CV, or returns the one already queued or processing for it. `execute({ jobId, saving })`
    runs the existing runner and returns its result; it calls `saving(assessmentId)` just before saving an assessment. */
export function startJob({ dir, intakeId, execute, now = () => new Date().toISOString(), verify }) {
  const r = runnerFor(dir, now, verify), current = jobsFor(dir, intakeId).filter((j) => ACTIVE.has(j.state)).pop();
  if (current) return { job: current, duplicate: true };
  const at = now(), job = { schema: "assessment-job/1", jobId: `job-${at.replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex")}`, intakeId, state: "queued", createdAt: at, startedAt: null, finishedAt: null, assessmentId: null, savingAssessmentId: null, runId: null, error: null, problems: [] };
  writeJob(dir, job);
  r.queue.push({ job, execute });
  const reply = { job: { ...job }, duplicate: false };
  setImmediate(() => { void drain(dir, r, now); }); // after the reply: the job is reported as queued first
  return reply;
}

/** Reconciles interrupted jobs for a folder as a new server process would (also done on first use); for tests. */
export const recoverJobs = (dir, now = () => new Date().toISOString(), verify) => { runners.delete(dir); runnerFor(dir, now, verify); };
