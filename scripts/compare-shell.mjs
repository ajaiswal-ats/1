/* Compare the app shell with the 2h reference at 1440×900, light and dark. Exits 1 on any unexpected difference.

   The one allowed difference: 2h's reviewer-only "Review labels" control is not in the app (ASSUMPTIONS.md #1),
   so the theme toggle sits further right by exactly that control's width plus the top bar's 14 px gap (117.875 px).
   The span from the toggle's 2h position to the user block is checked separately:
   - the toggle's position and size must match 2h's shifted position to within 0.01 px;
   - its buttons must have identical text, pressed state, fonts and colours;
   - every other pixel in the span must be plain top-bar background.
   The toggle's own pixels are not compared: at a fractional offset its edges anti-alias differently.
   Everything outside the span must match to 0 pixels.

   Usage: npm run dev (in another terminal), then npm run compare:shell */
import { chromium } from "playwright";
import { PNG } from "pngjs";
import path from "node:path";
import { OUT, open, fontsLoaded, boxes, styles, readPng, diff, reporter } from "./lib/compare.mjs";

const PARTS = {
  sidebar: ".side", logo: ".sbrand img", client: ".client", "nav: Candidates": ".nav a[href='#candidates']",
  "nav: Roles": ".nav a[href='#roles']", "nav: Reports label": ".nav .grp", "nav: Hiring progress": ".nav a[href='#progress']",
  "waiting badge": ".nav .ct", topbar: ".topbar", "top row": ".top-in", search: ".search", "theme toggle": ".seg.theme", user: ".me",
  "mockup banner": ".mockline", "page heading": "#page h1",
};
const STYLE_PARTS = { body: "body", "nav item": ".nav a[aria-current='page']", client: ".client b", h1: "#page h1", search: ".search input", banner: ".mockline", user: ".me b" };
const TOPBAR_GAP = 14; /* .tright gap in 2h */

const { ck, done } = reporter();
const browser = await chromium.launch();
const external = [];

async function capture(which, theme) {
  const { pg, ctx, errors } = await open(browser, which, "candidates", theme, 1440, which === "app" ? external : []);
  const file = path.join(OUT, `${which === "ref" ? "ref-2h" : "app"}-shell-${theme}.png`);
  await pg.screenshot({ path: file });
  const r = { file, errors, fonts: await fontsLoaded(pg), boxes: await boxes(pg, PARTS), styles: await styles(pg, STYLE_PARTS),
    review: (await boxes(pg, { r: ".tright > label.tgl" })).r, exact: await exact(pg),
    toggle: await pg.evaluate(() => [...document.querySelectorAll(".seg.theme button")].map((b) => { const c = getComputedStyle(b);
      return [b.textContent, b.getAttribute("aria-pressed"), c.fontFamily.split(",")[0], c.fontSize, c.fontWeight, c.color, c.backgroundColor, c.borderLeft].join(" | "); })) };
  await ctx.close();
  return r;
}

/* Unrounded boxes of the toggle and the Review labels control. */
const exact = (pg) => pg.evaluate(() => Object.fromEntries([["toggle", ".seg.theme"], ["review", ".tright > label.tgl"]].map(([k, s]) => {
  const e = document.querySelector(s); if (!e) return [k, null]; const r = e.getBoundingClientRect(); return [k, [r.x, r.y, r.width, r.height]];
})));

/* Pixel diff of a region, with an excluded rectangle (in page coordinates) painted identically in both images. */
function maskedDiff(a, b, [x, y, w, h], [mx, my, mw, mh], name) {
  const crop = (img) => { const o = new PNG({ width: w, height: h }); PNG.bitblt(img, o, x, y, w, h, 0, 0);
    for (let j = Math.max(0, my - y); j < Math.min(h, my - y + mh); j++) for (let i = Math.max(0, mx - x); i < Math.min(w, mx - x + mw); i++) o.data.fill(0, (j * w + i) * 4, (j * w + i) * 4 + 4);
    return o; };
  return diff(crop(a), [0, 0, w, h], crop(b), [0, 0, w, h], name);
}

