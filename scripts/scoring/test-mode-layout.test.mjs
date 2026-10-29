/* The scoring test mode's layout fixes stay in test mode: its stylesheet stacks the candidate page at narrow widths and
   drops the Next step column when there is no panel, and only the test mode imports it, so normal pages are unchanged. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync("src/scoring/scoring.css", "utf8");
const importers = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.posix.join(dir, e.name);
  if (e.isDirectory()) return importers(p);
  return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && fs.readFileSync(p, "utf8").includes("scoring.css") ? [p] : [];
});

describe("test-mode layout", () => {
  it("stacks the assessment and Next step panel at narrow widths, and drops the column when there is no panel", () => {
    expect(css).toMatch(/\.cd\.cd-solo\{grid-template-columns:minmax\(0,1fr\)\}/);
    expect(css).toMatch(/@media \(max-width:1199px\)\{\s*\.cd\{grid-template-columns:minmax\(0,1fr\)\}/);
    expect(css).toMatch(/@container sc \(max-width:860px\)/);
  });
  it("is imported only by the scoring test mode, so normal portal pages keep their layout", () => {
    /* The read-only preview (src/preview, vite.preview.config.mjs) is a separate page with its own entry, not a portal page. */
    expect(importers("src")).toEqual(["src/preview/main.tsx", "src/scoring/testMode.tsx"]);
    expect(fs.readFileSync("src/main.tsx", "utf8")).not.toMatch(/scoring\.css|src\/preview|\.\/preview/);
    expect(fs.readFileSync("src/styles/candidate.css", "utf8")).not.toMatch(/cd-solo|@container/);
  });
});

describe("long status labels", () => {
  it("wrap within their column, move under the name on narrow screens, and are never kept on one line", () => {
    expect(css).toMatch(/\.sc-item-s \.chip\{white-space:normal;[^}]*overflow-wrap:anywhere\}/);
    expect(css).toMatch(/\.sc-item-s\{[^}]*min-width:0;max-width:50%\}/);
    expect(css).toMatch(/@media \(max-width:640px\)\{\.sc-item>summary\{flex-wrap:wrap;[^}]*\}\.sc-item-s\{max-width:100%;flex-basis:100%/);
    expect(css).toMatch(/\.sc-open \.reqlist \.chip\{white-space:normal;overflow-wrap:anywhere\}/);
    expect(css).not.toMatch(/\.sc-item>summary \.chip\{flex:none\}|\.sc-item-s\{[^}]*flex:none/);
  });
});
