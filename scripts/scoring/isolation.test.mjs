/* The scoring test stays out of the production portal and away from hosted services:
   - the production entry reaches the test mode only through a branch guarded by import.meta.env.DEV (removed from builds;
     scripts/scoring/check-isolation.mjs checks the built files);
   - the test mode reaches the portal's pages but never the Supabase tree, and calls nothing but its own local server;
   - the scoring server reads no environment files, binds to loopback and refuses builds;
   - tracked scoring code names no client, role, source file or candidate. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");
it("the explicit public demo entry never imports authentication or local scoring services", () => {
  const entry = path.join(ROOT, "src/demo.tsx");
  expect(fs.existsSync(entry)).toBe(true);
  const modules = [...graph(entry)].map(f => path.relative(ROOT, f));
  expect(modules).toContain("src/App.tsx");
  expect(modules.some(f => f.startsWith("src/auth/") || f.startsWith("src/scoring/"))).toBe(false);
  expect(fs.readFileSync(path.join(ROOT, "demo.html"), "utf8")).toContain('/src/demo.tsx');
});
const resolve = (from, spec) => {
  const base = path.resolve(path.dirname(from), spec);
  return [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find((f) => fs.existsSync(f) && fs.statSync(f).isFile()) ?? null;
};
/** Every local module reachable from an entry, following static and dynamic imports (except those `skip` rejects). */
function graph(entry, skip = () => false) {
  const seen = new Set(), todo = [entry];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f) || !/\.(ts|tsx)$/.test(f)) continue;
    seen.add(f);
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:import|export)\s[^;]*?from\s+["'](\.[^"']+)["']|import\(\s*["'](\.[^"']+)["']\s*\)/g)) {
      const spec = m[1] ?? m[2];
      if (skip(f, spec)) continue;
      const r = resolve(f, spec);
      if (r) todo.push(r);
    }
  }
  return [...seen].map((f) => path.relative(ROOT, f));
}
const MAIN = path.join(ROOT, "src/main.tsx");

