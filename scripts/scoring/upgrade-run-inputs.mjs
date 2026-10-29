/* One-off local upgrade of run inputs from scoring-run-input/1 to /2. Adds provenance facts from file metadata only (no
   document content is read), stating unknown facts as "unknown". Ratings, gates, evidence, rubric and bound files must be
   identical, or the input is left unchanged. Revision 1 of the client view is re-bound to the new assessment identity with
   a recorded reason (a schema upgrade is not a content review). The old file is archived without overwriting anything.
   File names come from the private folder; this tracked script names no client, role or person.
   Usage: node scripts/scoring/upgrade-run-inputs.mjs */
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_DIR, appendProvenanceLog, inputFiles, readProvenanceLog, sha256Text, writeNewPrivateJson, writePrivateJson } from "./private-data.mjs";
import { withRunLib } from "./lib.mjs";

const dir = path.resolve(process.env.SCORING_PRIVATE_DIR || DEFAULT_DIR), sources = path.dirname(dir);
const mapping = JSON.parse(fs.readFileSync(path.join(dir, "mapping.json"), "utf8"));
const inventory = fs.existsSync(path.join(sources, "README.md")) ? fs.readFileSync(path.join(sources, "README.md"), "utf8") : "";
const inventoryDate = (inventory.match(/Saved (\d{1,2}) October (\d{4})/) || []);

await withRunLib(async (lib) => {
  for (const file of inputFiles(dir)) {
    const old = JSON.parse(fs.readFileSync(file, "utf8")), id = old.assessmentId, label = mapping.candidates.find((c) => c.id === id)?.label ?? id;
    if (old.schema === lib.INPUT_SCHEMA) {
      /* Upgrades made before the provenance log existed are logged now, from the archived input, and marked as such. */
      const archived = path.join(dir, "runs/inputs/archive", `${id}.v1.input.json`);
      if (fs.existsSync(archived) && !readProvenanceLog(dir).some((e) => e.kind === "schema-upgrade" && e.assessmentId === id)) {
        appendProvenanceLog(dir, lib, { at: fs.statSync(archived).mtime.toISOString(), kind: "schema-upgrade", assessmentId: id, from: "scoring-run-input/1", to: lib.INPUT_SCHEMA,
          fromInputSha256: sha256Text(fs.readFileSync(archived)), resultMayBeUnchanged: true,
          note: `Logged after the fact on ${new Date().toISOString()} from the archived input; the upgrade itself was not logged when it ran. Provenance fields were added; ratings, gates, evidence, rubric and bound files were unchanged. The client view was re-bound, which is not a review.` });
        console.log(`${label}: earlier upgrade logged after the fact`);
      } else console.log(`${label}: already upgraded`);
      continue;
    }
    if (old.schema !== "scoring-run-input/1") { console.log(`${label}: unknown schema, left unchanged`); continue; }
    const firstRecorded = fs.statSync(file).mtime.toISOString();
    const atMigration = { when: firstRecorded, basis: "First recorded in the run input written by the Step 2 migration; not recorded when the assessment was prepared." };
    const jdListed = inventoryDate.length && inventory.includes(old.sources.jd.sha256);
    const s = old.sources, { verifiedAgainstSource: _v, ...x } = s.extraction;
    void _v;
    const next = {
      ...old, schema: lib.INPUT_SCHEMA,
      sources: {
        cv: { ...s.cv, recorded: { when: mapping.assignedAt, basis: "Recorded in the private label mapping when labels were assigned, before the CV was read." } },
        jd: { ...s.jd, recorded: jdListed ? { when: `${inventoryDate[2]}-10-${inventoryDate[1].padStart(2, "0")}`, basis: "Listed in the private inventory, which is dated but records no time of day." } : { when: "unknown", basis: "No earlier record of this fingerprint was found." } },
        roleRequirements: { ...s.roleRequirements, recorded: atMigration },
        extraction: { ...x, recorded: atMigration, tool: "macOS PDFKit text layer, through a one-off Swift script (not kept)", toolVersion: "unknown",
          extractedAtBasis: "Modification time of the extracted text file; the extraction run itself was not logged.", accuracy: "unverified" },
      },
      preparation: { ...old.preparation, atBasis: "Entered by hand when the assessment was written." },
    };
    /* Identity check: nothing that determines ratings or evidence may differ. */
    const same = (a, b) => lib.canonical(a) === lib.canonical(b);
    const bindings = (src) => Object.fromEntries(Object.entries(src).map(([k, b]) => [k, { file: b.file, sha256: b.sha256, ...(b.version ? { version: b.version } : {}) }]));
    if (!same(old.assessment, next.assessment) || !same(old.rubric, next.rubric) || !same(bindings(old.sources), bindings(next.sources))) { console.log(`${label}: content would change; left unchanged`); continue; }
    const fp = lib.assessmentFingerprint(next, sha256Text);
    next.clientView = { ...old.clientView,
      describes: { assessmentFingerprint: fp, assessmentVersion: 1, stateSha256: lib.stateSha(fp, 1, lib.inputsOf(next), lib.gatesOf(next), sha256Text), rubric: next.rubric },
      rebinding: { previousFingerprint: old.clientView.describes.assessmentFingerprint, at: new Date().toISOString(),
        reason: "Schema upgrade to scoring-run-input/2: ratings, gates, evidence, rubric and bound files were compared and are identical; only provenance fields were added. This is not a content review." } };
    const problems = lib.schemaProblems(next);
    if (problems.length) { console.log(`${label}: upgraded input would be invalid (${problems.join("; ")}); left unchanged`); continue; }
    writeNewPrivateJson(path.join(dir, "runs/inputs/archive", `${id}.v1.input.json`), old);
    writePrivateJson(file, next);
    appendProvenanceLog(dir, lib, { at: new Date().toISOString(), kind: "schema-upgrade", assessmentId: id, from: "scoring-run-input/1", to: lib.INPUT_SCHEMA, fromInputSha256: sha256Text(fs.readFileSync(path.join(dir, "runs/inputs/archive", `${id}.v1.input.json`))), resultMayBeUnchanged: true,
      note: "Provenance fields were added; ratings, gates, evidence, rubric and bound files were unchanged. The client view was re-bound, which is not a review." });
    console.log(`${label}: upgraded (JD inventory record ${jdListed ? "found" : "not found"})`);
  }
});
