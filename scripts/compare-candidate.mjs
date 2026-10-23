/* Compare the candidate page and its actions with 2h at 1280, 1440 and 1920 px, light and dark. Exits 1 on any difference.

   Both pages are driven the same way (same clicks, same text typed). After each step the page area (#page) must match
   to 0 pixels and its text must be identical; toasts and the sidebar badge must match too.
   1. Every width and theme: Taylor Brooks (Inside Sales Leader), Summary tab.
   2. At 1440 px, both themes: all four tabs; seeking from an evidence link and a key moment; Play; every other submission;
      every form (open, empty submit, cancel, focus); then a run of saved actions (decline, feedback on the same person's
      other role, interview request, Hired, a move back), the Candidates page and Hiring progress afterwards,
      and everything again after a reload.

   The page area excludes the top bar, where the reviewer-only control differs (checked by compare:shell).
   Usage: npm run dev (in another terminal), then npm run compare:candidate */
import { chromium } from "playwright";
import { OUT, open, fontsLoaded, reporter, pageComparer, act, go, resetOrder } from "./lib/compare.mjs";

const WIDTHS = [1280, 1440, 1920];
const { ck, done } = reporter();
const browser = await chromium.launch();
const external = [];

const compareState = pageComparer(ck, "detail");
const leaveAndOpen = (hash) => async (pg) => { await go("#candidates")(pg); await go(hash)(pg); };
const tab = (name) => (pg) => pg.locator(".tabs").getByRole("tab", { name }).click();
const focused = (pg) => pg.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
const submit = (pg) => pg.click("#actForm button[type=submit]");

