/* Adopting a new extraction for an assessment: an explicit, versioned action (local only). It refuses an extraction of a
   different PDF, an incomplete extraction, or one on which any bound quote is no longer on its stated page. It archives
   the current run input, writes the next one bound to the new text, and logs the change. It changes no rating, evidence
   or client view: because the bound text changes, the assessment needs a new run (npm run scoring:run), and the older
   client view no longer describes it, so the client preview shows "update pending" until a reviewer confirms a new one.
   Usage: node scripts/scoring/adopt-extraction.mjs <assessment id> <extraction record> --reviewer "<name>" --reason "<why>" */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { appendProvenanceLog, sha256Text, writeNewPrivateJson, writePrivateJson } from "./private-data.mjs";
import { ExtractError, readExtraction } from "../extract/extract.mjs";

/** `lib`: run.ts and extraction.ts functions (canonical, schemaProblems, chainProblems, appendChained, locateQuote, parsePages). */
export function adoptExtraction({ dir, assessmentId, recordFile, reviewer, reason, lib, now = () => new Date() }) {
  if (!reviewer?.trim() || !reason?.trim() || reason.trim().length < 10) throw new ExtractError("bad-adoption", "A reviewer and a reason (at least 10 characters) are required.");
  const inputFile = path.join(dir, "runs/inputs", `${assessmentId}.input.json`);
  if (!fs.existsSync(inputFile)) throw new ExtractError("no-input", "No run input for this assessment.");
  const input = JSON.parse(fs.readFileSync(inputFile, "utf8")), { record, pages, textFile } = readExtraction(recordFile, lib);
  if (record.status !== "completed" || !pages) throw new ExtractError("not-completed", "Only a completed extraction can be adopted.");
  if (record.source.sha256 !== input.sources.cv.sha256) throw new ExtractError("different-source", "The extraction is of a different PDF from the assessment's CV.");
  if (record.text.sha256 === input.sources.extraction.sha256) throw new ExtractError("same-text", "The assessment already uses this text.");
  /* Every bound quote must be on its stated page of the new text. */
  const quotes = [
    ...input.assessment.gates.flatMap((g) => g.evidence.map((e, i) => [`gate ${g.id} quote ${i + 1}`, e])),
    ...input.assessment.criteria.flatMap((c) => c.evidence.map((e, i) => [`criterion ${c.id} quote ${i + 1}`, e])),
    ...input.assessment.otherResults.map((e, i) => [`other result ${i + 1}`, e]),
    ...input.clientView.content.strengths.flatMap((s, i) => s.evidence.map((e, j) => [`client-view strength ${i + 1} quote ${j + 1}`, e])),
  ];
  const missing = quotes.filter(([, e]) => !["found", "found-multiple"].includes(lib.locateQuote(pages, e.quote, e.page).status)).map(([id]) => id);
  if (missing.length) throw new ExtractError("quotes-missing", `${missing.length} bound quote(s) are not on their stated page in the new text: ${missing.join(", ")}. Not adopted.`);

  const at = now().toISOString(), sources = path.dirname(dir);
  const next = { ...input, sources: { ...input.sources, extraction: {
    file: path.relative(sources, textFile), sha256: record.text.sha256,
    recorded: { when: at, basis: `Adopted from extraction ${record.extractionId} by ${reviewer.trim()}: ${reason.trim()}` },
    method: "Reproducible local extraction (scripts/extract)", tool: record.tool.name, toolVersion: `${record.tool.os}; ${record.tool.swiftc}; tool ${record.tool.toolSourceSha256.slice(0, 12)}`,
    extractedAt: record.finishedAt, extractedAtBasis: "From the immutable extraction record.", accuracy: "unverified",
    note: `Extraction record ${record.extractionId}: ${record.review}. Not checked against the PDF unless a separate verification record says so.`,
    extractionId: record.extractionId, extractionRecordSha256: sha256Text(fs.readFileSync(recordFile)),
  } } };
  const problems = lib.schemaProblems(next);
  if (problems.length) throw new ExtractError("invalid", `The adopted input would be invalid: ${problems.join("; ")}`);
  writeNewPrivateJson(path.join(dir, "runs/inputs/archive", `${assessmentId}.${at.replace(/[-:.]/g, "")}.${crypto.randomBytes(2).toString("hex")}.input.json`), input);
  writePrivateJson(inputFile, next);
  appendProvenanceLog(dir, lib, { at, kind: "extraction-adopted", assessmentId, reviewer: reviewer.trim(), reason: reason.trim(), fromTextSha256: input.sources.extraction.sha256, toTextSha256: record.text.sha256, extractionId: record.extractionId, resultMayBeUnchanged: true });
  return { assessmentId, extractionId: record.extractionId, quotesChecked: quotes.length, nextStep: "Run npm run scoring:run; the client view must then be reviewed again." };
}
