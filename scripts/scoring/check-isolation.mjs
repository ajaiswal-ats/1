/* Privacy and isolation check for the scoring test. Run after `npm run build`: npm run scoring:check
   Fails if the production build (dist/), or any file Git would track (tracked or not ignored), contains private scoring
   content: candidate names from the source file names, the source file names, the client or role, or any substantial
   evidence quote. Also fails if the build contains the scoring page or its local endpoints, or if the private folder is not
   ignored or not owner-only. Private terms are compared but never printed. Local only; no network. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DEFAULT_DIR } from "./private-data.mjs";

const ROOT = path.resolve(import.meta.dirname, "../.."), PRIV = path.join(ROOT, process.env.SCORING_PRIVATE_DIR || DEFAULT_DIR);
let bad = 0;
const fail = (m) => { console.log(`FAIL ${m}`); bad++; };
const pass = (m) => console.log(`PASS ${m}`);

if (!fs.existsSync(path.join(ROOT, "dist/index.html"))) { console.log("FAIL dist/ not found: run npm run build first"); process.exit(1); }
const walk = (d, out = []) => { if (fs.existsSync(d)) for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); f.isDirectory() ? walk(p, out) : out.push(p); } return out; };
const dist = walk(path.join(ROOT, "dist"));

/* 1. The build contains no scoring page, entry or endpoint. */
const markers = ["__scoring", "scoring-test", "src/scoring", "Local scoring test", "Experimental — not validated", "scoring-test-reviewer-corrections", "Insufficient evidence — no score", "testMode", "Client preview", "Internal review", "Added to local test", "recruiter review pending", "No notes in this test assessment", "pdftool", "extraction-record", "rule-based best-effort blinding"];
const distHits = dist.filter((f) => { const t = fs.readFileSync(f, "latin1"); return markers.some((m) => t.includes(m)); });
distHits.length ? fail(`${distHits.length} build file(s) contain scoring-test code or endpoints`) : pass(`no scoring-test code, page or endpoint in ${dist.length} build files`);
fs.readdirSync(path.join(ROOT, "dist")).some((f) => f.endsWith(".html") && !["index.html", "demo.html"].includes(f)) ? fail("dist has an unexpected HTML entry") : pass("dist has only the portal and explicit fictional demo entries");

/* 2. Private content, from the private folder. */
if (!fs.existsSync(PRIV)) { console.log("SKIP private-content checks: the private scoring folder is not on this computer"); process.exit(bad ? 1 : 0); }
const json = (f) => JSON.parse(fs.readFileSync(path.join(PRIV, f), "utf8"));
const mapping = json("mapping.json"), data = json("assessments.json");
const cfg = json(`config/${fs.readdirSync(path.join(PRIV, "config")).find((f) => f !== "manifest.json")}`);
const terms = new Map(); // term → kind
const add = (t, kind) => { const s = String(t ?? "").trim(); if (s.length >= 4) terms.set(s.toLowerCase(), kind); };
for (const c of mapping.candidates) {
  add(c.sourceFile, "source file name");
  for (const tok of c.sourceFile.replace(/\.pdf$/i, "").split(/[\s_-]+/)) if (tok.length > 3 && !/^(resume|sales|manager|experienced|pdf)$/i.test(tok) && !/\d/.test(tok)) add(tok, "candidate name");
}
add(cfg.role.client.split(" (")[0], "client"); add(cfg.role.title.split(" (")[0], "role title");
const quotes = data.assessments.flatMap((a) => [...a.gates, ...a.criteria].flatMap((x) => x.evidence.map((e) => e.quote)).concat(a.otherResults.map((o) => o.quote)));
for (const q of quotes) if (q.length >= 25) add(q, "evidence quote");
console.log(`INFO ${terms.size} private terms loaded (not printed)`);

const scan = (files, label) => {
  let hits = 0; const kinds = new Set();
  for (const f of files) {
    let t; try { t = fs.readFileSync(f, "utf8").toLowerCase(); } catch { continue; }
    for (const [term, kind] of terms) if (t.includes(term)) { hits++; kinds.add(kind); console.log(`  ${path.relative(ROOT, f)}: contains a ${kind}`); }
  }
  hits ? fail(`${label}: ${hits} private term match(es) (${[...kinds].join(", ")})`) : pass(`${label}: no private content in ${files.length} files`);
};
scan(dist, "production build (dist/)");
const gitFiles = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: ROOT }).toString().split("\0").filter(Boolean).map((f) => path.join(ROOT, f));
scan(gitFiles, "files Git would track (tracked or not ignored)");
scan(walk(path.join(ROOT, "public")), "public/");

/* 3. The private folder is ignored and owner-only. */
const ignored = (p) => { try { execFileSync("git", ["check-ignore", "-q", p], { cwd: ROOT }); return true; } catch { return false; } };
const privFiles = walk(PRIV);
const notIgnored = privFiles.filter((f) => !ignored(path.relative(ROOT, f)));
notIgnored.length ? fail(`${notIgnored.length} private file(s) not ignored by Git`) : pass(`all ${privFiles.length} private files are ignored by Git`);
const loose = privFiles.filter((f) => (fs.statSync(f).mode & 0o077) !== 0);
loose.length ? fail(`${loose.length} private file(s) readable by other users`) : pass("private files are readable by the owner only");

console.log(bad ? `\n${bad} problem(s) found` : "\nPASS scoring test isolation and privacy checks");
process.exit(bad ? 1 : 0);
