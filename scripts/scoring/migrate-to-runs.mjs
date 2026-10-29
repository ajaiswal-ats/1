/* One-off migration (local): converts the earlier assessment files (assessments.json, client-view.json) into one run
   input per candidate, without changing any rating, gate result, evidence, rubric or source content. Source files are
   only fingerprinted (metadata), never read for content. File names and provenance notes come from the private
   runs/migration-sources.json, so this tracked script names no client, role or person. Refuses to overwrite an input.
   Usage: node scripts/scoring/migrate-to-runs.mjs */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DEFAULT_DIR, loadRubrics, writeNewPrivateJson } from "./private-data.mjs";
import { withRunLib } from "./lib.mjs";

const dir = path.resolve(process.env.SCORING_PRIVATE_DIR || DEFAULT_DIR), sources = path.dirname(dir);
const json = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(sources, f))).digest("hex");
const mtime = (f) => fs.statSync(path.join(dir, f)).mtime.toISOString();
const S = json("runs/migration-sources.json"), old = json("assessments.json"), cv = json("client-view.json"), mapping = json("mapping.json");
const rubric = loadRubrics(dir).find((r) => r.id === old.configId && r.version === old.configVersion);
if (!rubric || rubric.sha256 !== rubric.manifestSha256) throw new Error("The rubric named by the assessments is missing or changed; nothing migrated.");

await withRunLib(async (lib) => {
  for (const a of old.assessments.filter((x) => x.kind === "real")) {
    const m = mapping.candidates.find((c) => c.id === a.id), out = path.join(dir, "runs/inputs", `${a.id}.input.json`);
    if (fs.existsSync(out)) { console.log(`${m.label}: input exists, kept`); continue; }
    const cvSha = sha(m.sourceFile);
    if (cvSha !== m.sha256) { console.log(`${m.label}: BLOCKED — the CV no longer matches the fingerprint recorded before it was read; not migrated`); continue; }
    const extraction = S.extraction.file.replace("{id}", a.id);
    const { id, kind, ...assessment } = a; void id; void kind;
    const input = {
      schema: lib.INPUT_SCHEMA, assessmentId: a.id, submissionId: a.id,
      role: { id: rubric.config.role.id, title: rubric.config.role.title, loc: rubric.config.role.loc, summary: rubric.config.role.summary, resp: rubric.config.role.resp },
      sources: {
        cv: { file: m.sourceFile, sha256: cvSha },
        jd: { file: S.jd.file, sha256: sha(S.jd.file) },
        roleRequirements: { file: S.roleRequirements.file, sha256: sha(S.roleRequirements.file), version: S.roleRequirements.version },
        extraction: { file: extraction, sha256: sha(extraction), method: S.extraction.method, extractedAt: fs.statSync(path.join(sources, extraction)).mtime.toISOString(), verifiedAgainstSource: false, note: S.extraction.note },
      },
      rubric: { id: rubric.id, version: rubric.version, sha256: rubric.sha256 },
      assessment: { ...assessment, consistencyRules: old.consistencyRules },
      preparation: { method: "assistant-prepared", actor: S.actor, at: old.createdAt },
      provenanceNotes: S.provenanceNotes,
    };
    const fp = lib.assessmentFingerprint(input, (s) => crypto.createHash("sha256").update(s).digest("hex"));
    const state = lib.stateSha(fp, 1, lib.inputsOf(input), lib.gatesOf(input), (s) => crypto.createHash("sha256").update(s).digest("hex"));
    const c = cv.candidates[a.id];
    input.clientView = { revision: 1, describes: { assessmentFingerprint: fp, assessmentVersion: 1, stateSha256: state },
      content: { summary: c.summary, strengths: c.strengths, gaps: c.gaps, statuses: c.statuses }, statusRule: cv.statusRule,
      preparation: { method: "assistant-prepared", actor: S.actor, at: mtime("client-view.json") } };
    writeNewPrivateJson(out, input);
    console.log(`${m.label}: migrated`);
  }
});
