/* Milestone 3 in Supabase mode, end to end offline: the real supabase-js client, the portal's loaders and its Supabase-mode
   pages against milestone 2 only, milestone 3 without content, and milestone 3 with the fictional seed. Errors (a refused
   read, a failed request, a partly applied migration, inconsistent rows) must stop the load; they are never shown as
   "not connected" or filled in. The populated pages are compared, as text, with the demo's pages for the same fictional
   submissions and roles. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { KEY, PASSWORDS, URL_BASE, createProject } from "./fake-supabase.mjs";
import { loadAccount } from "../../src/auth/account.ts";
import { loadWorkspace } from "../../src/workspace/data.ts";
import { WorkspacePage } from "../../src/workspace/DbViews.tsx";
import { DataProvider } from "../../src/data/DataProvider.tsx";
import { CandidatePage } from "../../src/candidates/CandidatePage.tsx";
import { RolePage } from "../../src/roles/RolePage.tsx";
import { FIXTURE } from "../../src/data/fixtures.ts";
import { seedId } from "../../scripts/db/api-read-lib.mjs";

const EMAIL = { harbor: "portal-test-harbor@example.com", northwind: "portal-test-northwind@example.com" };
const EMPTY = "No summary is currently shared for this candidate.";
const NOT_CONNECTED_SUMMARY = "are not connected yet.";

async function load(p, who = "harbor", fetch = p.fetch) {
  const sb = createClient(URL_BASE, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch } });
  const { data } = await sb.auth.signInWithPassword({ email: EMAIL[who], password: PASSWORDS[who] });
  const account = await loadAccount(sb, data.session.user.id);
  return loadWorkspace(sb, account.client.id);
}
const page = (ws, route) => renderToStaticMarkup(createElement(WorkspacePage, { route, state: { status: "ready", key: "k", ws }, onRetry() {}, today: "2026-10-12" }));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const between = (html, start, end) => { const i = html.indexOf(start); return i < 0 ? "" : html.slice(i, html.indexOf(end, i)); };
const sub = (ref, c = "harbor") => seedId("submission", c, ref), role = (ref, c = "harbor") => seedId("role", c, ref);
/* A fetch that rewrites one table's response (to simulate a server returning inconsistent rows). */
const tamper = (p, table, fn) => async (url, init) => {
  const r = await p.fetch(url, init);
  if (!new URL(url).pathname.endsWith(`/rest/v1/${table}`)) return r;
  const rows = await r.json();
  return new Response(JSON.stringify(fn(rows)), { status: r.status, headers: { "Content-Type": "application/json" } });
};

describe("compatibility: milestone 2 only, milestone 3 empty, milestone 3 populated", () => {
  it("milestone 2 only: content is null and the pages keep their not-connected text", async () => {
    const ws = await load(await createProject({ m3: false }));
    expect(ws.content).toBeNull();
    expect(ws.subs).toHaveLength(12);
    expect(page(ws, `c-${sub("tb-isl")}`)).toContain(`The summary, why Revenue Optics shared this candidate, requirement evidence, strengths, points to clarify and key facts ${NOT_CONNECTED_SUMMARY}`);
    expect(page(ws, `role-${role("isl")}`)).toContain(`The role summary, what the role involves, the job description and the requirements ${NOT_CONNECTED_SUMMARY}`);
  });
  it("milestone 3 without content: nothing shared, shown as such (not as not connected), and nothing filled in", async () => {
    const ws = await load(await createProject({ m3Seed: false }));
    expect(ws.content.sets.size).toBe(0);
    expect(ws.content.packages.size).toBe(0);
    expect([...ws.content.roleInfo.values()].every((r) => r.summary === null && r.responsibilities.length === 0 && r.jobDescription === null && r.holdNote === null)).toBe(true);
    const c = page(ws, `c-${sub("tb-isl")}`), r = page(ws, `role-${role("isl")}`);
    expect(c).toContain(EMPTY);
    expect(c).not.toContain(NOT_CONNECTED_SUMMARY);
    expect(r).not.toContain("not connected yet");
    expect(r).not.toContain('class="rd"');
    expect(r).not.toContain("<dt>Requirements</dt>");
  });
  it("milestone 3 populated (Harbor): 4 agreed sets, 11 packages with complete evidence; hidden versions stay hidden", async () => {
    const ws = await load(await createProject());
    expect(ws.content.sets.size).toBe(4);
    expect([...ws.content.sets.values()].map((s) => s.label).sort()).toEqual(FIXTURE.roles.map((r) => r.reqVer).sort());
    expect(ws.content.packages.size).toBe(11);
    expect([...ws.content.packages.values()].reduce((n, p) => n + p.evidence.size, 0)).toBe(48);
    expect(ws.content.packages.get(sub("je-isl")).version).toBe(1);
    expect(ws.content.packages.has(sub("do-rsm"))).toBe(false);
    expect(page(ws, `c-${sub("do-rsm")}`)).toContain(EMPTY);
  });
  it("Northwind: only its agreed version 2; its package on superseded requirements is hidden; no Harbor content", async () => {
    const ws = await load(await createProject(), "northwind");
    expect([...ws.content.sets.values()].map((s) => s.version)).toEqual([2]);
    expect(ws.content.packages.size).toBe(0);
    expect(page(ws, `c-${sub("n1-ops", "northwind")}`)).toContain(EMPTY);
  });
});

