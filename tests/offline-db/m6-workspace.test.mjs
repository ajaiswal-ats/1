/* Milestone 6 in Supabase mode, end to end offline: the Screening interview tab through the real supabase-js client, the
   loader and the Supabase-mode view, without milestone 6, with it but no rows, and seeded; publication rules (paused,
   withdrawn, unpublished, superseded requirements); client isolation; text parity with the demo's fixtures; no player,
   seeking or recording; and the loader stopping on partial or inconsistent data. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { KEY, PASSWORDS, URL_BASE, createProject } from "./fake-supabase.mjs";
import { loadAccount } from "../../src/auth/account.ts";
import { loadWorkspace } from "../../src/workspace/data.ts";
import { Screening, WorkspacePage } from "../../src/workspace/DbViews.tsx";
import { FIXTURE } from "../../src/data/fixtures.ts";
import { seedId } from "../../scripts/db/api-read-lib.mjs";

const EMAIL = { harbor: "portal-test-harbor@example.com", northwind: "portal-test-northwind@example.com" };
const H = (ref) => seedId("submission", "harbor", ref);
const P6 = (ref) => `md5('portal-m6:package:harbor:${ref}')::uuid`;
async function signIn(p, who = "harbor", wrap = (f) => f) {
  const sb = createClient(URL_BASE, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: wrap(p.fetch) } });
  const { data } = await sb.auth.signInWithPassword({ email: EMAIL[who], password: PASSWORDS[who] });
  const account = await loadAccount(sb, data.session.user.id);
  return Object.assign(() => loadWorkspace(sb, account.client.id), { sb });
}
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const tab = (ws, ref) => renderToStaticMarkup(createElement(Screening, { ws, sub: ws.subs.find((s) => s.id === H(ref)) }));
const fd = (d) => `${Number(d.slice(8))} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(d.slice(5, 7)) - 1]}`;

describe("compatibility: without milestone 6, with it but no rows, and seeded", () => {
  it("without milestone 6: no screening; the tab keeps its 'not connected' text", async () => {
    const ws = await (await signIn(await createProject()))();
    expect(ws.screening).toBeNull();
    const h = renderToStaticMarkup(createElement(WorkspacePage, { route: `c-${H("tb-isl")}`, state: { status: "ready", key: "k", ws }, onRetry() {}, today: "2026-10-12" }));
    expect(h).toContain("Recruiter screening");
  });
  it("milestone 6 without rows: every candidate says no screening interview has been shared", async () => {
    const ws = await (await signIn(await createProject({ m6: true, m6Seed: false })))();
    expect(ws.screening.size).toBe(0);
    expect(tab(ws, "tb-isl")).toBe('<p class="muted">No screening interview has been shared for this candidate.</p>');
  });
  it("seeded: Harbor has the 9 demo screening calls, Northwind none", async () => {
    const p = await createProject({ m6: true });
    const h = await (await signIn(p))(), n = await (await signIn(p, "northwind"))();
    expect([...h.screening.keys()].sort()).toEqual(FIXTURE.subs.filter((s) => s.iv).map((s) => H(s.id)).sort());
    expect(n.screening.size).toBe(0);
    expect(tab(h, "bc-pa")).toContain("No screening interview has been shared for this candidate.");
  });
});

describe("the tab: the demo's reviewed text, no player, no seeking, no recording", () => {
  it("each of the 9 tabs shows the demo's date line, key moments, summary and notes", async () => {
    const ws = await (await signIn(await createProject({ m6: true })))();
    for (const s of FIXTURE.subs.filter((x) => x.iv)) {
      const t = text(tab(ws, s.id)), v = s.iv;
      expect(t, s.id).toContain(`Recruiter screening with Revenue Optics ${fd(v.date)} 2026 · ${v.dur} minutes · ${v.by}, Revenue Optics`);
      for (const [m, label] of v.moments) expect(t, s.id).toContain(`About ${m} min ${label}`);
      expect(t, s.id).toContain(`Screening summary ${v.summary}`);
      expect(t, s.id).toContain(`Recruiter observations ${v.notes} ${v.by}, Revenue Optics`);
    }
  });
  it("nothing playable: no player, controls, seek buttons, timestamps, links or transcript", async () => {
    const ws = await (await signIn(await createProject({ m6: true })))();
    for (const s of FIXTURE.subs.filter((x) => x.iv)) {
      const h = tab(ws, s.id);
      expect(h, s.id).not.toMatch(/<button|<a |href=|<video|<audio|<iframe|class="player"|class="pctl"|pbar|data-seek|role="slider"|\b\d{2}:\d{2}\b|Transcript|Play/);
      expect(text(h), s.id).toContain("No recording is shared in the portal.");
    }
  });
  it("notes are optional: with none shared the box says so (never an internal note)", async () => {
    const p = await createProject({ m6: true, m6Seed: false });
    await p.db.exec(`insert into public.submission_packages (id, client_id, submission_id, role_id, requirement_set_id, version, why_shared)
      select md5('t:pkg')::uuid, client_id, submission_id, role_id, requirement_set_id, 9, why_shared from public.submission_packages where id = md5('portal-m3:package:harbor:bc-pa:1')::uuid;
      insert into public.requirement_evidence (client_id, package_id, requirement_set_id, requirement_id, status, evidence, source_label)
      select client_id, md5('t:pkg')::uuid, requirement_set_id, requirement_id, status, evidence, source_label from public.requirement_evidence where package_id = md5('portal-m3:package:harbor:bc-pa:1')::uuid;
      insert into public.screening_summaries (client_id, package_id, requirement_set_id, call_on, duration_minutes, recruiter_name, summary)
      select client_id, id, requirement_set_id, '2026-09-20', 20, 'Fictional Recruiter', 'Fictional summary.' from public.submission_packages where id = md5('t:pkg')::uuid;
      select app_private.publish_package(md5('t:pkg')::uuid);`);
    const t = text(tab(await (await signIn(p))(), "bc-pa"));
    expect(t).toContain("Recruiter observations None shared.");
    expect(t).toContain("Example discussion topics Topics Revenue Optics noted, at about the minute they came up. None noted.");
    expect(t).toContain("No recording is shared in the portal.");
  });
});

describe("publication rules and isolation", () => {
  it("a paused or withdrawn package, an unpublished submission, or superseded requirements hide the summary", async () => {
    const p = await createProject({ m6: true }), load = await signIn(p);
    await p.db.exec(`update public.submission_packages set state = 'paused' where id = ${P6("tb-isl")};
      update public.submission_packages set state = 'withdrawn' where id = ${P6("gl-rsm")};
      update public.submissions set publication = 'unpublished' where id = '${H("so-pa")}';`);
    let ws = await load();
    expect(ws.screening.size).toBe(6);
    expect(tab(ws, "tb-isl")).toContain("No screening interview has been shared for this candidate.");
    expect(ws.subs.some((s) => s.id === H("so-pa"))).toBe(false);
    await p.db.exec("select app_private.agree_requirement_set(md5('portal-m3:set:harbor:isl:2')::uuid, current_date)");
    ws = await load();
    expect([...ws.screening.keys()].some((k) => [H("je-isl"), H("pr-isl")].includes(k))).toBe(false);
    expect(ws.screening.size).toBe(4);
  });
  it("Northwind never receives Harbor's summaries, even when it asks for them by package", async () => {
    const p = await createProject({ m6: true }), load = await signIn(p, "northwind");
    expect((await load()).screening.size).toBe(0);
    const harborPkg = (await p.db.query(`select ${P6("tb-isl")}::text as id`)).rows[0].id;
    const r = await load.sb.from("screening_summaries").select("id, summary").eq("package_id", harborPkg);
    expect([r.error, r.data]).toEqual([null, []]);
    const anon = await p.fetch(`${URL_BASE}/rest/v1/screening_summaries?select=id`, { headers: { apikey: KEY } });
    expect(anon.status).toBe(401);                                                      // signed out: no access at all
  });
});

describe("errors stop the load", () => {
  const tamper = (table, change) => (f) => async (url, init) => {
    const res = await f(url, init);
    if (!String(url).includes(`/rest/v1/${table}?`)) return res;
    const body = await res.json();
    return new Response(JSON.stringify(change(body)), { status: res.status, headers: { "Content-Type": "application/json" } });
  };
  it("milestone 6 without milestone 3, a refused read, or an inconsistent row is an error, never a partial tab", async () => {
    const p = await createProject({ m6: true });
    const missing3 = (f) => async (url, init) => (/\/rest\/v1\/(role_requirement_sets|submission_packages)\?/.test(String(url))
      ? new Response(JSON.stringify({ code: "PGRST205", message: "not found" }), { status: 404, headers: { "Content-Type": "application/json" } }) : f(url, init));
    await expect((await signIn(p, "harbor", missing3))()).rejects.toThrow(/milestone 6 without milestone 3/);
    const refused = (f) => async (url, init) => (String(url).includes("/rest/v1/screening_summaries?")
      ? new Response(JSON.stringify({ code: "42501", message: "permission denied" }), { status: 403, headers: { "Content-Type": "application/json" } }) : f(url, init));
    await expect((await signIn(p, "harbor", refused))()).rejects.toThrow(/screening_summaries could not be read/);
    const bad = [
      (b) => b.map((x, i) => (i ? x : { ...x, key_moments: [{ minute: x.duration_minutes, label: "Past the end" }] })),
      (b) => b.map((x, i) => (i ? x : { ...x, key_moments: [{ minute: 2, label: "A", url: "https://example.com" }] })),
      (b) => b.map((x, i) => (i ? x : { ...x, call_on: "2026-12-31" })),
      (b) => b.map((x, i) => (i ? x : { ...x, summary: "   " })),
      (b) => b.map((x, i) => (i ? x : { ...x, package_id: "00000000-0000-4000-8000-000000000000" })),
      (b) => [...b, { ...b[0], id: "ffffffff-ffff-4fff-8fff-ffffffffffff" }],
    ];
    for (const change of bad) await expect((await signIn(p, "harbor", tamper("screening_summaries", change)))()).rejects.toThrow();
  });
});
