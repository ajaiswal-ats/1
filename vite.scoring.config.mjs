import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { privatePathsGuard } from "./scripts/dev/private-paths.mjs";
import { scoringPrivateData } from "./scripts/scoring/private-data.mjs";

/* The portal's local scoring-test mode (npm run scoring:dev). Development only, 127.0.0.1 only.
   It serves the normal portal entry (index.html → src/main.tsx) with VITE_PORTAL_MODE fixed to "scoring-test", which
   renders the portal's own pages over an explicit local test-data adapter (src/scoring/testMode.tsx).
   - No environment settings: envDir is a folder with no .env files, so .env.local (and its Supabase settings) is never
     read, and the Supabase portal tree is never loaded; no move recorder.
   - The page may connect only to this server (Content-Security-Policy), and private or non-app files are not served.
   - Private inputs reach the page only through the scoring endpoints, from the Git-ignored scoring folder; this config
     refuses to build. The ordinary `npm run build` uses vite.config.ts, where the test mode is removed (DEV is false). */
export default defineConfig({
  envDir: path.resolve("scripts/scoring/no-env"),
  define: { "import.meta.env.VITE_PORTAL_MODE": JSON.stringify("scoring-test") },
  plugins: [privatePathsGuard(), react(), scoringPrivateData()],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.SCORING_PORT) || 5190,
    strictPort: true,
    open: false,
    fs: { deny: [".env", ".env.*", "*.{pem,key}", "**/docs/**", "**/supabase/**", "**/manatal/**"] },
  },
});
