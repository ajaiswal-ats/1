/* Writes the read-only preview's data (data/assessments.json) next to the built preview page in the private, Git-ignored
   scoring folder. Run after `vite build --config vite.preview.config.mjs` (npm run assessment-preview:build).
   - Only the four supplied candidates: assessments are grouped by recorded CV fingerprint (as on the scoring home) and
     each group must contain one of the supplied candidates' records. The latest valid assessment of each is exported,
     under the supplied candidate's label (Candidate A–D). Anything else is refused, never guessed.
   - Every assessment is loaded through the same checks the local tool applies (loadPrivateData); a blocked one stops the
     export. Only what the page shows is kept: no file names, fingerprints, run IDs, model details, provenance or
     screening questions.
   - No AI call, no network and no change to any record: it reads the private folder and writes one new data file. */
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import { DEFAULT_DIR, loadPrivateData } from "../scoring/private-data.mjs";
import { PREVIEW_OUT } from "../../vite.preview.config.mjs";

const SUPPLIED = ["cand-a", "cand-b", "cand-c", "cand-d"];

/** The latest assessment of each supplied candidate, minimised for the preview. Pure; for tests. */
export function previewData(data, { now = new Date().toISOString(), viewOf, resultLabel } = {}) {
  if (!data.available) throw new Error(`The private scoring data is not available: ${data.problems.join(" ")}`);
  if (data.problems.length) throw new Error(`The private data has problems; fix them first: ${data.problems.join(" ")}`);
  const groups = new Map();
  for (const a of data.assessments) { if (!a.cvSha256) throw new Error(`${a.id} has no recorded CV fingerprint.`); groups.set(a.cvSha256, [...(groups.get(a.cvSha256) ?? []), a]); }
  const picked = SUPPLIED.map((sid) => {
    const group = [...groups.values()].find((g) => g.some((a) => a.id === sid));
    if (!group) throw new Error(`No records for ${sid}.`);
    const named = group.find((a) => a.id === sid), valid = group.filter((a) => a.status !== "blocked");
    if (valid.length !== group.length) throw new Error(`${named.label}: an assessment is blocked; fix it first.`);
    const latest = [...valid].sort((x, y) => (x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : (x.attempt ?? 0) - (y.attempt ?? 0))).pop();
    return { label: named.label, a: latest };
  });
  if (groups.size !== SUPPLIED.length) throw new Error(`Expected the ${SUPPLIED.length} supplied candidates only; found ${groups.size} distinct CVs.`);
  const configs = new Set(picked.map(({ a }) => `${a.configId}@${a.configVersion}`));
  if (configs.size !== 1) throw new Error("The latest assessments use different assessment rules.");
  const loaded = data.configs.find((c) => `${c.id}@${c.version}` === [...configs][0]);
  if (!loaded?.id || !loaded.hashOk) throw new Error("The assessment rules are missing or do not match their recorded fingerprint.");
  /* Only what the calculation and the requirement names need: the full rules (test rules, rating descriptions, test
     choices, sources and the role description) stay in the reference document. Checked below to give identical results. */
  const config = {
    id: loaded.id, version: loaded.version, approved: loaded.approved, hashOk: loaded.hashOk, sha256: "", frozenSha256: "",
    role: { id: loaded.role.id, title: loaded.role.title, loc: loaded.role.loc },
    gates: loaded.gates.map((g) => ({ id: g.id, label: g.label })), gateExceptions: loaded.gateExceptions ?? [],
    criteria: loaded.criteria.map(({ anchors, source, testRule, ...c }) => c), // the calculator checks that an excluded criterion has its reason
    constraints: (loaded.constraints ?? []).map((c) => ({ id: c.id, label: c.label })), policy: loaded.policy, testChoices: [],
  };
  const assessments = picked.map(({ label, a }, i) => ({
    id: `preview-${String.fromCharCode(97 + i)}`, label, kind: "real", status: a.status, configId: a.configId, configVersion: a.configVersion,
    producedBy: /\(ai-proposed\)/.test(a.producedBy) ? "AI draft (ai-proposed)" : "Prepared by hand with an AI assistant", createdAt: a.createdAt,
    gates: a.gates, criteria: a.criteria, otherResults: a.otherResults, strengths: a.strengths, gaps: a.gaps,
    constraints: [], questions: [], manualReview: [], screening: null, consistencyRules: [],
    /* The client-summary history without names or times: the current (or latest) revision in full, with whether a
       recruiter confirmed it and any approved held strengths (what releases a held strength or a summary marked for
       review); earlier revisions only with their strengths and quotes, so a strength left out later keeps its evidence. */
    clientView: a.clientView ? { ...a.clientView, preparedBy: "" } : null,
    clientViews: (a.clientViews ?? []).map((x, j, all) => { const full = a.clientView ? x.current : j === all.length - 1;
      return { revision: x.revision, current: x.current, describes: { assessmentVersion: x.describes.assessmentVersion }, statusRule: "", preparation: { method: full ? x.preparation.method : "", actor: "", at: "" },
        content: full ? x.content : { summary: "", strengths: x.content.strengths, gaps: [], statuses: {} },
        ...(full && x.review?.approvedHeld?.length ? { review: { approvedHeld: x.review.approvedHeld } } : {}) }; }),
    corrections: (a.corrections ?? []).map((c) => ({ ...c, assessmentId: `preview-${String.fromCharCode(97 + i)}` })), latestVersion: a.latestVersion,
  }));
  const out = { schema: "assessment-preview/1", generatedAt: now, config, assessments };
  /* The same calculation the page makes, before anything is written. */
  const results = viewOf ? out.assessments.map((a) => {
    const v = viewOf(a, config, a.corrections, []), full = viewOf(a, loaded, a.corrections, []);
    if (v.versionProblems.length) throw new Error(`${a.label}: ${v.versionProblems.join("; ")}`);
    if (JSON.stringify(v.latest.result) !== JSON.stringify(full.latest.result)) throw new Error(`${a.label}: the shortened rules do not give the same result as the full rules.`);
    return `${a.label}: ${resultLabel(v.latest.result)}`;
  }) : [];
  return { out, results, sources: picked.map(({ label, a }) => `${label}: ${a.intakeId ? `added CV, attempt ${a.attempt}` : "supplied record"}`) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = path.resolve(import.meta.dirname, "../..");
  if (!fs.existsSync(path.join(PREVIEW_OUT, "index.html"))) throw new Error("Build the preview first (vite build --config vite.preview.config.mjs).");
  const vite = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", logLevel: "silent" });
  try {
    const m = (x) => vite.ssrLoadModule(x);
    const lib = { ...(await m("/src/scoring/extraction.ts")), ...(await m("/src/scoring/blinding.ts")), ...(await m("/src/scoring/run.ts")), buildVersions: (await m("/src/scoring/versions.ts")).buildVersions };
    const { viewOf } = await m("/src/scoring/model.ts"), { resultLabel } = await m("/src/scoring/plainText.ts");
    const { out, results, sources } = previewData(loadPrivateData(path.resolve(root, process.env.SCORING_PRIVATE_DIR || DEFAULT_DIR), lib), { viewOf, resultLabel });
    const dir = path.join(PREVIEW_OUT, "data"), file = path.join(dir, "assessments.json");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(out), { mode: 0o600 });
    for (const f of fs.readdirSync(PREVIEW_OUT, { recursive: true })) fs.chmodSync(path.join(PREVIEW_OUT, f), fs.statSync(path.join(PREVIEW_OUT, f)).isDirectory() ? 0o700 : 0o600);
    fs.chmodSync(PREVIEW_OUT, 0o700);
    console.log(`Preview data written (${out.assessments.length} assessments, private folder).`);
    for (const s of sources) console.log(`  source  ${s}`);
    for (const r of results) console.log(`  result  ${r}`);
  } finally { await vite.close(); }
}
