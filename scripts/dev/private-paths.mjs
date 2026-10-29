/* Development serving boundary, for both dev servers (vite.config.ts and vite.scoring.config.mjs).
   Vite's dev server serves any file under the project folder, including private reference documents (docs/), database and
   integration files, scripts and tests, by plain path, with query suffixes such as ?raw, or by /@fs/<absolute path>.
   The browser app needs none of them, so these requests are refused with 404 before Vite sees them. Source documents
   stay where they are; only serving is refused. */
import path from "node:path";

const DENIED_DIRS = ["docs", "supabase", "manatal", "scripts", "tests", "compare-output", "dist", "coverage", "private", "candidates", "resumes"];
const DENIED_FILE = /(^|\/)(\.env[^/]*|[^/]*\.(pdf|docx?|rtf|odt|pem|key|p12|pfx|local|local\.json)|ASSUMPTIONS\.md|VERIFICATION\.md|README\.md)$/i;

/** Whether a request URL would expose a private or non-app file. `root` is the project folder. */
export function isPrivatePath(url, root) {
  let p = (url ?? "/").split(/[?#]/)[0];
  try { for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(p); i++) p = decodeURIComponent(p); } catch { return true; }
  p = p.replace(/\\/g, "/");
  if (p.startsWith("/@fs/")) {
    const abs = path.posix.normalize(p.slice(4));
    const rootPosix = root.replace(/\\/g, "/").replace(/\/$/, "");
    if (!abs.startsWith(`${rootPosix}/`)) return !abs.includes("/node_modules/"); // only dependencies outside the project
    p = abs.slice(rootPosix.length);
  }
  p = path.posix.normalize(`/${p}`);
  const first = p.split("/").filter(Boolean)[0] ?? "";
  if (DENIED_DIRS.includes(first) || p.includes("/scoring-inputs/")) return true;
  /* Build caches (for example the compiled extraction tool) are never needed by the browser. */
  if (p.startsWith("/node_modules/.cache/")) return true;
  if (first.startsWith(".") && first !== ".vite") return true;
  return DENIED_FILE.test(p);
}

/** Vite plugin (dev server only): refuses private paths before any other middleware. */
export function privatePathsGuard() {
  return {
    name: "dev-private-paths-guard",
    apply: "serve",
    configureServer(server) {
      const root = server.config.root;
      server.middlewares.use((req, res, next) => {
        if (!isPrivatePath(req.url, root)) return next();
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end("Not served by the development server.");
      });
    },
  };
}
