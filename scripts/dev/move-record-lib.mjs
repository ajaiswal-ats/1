/* Development-only record of a manual UI stage-change test run, kept by the Vite dev server (never in a build).
   Before each client action request (stage move, decline or feedback), the browser sends the action kind, the request's
   idempotency key, submission id, the version and stage the user saw, and the resulting stage; after the answer, the
   outcome. Only these whitelisted fields are kept: the record never holds passwords, session tokens, keys of the project,
   or any note or feedback text. The cleanup SQL is generated from it
   (npm run db:ui-moves:restore-sql) and is never run automatically. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STAGES = ["To review", "Interview", "Offer", "Hired", "Declined"];
const OUTCOME = /^(ok|uncertain|error:[a-z0-9_]{1,40})$/;
const int = (v) => Number.isInteger(v) && v >= 0 && v < 1e6;

/** Returns the entry with only its allowed fields, or null if anything is missing, extra or malformed. */
export function cleanEntry(e) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return null;
  const at = new Date().toISOString();
  if (e.phase === "sent") {
    const keys = ["phase", "action", "key", "submission_id", "expected_version", "seen_stage", "to_stage", "attempt"];
    if (Object.keys(e).some((k) => !keys.includes(k))) return null;
    if (!["move", "decline", "feedback"].includes(e.action)) return null;
    if (!UUID.test(e.key) || !UUID.test(e.submission_id) || !int(e.expected_version) || e.expected_version < 1 || !int(e.attempt)) return null;
    if (!STAGES.includes(e.seen_stage) || !STAGES.includes(e.to_stage)) return null;
    return { phase: "sent", at, action: e.action, key: e.key, submission_id: e.submission_id, expected_version: e.expected_version, seen_stage: e.seen_stage, to_stage: e.to_stage, attempt: e.attempt };
  }
  if (e.phase === "outcome") {
    const keys = ["phase", "key", "submission_id", "outcome"];
    if (Object.keys(e).some((k) => !keys.includes(k))) return null;
    if (!UUID.test(e.key) || !UUID.test(e.submission_id) || typeof e.outcome !== "string" || !OUTCOME.test(e.outcome)) return null;
    return { phase: "outcome", at, key: e.key, submission_id: e.submission_id, outcome: e.outcome };
  }
  return null;
}

/** A run record that appends entries to one file (mode 600), written atomically after every entry. */
export function createRunFile(dir, project, now = new Date()) {
  const run = { kind: "ui-moves", runId: crypto.randomUUID(), project, createdAt: now.toISOString(), entries: [] };
  const file = path.join(dir, `ui-moves-${run.createdAt.replace(/[-:]/g, "").replace(/\..*/, "")}-${run.runId.slice(0, 8)}.json`);
  let created = false;
  return {
    file,
    run,
    append(entry) {
      if (!created) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); created = true; }
      run.entries.push(entry);
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(run, null, 2) + "\n", { mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
    },
  };
}

/** Accepts only same-machine requests (the dev server listens on 127.0.0.1; this also refuses other web origins). */
export const isLocalRequest = (headers) => {
  const origin = headers.origin, host = headers.host || "";
  return /^127\.0\.0\.1:\d+$|^localhost:\d+$/.test(host) && (!origin || /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin));
};
