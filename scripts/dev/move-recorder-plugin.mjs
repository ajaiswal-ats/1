/* Vite plugin: the development-only test-run recorder (see move-record-lib.mjs). It exists only while `vite` serves the
   app (configureServer), and only if VITE_DEV_RECORD_MOVES=true; a production build has no such endpoint.
   POST /__dev/move-record with one JSON entry; 204 once it is on disk, 400 for a malformed entry, 403 for a non-local
   request. The record goes to supabase/runs/ (gitignored), or DEV_MOVE_RECORD_DIR if set (used by the offline checks). */
import path from "node:path";
import { loadEnv } from "vite";
import { cleanEntry, createRunFile, isLocalRequest } from "./move-record-lib.mjs";

export const RECORD_PATH = "/__dev/move-record";

export function moveRecorder() {
  return {
    name: "dev-move-recorder",
    apply: "serve",
    configureServer(server) {
      const env = { ...loadEnv(server.config.mode, server.config.envDir || server.config.root, "VITE_"), ...process.env };
      if (env.VITE_DEV_RECORD_MOVES !== "true") return;
      const project = (String(env.VITE_SUPABASE_URL || "").match(/^https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || "unknown";
      const dir = process.env.DEV_MOVE_RECORD_DIR || path.join(server.config.root, "supabase/runs");
      const runFile = createRunFile(dir, project);
      server.config.logger.info(`dev move recorder: stage-change test requests are recorded in ${path.relative(server.config.root, runFile.file)}`);
      server.middlewares.use(RECORD_PATH, (req, res) => {
        if (req.method !== "POST") { res.statusCode = 405; return res.end(); }
        if (!isLocalRequest(req.headers)) { res.statusCode = 403; return res.end(); }
        let body = "";
        req.on("data", (c) => { body += c; if (body.length > 4096) req.destroy(); });
        req.on("end", () => {
          let entry = null;
          try { entry = cleanEntry(JSON.parse(body)); } catch { entry = null; }
          if (!entry) { res.statusCode = 400; return res.end(); }
          try { runFile.append(entry); res.statusCode = 204; } catch { res.statusCode = 500; }
          res.end();
        });
      });
    },
  };
}
