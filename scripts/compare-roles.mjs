/* Compare the Roles page and every role page with 2h at 1280, 1440 and 1920 px, light and dark. Exits 1 on any difference.

   For each width and theme: Roles, and each role page (Inside Sales Leader, Pricing Analyst, Field Sales Representative,
   and the on-hold Regional Sales Manager): the page area (#page) must match to 0 pixels and its text must be identical.
   At 1440 px, both themes: the job description opened; the stage tiles, total tile and "Open in Candidates" open Candidates
   on that role; a role's candidate link opens the same candidate route; an unknown role id; then saved actions on both
   pages (including both of Taylor Brooks's submissions) and the Roles table, role pages and Candidates afterwards,
   and again after a reload.

   The page area excludes the top bar, where the reviewer-only control differs (checked by compare:shell).
   Usage: npm run dev (in another terminal), then npm run compare:roles */
import { chromium } from "playwright";
import { open, fontsLoaded, reporter, pageComparer, act, go } from "./lib/compare.mjs";

const WIDTHS = [1280, 1440, 1920], ROLES = ["isl", "pa", "fsr", "rsm"];
const { ck, done } = reporter();
const compareState = pageComparer(ck, "roles");
const browser = await chromium.launch();
const external = [];
const submit = (pg) => pg.click("#actForm button[type=submit]");
const hash = (pg) => pg.evaluate(() => location.hash);

for (const theme of ["light", "dark"]) {
  for (const width of WIDTHS) {
    const tag = `[${theme} ${width}px]`;
    const r = await open(browser, "ref", "roles", theme, width), a = await open(browser, "app", "roles", theme, width, external);
    const both = [r.pg, a.pg];
    const step = async (name, fn) => { await act(both, fn); await compareState(r.pg, a.pg, `${tag} ${name}`, `${theme}-${width}-${name.replace(/\W+/g, "-")}`); };
    ck(`${tag} fonts loaded, no page errors`, (await fontsLoaded(r.pg)) && (await fontsLoaded(a.pg)) && !r.errors.length && !a.errors.length, [...r.errors, ...a.errors].join("; "));
    ck(`${tag} no horizontal page scroll`, !(await a.pg.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    await step("Roles", go("#roles"));
    for (const id of ROLES) await step(`role ${id}`, go(`#role-${id}`));
    ck(`${tag} sidebar marks Roles as current on a role page`, (await a.pg.getAttribute(".nav a[href='#roles']", "aria-current")) === "page");

    if (width === 1440) {
      await step("role isl, job description open", async (pg) => { await go("#role-isl")(pg); await pg.click(".jd summary"); });
      /* Tiles and links open Candidates on this role, with no other filter */
      const opens = [["total tile", ".ftile.total"], ["Interview tile", ".ftile >> nth=2"], ["Open in Candidates", ".sec-h a[href='#candidates']"]];
      for (const [name, sel] of opens) {
        await step(`role rsm, ${name} opens Candidates on that role`, async (pg) => {
          await go("#candidates")(pg); await pg.locator(".toolbar .fchip", { hasText: "Waiting on you" }).click(); await pg.selectOption("#roleSel", "all");
          await go("#role-rsm")(pg); await pg.click(sel);
        });
        ck(`${tag} ${name}: Candidates shows Regional Sales Manager, All candidates`, (await a.pg.inputValue("#roleSel")) === "rsm" && (await a.pg.getAttribute(".toolbar .fchip >> nth=0", "aria-pressed")) === "true");
      }
      await act(both, async (pg) => { await pg.selectOption("#roleSel", "all"); await go("#role-isl")(pg); await pg.click("tbody a.nm >> nth=0"); });
      ck(`${tag} role page candidate link opens the same candidate route`, (await hash(a.pg)) === (await hash(r.pg)), await hash(a.pg));
      await step("unknown role", go("#role-nope"));

      /* Saved actions, then the role pages agree */
      await act(both, async (pg) => {
        await go("#c-tb-isl")(pg); await pg.click("[data-form=decline]"); await pg.fill("#fNote", "The team needs CRM reporting from day one."); await submit(pg);
        await go("#c-tb-rsm")(pg); await pg.click("[data-form=feedback]"); await pg.fill("#fNote", "Regional scope is the open question."); await submit(pg);
        await go("#c-pr-isl")(pg); await pg.click("[data-form=interview]"); await submit(pg);
        await go("#c-en-pa")(pg); await pg.selectOption("#mv", "Offer"); await pg.click("[data-form=move]"); await submit(pg);
        await go("#c-je-isl")(pg); await pg.selectOption("#mv", "To review"); await pg.click("[data-form=move]"); await submit(pg);
      });
      await step("Roles after actions", go("#roles"));
      for (const id of ROLES) await step(`role ${id} after actions`, go(`#role-${id}`));
      await step("Candidates on Inside Sales Leader after actions", async (pg) => { await go("#role-isl")(pg); await pg.click(".ftile.total"); });
      const reload = async (pg) => { await go("#roles")(pg); await pg.reload(); await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(200); };
      await step("Roles after reload", reload);
      for (const id of ["isl", "rsm"]) await step(`role ${id} after reload`, go(`#role-${id}`));
    }
    await r.ctx.close(); await a.ctx.close();
  }
}
ck("no external requests from the app", !external.length, external.join(", "));
await browser.close();
process.exit(done() ? 0 : 1);
