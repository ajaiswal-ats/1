/* Offline database tests: an in-memory Postgres (PGlite) with the real migration, seed and SQL scripts, behind a small
   stand-in for the Supabase Auth and Data API. No network, no hosted project. Run with: npm run db:test:offline */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/offline-db/**/*.test.mjs"], testTimeout: 60_000, hookTimeout: 60_000 },
});
