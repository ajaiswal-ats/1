/* Compare the Candidates page with 2h at 1280, 1440 and 1920 px, light and dark. Exits 1 on any difference.

   For each width and theme, Pipeline and List: the page area (#page) must match to 0 pixels and its text must be identical.
   At 1440 px the same controls are then used on both pages (Waiting on you, role filter including the on-hold role,
   Show/Hide declined, List), and every resulting state is checked the same way. Also checked: remembered controls,
   top-bar search results, and that a card opens the candidate's route (the candidate page itself is the next milestone).

   The page area excludes the top bar, where the reviewer-only control differs (checked by compare:shell).
   Usage: npm run dev (in another terminal), then npm run compare:candidates */
import { chromium } from "playwright";
import path from "node:path";
import { OUT, open, fontsLoaded, readPng, diff, unstick, reporter } from "./lib/compare.mjs";

const WIDTHS = [1280, 1440, 1920];
const { ck, done } = reporter();
const browser = await chromium.launch();
const external = [];

async function shot(pg, name) {
  await pg.mouse.move(1, 1);
  await pg.evaluate(() => scrollTo(0, 0));
  await unstick(pg);
  const file = path.join(OUT, `${name}.png`);
  await pg.screenshot({ path: file, fullPage: true });
  const box = await pg.evaluate(() => { const r = document.querySelector("#page").getBoundingClientRect(); return [r.x, r.y + scrollY, r.width, r.height].map(Math.round); });
  await pg.evaluate(() => document.querySelectorAll("body *").forEach((e) => (e.style.position = "")));
  return { file, box };
}

async function compareState(ref, app, tag, slug) {
  const a = await shot(ref, `ref-2h-cand-${slug}`), b = await shot(app, `app-cand-${slug}`);
  const sameSize = a.box[2] === b.box[2] && a.box[3] === b.box[3];
  const d = sameSize ? diff(readPng(a.file), a.box, readPng(b.file), b.box, `cand-${slug}`) : { n: Infinity };
  ck(`${tag}: page area identical`, d.n === 0, sameSize ? `${d.n} px` : `size 2h ${a.box.slice(2)} vs app ${b.box.slice(2)}`);
  const [ta, tb] = [await ref.innerText("#page"), await app.innerText("#page")];
  const i = [...ta].findIndex((c, k) => c !== tb[k]);
  ck(`${tag}: page text identical`, ta === tb, i < 0 ? `lengths ${ta.length}/${tb.length}` : `first difference: 2h "${ta.slice(i, i + 60)}" app "${tb.slice(i, i + 60)}"`);
}

/** The same user action on both pages. */
async function act(pages, fn) { for (const pg of pages) { await fn(pg); await pg.waitForTimeout(150); } }
const view = (name) => (pg) => pg.locator(".pagehead .seg").getByRole("button", { name }).click();
const chip = (name) => (pg) => pg.locator(".toolbar .fchip", { hasText: name }).click();
const role = (id) => (pg) => pg.selectOption("#roleSel", id);
const declined = (pg) => pg.click("#decTgl");

