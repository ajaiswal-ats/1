// Prepares private SQL only. No environment files, credentials, network requests or database connection.
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const input = arg("--input"), out = arg("--out"), clientId = arg("--client-id"), submissionId = arg("--submission-id");
if (!input || !out || !clientId || !submissionId) {
  console.log("Prepare an owner-reviewed SQL draft; applies nothing.\nUsage: node scripts/recruiter/prepare-import.mjs --input PRIVATE_SOURCE.json --client-id UUID --submission-id UUID --out PRIVATE_OUTPUT.sql\nInput JSON: {config, assessment, screeningSet}. The output contains private evidence: keep it outside Git and public/.");
  process.exit(process.argv.includes("--help") ? 0 : 1);
}
const vite = await createServer({ configFile: false, envDir: path.resolve("scripts/scoring/no-env"), server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", logLevel: "error" });
try {
  const { prepareImport } = await vite.ssrLoadModule("/src/recruiter/import.ts");
  const row = prepareImport(JSON.parse(fs.readFileSync(input, "utf8")), clientId, submissionId);
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const columns = Object.keys(row), values = columns.map((k) => quote(typeof row[k] === "string" ? row[k] : JSON.stringify(row[k])));
  // Explicit UUID mapping is checked again by the composite submission/client foreign key on import.
  const sql = `-- PRIVATE draft: inspect the explicit client/submission mapping before running as database owner.\n-- No summary is published and no account is provisioned by this file.\nset standard_conforming_strings = on;\nbegin;\ninsert into app_private.scoring_assessments (${columns.join(", ")})\nvalues (${values.join(", ")});\ncommit;\n`;
  fs.writeFileSync(out, sql, { flag: "wx", mode: 0o600 });
  console.log("Prepared a private SQL draft with an explicit portal mapping. Nothing was applied or shared.");
} finally { await vite.close(); }
