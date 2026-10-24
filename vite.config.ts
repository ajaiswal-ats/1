/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { moveRecorder } from "./scripts/dev/move-recorder-plugin.mjs";

export default defineConfig({
  /* moveRecorder: development-only test-run record of stage-change requests; inactive unless VITE_DEV_RECORD_MOVES=true, absent from builds. */
  plugins: [react(), moveRecorder()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  /* Unit tests, including the database scripts' logic; the hosted database tests in tests/db run separately (vitest.db.config.mjs). */
  test: { include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"] },
});
