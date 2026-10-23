/* Shared helpers for comparing the app with the 2h reference.
   2h is opened read-only from its folder; nothing is written there.
   Both pages get the same Plex font files (from @fontsource), and every other external request is blocked. */
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const REF = "file://" + path.resolve(ROOT, "../client-workspace-v1-visual-2h/index.html");
export const APP = process.env.APP_URL || "http://127.0.0.1:5173/";
export const OUT = path.join(ROOT, "compare-output");
export const THEME_KEYS = { ref: "ro-v1v2h-theme", app: "ro-portal-theme" };
fs.mkdirSync(OUT, { recursive: true });

const FONTS = [
  ["IBM Plex Sans", "ibm-plex-sans", [400, 500, 600]],
  ["IBM Plex Sans Condensed", "ibm-plex-sans-condensed", [500, 600]],
  ["IBM Plex Mono", "ibm-plex-mono", [400, 600]],
];
const fontFile = (pkg, w) => path.join(ROOT, "node_modules/@fontsource", pkg, "files", `${pkg}-latin-${w}-normal.woff2`);
const FONT_CSS = FONTS.flatMap(([fam, pkg, ws]) => ws.map((w) =>
  `@font-face{font-family:'${fam}';font-style:normal;font-weight:${w};font-display:swap;src:url(https://fonts.gstatic.com/local/${pkg}-${w}.woff2) format('woff2')}`)).join("");

/** Serves fonts locally, blocks everything else external, and records what was blocked. */
export async function prepare(ctx, external) {
  await ctx.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.protocol === "file:" || u.hostname === "127.0.0.1" || u.protocol === "data:") return r.continue();
    if (u.hostname === "fonts.googleapis.com") return r.fulfill({ status: 200, contentType: "text/css", body: FONT_CSS });
    const m = u.hostname === "fonts.gstatic.com" && u.pathname.match(/^\/local\/(.+)-(\d00)\.woff2$/);
    if (m) return r.fulfill({ status: 200, contentType: "font/woff2", body: fs.readFileSync(fontFile(m[1], m[2])) });
    external.push(u.href);
    return r.abort();
  });
}

/** Opens a page with fresh storage and the given theme, and waits for fonts. */
export async function open(browser, which, hash, theme, width, external = []) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme: theme });
  await prepare(ctx, external);
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  const url = which === "ref" ? REF : APP;
  await pg.goto(url + "#" + hash);
  await pg.evaluate(([k, t]) => { localStorage.clear(); localStorage.setItem(k, t); }, [THEME_KEYS[which], theme]);
  await pg.reload();
  await pg.waitForSelector("#page h1");
  await pg.evaluate(() => document.fonts.ready);
  await pg.mouse.move(1, 1);
  await pg.waitForTimeout(300);
  return { pg, ctx, errors };
}

/* The faces the shell uses on every page. */
export const fontsLoaded = (pg) => pg.evaluate(() => ["400 14px 'IBM Plex Sans'", "500 14px 'IBM Plex Sans'", "600 14px 'IBM Plex Sans'",
  "600 16px 'IBM Plex Sans Condensed'", "600 11.5px 'IBM Plex Mono'"].every((f) => document.fonts.check(f)));

export const boxes = (pg, parts) => pg.evaluate((parts) => Object.fromEntries(Object.entries(parts).map(([k, s]) => {
  const e = document.querySelector(s); if (!e) return [k, null];
  const r = e.getBoundingClientRect(); return [k, [r.x, r.y, r.width, r.height].map(Math.round)];
})), parts);

export const styles = (pg, parts) => pg.evaluate((parts) => Object.fromEntries(Object.entries(parts).map(([k, s]) => {
  const e = document.querySelector(s); if (!e) return [k, null]; const c = getComputedStyle(e);
  return [k, [c.fontFamily.split(",")[0], c.fontSize, c.fontWeight, c.color, c.backgroundColor].join(" | ")];
})), parts);

export const readPng = (file) => PNG.sync.read(fs.readFileSync(file));

