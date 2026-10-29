/* Reproducible local PDF extraction, best-effort blinding, human verification records and comparison (no network).
   Requires macOS with the Xcode Command Line Tools (swiftc and the system PDFKit framework): `xcode-select --install`.
   The Swift tool (pdftool.swift) is compiled once per source version into node_modules/.cache/scoring-pdftool/.
   `lib` is src/scoring/extraction.ts and blinding.ts (loaded through Vite by cli.mjs, imported directly by tests).

   Records are immutable (written once, never overwritten). An extraction record states that the tool ran ("completed"),
   whether manual review is required, and that the text has not been checked against the PDF; only a separate human
   verification record can change the last. Records and logs hold labels, counts and fingerprints: the document text is in
   the separate text file, and the source file's name and path are not recorded. */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HERE = import.meta.dirname, ROOT = path.resolve(HERE, "../..");
export const TOOL_SOURCE = path.join(HERE, "pdftool.swift");
export const EXTRACTION_SCHEMA = "extraction-record/1", BLINDING_SCHEMA = "blinding-record/1", VERIFICATION_SCHEMA = "extraction-verification/1";

export const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const shaFile = (f) => sha256(fs.readFileSync(f));
/** Stable JSON (sorted keys), the same rule as src/scoring/run.ts. */
export const canonical = (v) => v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
  : `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;

/** A clear, path-free error with a stable code. */
export class ExtractError extends Error { constructor(code, message) { super(message); this.code = code; } }

/** Writes a new file atomically; refuses to overwrite anything (a hard link fails if the name exists). Owner-only. */
export function writeNew(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  try { fs.linkSync(tmp, file); } catch (e) { throw e.code === "EEXIST" ? new ExtractError("exists", "An output with this name already exists; nothing was overwritten.") : e; } finally { fs.unlinkSync(tmp); }
}
const writeNewJson = (file, v) => writeNew(file, JSON.stringify(v, null, 2) + "\n");

/* ---- the Swift tool ------------------------------------------------------------------------------------------- */

function swiftcVersion() {
  try { return execFileSync("swiftc", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\n").find((l) => /Swift version/.test(l))?.trim() ?? "unknown"; }
  catch { throw new ExtractError("no-swiftc", "swiftc is not available. Extraction needs macOS with the Xcode Command Line Tools (xcode-select --install)."); }
}
/** Compiles the tool once per source fingerprint; returns the binary path. */
export function buildTool() {
  if (process.platform !== "darwin") throw new ExtractError("not-macos", "Extraction uses Apple PDFKit and runs on macOS only.");
  swiftcVersion();
  const dir = path.join(ROOT, "node_modules/.cache/scoring-pdftool", shaFile(TOOL_SOURCE).slice(0, 16)), bin = path.join(dir, "pdftool");
  if (!fs.existsSync(bin)) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${bin}.${process.pid}.tmp`;
    execFileSync("swiftc", ["-O", "-o", tmp, TOOL_SOURCE], { stdio: ["ignore", "ignore", "pipe"] });
    fs.renameSync(tmp, bin);
  }
  return bin;
}
const osVersion = () => { try { return `macOS ${execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim()} (${execFileSync("sw_vers", ["-buildVersion"], { encoding: "utf8" }).trim()})`; } catch { return `${os.type()} ${os.release()}`; } };

