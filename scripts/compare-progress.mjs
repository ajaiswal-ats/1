/* Compare the Hiring progress page with 2h at 1280, 1440 and 1920 px, light and dark. Exits 1 on any difference.

   For each width and theme: the page area (#page) must match to 0 pixels, with the "How this is counted" panels closed
   and open; the page text with panels open must be identical; and each chart's box must be identical.
   Then each control is driven the same way on both pages (pipeline view, include on-hold, sort, role filter),
   and the same checks run for every resulting state at 1440 px. Hover tooltips are compared for each chart.

   The page area excludes the top bar, where the reviewer-only control differs (checked by compare:shell).
   Usage: npm run dev (in another terminal), then npm run compare:progress */
import { chromium } from "playwright";
import path from "node:path";
import { OUT, open, fontsLoaded, readPng, diff, unstick, reporter } from "./lib/compare.mjs";

const WIDTHS = [1280, 1440, 1920];
const SECTIONS = ["#hp-funnel", "#hp-roles", "#hp-time", "#hp-weekly"];
const { ck, done } = reporter();
const browser = await chromium.launch();
const external = [];

const setInfo = (pg, open) => pg.evaluate((o) => document.querySelectorAll("#page details.fo-info").forEach((d) => (d.open = o)), open);
const pageText = (pg) => pg.evaluate(() => document.querySelector("#page").innerText);
const sectionBoxes = (pg) => pg.evaluate((ids) => ids.map((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 100) / 100) : null; }), SECTIONS);

async function shot(pg, name) {
  await pg.mouse.move(1, 1);
  await pg.evaluate(() => scrollTo(0, 0));
  await unstick(pg);
  const file = path.join(OUT, `${name}.png`);
  await pg.screenshot({ path: file, fullPage: true });
  const box = await pg.evaluate(() => { const r = document.querySelector("#page").getBoundingClientRect(); return [r.x, r.y + scrollY, r.width, r.height].map(Math.round); });
  return { file, box };
}

/** Pixels, text and chart boxes of the current state of both pages. */
async function compareState(ref, app, tag, slug) {
  for (const infoOpen of [false, true]) {
    await setInfo(ref, infoOpen); await setInfo(app, infoOpen);
    const a = await shot(ref, `ref-2h-progress-${slug}${infoOpen ? "-info" : ""}`), b = await shot(app, `app-progress-${slug}${infoOpen ? "-info" : ""}`);
    const sameSize = a.box[2] === b.box[2] && a.box[3] === b.box[3];
    const d = sameSize ? diff(readPng(a.file), a.box, readPng(b.file), b.box, `progress-${slug}${infoOpen ? "-info" : ""}`) : { n: Infinity };
    ck(`${tag}, panels ${infoOpen ? "open" : "closed"}: page area identical`, d.n === 0, sameSize ? `${d.n} px` : `size 2h ${a.box.slice(2)} vs app ${b.box.slice(2)}`);
    if (infoOpen) {
      const [ta, tb] = [await pageText(ref), await pageText(app)];
      const i = [...ta].findIndex((c, k) => c !== tb[k]);
      ck(`${tag}: page text identical, counting explanations included`, ta === tb, i < 0 ? `lengths ${ta.length}/${tb.length}` : `first difference: 2h "${ta.slice(i, i + 60)}" app "${tb.slice(i, i + 60)}"`);
    }
  }
  const [ba, bb] = [await sectionBoxes(ref), await sectionBoxes(app)];
  ck(`${tag}: chart boxes identical`, JSON.stringify(ba) === JSON.stringify(bb), `2h ${JSON.stringify(ba)} app ${JSON.stringify(bb)}`);
  await setInfo(ref, false); await setInfo(app, false);
}

/** The same user action on both pages. */
async function act(pages, fn) { for (const pg of pages) { await fn(pg); await pg.waitForTimeout(150); } }

for (const theme of ["light", "dark"]) {
  for (const width of WIDTHS) {
    const tag = `[${theme} ${width}px]`;
    const r = await open(browser, "ref", "progress", theme, width), a = await open(browser, "app", "progress", theme, width, external);
    ck(`${tag} fonts loaded, no page errors`, (await fontsLoaded(r.pg)) && (await fontsLoaded(a.pg)) && !r.errors.length && !a.errors.length, [...r.errors, ...a.errors].join("; "));
    ck(`${tag} no horizontal page scroll`, !(await a.pg.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    await compareState(r.pg, a.pg, `${tag} default`, `${theme}-${width}`);

    if (width === 1440) {
      const both = [r.pg, a.pg];
      const states = [
        ["pipeline 'In stage now'", (pg) => pg.locator("#hp-funnel").getByRole("button", { name: "In stage now" }).click()],
        ["include on-hold roles", (pg) => pg.locator("#roHold").check()],
        ["sort A–Z", (pg) => pg.locator("#hp-roles").getByRole("button", { name: "A–Z" }).click()],
        ["role filter: Regional Sales Manager (on hold)", (pg) => pg.selectOption("#rRole", "rsm")],
        ["role filter: Regional Sales Manager, on-hold excluded", (pg) => pg.locator("#roHold").uncheck()],
        ["role filter: Field Sales Representative", (pg) => pg.selectOption("#rRole", "fsr")],
        ["role filter: Pricing Analyst, pipeline 'Reached so far'", async (pg) => { await pg.selectOption("#rRole", "pa"); await pg.locator("#hp-funnel").getByRole("button", { name: "Reached so far" }).click(); }],
        ["role filter: Inside Sales Leader, sort fewest first", async (pg) => { await pg.selectOption("#rRole", "isl"); await pg.locator("#hp-roles").getByRole("button", { name: "Fewest first" }).click(); }],
      ];
      for (const [name, fn] of states) {
        await act(both, fn);
        await compareState(r.pg, a.pg, `${tag} ${name}`, `${theme}-${name.replace(/\W+/g, "-")}`);
      }
      /* Reload both: the controls are remembered in this browser, as in 2h. */
      await act(both, (pg) => pg.reload());
      await act(both, (pg) => pg.evaluate(() => document.fonts.ready));
      ck(`${tag} controls remembered after reload`, (await a.pg.inputValue("#rRole")) === "isl" && (await a.pg.isChecked("#roHold")) === false && (await a.pg.inputValue("#rRole")) === (await r.pg.inputValue("#rRole")));
      await act(both, (pg) => pg.selectOption("#rRole", "all"));

      /* Tooltips: hover the same mark on both pages. */
      const marks = [["Pipeline bar", "#hp-funnel rect.hit >> nth=2"], ["role column segment", "#hp-roles .rc-seg >> nth=0"],
        ["time bar", "#hp-time .tsa-bar >> nth=3"], ["weekly column", "#hp-weekly .wka-c i >> nth=6"]];
      for (const [name, sel] of marks) {
        const tips = [];
        for (const pg of both) { const box = await pg.locator(sel).boundingBox(); await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await pg.waitForTimeout(80);
          tips.push(await pg.evaluate(() => { const t = document.getElementById("tip"); return t.hidden ? null : [t.innerText, t.querySelector("b")?.innerText]; })); }
        ck(`${tag} tooltip on ${name} identical`, tips[0] !== null && JSON.stringify(tips[0]) === JSON.stringify(tips[1]), JSON.stringify(tips));
      }
    }
    await r.ctx.close(); await a.ctx.close();
  }
}
ck("no external requests from the app", !external.length, external.join(", "));
await browser.close();
console.log(`screenshots and diffs: ${OUT}`);
process.exit(done() ? 0 : 1);