for (const theme of ["light", "dark"]) {
  for (const width of WIDTHS) {
    const tag = `[${theme} ${width}px]`;
    const r = await open(browser, "ref", "c-tb-isl", theme, width), a = await open(browser, "app", "c-tb-isl", theme, width, external);
    const both = [r.pg, a.pg];
    ck(`${tag} fonts loaded, no page errors`, (await fontsLoaded(r.pg)) && (await fontsLoaded(a.pg)) && !r.errors.length && !a.errors.length, [...r.errors, ...a.errors].join("; "));
    ck(`${tag} no horizontal page scroll`, !(await a.pg.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    await compareState(r.pg, a.pg, `${tag} Taylor Brooks, Summary`, `${theme}-${width}-tb-isl`);

    if (width === 1440) {
      const step = async (name, fn, { toast } = {}) => {
        const t = await act(both, fn, { expectToast: toast !== undefined });
        await compareState(r.pg, a.pg, `${tag} ${name}`, `${theme}-${name.replace(/\W+/g, "-")}`);
        if (toast !== undefined) ck(`${tag} ${name}: toast "${toast}"`, t[0] === toast && t[1] === toast, JSON.stringify(t));
      };
      const sameFocus = async (name) => ck(`${tag} ${name}: same field has focus`, (await focused(r.pg)) === (await focused(a.pg)), `${await focused(r.pg)} / ${await focused(a.pg)}`);

      /* Tabs, seeking and the player */
      for (const t of ["Screening interview", "Resume", "Notes and history"]) await step(`Taylor, ${t} tab`, tab(t));
      await step("Taylor, Summary, evidence link opens the interview at 14:05", async (pg) => { await tab("Summary")(pg); await pg.getByRole("button", { name: "Interview 14:05" }).click(); });
      await step("Taylor, key moment 21:00", (pg) => pg.locator(".moments").getByRole("button", { name: "21:00" }).click());
      await step("Taylor, Play", (pg) => pg.click("#play"), { toast: "Playback is simulated in this mockup." });
      await step("Taylor, Resume via evidence link", async (pg) => { await tab("Summary")(pg); await pg.locator(".req").getByRole("button", { name: "Resume" }).first().click(); });

      /* Every other submission, and notes with seeded history or a decline note */
      for (const id of ["tb-rsm", "je-isl", "pr-isl", "mw-isl", "en-pa", "so-pa", "bc-pa", "gl-rsm", "do-rsm", "ab-fsr", "cm-rsm"]) await step(`${id}, Summary`, leaveAndOpen(`#c-${id}`));
      await step("mw-isl, Notes (decline note)", async (pg) => { await leaveAndOpen("#c-mw-isl")(pg); await tab("Notes and history")(pg); });
      await step("gl-rsm, Notes (seeded history)", async (pg) => { await leaveAndOpen("#c-gl-rsm")(pg); await tab("Notes and history")(pg); });
      await step("do-rsm, Screening interview (none shared)", async (pg) => { await leaveAndOpen("#c-do-rsm")(pg); await tab("Screening interview")(pg); });

      /* Forms: open, empty submit, cancel */
      await step("Taylor, Move to Interview form", async (pg) => { await leaveAndOpen("#c-tb-isl")(pg); await pg.click("[data-form=interview]"); });
      await sameFocus("Move to Interview form");
      await step("Taylor, form cancelled", (pg) => pg.click("[data-cancel]"));
      await step("Taylor, Decline form", (pg) => pg.click("[data-form=decline]"));
      await step("Taylor, Decline with no note", submit);
      await sameFocus("Decline with no note");
      await step("Taylor, Decline cancelled", (pg) => pg.click("[data-cancel]"));
      ck(`${tag} opening, failing and cancelling forms saved nothing`, (await a.pg.evaluate(() => localStorage.getItem("ro-portal-demo-actions"))) === null);
      await step("Taylor, Move to Offer form (offer warning)", async (pg) => { await pg.selectOption("#mv", "Offer"); await pg.click("[data-form=move]"); });
      await step("Taylor, Move to Hired form", async (pg) => { await pg.click("[data-cancel]"); await pg.selectOption("#mv", "Hired"); await pg.click("[data-form=move]"); });
      await step("Taylor (Regional Sales Manager, on hold), feedback form", async (pg) => { await leaveAndOpen("#c-tb-rsm")(pg); await pg.click("[data-form=feedback]"); });
      await sameFocus("feedback form");
      await step("feedback with no note", submit);

      /* Saved actions */
      await step("Taylor declined for Inside Sales Leader", async (pg) => {
        await leaveAndOpen("#c-tb-isl")(pg); await pg.click("[data-form=decline]");
        await pg.fill("#fNote", "Strong coach, but the team here needs CRM reporting from day one."); await pg.selectOption("#fCat", "Key skills gap"); await submit(pg);
      }, { toast: "Declined. Recorded in this mockup; nothing was sent." });
      await step("Taylor, Notes after decline", tab("Notes and history"));
      await step("Taylor's other role is unchanged", leaveAndOpen("#c-tb-rsm"));
      await step("feedback saved for Regional Sales Manager", async (pg) => {
        await pg.click("[data-form=feedback]"); await pg.fill("#fNote", "Clear on coaching; regional scope is the open question."); await submit(pg);
      }, { toast: "Feedback recorded in this mockup. Stage unchanged." });
      await step("feedback, Notes and history", tab("Notes and history"));
      await step("Priya moved to Interview with suggested times", async (pg) => {
        await leaveAndOpen("#c-pr-isl")(pg); await pg.click("[data-form=interview]"); await pg.fill("#fTimes", "Wed 14 Oct afternoon"); await submit(pg);
      }, { toast: "Moved to Interview. Saved in this mockup; nothing was sent." });
      await step("Aisha moved to Hired with a note", async (pg) => {
        await leaveAndOpen("#c-ab-fsr")(pg); await pg.selectOption("#mv", "Hired"); await pg.click("[data-form=move]"); await pg.fill("#fNote", "Ready to proceed."); await submit(pg);
      }, { toast: "Hired stage saved in this mockup. Offer status is not recorded; nothing was sent." });
      await step("Aisha, Notes and history", tab("Notes and history"));
      await step("Jordan moved back to To review", async (pg) => {
        await leaveAndOpen("#c-je-isl")(pg); await pg.selectOption("#mv", "To review"); await pg.click("[data-form=move]"); await submit(pg);
      }, { toast: "Moved to To review. Saved in this mockup; nothing was sent." });

      /* The rest of the app agrees */
      await step("Back to pipeline", async (pg) => { await resetOrder(pg); await pg.click("#backPipe"); });
      ck(`${tag} sidebar badge after actions`, (await a.pg.innerText(".nav .ct")) === (await r.pg.innerText(".nav .ct")), await a.pg.innerText(".nav .ct"));
      await step("Candidates, List after actions", (pg) => pg.locator(".pagehead .seg").getByRole("button", { name: "List" }).click());
      await step("Hiring progress after actions", go("#progress"));
      await step("Hiring progress after actions, counting panels open", (pg) => pg.evaluate(() => document.querySelectorAll("#page details.fo-info").forEach((d) => (d.open = true))));

      /* Reload: the changes persist */
      const reload = async (pg) => { await resetOrder(pg); await pg.reload(); await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(200); };
      await step("after reload: Hiring progress", reload);
      await step("after reload: Candidates", go("#candidates"));
      await step("after reload: Taylor (Inside Sales Leader)", go("#c-tb-isl"));
      await step("after reload: Taylor (Regional Sales Manager), Notes", async (pg) => { await go("#c-tb-rsm")(pg); await tab("Notes and history")(pg); });
      ck(`${tag} five saved actions in this browser's demo log`, JSON.parse(await a.pg.evaluate(() => localStorage.getItem("ro-portal-demo-actions"))).length === 5);
      ck(`${tag} sidebar badge after reload`, (await a.pg.innerText(".nav .ct")) === (await r.pg.innerText(".nav .ct")), await a.pg.innerText(".nav .ct"));
    }
    await r.ctx.close(); await a.ctx.close();
  }
}
ck("no external requests from the app", !external.length, external.join(", "));
await browser.close();
console.log(`screenshots and diffs: ${OUT}`);
process.exit(done() ? 0 : 1);
