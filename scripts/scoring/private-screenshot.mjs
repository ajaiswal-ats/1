/* Screenshots of the local scoring test (real candidate data) are private files: they go only in the Git-ignored scoring
   folder, readable by the owner alone (files 600, folders 700), as `npm run scoring:check` requires. Playwright's own
   `screenshot({ path })` writes with the process umask (usually 644), so screenshots are taken as bytes and written here. */
import fs from "node:fs";
import path from "node:path";

export const PRIVATE_SCREENS = path.resolve(import.meta.dirname, "../../docs/reference/scoring-inputs/prototype/screens");

/** Saves a screenshot of a Playwright page or locator as an owner-only file. `file` is a name inside the private screens
    folder, or a path inside it; anything outside is refused. Returns the full path. */
export async function savePrivateScreenshot(target, file, options = {}, dir = PRIVATE_SCREENS) {
  const out = path.resolve(dir, file);
  if (path.relative(dir, out).startsWith("..") || path.isAbsolute(path.relative(dir, out))) throw new Error("Private screenshots are saved only inside the private screens folder.");
  const bytes = await target.screenshot({ ...options, path: undefined });
  fs.mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
  for (let d = path.dirname(out); d.startsWith(dir); d = path.dirname(d)) { fs.chmodSync(d, 0o700); if (d === dir) break; }
  fs.writeFileSync(out, bytes, { mode: 0o600 });
  fs.chmodSync(out, 0o600); // also when the file already existed with wider permissions
  return out;
}
