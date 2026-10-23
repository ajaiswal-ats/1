/* Browser check of demo persistence with two tabs of the app in one browser, through the real UI. Exits 1 on any failure.
   - Saves in two tabs both survive, in either order, and a reload shows both (cross-tab overwrite regression).
   - A tab picks up the other tab's save without reloading.
   - An action the other tab has made impossible is refused with a message and saves nothing.
   - Malformed saved data does not break the app; the valid saved actions still apply (malformed-action regression).
   - With storage full (reads work, writes throw), successive actions all stay applied for the visit (quota regression).
   Usage: npm run dev (in another terminal), then npm run check:persistence */
import { chromium } from "playwright";
import { APP, prepare, reporter } from "./lib/compare.mjs";

const KEY = "ro-portal-demo-actions";
const { ck, done } = reporter();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const external = [];
await prepare(ctx, external);
const errors = [];
const tab = async (hash) => { const pg = await ctx.newPage(); pg.on("pageerror", (e) => errors.push(String(e))); await pg.goto(APP + hash); await pg.waitForSelector("#page h1"); return pg; };
const go = async (pg, hash) => { await pg.evaluate((h) => (location.hash = h), hash); await pg.waitForTimeout(150); };
const badge = (pg) => pg.innerText(".nav .ct");
const stage = (pg) => pg.innerText(".statusdl dd >> nth=0");
const saved = (pg) => pg.evaluate((k) => JSON.parse(localStorage.getItem(k) || "[]"), KEY);
const submit = (pg) => pg.click("#actForm button[type=submit]");

const A = await tab("#candidates");
await A.evaluate(() => localStorage.clear());
await A.reload(); await A.waitForSelector("#page h1");
const B = await tab("#c-pr-isl"); /* opened before tab A saves anything */

/* Tab A declines Taylor; tab B, without reloading, moves Priya to Interview. */
await go(A, "#c-tb-isl"); await A.click("[data-form=decline]"); await A.fill("#fNote", "Needs CRM reporting from day one."); await submit(A);
await B.waitForTimeout(200);
ck("tab B picks up tab A's decline without reloading (badge 5 → 4)", (await badge(B)) === "4", await badge(B));
await B.click("[data-form=interview]"); await submit(B);
ck("tab B's save keeps tab A's decline: two actions saved", JSON.stringify((await saved(B)).map((x) => [x.type, x.sid])) === JSON.stringify([["decline", "tb-isl"], ["move", "pr-isl"]]), JSON.stringify(await saved(B)));
await A.reload(); await A.waitForSelector("#page h1");
ck("after reloading tab A, both changes show", (await stage(A)) === "Declined" && (await badge(A)) === "3");
await go(A, "#c-pr-isl");
ck("Priya is in Interview in tab A", (await stage(A)) === "Interview");

/* Tab B opens a decline form for Elena; tab A declines Elena first; tab B's save is refused. */
await go(B, "#c-en-pa"); await B.click("[data-form=decline]"); await B.fill("#fNote", "Second opinion.");
await go(A, "#c-en-pa"); await A.click("[data-form=decline]"); await A.fill("#fNote", "Not enough pricing depth."); await submit(A);
await B.waitForTimeout(200);
await submit(B);
ck("a save the other tab made impossible is refused with a message", (await B.innerText("#actForm .err")) === "This change is no longer available for this candidate.");
const afterConflict = await saved(B);
ck("the refused save changed nothing: three actions, Elena's own decline note kept", afterConflict.length === 3 && afterConflict[2].text === "Not enough pricing depth.");

/* Malformed saved data: the app still loads, and the valid actions still apply. */
await A.evaluate((k) => {
  const v = JSON.parse(localStorage.getItem(k));
  localStorage.setItem(k, JSON.stringify([null, 42, { type: "move", sid: "ab-fsr", to: "Offer", d: "2026-10-12" }, ...v, { type: "decline", sid: "je-isl", text: 7 }]));
}, KEY);
errors.length = 0;
await A.reload(); await A.waitForSelector("#page h1");
ck("with malformed saved data the app loads without errors", !errors.length && (await A.innerText("#page h1")) === "Elena Novak", errors.join("; "));
ck("the valid saved actions still apply (badge 2, Elena declined)", (await badge(A)) === "2" && (await stage(A)) === "Declined", `${await badge(A)} ${await stage(A)}`);
await go(A, "#c-ab-fsr");
ck("the malformed move without a note did not apply", (await stage(A)) === "To review");
await go(A, "#progress");
ck("Hiring progress renders with malformed saved data", (await A.innerText("#page h1")) === "Hiring progress" && !errors.length);
ck("unreadable saved text: app loads with no saved changes", await (async () => {
  await A.evaluate((k) => localStorage.setItem(k, "{not json"), KEY); await A.reload(); await A.waitForSelector("#page h1");
  return !errors.length && (await badge(A)) === "5";
})());

/* Storage full: reads work, writes of the demo list throw QuotaExceededError. Decline Taylor, then Elena, without reloading. */
const full = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await prepare(full, external);
await full.addInitScript((k) => {
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) { if (key === k) throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); return set.call(this, key, value); };
}, KEY);
const F = await full.newPage(); F.on("pageerror", (e) => errors.push(String(e)));
await F.goto(APP + "#c-tb-isl"); await F.waitForSelector("#page h1");
await F.click("[data-form=decline]"); await F.fill("#fNote", "Needs CRM reporting from day one."); await submit(F);
await go(F, "#c-en-pa"); await F.click("[data-form=decline]"); await F.fill("#fNote", "Not enough pricing depth."); await submit(F);
ck("storage full: Elena's decline shows as saved for this visit", (await F.innerText(".nextbox.done b")) === "Declined" && (await stage(F)) === "Declined");
await go(F, "#c-tb-isl");
ck("storage full: Taylor is still declined after declining Elena (badge 3)", (await stage(F)) === "Declined" && (await badge(F)) === "3", `${await stage(F)} ${await badge(F)}`);
ck("storage full: nothing was written to storage", (await F.evaluate((k) => localStorage.getItem(k), KEY)) === null);
await go(F, "#candidates");
ck("storage full: Candidates agrees (2 in To review)", (await F.innerText(".col >> nth=0 >> .col-h .ct")) === "2");
await full.close();

ck("no page errors in either tab", !errors.length, errors.join("; "));
ck("no external requests", !external.length, external.join(", "));
await browser.close();
process.exit(done() ? 0 : 1);
