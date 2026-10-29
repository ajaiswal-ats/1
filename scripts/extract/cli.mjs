/* Local document preparation commands (macOS; no network). Prints labels, statuses, counts and short fingerprints only:
   never document text, names, contact details or source paths.
     node scripts/extract/cli.mjs fixtures <dir>                                   synthetic test PDFs (fictional)
     node scripts/extract/cli.mjs extract <pdf> --label <label> [--out <dir>]      reproducible extraction record + text
     node scripts/extract/cli.mjs blind <record.json> --options <options.json> [--out <dir>]
     node scripts/extract/cli.mjs verify <record.json> --reviewer <name> --date <YYYY-MM-DD> --pages all|1,2 --method <how> --result matches|"differences found" [--notes <text>]
     node scripts/extract/cli.mjs compare <old record.json> <new record.json> [--assessment <id>]
     node scripts/extract/cli.mjs adopt <assessment id> <record.json> --reviewer <name> --reason <why>
   Outputs go to the private extraction folder (docs/reference/scoring-inputs/prototype/extractions) unless --out names a
   folder inside it; EXTRACT_ALLOWED_ROOT overrides the allowed root (used by tests with a temporary folder). */
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_DIR } from "../scoring/private-data.mjs";
import { withExtractLib } from "../scoring/lib.mjs";
import { ExtractError, blindExtraction, compareRecordFiles, extractPdf, recordVerification, runTool } from "./extract.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : undefined; };
const positional = rest.filter((x, i) => !x.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--")));
const privateDir = path.resolve(process.env.SCORING_PRIVATE_DIR || DEFAULT_DIR);
const allowedRoot = path.resolve(process.env.EXTRACT_ALLOWED_ROOT || path.join(privateDir, "extractions"));
const outDir = path.resolve(flag("out") ?? allowedRoot);

try {
  await withExtractLib(async (lib) => {
    if (cmd === "fixtures") { fs.mkdirSync(positional[0], { recursive: true }); runTool("make-fixtures", path.resolve(positional[0])); console.log("Synthetic fixtures written."); return; }
    if (cmd === "extract") {
      const { record } = extractPdf({ pdf: positional[0], outDir, allowedRoot, label: flag("label"), lib });
      console.log(`${record.label}: ${record.status.toUpperCase()} · ${record.source.pageCount} page(s) · ${record.review} · ${record.verification}`);
      for (const p of record.pages.filter((x) => x.flags.length)) console.log(`  page ${p.page}: ${p.flags.join("; ")}`);
      if (record.problems.length) console.log(`  problems: ${record.problems.join("; ")}`);
      console.log(`  extraction ${record.extractionId} · source ${record.source.sha256.slice(0, 12)} · content ${record.contentSha256.slice(0, 12)}${record.text ? ` · text ${record.text.sha256.slice(0, 12)}` : ""}`);
      if (record.status !== "completed") process.exitCode = 2;
      return;
    }
    if (cmd === "blind") {
      const options = JSON.parse(fs.readFileSync(flag("options"), "utf8"));
      const { record } = blindExtraction({ recordFile: positional[0], outDir, allowedRoot, options, lib });
      console.log(`Blinded ${record.sourceExtractionId}: ${Object.entries(record.counts).map(([k, n]) => `${n} ${k}`).join(", ") || "no replacements"} · ${record.residualItems} item(s) for residual review · ${record.guarantee}`);
      return;
    }
    if (cmd === "verify") {
      const pages = flag("pages") === "all" ? "all" : (flag("pages") ?? "").split(",").filter(Boolean);
      const { verification } = recordVerification({ recordFile: positional[0], reviewer: flag("reviewer"), reviewedOn: flag("date"), pages, method: flag("method"), result: flag("result"), notes: flag("notes") ?? "", lib });
      console.log(`Verification recorded for ${verification.extractionId}: ${verification.result} (pages ${verification.scope.pages === "all" ? "all" : verification.scope.pages.join(", ")}).`);
      return;
    }
    if (cmd === "compare") {
      let quotes = [];
      if (flag("assessment")) {
        const input = JSON.parse(fs.readFileSync(path.join(privateDir, "runs/inputs", `${flag("assessment")}.input.json`), "utf8"));
        quotes = [...input.assessment.gates.flatMap((g) => g.evidence.map((e, i) => ({ id: `gate ${g.id} quote ${i + 1}`, ...e }))), ...input.assessment.criteria.flatMap((c) => c.evidence.map((e, i) => ({ id: `criterion ${c.id} quote ${i + 1}`, ...e })))];
      }
      const c = compareRecordFiles(positional[0], positional[1], lib, quotes);
      console.log(`Compare ${c.from} → ${c.to} (${c.sameSource ? "same PDF" : "DIFFERENT PDF"}): ${c.pages.map((p) => `p${p.page} ${p.status}`).join(", ")}`);
      for (const a of c.attention) console.log(`  attention: ${a}`);
      console.log(`  ${quotes.length} quote(s) checked · nothing was changed; adopting the new extraction is a separate command`);
      return;
    }
    if (cmd === "adopt") {
      const { adoptExtraction } = await import("../scoring/adopt-extraction.mjs");
      const r = adoptExtraction({ dir: privateDir, assessmentId: positional[0], recordFile: positional[1], reviewer: flag("reviewer"), reason: flag("reason"), lib });
      console.log(`Adopted ${r.extractionId} for ${r.assessmentId} (${r.quotesChecked} quotes on their pages). ${r.nextStep}`);
      return;
    }
    throw new ExtractError("usage", "Unknown command. See the header of scripts/extract/cli.mjs.");
  });
} catch (e) {
  console.log(`FAILED (${e instanceof ExtractError ? e.code : "error"}): ${e instanceof ExtractError ? e.message : "unexpected error"}`);
  process.exitCode = 1;
}