/** What produced an extraction: the tool, its source and runner fingerprints, and the environment (PDFKit is part of the OS). */
export function toolIdentity() {
  return {
    name: "macOS PDFKit text layer (PDFPage.string) via scripts/extract/pdftool.swift",
    toolSourceSha256: shaFile(TOOL_SOURCE),
    runnerSha256: sha256(["scripts/extract/extract.mjs", "src/scoring/extraction.ts"].map((f) => fs.readFileSync(path.join(ROOT, f))).join("\n")),
    swiftc: swiftcVersion(), os: osVersion(), arch: process.arch, pdfkit: "the system framework of the OS above",
  };
}
export function runTool(command, arg) {
  const out = execFileSync(buildTool(), [command, arg], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  return command === "extract" ? JSON.parse(out) : null;
}

/* ---- extraction ---------------------------------------------------------------------------------------------- */

const FAILURES = { locked: "encrypted or password-protected: not extracted", unreadable: "unreadable or corrupt PDF", missing: "source file not found", usage: "tool usage error" };

/** Output folders must be inside the allowed root, and not the folder holding the source PDF. */
export function checkOutDir(outDir, allowedRoot, sourcePdf) {
  const out = path.resolve(outDir), root = path.resolve(allowedRoot), rel = path.relative(root, out);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new ExtractError("out-outside-root", "The output folder is outside the allowed extraction folder.");
  if (sourcePdf && path.resolve(path.dirname(sourcePdf)) === out) throw new ExtractError("out-is-source-folder", "The output folder must not be the folder holding the source PDF.");
  return out;
}

/** Extracts one PDF into a new, immutable record (and text file when the tool ran). Never overwrites anything. */
export function extractPdf({ pdf, outDir, allowedRoot, label, lib, now = () => new Date() }) {
  if (!label || !/^[\w .-]{1,60}$/.test(label)) throw new ExtractError("bad-label", "A short label (letters, digits, spaces, . _ -) is required.");
  const out = checkOutDir(outDir, allowedRoot, pdf);
  if (!fs.existsSync(pdf) || !fs.statSync(pdf).isFile()) throw new ExtractError("missing", "The source PDF was not found.");
  const bytes = fs.readFileSync(pdf), sourceSha = sha256(bytes), startedAt = now().toISOString();
  const tool = toolIdentity(), r = runTool("extract", path.resolve(pdf)), finishedAt = now().toISOString();
  const pages = r.ok ? r.pages.map((p) => ({ page: p.page, text: p.text, images: p.images, flags: lib.pageFlags(p) })) : [];
  const problems = r.ok ? (r.pageCount === 0 ? ["the PDF has no pages"] : []) : [FAILURES[r.error] ?? "extraction failed"];
  const status = r.ok && r.pageCount > 0 ? "completed" : "failed";
  /* The deterministic content: the same PDF, tool and options always give the same fingerprint. */
  const content = { schema: "extraction-content/1", source: { sha256: sourceSha, bytes: bytes.length, pageCount: r.pageCount }, tool, options: lib.EXTRACTION_OPTIONS, status, problems, pages };
  const extractionId = `ext-${startedAt.replace(/[-:.]/g, "")}-${sourceSha.slice(0, 12)}-${crypto.randomBytes(3).toString("hex")}`;
  const text = status === "completed" ? lib.pagesToText(pages.map((p) => p.text)) : null;
  const flagged = pages.filter((p) => p.flags.length);
  const record = {
    schema: EXTRACTION_SCHEMA, extractionId, label, startedAt, finishedAt,
    status, review: status !== "completed" ? "not applicable: extraction failed" : flagged.length ? "manual review required" : "no problems detected (this is not a verification)",
    verification: "not checked against PDF",
    source: content.source, tool, options: content.options, problems,
    pages: pages.map((p) => ({ page: p.page, chars: p.text.replace(/\s/g, "").length, images: p.images, flags: p.flags })),
    text: text === null ? null : { file: `${extractionId}.txt`, sha256: sha256(text) },
    contentSha256: sha256(canonical(content)),
  };
  if (text !== null) writeNew(path.join(out, record.text.file), text);
  try { writeNewJson(path.join(out, `${extractionId}.json`), record); }
  catch (e) { if (text !== null) fs.rmSync(path.join(out, record.text.file), { force: true }); throw e; }
  return { record, recordFile: path.join(out, `${extractionId}.json`) };
}

/** Reads a record and its text, checking the text against the recorded fingerprint. */
export function readExtraction(recordFile, lib) {
  const record = JSON.parse(fs.readFileSync(recordFile, "utf8"));
  if (record.schema !== EXTRACTION_SCHEMA) throw new ExtractError("bad-record", "Not an extraction record.");
  if (record.status !== "completed") return { record, pages: null };
  const textFile = path.join(path.dirname(recordFile), record.text.file), text = fs.readFileSync(textFile, "utf8");
  if (sha256(text) !== record.text.sha256) throw new ExtractError("text-changed", "The extracted text does not match its record.");
  return { record, pages: lib.parsePages(text), textFile };
}

/* ---- human verification --------------------------------------------------------------------------------------- */

/** A person's check of an extraction against its PDF: a separate, immutable record. Never created automatically. */
export function recordVerification({ recordFile, reviewer, reviewedOn, pages, method, result, notes = "", lib }) {
  const { record } = readExtraction(recordFile, lib);
  if (record.status !== "completed") throw new ExtractError("not-completed", "Only a completed extraction can be checked.");
  if (!reviewer?.trim() || Number.isNaN(Date.parse(reviewedOn)) || !method?.trim() || !["matches", "differences found"].includes(result)) throw new ExtractError("bad-verification", "Reviewer, date, method and result (matches / differences found) are required.");
  const scope = { pages: pages === "all" ? "all" : pages.map(Number).filter((n) => n >= 1 && n <= record.source.pageCount), method };
  const v = { schema: VERIFICATION_SCHEMA, extractionId: record.extractionId, reviewer: reviewer.trim(), reviewedOn, scope, result, notes, recordSha256: shaFile(recordFile) };
  const file = path.join(path.dirname(recordFile), `${record.extractionId}.verification-${Date.parse(reviewedOn)}-${crypto.randomBytes(2).toString("hex")}.json`);
  writeNewJson(file, v);
  return { verification: v, file };
}
export function verificationsFor(recordFile, extractionId) {
  const dir = path.dirname(recordFile);
  return fs.readdirSync(dir).filter((f) => f.startsWith(`${extractionId}.verification-`)).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

/* ---- blinding ------------------------------------------------------------------------------------------------ */

/** Writes a blinded copy (never changing the source), a record (counts, no text) and a private residual review report. */
export function blindExtraction({ recordFile, outDir, allowedRoot, options, lib, now = () => new Date() }) {
  const out = checkOutDir(outDir, allowedRoot);
  const { record, pages } = readExtraction(recordFile, lib);
  if (!pages) throw new ExtractError("not-completed", "Only a completed extraction can be blinded.");
  const b = lib.blindPages(pages, options), at = now().toISOString();
  const blindingId = `blind-${at.replace(/[-:.]/g, "")}-${record.extractionId.slice(-6)}-${crypto.randomBytes(3).toString("hex")}`;
  const text = lib.pagesToText(b.pages);
  const rec = {
    schema: BLINDING_SCHEMA, blindingId, createdAt: at, sourceExtractionId: record.extractionId, sourceTextSha256: record.text.sha256,
    method: { ...lib.BLINDING_METHOD, sourceSha256: shaFile(path.join(ROOT, "src/scoring/blinding.ts")) }, optionsSha256: sha256(canonical(options)),
    guarantee: "none: best-effort rule-based blinding; identifiers may remain and useful text may be removed; residual review required",
    counts: b.counts, replacementsPerPage: pages.map((_, i) => b.replacements.filter((r) => r.page === i + 1).length),
    residualItems: b.residual.length, residualReview: "pending human review",
    output: { file: `${blindingId}.blinded.txt`, sha256: sha256(text) }, report: `${blindingId}.residual-review.json`,
  };
  writeNew(path.join(out, rec.output.file), text);
  writeNewJson(path.join(out, rec.report), { blindingId, status: "pending human review", note: "Private: contains document text. Check each item, and the blinded text, before relying on it.", items: b.residual });
  writeNewJson(path.join(out, `${blindingId}.json`), rec);
  return { record: rec };
}

/* ---- comparison ---------------------------------------------------------------------------------------------- */

/** Compares two extraction records page by page (and optional quotes). Changes nothing. */
export function compareRecordFiles(oldFile, newFile, lib, quotes = []) {
  const a = readExtraction(oldFile, lib), b = readExtraction(newFile, lib);
  if (!a.pages || !b.pages) throw new ExtractError("not-completed", "Both extractions must be completed.");
  return { from: a.record.extractionId, to: b.record.extractionId, sameSource: a.record.source.sha256 === b.record.source.sha256, ...lib.compareExtractions(a.pages, b.pages, quotes) };
}