describe("production isolation", () => {
  it("the portal entry reaches the scoring test only through the development-only branch", () => {
    const main = fs.readFileSync(MAIN, "utf8"), refs = [...main.matchAll(/^.*\.\/scoring\/.*$/gm)].map((m) => m[0]);
    expect(refs).toHaveLength(1);
    expect(main).toMatch(/if \(import\.meta\.env\.DEV && import\.meta\.env\.VITE_PORTAL_MODE === "scoring-test"\) \{\n\s+void import\("\.\/scoring\/testMode"\)/);
    const portal = graph(MAIN, (f, spec) => f === MAIN && spec === "./scoring/testMode");
    expect(portal.length).toBeGreaterThan(20);
    expect(portal.filter((f) => f.startsWith("src/scoring/"))).toEqual([]);
  });
  it("a production build refuses the scoring-test mode like any unknown mode", () => {
    expect(fs.readFileSync(path.join(ROOT, "src/auth/config.ts"), "utf8")).not.toMatch(/scoring/);
  });
  it("the production build has only client and fictional demo entries, with private-path protection", () => {
    const cfg = fs.readFileSync(path.join(ROOT, "vite.config.ts"), "utf8");
    expect(cfg).not.toMatch(/scoring/);
    expect(cfg).toContain('input: ["index.html", "demo.html"]');
    expect(cfg).toMatch(/plugins: \[privatePathsGuard\(\),/);
    expect(fs.existsSync(path.join(ROOT, "scoring.html"))).toBe(false);
  });
  it("neither client entry imports the unfinished recruiter workspace", () => {
    const portal = graph(MAIN, (f, spec) => f === MAIN && spec === "./scoring/testMode");
    const demo = graph(path.join(ROOT, "src/demo.tsx"));
    expect([...portal, ...demo].filter((f) => f.startsWith("src/recruiter/"))).toEqual([]);
  });
  it("the fictional recruiter preview stays local, uses no environment files and refuses builds", () => {
    const cfg = fs.readFileSync(path.join(ROOT, "vite.recruiter-preview.config.mjs"), "utf8");
    expect(cfg).toContain('envDir: path.resolve("scripts/scoring/no-env")');
    expect(cfg).toContain('host: "127.0.0.1"');
    expect(cfg).toMatch(/apply: "build", buildStart\(\) \{ throw/);
    expect(cfg).toContain("privatePathsGuard()");
    const entry = fs.readFileSync(path.join(ROOT, "recruiter-preview.html"), "utf8");
    expect(entry).toContain('/src/recruiter/demo.tsx');
    const preview = fs.readFileSync(path.join(ROOT, "src/recruiter/demo.tsx"), "utf8");
    expect(preview).toContain('if (!import.meta.env.DEV) throw');
    expect(preview).toContain('useState(fictionalGateway)');
  });
  it("the recruiter entry reuses the calculator without importing local services, private fixtures or preview exports", () => {
    const recruiter = graph(path.join(ROOT, "src/recruiter/main.tsx"));
    expect(recruiter).toContain("src/scoring/calculator.ts");
    expect(recruiter.some((f) => /src\/(preview|scoring\/(api|testMode|syntheticFixture|extraction|blinding))/.test(f))).toBe(false);
    expect(recruiter.some((f) => /src\/recruiter\/import\.ts/.test(f))).toBe(false);
    expect(recruiter.some((f) => /src\/recruiter\/(demo|fictional)\.tsx?$/.test(f))).toBe(false);
  });
});

describe("separation from hosted services", () => {
  const scoring = graph(path.join(ROOT, "src/scoring/testMode.tsx"));
  it("the test mode reuses the portal's pages but never reaches the Supabase tree", () => {
    expect(scoring).toEqual(expect.arrayContaining(["src/auth/AuthViews.tsx", "src/workspace/DbViews.tsx", "src/workspace/data.ts", "src/scoring/calculator.ts"]));
    expect(scoring.filter((f) => /src\/auth\/(AuthRoot|config|session|account)\.tsx?$/.test(f) && !/session\.ts$/.test(f))).toEqual([]);
    for (const f of scoring) expect(fs.readFileSync(path.join(ROOT, f), "utf8"), f).not.toMatch(/from\s+["']@supabase|createClient\(/);
  });
  it("the only network calls in the test mode are to its own local server", () => {
    for (const f of scoring) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      for (const m of src.matchAll(/fetch\(\s*["'`]([^"'`]+)/g)) expect(m[1], f).toMatch(/^\/__scoring\//);
      expect(src, f).not.toMatch(/fetch\(\s*[a-zA-Z]/);
    }
  });
  it("the scoring server reads no environment files, fixes the mode, guards private paths, binds to loopback and refuses builds", () => {
    const cfg = fs.readFileSync(path.join(ROOT, "vite.scoring.config.mjs"), "utf8");
    expect(cfg).toMatch(/envDir: path\.resolve\("scripts\/scoring\/no-env"\)/);
    expect(cfg).toMatch(/"import\.meta\.env\.VITE_PORTAL_MODE": JSON\.stringify\("scoring-test"\)/);
    expect(cfg).toMatch(/plugins: \[privatePathsGuard\(\), react\(\), scoringPrivateData\(\)\]/);
    expect(cfg).toMatch(/host: "127\.0\.0\.1"/);
    expect(cfg).not.toMatch(/moveRecorder/);
    expect(fs.readdirSync(path.join(ROOT, "scripts/scoring/no-env")).filter((f) => f.startsWith(".env"))).toEqual([]);
    expect(fs.readFileSync(path.join(ROOT, "scripts/scoring/private-data.mjs"), "utf8")).toMatch(/apply: "build",\s*buildStart\(\) \{ throw/);
  });

  it("the extraction and blinding code makes no network calls and is never part of the app", () => {
    for (const f of ["scripts/extract/extract.mjs", "scripts/extract/cli.mjs", "scripts/extract/pdftool.swift", "scripts/scoring/adopt-extraction.mjs", "src/scoring/extraction.ts", "src/scoring/blinding.ts"]) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      expect(src, f).not.toMatch(/from\s+["']node:(?:http|https|net|tls|dgram)["']|\bfetch\(|URLSession|XMLHttpRequest|WebSocket/);
    }
    expect(graph(MAIN, (f, spec) => f === MAIN && spec === "./scoring/testMode").filter((f) => /scoring\/(extraction|blinding)\.ts$/.test(f))).toEqual([]);
  });

  /* Private-content scanning of tracked files needs the private folder, so it is an explicit local check, not part of the
     standard tests: npm run scoring:check (scripts/scoring/check-isolation.mjs). */
  it("standard tests never read the private scoring folder", () => {
    const tests = [...fs.readdirSync(path.join(ROOT, "scripts/scoring")).filter((f) => f.endsWith(".test.mjs") && f !== "isolation.test.mjs").map((f) => `scripts/scoring/${f}`),
      ...fs.readdirSync(path.join(ROOT, "src/scoring")).filter((f) => /\.test\.tsx?$/.test(f)).map((f) => `src/scoring/${f}`)];
    for (const f of tests) expect(fs.readFileSync(path.join(ROOT, f), "utf8"), f).not.toMatch(/scoring-inputs|DEFAULT_DIR|loadPrivateData\(DIR/);
  });

});
