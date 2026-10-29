/* Local assessment run (npm run scoring:run [-- <assessment id> ...]). For each run input in the private folder: validate
   it against its bound files and rubric (fail closed), calculate with the deterministic calculator, and write a NEW
   immutable run record (never overwriting an earlier one). The result and its fingerprint depend only on the validated
   inputs; the run ID and time are recorded beside them. Prints labels and outcomes only, never private text.
   This is not automated CV scoring: the evidence and ratings in each run input were prepared before the run. */
import path from "node:path";
import crypto from "node:crypto";
import { DEFAULT_DIR, contextFor, inputFiles, loadRubrics, sha256Text, writeNewPrivateJson } from "./private-data.mjs";
import { withRunLib } from "./lib.mjs";
import fs from "node:fs";

const dir = path.resolve(process.env.SCORING_PRIVATE_DIR || DEFAULT_DIR), only = process.argv.slice(2);
const mapping = JSON.parse(fs.readFileSync(path.join(dir, "mapping.json"), "utf8"));
let failed = 0;
await withRunLib(async (lib) => {
  const ctx = contextFor(dir, loadRubrics(dir));
  for (const file of inputFiles(dir)) {
    const id = path.basename(file).replace(/\.input\.json$/, "");
    if (only.length && !only.includes(id)) continue;
    const label = mapping.candidates.find((c) => c.id === id)?.label ?? id;
    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch { console.log(`${label}: BLOCKED — the run input is not valid JSON`); failed++; continue; }
    const v = lib.validateRunInput(raw, ctx);
    if (v.status === "blocked") { console.log(`${label}: BLOCKED — ${v.problems.join("; ")}`); failed++; continue; }
    const { result, resultSha256 } = lib.computeRun(v.input, v.rubric, sha256Text);
    const createdAt = new Date().toISOString(), runId = `run-${createdAt.replace(/[-:.]/g, "")}-${id}-${crypto.randomBytes(3).toString("hex")}`;
    writeNewPrivateJson(path.join(dir, "runs/records", `${runId}.json`), { runId, createdAt, inputFile: path.basename(file), inputFileSha256: sha256Text(fs.readFileSync(file)), result, resultSha256 });
    const r = result.v1;
    console.log(`${label}: ${v.status.toUpperCase()} · ${r.status}${r.score === null ? "" : ` ${r.score} ${r.band}${r.capApplied ? " (capped)" : ""}`} · result ${resultSha256.slice(0, 12)} · ${runId}`);
  }
});
process.exit(failed ? 1 : 0);
