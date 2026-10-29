import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* The read-only assessment preview (npm run assessment-preview:build), separate from the client portal: its own page
   (src/preview), its own output folder, no environment settings (envDir has no .env files, so no Supabase setting can
   be bundled) and no public folder. The output goes to the Git-ignored private scoring folder, because the export step
   (scripts/preview/export-data.mjs) writes the candidate data next to it. Serve it only on 127.0.0.1 or behind verified
   access protection. */
export const PREVIEW_OUT = path.resolve("docs/reference/scoring-inputs/preview-build");
export default defineConfig({
  root: path.resolve("src/preview"),
  base: "./",
  envDir: path.resolve("scripts/scoring/no-env"),
  publicDir: false,
  plugins: [react()],
  build: { outDir: PREVIEW_OUT, emptyOutDir: true, sourcemap: false },
  preview: { host: "127.0.0.1", port: 5194, strictPort: true, headers: { "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" } },
});
