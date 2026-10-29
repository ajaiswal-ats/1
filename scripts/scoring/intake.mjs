/* CV intake and AI-proposed assessment for the local scoring server (choose role → add CV → assess → view result).
   Everything is written once into the private, Git-ignored scoring folder and never overwritten:
     intake/<intakeId>/intake.json                  label, role, upload time and the CV's fingerprint (no file name)
     intake/<intakeId>/source/cv.pdf                the uploaded CV
     intake/<intakeId>/ext-….json / .txt            the extraction record and text (scripts/extract)
     intake/<intakeId>/blinding-options.json        name variants used for best-effort blinding (private)
     intake/<intakeId>/blind-….*                    the blinded text, its record and the residual review
     intake/<intakeId>/ext-….verification-….json    a person's extraction review (required before assessment)
     intake/<intakeId>/ai-run-….json                each AI run: route, models, prompt and input fingerprints, raw output,
                                                    validation result (kept whether valid or not)
     runs/inputs/<intakeId>-a<n>.input.json         a validated assessment, as an ordinary run input
     runs/records/run-….json                        its immutable run record
   The AI route only proposes. Output that fails validation is kept for inspection and never becomes an assessment. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { blindExtraction, extractPdf, readExtraction, recordVerification, verificationsFor } from "../extract/extract.mjs";

export const INTAKE = "intake";
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const writeOnce = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 }); };
export const intakeIds = (dir) => { const d = path.join(dir, INTAKE); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /^in-[\w-]+$/.test(f) && fs.existsSync(path.join(d, f, "intake.json"))).sort() : []; };
export const roleSources = (dir) => { const f = path.join(dir, "config/role-sources.json"); return fs.existsSync(f) ? readJson(f).roles ?? [] : []; };

/** Page problems in plain English (from the extraction tool's flags). */
export function plainFlag(page, flag) {
  if (/^image-only/.test(flag)) return `Page ${page} has no selectable text (it may be a scanned image). Text inside images is not read.`;
  if (/^empty/.test(flag)) return `Page ${page} has no text.`;
  if (/^sparse/.test(flag)) return `Page ${page} has very little text.`;
  if (/contains images/.test(flag)) return `Page ${page} contains images. Any text inside them is not read.`;
  if (/suspicious characters/.test(flag)) return `Page ${page} has unusual characters. Check that the text reads correctly.`;
  if (/hyphenated/.test(flag)) return `Page ${page} splits some words across lines with hyphens. Quotes across those breaks may not match.`;
  if (/ligature/.test(flag)) return `Page ${page} uses joined letters (for example "fi" as one character). Some quotes may need to keep them.`;
  if (/multiple columns/.test(flag)) return `Page ${page} may have columns. Check that the reading order makes sense.`;
  return `Page ${page}: ${flag}.`;
}
const plainFailure = (problems) => problems.map((x) => (/encrypted|password/.test(x) ? "The PDF is password-protected, so no text could be read." : /unreadable|corrupt/.test(x) ? "The file could not be read as a PDF. It may be damaged." : /no pages/.test(x) ? "The PDF has no pages." : `Extraction failed: ${x}.`));

/** Likely name variants for best-effort blinding: the first line of page 1 when it looks like a name, and words from the
    uploaded file's name. Anything missed is listed in the residual review; blinding is never anonymisation. */
