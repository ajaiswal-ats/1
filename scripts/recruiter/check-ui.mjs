// Offline browser check of the real recruiter entry. Every remote request is intercepted; uses synthetic data only.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { privatePathsGuard } from "../dev/private-paths.mjs";

const ROOT = path.resolve(import.meta.dirname, "../.."), PORT = 5196, APP = `http://127.0.0.1:${PORT}`, HOST = "abcdefghijklmnopqrst.supabase.co";
const server = await createServer({ root: ROOT, configFile: false, envDir: path.join(ROOT, "scripts/scoring/no-env"),
  plugins: [privatePathsGuard(), react()],
  define: { "import.meta.env.VITE_PORTAL_MODE": JSON.stringify("supabase"), "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(`https://${HOST}`), "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("sb_publishable_offline_recruiter_check") },
  server: { host: "127.0.0.1", port: PORT, strictPort: true }, logLevel: "error" });
let browser;
try {
  await server.listen();
  const { recruiterFixture } = await server.ssrLoadModule("/src/recruiter/fictional.ts");
  let assessment = recruiterFixture(), allowStaff = true, saves = 0, shares = 0;
  const user = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "reviewer@example.invalid", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" };
  const jwt = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ sub: user.id, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.offline`;
  const errors = [], outside = [];
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/*", async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === APP) return route.continue();
    if (url.hostname !== HOST) { outside.push(req.url()); return route.abort(); }
    const reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: body === undefined ? undefined : JSON.stringify(body), headers: { "Access-Control-Allow-Origin": APP } });
    if (req.method() === "OPTIONS") return reply(undefined, 204);
    if (url.pathname === "/auth/v1/token") return reply({ access_token: jwt, refresh_token: "offline-refresh", expires_in: 3600, token_type: "bearer", user });
    if (url.pathname === "/auth/v1/user") return reply(user);
    if (url.pathname === "/auth/v1/logout") return reply(undefined, 204);
    if (url.pathname === "/rest/v1/rpc/recruiter_account") return reply(allowStaff ? { userId: user.id, displayName: "Example Recruiter" } : null);
    if (url.pathname === "/rest/v1/rpc/recruiter_assessments") return reply([{ ...assessment, updatedAt: "2026-10-30T10:00:00Z" }]);
    if (url.pathname === "/rest/v1/rpc/recruiter_assessment") return reply(assessment);
    if (url.pathname === "/rest/v1/rpc/recruiter_save_review") {
      const body = req.postDataJSON(); assert.equal(body.p_expected_revision, assessment.revision);
      saves++; assessment = { ...assessment, revision: assessment.revision + 1, inputs: body.p_inputs, review: body.p_review, reviewed: true, history: [{ revision: assessment.revision + 1, kind: "review", reviewer: "Example Recruiter", reason: body.p_reason, at: "2026-10-30T10:00:00Z", changes: body.p_review.changes }, ...assessment.history] };
      return reply(assessment.revision);
    }
    if (url.pathname === "/rest/v1/rpc/recruiter_share_summary") { shares++; return reply({ code: "PT400", message: "scoring_rules_await_approval" }, 400); }
    outside.push(req.url()); return route.abort();
  });
  const page = await context.newPage(); page.on("pageerror", (e) => errors.push(e.message));
  const signIn = async () => { await page.getByLabel("Work email").fill(user.email); await page.getByLabel("Password", { exact: true }).fill("synthetic-password"); await page.getByRole("button", { name: "Sign in", exact: true }).click(); };
  await page.goto(`${APP}/recruiter.html`); await signIn();
  await page.getByRole("heading", { name: "Candidate assessments", exact: true }).waitFor();
  await page.getByRole("link", { name: "Review Candidate Example" }).click();
  await page.getByRole("heading", { name: "Candidate Example", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Share reviewed summary", exact: true }).isDisabled(), true);
  await page.getByLabel(/Winning synthetic deals/).selectOption("2");
  const correction = page.locator(".rec-correction");
  await correction.getByLabel("Evidence", { exact: true }).fill("Delivered three synthetic projects.");
  await correction.getByLabel("Reason for correction").fill("Only level two is supported by this evidence.");
  await page.getByRole("button", { name: "Screening", exact: true }).click();
  const question = page.locator(".rec-item").filter({ has: page.getByRole("heading", { name: "Describe a synthetic result." }) });
  await question.getByLabel("Answer", { exact: true }).fill("I delivered three synthetic projects.");
  await question.getByRole("combobox").selectOption("4");
  await question.getByLabel("Exact quote from the answer").fill("three synthetic projects");
  await question.getByLabel("Reason for rating").fill("Covers most of the proposed answer points.");
  await page.getByLabel("Reason for decision", { exact: true }).fill("Hold until the outstanding essential checks are verified.");
  await page.getByLabel("What did you review or change?").fill("Reviewed the CV and recorded the screening evidence.");
  await page.getByRole("button", { name: "Save recruiter review", exact: true }).click();
  await page.getByText("Recruiter review saved. Nothing was shared with the client.", { exact: true }).waitFor();
  assert.equal(saves, 1); assert.equal(shares, 0); assert.equal(assessment.inputs.criteria[0].rating, 2);
  assert.equal(assessment.review.screening[0].answer, "I delivered three synthetic projects.", "saved screening payload");
  await page.getByRole("button", { name: "Screening", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.rec-stats')?.textContent?.includes('Reviewed'));
  assert.equal(await question.getByRole("textbox").first().inputValue(), "I delivered three synthetic projects.");
  await page.getByRole("button", { name: "Client summary", exact: true }).click();
  await page.getByLabel("Why this candidate is being shared").fill("Reviewed synthetic role experience.");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "← Candidate assessments", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: /Why this candidate is being shared/ }).inputValue(), "Reviewed synthetic role experience.");
  const out = path.join(ROOT, "compare-output/recruiter"); fs.mkdirSync(out, { recursive: true });
  await page.screenshot({ path: path.join(out, "client-summary-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: path.join(out, "client-summary-mobile.png"), fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({ path: path.join(out, "client-summary-dark.png"), fullPage: true });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("heading", { name: "Sign in to review candidates" }).waitFor();
  allowStaff = false; await signIn(); await page.getByRole("heading", { name: "No recruiter access" }).waitFor();
  assert.equal(await page.getByText("Candidate Example", { exact: true }).count(), 0);
  assert.deepEqual(errors, []); assert.deepEqual(outside, []);
  console.log("PASS recruiter sign-in/access denial, CV correction and save, screening persistence, blocked sharing, unsaved navigation, desktop/mobile/dark layout, sign-out clearance; no outside requests.");
} finally { await browser?.close(); await server.close(); }
