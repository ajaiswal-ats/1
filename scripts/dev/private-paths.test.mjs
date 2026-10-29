/* The development serving boundary shared by both dev servers. */
import { describe, expect, it } from "vitest";
import { isPrivatePath } from "./private-paths.mjs";

const ROOT = "/work/client-portal-v1";
describe("private paths", () => {
  it.each([
    "/docs/reference/scoring-inputs/prototype/mapping.json",
    "/docs/reference/scoring-inputs/prototype/assessments.json?raw",
    "/docs/reference/Candidate%20Scoring%20One-Page%20Starter.pdf",
    "/%64ocs/reference/x.md",
    "/%2564ocs/reference/x.md",
    "/src/../docs/reference/x.json",
    "//docs/reference/x.json",
    "/./docs/x",
    `/@fs${ROOT}/docs/reference/scoring-inputs/prototype/mapping.json`,
    "/@fs/etc/hosts",
    "/supabase/.env.dev.local", "/supabase/migrations/001.sql", "/manatal/runs/x.json", "/scripts/dev/move-record-lib.mjs", "/tests/db/x.test.mjs",
    "/.env.local", "/.git/config", "/anything/resume.pdf", "/ASSUMPTIONS.md", "/dist/index.html",
    "/node_modules/.cache/scoring-pdftool/abc/pdftool", `/@fs${ROOT}/node_modules/.cache/scoring-pdftool/abc/pdftool`, "/node_modules/%2Ecache/x",
  ])("refuses %s", (url) => expect(isPrivatePath(url, ROOT)).toBe(true));

  it.each([
    "/", "/index.html", "/src/main.tsx", "/src/workspace/DbViews.tsx?t=1", "/@vite/client", "/@react-refresh", "/@id/react",
    "/node_modules/.vite/deps/react.js?v=1", "/node_modules/@fontsource/ibm-plex-sans/files/x.woff2", `/@fs${ROOT}/node_modules/vite/dist/client/env.mjs`,
    "/src/assets/revenue-optics-logo.png", "/__scoring/data",
  ])("serves %s", (url) => expect(isPrivatePath(url, ROOT)).toBe(false));
});
