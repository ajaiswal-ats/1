/* Private screenshots are written owner-only (synthetic bytes; no browser, no candidate data). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { savePrivateScreenshot } from "./private-screenshot.mjs";

let dir;
const fake = (bytes = Buffer.from("synthetic png bytes")) => ({ calls: [], async screenshot(o) { this.calls.push(o); return bytes; } });
const mode = (f) => fs.statSync(f).mode & 0o777;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "private-screens-")); fs.chmodSync(dir, 0o755); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("private screenshots", () => {
  it("writes the file owner-only (600) and the folder owner-only (700), whatever the umask", async () => {
    const old = process.umask(0o022);
    try {
      const t = fake(), f = await savePrivateScreenshot(t, "x-PRIVATE.png", { fullPage: true }, dir);
      expect([mode(f), mode(dir), fs.readFileSync(f, "utf8")]).toEqual([0o600, 0o700, "synthetic png bytes"]);
      expect(t.calls).toEqual([{ fullPage: true, path: undefined }]); // Playwright never writes the file itself
    } finally { process.umask(old); }
  });
  it("tightens an existing file that was readable by others, and creates sub-folders owner-only", async () => {
    fs.writeFileSync(path.join(dir, "old-PRIVATE.png"), "x", { mode: 0o644 });
    expect(mode(await savePrivateScreenshot(fake(), "old-PRIVATE.png", {}, dir))).toBe(0o600);
    const f = await savePrivateScreenshot(fake(), "run1/y-PRIVATE.png", {}, dir);
    expect([mode(f), mode(path.dirname(f))]).toEqual([0o600, 0o700]);
  });
  it("refuses a path outside the private folder", async () => {
    await expect(savePrivateScreenshot(fake(), "../escape.png", {}, dir)).rejects.toThrow(/only inside the private screens folder/);
    await expect(savePrivateScreenshot(fake(), "/tmp/escape.png", {}, dir)).rejects.toThrow(/only inside the private screens folder/);
  });
});