for (const theme of ["light", "dark"]) {
  for (const width of WIDTHS) {
    const tag = `[${theme} ${width}px]`;
    const r = await open(browser, "ref", "candidates", theme, width), a = await open(browser, "app", "candidates", theme, width, external);
    const both = [r.pg, a.pg];
    ck(`${tag} fonts loaded, no page errors`, (await fontsLoaded(r.pg)) && (await fontsLoaded(a.pg)) && !r.errors.length && !a.errors.length, [...r.errors, ...a.errors].join("; "));
    ck(`${tag} no horizontal page scroll`, !(await a.pg.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    await compareState(r.pg, a.pg, `${tag} Pipeline`, `${theme}-${width}-pipeline`);
    await act(both, view("List"));
    await compareState(r.pg, a.pg, `${tag} List`, `${theme}-${width}-list`);

    if (width === 1440) {
      const states = [
        ["List, Waiting on you", chip("Waiting on you")],
        ["Pipeline, Waiting on you (empty columns)", view("Pipeline")],
        ["Pipeline, Inside Sales Leader", async (pg) => { await chip("All candidates")(pg); await role("isl")(pg); }],
        ["Pipeline, Regional Sales Manager (on hold)", role("rsm")],
        ["Pipeline, on-hold role, declined shown", declined],
        ["Pipeline, all roles, declined shown", role("all")],
        ["List, all roles, declined shown", view("List")],
        ["List, Pricing Analyst", role("pa")],
        ["List, Field Sales Representative, Waiting on you", async (pg) => { await role("fsr")(pg); await chip("Waiting on you")(pg); }],
        ["Pipeline, Field Sales Representative, Waiting on you", view("Pipeline")],
        ["Pipeline, declined hidden again", async (pg) => { await role("all")(pg); await chip("All candidates")(pg); await declined(pg); }],
      ];
      for (const [name, fn] of states) {
        await act(both, fn);
        await compareState(r.pg, a.pg, `${tag} ${name}`, `${theme}-${name.replace(/\W+/g, "-")}`);
      }
      /* Controls are remembered between visits, as in 2h. */
      await act(both, async (pg) => { await role("pa")(pg); await view("List")(pg); await pg.reload(); await pg.evaluate(() => document.fonts.ready); });
      const st = (pg) => pg.evaluate(() => [document.querySelector("#roleSel").value, document.querySelector(".pagehead .seg [aria-pressed='true']").textContent]);
      ck(`${tag} role filter and view remembered after reload`, JSON.stringify(await st(a.pg)) === JSON.stringify(["pa", "List"]) && JSON.stringify(await st(r.pg)) === JSON.stringify(await st(a.pg)));
      await compareState(r.pg, a.pg, `${tag} after reload`, `${theme}-after-reload`);

      /* Search: same results on both pages. Checked on fresh Hiring progress pages: 2h's Candidates list sorts its data
         in place, so after the board renders, 2h's search order follows the board (ASSUMPTIONS.md #22). */
      const fresh = [await open(browser, "ref", "progress", theme, width), await open(browser, "app", "progress", theme, width, external)];
      for (const q of ["tay", "sales", "zzz"]) {
        const res = [];
        for (const { pg } of fresh) { await pg.fill("#q", q); await pg.waitForTimeout(100);
          res.push(await pg.evaluate(() => { const p = document.querySelector("#spop"); return p.hidden ? null : [p.innerText, [...p.querySelectorAll("a")].map((x) => x.getAttribute("href"))]; })); }
        ck(`${tag} search "${q}": same results and links`, res[0] !== null && JSON.stringify(res[0]) === JSON.stringify(res[1]), JSON.stringify(res));
      }
      for (const { pg } of fresh) await pg.keyboard.press("Escape");
      ck(`${tag} Escape closes search`, (await fresh[1].pg.evaluate(() => document.querySelector("#spop").hidden)) === true);
      await fresh[1].pg.fill("#q", "pri"); await fresh[1].pg.click("#spop a >> nth=0"); await fresh[1].pg.waitForTimeout(100);
      ck(`${tag} choosing a result opens its route and clears the search`, (await fresh[1].pg.evaluate(() => [location.hash, document.querySelector("#q").value, document.querySelector("#spop").hidden].join())) === "#c-pr-isl,,true");
      for (const f of fresh) await f.ctx.close();

      /* A card or row opens the candidate's route. The candidate page itself is the next milestone. */
      await act(both, (pg) => pg.click("tbody a.nm >> nth=0"));
      ck(`${tag} first list row opens the same candidate route`, (await a.pg.evaluate(() => location.hash)) === (await r.pg.evaluate(() => location.hash)), await a.pg.evaluate(() => location.hash));
      await act(both, (pg) => pg.goto(pg.url().split("#")[0] + "#candidates"));
      await act(both, view("Pipeline"));
      await act(both, (pg) => pg.click(".ccard >> nth=0"));
      ck(`${tag} first pipeline card opens the same candidate route`, (await a.pg.evaluate(() => location.hash)) === (await r.pg.evaluate(() => location.hash)), await a.pg.evaluate(() => location.hash));
      ck(`${tag} sidebar marks Candidates as current on a candidate route`, (await a.pg.getAttribute(".nav a[href='#candidates']", "aria-current")) === "page");
    }
    await r.ctx.close(); await a.ctx.close();
  }
}
ck("no external requests from the app", !external.length, external.join(", "));
await browser.close();
console.log(`screenshots and diffs: ${OUT}`);
process.exit(done() ? 0 : 1);
