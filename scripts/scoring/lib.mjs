/* Loads the shared run logic (src/scoring/run.ts, versions.ts) for local scripts through Vite, with no config file and no
   environment files, so scripts and the local server use exactly the same validation and calculation. Local only. */
import path from "node:path";
import { createServer } from "vite";

/** Loads the shared TypeScript modules the extraction commands use (extraction, blinding and run logic) through Vite. */
export async function withExtractLib(task) {
  const vite = await createServer({ configFile: false, envDir: path.resolve("scripts/scoring/no-env"), server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", logLevel: "error" });
  try {
    const lib = { ...(await vite.ssrLoadModule("/src/scoring/run.ts")), ...(await vite.ssrLoadModule("/src/scoring/extraction.ts")), ...(await vite.ssrLoadModule("/src/scoring/blinding.ts")) };
    return await task(lib);
  } finally { await vite.close(); }
}

export async function withRunLib(task) {
  const vite = await createServer({ configFile: false, envDir: path.resolve("scripts/scoring/no-env"), server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", logLevel: "error" });
  try {
    const lib = { ...(await vite.ssrLoadModule("/src/scoring/run.ts")), buildVersions: (await vite.ssrLoadModule("/src/scoring/versions.ts")).buildVersions };
    return await task(lib);
  } finally { await vite.close(); }
}

/** Loads what the evaluation pack needs: the same logic the local server validates assessments with, the recruiter
    portal's identical-CV grouping, and the sheet builder. */
export async function withPackLib(task) {
  const vite = await createServer({ configFile: false, envDir: path.resolve("scripts/scoring/no-env"), server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", logLevel: "error" });
  try {
    const load = (m) => vite.ssrLoadModule(m);
    const lib = { ...(await load("/src/scoring/run.ts")), ...(await load("/src/scoring/screening.ts")), ...(await load("/src/scoring/finalReview.ts")),
      buildVersions: (await load("/src/scoring/versions.ts")).buildVersions, ...(await load("/src/scoring/evaluationPack.ts")),
      groupCandidates: (await load("/src/scoring/AssessHome.tsx")).groupCandidates };
    return await task(lib);
  } finally { await vite.close(); }
}
