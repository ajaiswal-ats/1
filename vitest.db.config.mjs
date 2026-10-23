/* Hosted development database tests (tests/db). Run only on request: npm run db:test:api. Never part of npm test. */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/db/**/*.test.mjs"], testTimeout: 30_000, hookTimeout: 90_000, fileParallelism: false },
});