/** Counts differing pixels between region ra of image a and region rb of image b (same size), and writes a diff image. */
export function diff(a, ra, b, rb, name) {
  const [w, h] = [ra[2], ra[3]];
  if (rb[2] !== w || rb[3] !== h) return { n: Infinity, pct: "size differs" };
  const crop = (img, [x, y]) => { const o = new PNG({ width: w, height: h }); PNG.bitblt(img, o, x, y, w, h, 0, 0); return o; };
  const ca = crop(a, ra), cb = crop(b, rb), d = new PNG({ width: w, height: h });
  const n = pixelmatch(ca.data, cb.data, d.data, w, h, { threshold: 0.1 });
  if (name) fs.writeFileSync(path.join(OUT, `diff-${name}.png`), PNG.sync.write(d));
  return { n, pct: ((100 * n) / (w * h)).toFixed(3) };
}

/** Makes sticky and fixed elements static so a full-page screenshot shows the page as laid out (as 2h's own tests do). */
export const unstick = (pg) => pg.evaluate(() => document.querySelectorAll("body *").forEach((e) => {
  const p = getComputedStyle(e).position; if (p === "sticky" || p === "fixed") e.style.position = "static";
}));

async function pageShot(pg, name) {
  await pg.mouse.move(1, 1);
  await pg.evaluate(() => scrollTo(0, 0));
  await unstick(pg);
  const file = path.join(OUT, `${name}.png`);
  await pg.screenshot({ path: file, fullPage: true });
  const box = await pg.evaluate(() => { const r = document.querySelector("#page").getBoundingClientRect(); return [r.x, r.y + scrollY, r.width, r.height].map(Math.round); });
  await pg.evaluate(() => document.querySelectorAll("body *").forEach((e) => (e.style.position = "")));
  return { file, box };
}

/** Compares the page area (#page) of 2h and the app: 0 differing pixels and identical text. */
export const pageComparer = (ck, prefix) => async function compareState(ref, app, tag, slug) {
  const a = await pageShot(ref, `ref-2h-${prefix}-${slug}`), b = await pageShot(app, `app-${prefix}-${slug}`);
  const sameSize = a.box[2] === b.box[2] && a.box[3] === b.box[3];
  const d = sameSize ? diff(readPng(a.file), a.box, readPng(b.file), b.box, `${prefix}-${slug}`) : { n: Infinity };
  ck(`${tag}: page area identical`, d.n === 0, sameSize ? `${d.n} px` : `size 2h ${a.box.slice(2)} vs app ${b.box.slice(2)}`);
  const [ta, tb] = [await ref.innerText("#page"), await app.innerText("#page")];
  const i = [...ta].findIndex((c, k) => c !== tb[k]);
  ck(`${tag}: page text identical`, ta === tb, i < 0 ? `lengths ${ta.length}/${tb.length}` : `first difference: 2h "${ta.slice(i, i + 70)}" app "${tb.slice(i, i + 70)}"`);
};

/** The same user action on both pages; returns what each page's toast said, if anything.
    Before acting, each page's previous toast is allowed to time out, so a toast seen afterwards is a new one. */
export async function act(pages, fn, { expectToast = false } = {}) {
  const toasts = [];
  for (const pg of pages) {
    if (expectToast) await pg.waitForFunction(() => { const t = document.getElementById("toast"); return !t || t.hidden; }, null, { timeout: 5000 });
    await fn(pg); await pg.waitForTimeout(150);
    toasts.push(await pg.evaluate(() => { const t = document.getElementById("toast"); return t && !t.hidden ? t.textContent : null; }));
  }
  return toasts;
}
/* 2h sorts its shared data in place whenever its Candidates list renders, so the order of cards that tie on waiting time
   depends on browsing history (ASSUMPTIONS.md #22). Before showing a list, 2h's data is put back in its original order;
   the app always keeps that order (role pages list candidates in that order too). This changes only the order of 2h's array, nothing it displays otherwise. */
export const resetOrder = (pg) => pg.evaluate(() => { if (typeof SEED === "undefined") return; const at = (id) => SEED.findIndex((x) => x.id === id); S.subs.sort((x, y) => at(x.id) - at(y.id)); save(); });
/** Navigates by hash, as clicking a link would; 2h's order is reset first (see resetOrder). */
export const go = (hash) => async (pg) => { await resetOrder(pg); await pg.evaluate((h) => (location.hash = h), hash); await pg.waitForTimeout(100); };

export function reporter() {
  let pass = 0, fail = 0;
  const ck = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
  const done = () => { console.log(`\n${pass}/${pass + fail} passed`); return fail === 0; };
  return { ck, done };
}
