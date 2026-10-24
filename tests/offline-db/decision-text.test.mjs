/* Regression (Codex, M2 review): client text whitespace. PostgreSQL's btrim() removes only spaces, so "\t\n" used to be
   accepted as a decline note or feedback, and the workspace then failed to load ("missing text"). The rule now, in the
   functions and in the table checks: leading and trailing whitespace (the same set as JavaScript's trim) is removed,
   internal line breaks are kept, required text must have something left, and an About with nothing left becomes null. */
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { KEY, PASSWORDS, URL_BASE, asUser, createProject, snapshot } from "./fake-supabase.mjs";
import { loadAccount } from "../../src/auth/account.ts";
import { loadWorkspace } from "../../src/workspace/data.ts";
import { supabaseMoveRpc } from "../../src/workspace/moves.ts";
import { seedId } from "../../scripts/db/api-read-lib.mjs";

const HARBOR = "portal-test-harbor@example.com";
const H = (ref) => seedId("submission", "harbor", ref);
const WHITESPACE_ONLY = ["\t\n", " \t \r\n ", "\n\n\n", " 　", "﻿", "   \v\f"];
const decline = (p, note, v = 1, ref = "ab-fsr") => asUser(p.db, p.ids[HARBOR], "select public.client_decline($1, $2, null, $3, gen_random_uuid())::text as r", [H(ref), note, v]);
const feedback = (p, about, text, v = 2, ref = "je-isl") => asUser(p.db, p.ids[HARBOR], "select public.client_add_feedback($1, $2, $3, $4, gen_random_uuid())::text as r", [H(ref), about, text, v]);
const errorOf = (promise) => promise.then(() => "accepted", (e) => e.message);

describe("whitespace-only required text is refused, and nothing changes", () => {
  it("decline notes: tabs, newlines, mixed and Unicode whitespace", async () => {
    const p = await createProject(), before = await snapshot(p.db);
    for (const note of WHITESPACE_ONLY) expect(await errorOf(decline(p, note)), JSON.stringify(note)).toBe("invalid_request");
    expect(await snapshot(p.db)).toEqual(before);           // stage, version, history, notes and idempotency keys unchanged
  });
  it("feedback text: the same", async () => {
    const p = await createProject(), before = await snapshot(p.db);
    for (const text of WHITESPACE_ONLY) expect(await errorOf(feedback(p, "General feedback", text)), JSON.stringify(text)).toBe("invalid_request");
    expect(await snapshot(p.db)).toEqual(before);
  });
});

describe("accepted text is normalised the same way everywhere", () => {
  it("meaningful multiline text keeps its internal line breaks and spacing; only the ends are trimmed", async () => {
    const p = await createProject();
    await decline(p, "\n\t Not enough CRM depth.\n\n  Field work is light.  \n\t");
    await feedback(p, null, "\r\nStrong on process.\nAsk about weekends. ");
    const notes = (await p.db.query("select kind, text from public.client_notes order by kind")).rows;
    expect(notes).toEqual([{ kind: "decline", text: "Not enough CRM depth.\n\n  Field work is light." }, { kind: "feedback", text: "Strong on process.\nAsk about weekends." }]);
  });
  it("a whitespace-only About becomes null; a padded About is trimmed", async () => {
    const p = await createProject();
    await feedback(p, " \t\n ", "One.");
    await feedback(p, "　 Panel on 9 Oct \n", "Two.", 2, "tb-rsm");
    expect((await p.db.query("select about from public.client_notes order by created_at, id")).rows.map((r) => r.about).sort()).toEqual(["Panel on 9 Oct", null]);
  });
  it("the same request with differently padded text is the same request (one note)", async () => {
    const p = await createProject();
    const key = crypto.randomUUID();
    const send = (note) => asUser(p.db, p.ids[HARBOR], "select public.client_decline($1, $2, null, 1, $3)::text as r", [H("ab-fsr"), note, key]);
    const a = (await send("Not a fit.")).rows[0].r, b = (await send("\tNot a fit.\n")).rows[0].r;
    expect(b).toBe(a);
    expect((await p.db.query("select count(*)::int as n from public.client_notes")).rows[0].n).toBe(1);
  });
  it("the database's trim matches JavaScript's trim for every Basic Multilingual Plane character", async () => {
    const p = await createProject(), cps = [];
    for (let c = 1; c <= 0xffff; c++) if (c < 0xd800 || c > 0xdfff) cps.push(c);              // NUL cannot be stored; lone surrogates are not text
    const strs = cps.map((c) => `${String.fromCharCode(c)}x${String.fromCharCode(c)}`);
    const rows = (await p.db.query("select app_private.trim_ws(s) as t from unnest($1::text[]) with ordinality u(s, i) order by i", [strs])).rows;
    expect(cps.filter((c, i) => rows[i].t !== strs[i].trim()).map((c) => c.toString(16))).toEqual([]);
  }, 60000);
});

describe("the table enforces it too (direct writes by the owner)", () => {
  const insert = (p, text, about = null) => p.db.query(`
    with e as (insert into public.submission_events (client_id, submission_id, submission_version, kind, to_stage, occurred_on, actor_kind, actor_member_id, source)
               select s.client_id, s.id, 3, 'feedback', 'Interview', current_date, 'client', (select id from public.client_members where display_name = 'Maria Alvarez (test)'), 'portal'
               from public.submissions s where s.id = $1 returning *)
    insert into public.client_notes (client_id, submission_id, event_id, kind, about, text, author_member_id)
    select client_id, submission_id, id, 'feedback', $3, $2, actor_member_id from e`, [H("je-isl"), text, about]).then(() => "accepted", (e) => e.code);
  it("whitespace-only or untrimmed text, and a blank or untrimmed About, are refused", async () => {
    const p = await createProject();
    for (const [text, about] of [["\t\n", null], ["Padded.\n", null], [" Padded.", null], ["Fine.", " \n"], ["Fine.", "Padded "]])
      expect(await insert(p, text, about), JSON.stringify([text, about])).toBe("23514");
    expect(await insert(p, "Line one\nLine two", "Panel")).toBe("accepted");
  });
});

describe("through supabase-js: a refused whitespace note leaves the workspace loadable", () => {
  it("invalid_request, then the workspace still loads with no new note", async () => {
    const p = await createProject();
    const sb = createClient(URL_BASE, KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: p.fetch } });
    const { data } = await sb.auth.signInWithPassword({ email: HARBOR, password: PASSWORDS.harbor });
    const account = await loadAccount(sb, data.session.user.id);
    const out = await supabaseMoveRpc(sb)({ action: "decline", submissionId: H("ab-fsr"), toStage: "Declined", expectedVersion: 1, key: crypto.randomUUID(), note: "\t\n", category: null });
    expect(out).toEqual({ kind: "error", code: "invalid_request" });
    const ws = await loadWorkspace(sb, account.client.id);
    expect(ws.notes).toEqual([]);
    expect(ws.subs.find((s) => s.id === H("ab-fsr"))).toMatchObject({ stage: "To review", version: 1 });
  });
});