for (const theme of ["light", "dark"]) {
  console.log(`\n=== ${theme.toUpperCase()} ===`);
  const ref = await capture("ref", theme), app = await capture("app", theme);
  const A = readPng(ref.file), B = readPng(app.file);
  ck(`[${theme}] fonts loaded in both`, ref.fonts && app.fonts);
  ck(`[${theme}] no page errors`, !ref.errors.length && !app.errors.length, [...ref.errors, ...app.errors].join("; "));

  /* The allowance */
  const t = ref.boxes["theme toggle"], u = ref.boxes.user;
  ck(`[${theme}] 2h has the Review labels control; the app does not`, !!ref.exact.review && app.exact.review === null);
  const [rt, at, dx] = [ref.exact.toggle, app.exact.toggle, ref.exact.review[2] + TOPBAR_GAP];
  ck(`[${theme}] theme toggle moved right by Review labels width + gap (${dx}px) to within 0.01px, same size and row`,
    Math.abs(at[0] - (rt[0] + dx)) < 0.01 && Math.abs(at[1] - rt[1]) < 0.01 && Math.abs(at[2] - rt[2]) < 0.01 && Math.abs(at[3] - rt[3]) < 0.01,
    `2h x ${rt[0].toFixed(3)}, app x ${at[0].toFixed(3)}`);
  ck(`[${theme}] theme buttons identical in text, pressed state, fonts and colours`, JSON.stringify(ref.toggle) === JSON.stringify(app.toggle), app.toggle.join(" / "));
  const span = [t[0], 0, u[0] - t[0], ref.boxes["top row"][3]];
  const bgAt = (x, y) => [...A.data.slice((y * A.width + x) * 4, (y * A.width + x) * 4 + 4)];
  const bg = bgAt(t[0] - 2, 5);
  const ab = app.boxes["theme toggle"], tx0 = ab[0] - 1 - span[0], tx1 = ab[0] + ab[2] + 1 - span[0], ty0 = ab[1] - 1, ty1 = ab[1] + ab[3] + 1;
  let off = 0;
  for (let y = 0; y < span[3]; y++) for (let x = 0; x < span[2]; x++) {
    if (x >= tx0 && x < tx1 && y >= ty0 && y < ty1) continue;
    const i = (y * B.width + span[0] + x) * 4;
    if (B.data[i] !== bg[0] || B.data[i + 1] !== bg[1] || B.data[i + 2] !== bg[2]) off++;
  }
  ck(`[${theme}] rest of the allowed span is plain top-bar background`, off === 0, `${off} px`);

  /* Everything else */
  const sb = diff(A, [0, 0, 224, 900], B, [0, 0, 224, 900], `shell-sidebar-${theme}`);
  ck(`[${theme}] sidebar identical`, sb.n === 0, `${sb.n} px`);
  const tb = maskedDiff(A, B, [224, 0, 1216, ref.boxes.topbar[3]], span, `shell-topbar-${theme}`);
  ck(`[${theme}] top bar and banner identical outside the allowed span`, tb.n === 0, `${tb.n} px`);
  const h = ref.boxes["page heading"];
  const hd = diff(A, h, B, app.boxes["page heading"], `shell-heading-${theme}`);
  ck(`[${theme}] page heading identical`, hd.n === 0, `${hd.n} px`);
  const moved = Object.keys(PARTS).filter((k) => k !== "theme toggle" && JSON.stringify(ref.boxes[k]) !== JSON.stringify(app.boxes[k]));
  ck(`[${theme}] all other element boxes identical (${Object.keys(PARTS).length - 1})`, !moved.length, moved.map((k) => `${k}: 2h ${ref.boxes[k]} app ${app.boxes[k]}`).join("; "));
  const st = Object.keys(STYLE_PARTS).filter((k) => ref.styles[k] !== app.styles[k]);
  ck(`[${theme}] computed fonts and colours identical (${Object.keys(STYLE_PARTS).length} elements)`, !st.length, st.map((k) => `${k}: 2h ${ref.styles[k]} app ${app.styles[k]}`).join("; "));
}
ck("no external requests from the app", !external.length, external.join(", "));
await browser.close();
console.log(`screenshots and diffs: ${OUT}`);
process.exit(done() ? 0 : 1);
