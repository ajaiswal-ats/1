/* Explicit local check against the real private files (not part of npm test): npm run scoring:check-migration
   Checks that the pre-migration files still match their recorded fingerprints, that each run input carries exactly the
   earlier assessment (no rating, gate or evidence changed), that every run validates as provisional and is recorded, and
   that the recorded results equal the frozen ones. This shows the migration is consistent; it does not show that the
   ratings are accurate or the extraction correct. Prints labels and outcomes only, never private text. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DEFAULT_DIR, loadPrivateData, runRecords } from "./private-data.mjs";
import { withRunLib } from "./lib.mjs";

const DIR = path.resolve(process.env.SCORING_PRIVATE_DIR || DEFAULT_DIR);
if (!fs.existsSync(path.join(DIR, "runs/inputs"))) { console.log("SKIP: the private scoring folder is not on this computer"); process.exit(0); }
const json = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
let bad = 0;
const check = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"} ${label}`); if (!ok) bad++; };

await withRunLib(async (lib) => {
  for (const [f, h] of Object.entries(json("frozen-inputs.json").files)) check(crypto.createHash("sha256").update(fs.readFileSync(path.join(DIR, f))).digest("hex") === h, `${f} unchanged since the migration`);
  const old = json("assessments.json"), frozen = json("frozen-results.json").results, expected = { "cand-a": null, "cand-b": 64, "cand-c": 54, "cand-d": 68 };
  const d = loadPrivateData(DIR, lib), records = runRecords(DIR);
  for (const a of old.assessments) {
    const { id, kind, ...rest } = a; void kind;
    const now = d.assessments.find((x) => x.id === id), label = now?.label ?? id;
    check(lib.canonical(json(`runs/inputs/${id}.input.json`).assessment) === lib.canonical({ ...rest, consistencyRules: old.consistencyRules }), `${label}: run input carries exactly the earlier assessment`);
    check(now?.status === "provisional", `${label}: validates, and is provisional (not verified)`);
    if (now?.status !== "provisional") continue;
    const rec = records.find((r) => r.runId === now.run.runId)?.result.v1, f = frozen.find((x) => x.assessmentId === id);
    check(!!rec && [rec.status, rec.points, rec.possible, rec.score, rec.band].join() === [f.status, f.points, f.possible, f.score, f.band].join() && rec.score === expected[id], `${label}: recorded result equals the frozen result (${rec?.score ?? "no score"})`);
    check(now.provenance.extractionAccuracy === "unverified" && now.provenance.sources.some((s) => s.timing !== "before preparation"), `${label}: provenance gaps stated, not inferred`);
    check(now.screening === null, `${label}: screening not assessed`);
  }
  check(!d.problems.length, "no problems reported by the local loader");
});
console.log(bad ? `\n${bad} check(s) failed` : "\nPASS migration consistency (not rating accuracy or extraction correctness)");
process.exit(bad ? 1 : 0);
