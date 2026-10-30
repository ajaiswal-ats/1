import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { privatePathsGuard } from "./scripts/dev/private-paths.mjs";

// Explicit fictional preview only: no .env files, local assessment data or hosted backend. Never a deployable build.
export default defineConfig({
  envDir: path.resolve("scripts/scoring/no-env"),
  plugins: [react(), privatePathsGuard(), { name: "fictional-preview-only", apply: "build", buildStart() { throw new Error("The fictional recruiter preview is local only; build the real recruiter.html entry instead."); } }],
  server: { host: "127.0.0.1", port: 5197, strictPort: true, open: false },
});