export function nameVariants(firstPage, fileName = "") {
  const out = new Set(), first = (firstPage.split("\n").map((l) => l.trim()).find(Boolean) ?? "").replace(/\s+/g, " ");
  if (/^[A-Z][\p{L}'.-]+(?: [A-Z][\p{L}'.-]*){1,3}$/u.test(first) && first.length <= 40) { out.add(first); for (const w of first.split(" ")) if (w.replace(/\W/g, "").length > 2) out.add(w); }
  for (const w of fileName.replace(/\.pdf$/i, "").split(/[^\p{L}']+/u)) if (w.length > 2 && !/^(resume|cv|curriculum|vitae|pdf|final|updated|sales|manager|experienced|the|and)$/i.test(w)) out.add(w[0].toUpperCase() + w.slice(1));
  return [...out];
}

/** Everything known about one intake, for the page. CV text is not included (see intakeText). */
export function intakeSummary(dir, id, lib) {
  const d = path.join(dir, INTAKE, id), meta = readJson(path.join(d, "intake.json")), files = fs.readdirSync(d);
  const extFile = files.find((f) => /^ext-.*\.json$/.test(f) && !f.includes(".verification-"));
  const ext = extFile ? readJson(path.join(d, extFile)) : null;
  const verifications = ext ? verificationsFor(path.join(d, extFile), ext.extractionId) : [];
  const reviewState = ext ? lib.verificationStatus({ extractionId: ext.extractionId, pageCount: ext.source.pageCount }, verifications).status : "not checked against PDF";
  const blindFile = files.find((f) => /^blind-.*\.json$/.test(f) && !f.includes("residual"));
  const blind = blindFile ? readJson(path.join(d, blindFile)) : null;
  const runs = files.filter((f) => /^ai-run-.*\.json$/.test(f)).sort().map((f) => readJson(path.join(d, f)));
  const lastReview = verifications.slice().sort((a, b) => (a.reviewedOn < b.reviewedOn ? -1 : 1)).pop() ?? null;
  return {
    id, label: meta.label, role: meta.role, uploadedAt: meta.uploadedAt,
    extraction: !ext ? { status: "missing", messages: ["No extraction record was written."] }
      : ext.status !== "completed" ? { status: "failed", messages: plainFailure(ext.problems) }
      : { status: "completed", pages: ext.source.pageCount, messages: ext.pages.flatMap((p) => p.flags.map((f) => plainFlag(p.page, f))) },
    blinding: blind ? { replacements: Object.values(blind.counts).reduce((s, n) => s + n, 0), itemsToCheck: blind.residualItems } : null,
    review: { status: reviewState === "checked against PDF" ? "matches" : reviewState === "differences found by a reviewer" ? "differences" : reviewState === "partly checked against PDF" ? "partly" : "not reviewed",
      by: lastReview?.reviewer ?? null, on: lastReview?.reviewedOn ?? null, notes: lastReview?.notes ?? "" },
    runs: runs.map((r) => ({ runId: r.runId, at: r.finishedAt, route: r.route.label, isAi: r.route.isAi, models: r.route.models ?? [], outcome: r.outcome, problems: r.problems?.length ? r.problems : r.error ? [r.error] : [], warnings: r.warnings ?? [], assessmentId: r.assessmentId ?? null, durationMs: r.route.durationMs ?? null })),
  };
}

/** The extracted text (original, page by page) and the blinded text, for the extraction review. Local reviewer only. */
export function intakeText(dir, id, lib) {
  const d = path.join(dir, INTAKE, id), files = fs.readdirSync(d), extFile = files.find((f) => /^ext-.*\.json$/.test(f) && !f.includes(".verification-"));
  if (!extFile) return null;
  const { record, pages } = readExtraction(path.join(d, extFile), lib);
  if (!pages) return { pages: [] };
  const blindFile = files.find((f) => /^blind-.*\.blinded\.txt$/.test(f)), blinded = blindFile ? lib.parsePages(fs.readFileSync(path.join(d, blindFile), "utf8")) : [];
  return { pages: pages.map((t, i) => ({ page: i + 1, text: t, blinded: blinded[i] ?? "", messages: record.pages[i].flags.map((f) => plainFlag(i + 1, f)) })) };
}

/** Saves a CV, extracts and blinds it. The label never contains the file name. */
export function createIntake({ dir, pdf, fileName = "", role, lib, now = () => new Date() }) {
  if (!Buffer.isBuffer(pdf) || pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("The file is not a PDF.");
  const sources = roleSources(dir).find((r) => r.config.id === role?.id && r.config.version === role?.version);
  if (!sources) throw new Error("That role and rules version is not available.");
  const at = now(), id = `in-${at.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex")}`, d = path.join(dir, INTAKE, id);
  const label = `New CV ${intakeIds(dir).length + 1}`;
  writeOnce(path.join(d, "source/cv.pdf"), pdf);
  writeOnce(path.join(d, "intake.json"), { schema: "cv-intake/1", intakeId: id, label, role: { id: role.id, version: role.version }, uploadedAt: at.toISOString(), source: { file: `prototype/${INTAKE}/${id}/source/cv.pdf`, sha256: sha(pdf), bytes: pdf.length } });
  const { recordFile, record } = extractPdf({ pdf: path.join(d, "source/cv.pdf"), outDir: d, allowedRoot: path.join(dir, INTAKE), label: label.replace(/[^\w .-]/g, ""), lib, now });
  if (record.status === "completed") {
    const { pages } = readExtraction(recordFile, lib), names = nameVariants(pages[0] ?? "", fileName);
    writeOnce(path.join(d, "blinding-options.json"), { names, note: "Private: name variants for best-effort blinding (from the first line of page 1 and the uploaded file name)." });
    blindExtraction({ recordFile, outDir: d, allowedRoot: path.join(dir, INTAKE), options: { names }, lib, now });
  }
  return intakeSummary(dir, id, lib);
}

/** A person's extraction review: the whole text compared with the PDF. Attribution only (a typed name). */
export function reviewExtraction({ dir, id, reviewer, result, notes = "", lib, now = () => new Date() }) {
  const d = path.join(dir, INTAKE, id), extFile = fs.readdirSync(d).find((f) => /^ext-.*\.json$/.test(f) && !f.includes(".verification-"));
  if (!extFile) throw new Error("This CV has no extraction to review.");
  recordVerification({ recordFile: path.join(d, extFile), reviewer, reviewedOn: now().toISOString(), pages: "all", method: "Read the extracted text beside the original PDF in the local review page", result, notes, lib });
  return intakeSummary(dir, id, lib);
}

/** Runs the AI route on a reviewed extraction, validates the output and, only when valid, writes a run input and run. */
export async function assessIntake({ dir, id, route, lib, ai, run, writeRun, now = () => new Date(), jobId = null, saving = () => {} }) {
  const s = intakeSummary(dir, id, lib);
  if (s.extraction.status !== "completed") throw new Error("The CV text could not be extracted, so it cannot be assessed.");
  if (s.review.status !== "matches") throw new Error(s.review.status === "differences" ? "The extraction review found differences. Fix or replace the CV before assessing it." : "Review the extracted text against the PDF before assessing.");
  if (!route) throw new Error("No AI route is configured.");
  const d = path.join(dir, INTAKE, id), meta = readJson(path.join(d, "intake.json")), files = fs.readdirSync(d), sourcesRoot = path.dirname(dir);
  const extFile = files.find((f) => /^ext-.*\.json$/.test(f) && !f.includes(".verification-")), { record, pages } = readExtraction(path.join(d, extFile), lib);
  const blindTxt = files.find((f) => /^blind-.*\.blinded\.txt$/.test(f)), blindedText = fs.readFileSync(path.join(d, blindTxt), "utf8"), blinded = lib.parsePages(blindedText);
  const src = roleSources(dir).find((r) => r.config.id === meta.role.id && r.config.version === meta.role.version);
  const rubric = run.rubrics.find((r) => r.id === meta.role.id && r.version === meta.role.version);
  if (!src || !rubric || rubric.sha256 !== rubric.manifestSha256) throw new Error("The assessment rules for this role are missing or have changed since they were fixed.");
  const jdText = fs.readFileSync(path.join(sourcesRoot, src.jdText.file), "utf8");
  if (sha(jdText) !== src.jdText.sha256) throw new Error("The job description text has changed since it was recorded.");
  const config = rubric.config, prompt = ai.buildPrompt({ config, jdText, pages: blinded }), schema = ai.outputSchema(config);
  const startedAt = now().toISOString(), result = await route.run({ ...prompt, schema }), finishedAt = now().toISOString();
  const runId = `ai-run-${finishedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex")}`;
  const v = result.ok ? ai.validateAiOutput(result.output, { config, blindedPages: blinded, originalPages: pages }) : null;
  let outcome = !result.ok ? "failed" : v.ok ? "valid" : "invalid";
  let assessmentId = null;
  /* Server-side rule checks on a valid proposal: they may only lower or withhold, and every change is recorded. */
  const checked = outcome === "valid" ? ai.applyRuleChecks(v.output, config, pages) : null;
  if (outcome === "valid") {
    const attempt = fs.existsSync(path.join(dir, "runs/inputs")) ? fs.readdirSync(path.join(dir, "runs/inputs")).filter((f) => f.startsWith(`${id}-a`)).length + 1 : 1;
    assessmentId = `${id}-a${attempt}`;
    const models = result.meta.models?.length ? result.meta.models.join(", ") : result.meta.requestedModel ?? "unknown model";
    const input = ai.toRunInput({
      assessmentId, config, rubricSha256: rubric.sha256, output: checked.output, warnings: [...checked.adjustments, ...checked.notes, ...v.warnings],
      sources: {
        cv: { file: meta.source.file, sha256: meta.source.sha256, recorded: { when: meta.uploadedAt, basis: "Recorded when the CV was added, before it was assessed." } },
        jd: src.jd, roleRequirements: src.roleRequirements,
        extraction: { file: `prototype/${INTAKE}/${id}/${record.text.file}`, sha256: record.text.sha256, recorded: { when: record.finishedAt, basis: "Recorded in the extraction record when the text was extracted." },
          tool: "macOS PDFKit through scripts/extract/pdftool.swift", toolVersion: `${record.tool.os ?? "macOS"}; ${record.tool.swiftc ?? "swiftc"}`, extractedAt: record.finishedAt, note: `Extraction ${record.extractionId}; reviewed against the PDF by ${s.review.by}.` },
      },
      preparation: { actor: `${route.isAi ? "AI route" : "Non-AI test route"}: ${route.id}, model ${models}, ${ai.PROMPT_VERSION}${checked.adjustments.length ? `, ${checked.adjustments.length} rule-check change(s)` : ""}`, at: finishedAt },
    }, run.hash);
    /* The same checks the loader applies (bound files, rubric, quotes on their pages); a failure here keeps it out. */
    try { saving(assessmentId); writeRun(assessmentId, input); }
    catch (e) { assessmentId = null; v.ok = false; v.problems = [`the assessment did not pass the run checks: ${e.message}`]; }
  }
  if (outcome === "valid" && !v.ok) outcome = "invalid";
  writeOnce(path.join(d, `${runId}.json`), {
    schema: "ai-run/1", runId, intakeId: id, jobId, startedAt, finishedAt, outcome, assessmentId,
    route: { id: route.id, label: route.label, isAi: route.isAi, requestedModel: result.meta.requestedModel ?? null, models: result.meta.models ?? [], costUsdEstimate: result.meta.costUsd ?? null, capUsd: result.meta.capUsd ?? null, durationMs: result.meta.durationMs ?? null, subtype: result.meta.subtype ?? null },
    promptVersion: ai.PROMPT_VERSION, promptSha256: sha(prompt.system + "\n" + prompt.user), schemaSha256: sha(JSON.stringify(schema)),
    inputs: { extractionId: record.extractionId, originalTextSha256: record.text.sha256, blindedTextSha256: sha(blindedText), jdTextSha256: src.jdText.sha256, rubric: { id: config.id, version: config.version, sha256: rubric.sha256 } },
    error: result.ok ? null : result.error, problems: v && !v.ok ? v.problems : [], warnings: v?.ok ? v.warnings : [],
    ruleChecks: checked ? { adjustments: checked.adjustments, notes: checked.notes, note: "The output field holds the AI's own proposal; the assessment uses it after these rule-check changes." } : null,
    output: result.ok ? result.output : null, raw: result.raw ?? null,
  });
  return { outcome, runId, assessmentId, error: result.ok ? null : result.error, problems: v && !v.ok ? v.problems : [], summary: intakeSummary(dir, id, lib) };
}

/** Labels for assessments made from intakes (the label mapping only covers the four earlier CVs). */
export function intakeLabels(dir) {
  const inputs = fs.existsSync(path.join(dir, "runs/inputs")) ? fs.readdirSync(path.join(dir, "runs/inputs")) : [];
  return intakeIds(dir).flatMap((id) => {
    const meta = readJson(path.join(dir, INTAKE, id, "intake.json"));
    return inputs.filter((f) => f.startsWith(`${id}-a`) && f.endsWith(".input.json")).map((f) => {
      const assessmentId = f.replace(/\.input\.json$/, ""), attempt = Number(assessmentId.split("-a").pop());
      return { id: assessmentId, label: meta.label, sha256: meta.source.sha256, assignedAt: meta.uploadedAt, intakeId: id, attempt };
    });
  });
}