describe("parity with the demo's pages (same fictional content; sources as plain text)", () => {
  it("each visible Summary tab has the demo's text", async () => {
    const ws = await load(await createProject());
    const visible = FIXTURE.subs.filter((s) => s.id !== "do-rsm");
    expect(visible).toHaveLength(11);
    for (const s of visible) {
      const demo = renderToStaticMarkup(createElement(DataProvider, null, createElement(CandidatePage, { id: s.id })));
      const db = page(ws, `c-${sub(s.id)}`);
      expect(text(between(db, 'role="tabpanel">', "<aside")), s.id).toBe(text(between(demo, 'role="tabpanel">', "<aside")));
    }
  });
  it("sources are plain text, and a row without a source shows none", async () => {
    const ws = await load(await createProject());
    const h = page(ws, `c-${sub("tb-isl")}`), panel = between(h, 'role="tabpanel">', "<aside");
    expect(panel).not.toContain("<button");
    expect(panel).toContain('<div class="src">Source: Interview 14:05</div>');
    const pkg = ws.content.packages.get(sub("so-pa")), withSource = [...pkg.evidence.values()].filter((e) => e.source).length;
    expect([...pkg.evidence.values()].some((e) => e.source === null)).toBe(true);
    expect(between(page(ws, `c-${sub("so-pa")}`), 'role="tabpanel">', "<aside").split('class="src"').length - 1).toBe(withSource);
  });
  it("each role page has the demo's hold note, summary, responsibilities, job description and requirements", async () => {
    const ws = await load(await createProject());
    for (const r of FIXTURE.roles) {
      const demo = renderToStaticMarkup(createElement(DataProvider, null, createElement(RolePage, { id: r.id })));
      const db = page(ws, `role-${role(r.id)}`);
      for (const [start, end] of [['<div class="rd">', "<section"], ['<p class="lede">', "</p>"], ['<div class="banner warn">', "</div>"]])
        expect(text(between(db, start, end)), `${r.id} ${start}`).toBe(text(between(demo, start, end)));
      expect(db).toContain(`<div><dt>Requirements</dt><dd>${r.reqVer}</dd></div>`);
    }
  });
});

describe("errors stop the load; they are never shown as not connected or filled in", () => {
  it("a refused read of an optional milestone 3 table is an error, not 'not applied'", async () => {
    const p = await createProject();
    await p.db.exec("revoke select on public.role_requirement_sets from authenticated");
    await expect(load(p)).rejects.toThrow(/role_requirement_sets could not be read/);
  });
  it("a refused read of a required milestone 3 table is an error", async () => {
    const p = await createProject();
    await p.db.exec("revoke select on public.requirement_evidence from authenticated");
    await expect(load(p)).rejects.toThrow(/requirement_evidence could not be read/);
  });
  it("a failed request is an error", async () => {
    const p = await createProject();
    const failing = async (url, init) => { if (new URL(url).pathname.endsWith("/rest/v1/role_requirements")) throw new TypeError("Failed to fetch"); return p.fetch(url, init); };
    await expect(load(p, "harbor", failing)).rejects.toThrow(/role_requirements could not be read/);
  });
  it("a partly applied migration is an error: packages without sets, a missing evidence table, missing role columns", async () => {
    const a = await createProject({ m3Seed: false });
    await a.db.exec("drop table public.requirement_evidence; drop table public.submission_packages");
    await expect(load(a)).rejects.toThrow(/only part of milestone 3/);
    const b = await createProject({ m3Seed: false });
    await b.db.exec("drop table public.requirement_evidence");
    await expect(load(b)).rejects.toThrow(/requirement_evidence could not be read/);
    const c = await createProject({ m3Seed: false });
    await c.db.exec("alter table public.roles drop column hold_note");
    await expect(load(c)).rejects.toThrow(/roles could not be read/);
  });
  it("inconsistent rows are errors: a missing evidence row, a draft package, an unagreed set, evidence without a source", async () => {
    const p = await createProject();
    await expect(load(p, "harbor", tamper(p, "requirement_evidence", (rows) => rows.slice(1)))).rejects.toThrow(/incomplete evidence/);
    await expect(load(p, "harbor", tamper(p, "submission_packages", (rows) => rows.map((r, i) => (i ? r : { ...r, state: "draft" }))))).rejects.toThrow(/not published/);
    await expect(load(p, "harbor", tamper(p, "role_requirement_sets", (rows) => rows.map((r, i) => (i ? r : { ...r, status: "superseded" }))))).rejects.toThrow(/not agreed/);
    await expect(load(p, "harbor", tamper(p, "requirement_evidence", (rows) => rows.map((r) => (r.source_label ? { ...r, source_label: null } : r))))).rejects.toThrow(/without a source/);
    await expect(load(p, "harbor", tamper(p, "submission_packages", (rows) => rows.slice(1)))).rejects.toThrow(/evidence for a package that was not returned/);
  });
});
