/* Supabase-mode Roles and Candidates pages: database values only, "not connected" where the database has nothing,
   no actions, loading / empty / error states, and data shown only for the account it belongs to. */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthView } from "../auth/AuthViews";
import type { AuthState } from "../auth/session";
import { CLIENT, CURRENT_USER, FIXTURE } from "../data/fixtures";
import type { Workspace } from "./data";
import { History, WorkspacePage, historyText } from "./DbViews";
import { history, type DbEvent } from "./data";
import type { WorkspaceState } from "./store";

beforeEach(() => { (globalThis as { document?: unknown }).document = { documentElement: { getAttribute: () => "light" } }; });
afterEach(() => { delete (globalThis as { document?: unknown }).document; });

const WS: Workspace = {
  clientId: "c1",
  roles: [
    { id: "r1", title: "Warehouse Lead", location: "Reno, NV", status: "Open", openedOn: "2026-10-01", recruiterName: "Alex Kim" },
    { id: "r2", title: "Buyer", location: "", status: "On hold", openedOn: "2026-09-01", recruiterName: "" },
  ],
  people: new Map([["p1", { id: "p1", name: "Jo Doe", headline: "Ops · Example Co", location: "Reno, NV" }], ["p2", { id: "p2", name: "Ann Lee", headline: "", location: "" }]]),
  subs: [
    { id: "s1", roleId: "r1", personId: "p1", stage: "Interview", sharedOn: "2026-10-08", version: 1 },
    { id: "s2", roleId: "r2", personId: "p1", stage: "To review", sharedOn: "2026-09-20", version: 1 },
    { id: "s3", roleId: "r1", personId: "p2", stage: "Declined", sharedOn: "2026-10-08", version: 1 },
  ],
  moves: [{ submissionId: "s1", toStage: "Interview", occurredOn: "2026-10-10" }],
  events: [
    { id: 1, submissionId: "s1", version: 1, kind: "shared", toStage: "To review", occurredOn: "2026-10-08", actorKind: "revenue_optics", actorMemberId: null },
    { id: 2, submissionId: "s1", version: 2, kind: "stage_move", toStage: "Interview", occurredOn: "2026-10-10", actorKind: "client", actorMemberId: "m-me" },
    { id: 3, submissionId: "s2", version: 1, kind: "shared", toStage: "To review", occurredOn: "2026-09-20", actorKind: "revenue_optics", actorMemberId: null },
    { id: 4, submissionId: "s3", version: 1, kind: "shared", toStage: "To review", occurredOn: "2026-10-08", actorKind: "revenue_optics", actorMemberId: null },
  ],
  notes: [],
  content: null,
  steps: null,
  screening: null,
};
const ready: WorkspaceState = { status: "ready", key: "u1:c1", ws: WS };
const page = (route: string, state: WorkspaceState = ready) => renderToStaticMarkup(<WorkspacePage route={route} state={state} onRetry={() => {}} today="2026-10-12" />);
const DEMO = [CLIENT.note, CURRENT_USER.name, ...FIXTURE.subs.map((s) => s.name), ...FIXTURE.roles.map((r) => r.title)];
const ROUTES = ["candidates", "roles", "progress", "c-s1", "role-r1", "c-unknown", "role-unknown"];

describe("Roles (database)", () => {
  it("lists each role with status, shared, stage counts and last 7 days; Waiting on you is not connected", () => {
    const h = page("roles");
    expect(h).toContain('href="#role-r1">Warehouse Lead</a><span class="rv-sub">Reno, NV</span>');
    expect(h).toContain('href="#role-r2">Buyer</a><span class="rv-sub"></span></td>');                   // no location: nothing invented
    expect(h).toContain('<span class="rv-chip rv-wait"><i></i>On hold</span>');
    expect(h).toContain("2 shared · 1 moved");
    expect(h).toContain("&quot;Waiting on you&quot; is not connected yet.");
    expect(h).toContain('class="rv-zero">Not connected yet</span>');
  });
  it("a role page shows database fields, counts and its candidates; descriptions and requirements are not connected", () => {
    const h = page("role-r1");
    expect(h).toContain("<h1>Warehouse Lead</h1>");
    expect(h).toContain("<dt>Recruiter</dt><dd>Alex Kim, Revenue Optics</dd>");
    expect(h).toContain("requirements are not connected yet");
    expect(h).toContain('href="#c-s1">Jo Doe</a>');
    expect(page("role-r2")).not.toContain("<dt>Recruiter</dt>");
  });
  it("no roles: an empty state", () => {
    expect(page("roles", { status: "ready", key: "u1:c1", ws: { ...WS, roles: [], subs: [], people: new Map(), moves: [] } })).toContain("No roles yet.");
  });
});

describe("Candidates (database)", () => {
  it("pipeline cards show name, headline, role and the same person's other roles, and nothing invented", () => {
    const h = page("candidates");
    expect(h).toContain("3 submissions · 2 people · 2 roles");
    expect(h).toContain('href="#c-s1">Jo Doe</a>');
    expect(h).toContain('<p class="x-hd">Ops · Example Co</p>');
    expect(h).toContain('href="#c-s2">Buyer</a>');
    expect(h).not.toContain("nextbar");
    expect(h).toContain("Not shared");
    expect(h).toContain("1 declined hidden");
    expect(h).toMatch(/disabled="" aria-disabled="true" title="Not connected yet">Waiting on you/);
    expect(h).toContain("Next steps, requirement evidence and interviews are not connected yet.");
  });
  it("a candidate page shows database fields; decline and feedback follow the provisional rules", () => {
    const h = page("c-s1");                                     // Interview, open role
    expect(h).toContain("<h1>Jo Doe</h1>");
    expect(h).toContain("for <a href=\"#role-r1\">Warehouse Lead</a>");
    expect(h).toContain("<span>Shared 8 Oct</span>");
    expect(h).toMatch(/<button type="button" class="btn btn-d" data-form="decline">Decline<\/button>/);
    expect(h).toMatch(/<button type="button" class="btn btn-s" data-form="feedback">Share interview feedback<\/button>/);
    expect(h).toContain("Manatal is not updated");
    expect(h).toContain("Who may act, and when, is provisional.");
    const onHold = page("c-s2");                                // To review, on-hold role: neither
    expect(onHold).toMatch(/class="btn btn-d btn-off" data-form="decline" disabled="" title="Not available for this stage or role \(provisional rules\)"/);
    expect(onHold).toMatch(/class="btn btn-s btn-off" data-form="feedback" disabled=""/);
    expect(page("c-unknown")).toContain("Candidate not found.");
  });
  it("without client notes on the database (milestone 2 not applied), decisions are unavailable and say so", () => {
    const h = page("c-s1", { status: "ready", key: "u1:c1", ws: { ...WS, notes: null } });
    expect(h).toContain("Decline and interview feedback are not available on this database yet.");
    expect(h).toMatch(/data-form="decline" disabled="" title="Not available on this database yet"/);
  });
  it("stage choices follow the provisional rule: open role, not from Offer/Hired/Declined, Offer and Hired marked provisional", () => {
    const h = page("c-s1");                                     // Interview, open role
    expect(h).toContain('<option value="To review" selected="">To review</option><option value="Offer">Offer (provisional)</option><option value="Hired">Hired (provisional)</option>');
    expect(page("c-s2")).toContain("This role is on hold, so stage changes are paused.");
    expect(page("c-s3")).toContain("Declined for this role. The note is in Notes and history.");
    expect(page("c-s3")).not.toMatch(/You declined/);
    expect(page("c-s2")).not.toContain('id="mv"');
  });
  it("the lists and the other pages have no action controls, and no page shows a demo value", () => {
    for (const r of ROUTES) {
      const h = page(r);
      if (!r.startsWith("c-s")) expect(h, r).not.toMatch(/<form|<select id="mv"|data-form/);
      for (const d of DEMO) expect(h, `${r}: ${d}`).not.toContain(d);
    }
  });
});

describe("candidate history (read-only, from submission events)", () => {
  const sub = (over = {}) => ({ id: "s1", roleId: "r1", personId: "p1", stage: "Offer" as const, sharedOn: "2026-10-01", version: 4, ...over });
  const ev = (version: number, o: Partial<DbEvent>): DbEvent => ({ id: version, submissionId: "s1", version, kind: "stage_move", toStage: "Interview", occurredOn: `2026-10-0${version}`, actorKind: "client", actorMemberId: null, ...o });
  const wsWith = (events: DbEvent[]) => ({ ...WS, events });
  const all = [ev(1, { kind: "shared", toStage: "To review", actorKind: "revenue_optics" }), ev(2, { actorMemberId: "m-me" }), ev(3, { toStage: "Offer", actorMemberId: "m-other" }), ev(4, { toStage: "Offer", actorKind: "revenue_optics" })];

  it("'You' only for the signed-in member; another member or an unrecorded client actor is 'Client team'", () => {
    expect(history(wsWith(all), sub(), "m-me").entries.map((e) => e.actor)).toEqual(["Revenue Optics", "You", "Client team", "Revenue Optics"]);
    expect(history(wsWith(all), sub(), "m-other").entries.map((e) => e.actor)).toEqual(["Revenue Optics", "Client team", "You", "Revenue Optics"]);
    expect(history(wsWith([ev(2, { actorMemberId: null })]), sub({ version: 2 }), "m-me").entries[0].actor).toBe("Client team");   // seeded history
    expect(history(wsWith([ev(2, { actorMemberId: "m-me" })]), sub({ version: 2 }), "").entries[0].actor).toBe("Client team");    // no member known
  });
  it("is ordered by submission version, whatever order the rows came in, and shown newest first with dates", () => {
    const h = history(wsWith([all[2], all[0], all[3], all[1]]), sub(), "m-me");
    expect(h.entries.map((e) => e.version)).toEqual([1, 2, 3, 4]);
    const html = renderToStaticMarkup(<History ws={wsWith([all[2], all[0], all[3], all[1]])} sub={sub()} memberId="m-me" />);
    const lines = [...html.matchAll(/<li><span class="t">([^<]+)<\/span><span>([^<]+)<\/span><\/li>/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(lines).toEqual(["4 Oct Revenue Optics moved Jo to Offer", "3 Oct Client team moved Jo to Offer", "2 Oct You moved Jo to Interview", "1 Oct Revenue Optics shared Jo for this role"]);
    expect(html).toContain("No notes yet.");
  });
  it("says what is missing rather than inventing it", () => {
    const gap = history(wsWith([all[0], all[3]]), sub(), "m-me");
    expect(gap.missing).toBe(2);
    const html = renderToStaticMarkup(<History ws={wsWith([all[0], all[3]])} sub={sub()} memberId="m-me" />);
    expect(html).toContain("2 changes are not shown: their history entries are not available.");
    const none = renderToStaticMarkup(<History ws={wsWith([])} sub={sub({ version: 1 })} memberId="m-me" />);
    expect(none).toContain("No history is available for this candidate.");
    expect(none).toContain("1 change is not shown");
    expect(history(wsWith(all), sub({ version: 3 }), "m-me").beyondCurrent).toBe(true);
    expect(renderToStaticMarkup(<History ws={wsWith(all)} sub={sub({ version: 3 })} memberId="m-me" />)).toContain("Reload the page to see the latest stage.");
  });
  it("notes: decline note with its category, feedback with its subject; 'You' only for the member's own", () => {
    const notes = [
      { id: "n1", submissionId: "s1", eventId: 3, kind: "feedback" as const, about: "Panel on 9 Oct", text: "Strong on process.", category: null, authorMemberId: "m-other", createdAt: "2026-10-03T10:00:00Z" },
      { id: "n2", submissionId: "s1", eventId: 5, kind: "decline" as const, about: null, text: "Not enough CRM depth.", category: null, authorMemberId: "m-me", createdAt: "2026-10-05T10:00:00Z" },
    ];
    const html = renderToStaticMarkup(<History ws={{ ...wsWith(all), notes }} sub={sub()} memberId="m-me" />);
    expect(html).toContain('<b>Interview feedback</b> <span class="xs muted">about Panel on 9 Oct</span><p style="margin:6px 0 0;white-space:pre-wrap">Strong on process.</p><p class="xs muted" style="margin:6px 0 0">Client team · 3 Oct</p>');
    expect(html).toContain('<b>Decline note</b> <span class="chip c-mute">No category</span><p style="margin:6px 0 0;white-space:pre-wrap">Not enough CRM depth.</p><p class="xs muted" style="margin:6px 0 0">You · 5 Oct</p>');
    expect(html.indexOf("Interview feedback")).toBeLessThan(html.indexOf("Decline note"));     // oldest first, as 2h adds them
    expect(renderToStaticMarkup(<History ws={{ ...wsWith(all), notes: null }} sub={sub()} memberId="m-me" />)).toContain("Notes are not available on this database yet.");
  });
  it("history wording for decisions", () => {
    expect(historyText({ version: 3, date: "2026-10-03", actor: "Client team", kind: "feedback", toStage: "Interview" }, "Jo")).toBe("Client team shared interview feedback");
    expect(historyText({ version: 4, date: "2026-10-04", actor: "You", kind: "decline", toStage: "Declined" }, "Jo")).toBe("You declined Jo");
  });
  it("declines read as declines", () => {
    expect(historyText({ version: 2, date: "2026-10-02", actor: "Client team", kind: "stage_move", toStage: "Declined" }, "Jo")).toBe("Client team declined Jo");
  });
  it("the candidate page has the reviewed tabs; the other tabs say they are not connected", () => {
    const h = page("c-s1");
    expect(h).toContain('role="tablist"');
    expect([...h.matchAll(/data-tab="(\w+)"/g)].map((m) => m[1])).toEqual(["summary", "interview", "resume", "notes"]);
    expect(h).toContain("The summary, why Revenue Optics shared this candidate, requirement evidence");
  });
});

describe("states", () => {
  it("loading, error with retry, and Hiring progress not connected without milestone 4", () => {
    expect(page("candidates", { status: "loading", key: "u1:c1" })).toContain("Loading workspace data…");
    const e = page("roles", { status: "error", key: "u1:c1" });
    expect(e).toContain('role="alert"');
    expect(e).toContain(">Try again</button>");
    expect(e).not.toContain("Warehouse Lead");
    expect(page("progress")).toContain("Hiring progress is not connected yet: it needs interview and offer records (milestone 4) on this database.");
  });
  it("the shell shows data only for the account it was loaded for", () => {
    const auth = (userId: string, clientId: string): AuthState => ({ status: "ready", user: { id: userId, email: "x@example.com" }, member: { id: "m", clientId, displayName: "Pat Example", jobTitle: "" }, client: { id: clientId, name: `Client ${clientId}` } });
    const shell = (a: AuthState, s: WorkspaceState) => renderToStaticMarkup(<AuthView state={a} route="candidates" actions={{ signIn() {}, signOut() {}, retry() {} }} workspace={{ state: s, retry() {}, today: "2026-10-12" }} />);
    expect(shell(auth("u1", "c1"), ready)).toContain("Jo Doe");
    expect(shell(auth("u1", "c1"), ready)).toContain("2 roles with Revenue Optics");
    const other = shell(auth("u2", "c2"), ready);           // the data is for u1:c1
    expect(other).not.toContain("Jo Doe");
    expect(other).toContain("Loading workspace data…");
  });
});

describe('Help and support route',()=>{
  it('uses only the loaded workspace recruiter details',()=>{
    const h=page('help');
    expect(h).toContain('<h1>Help and support</h1>');
    expect(h).toContain('Alex Kim');expect(h).toContain('Warehouse Lead');
    expect(h).not.toContain(CLIENT.name);expect(h).not.toContain('Jamie Scott');
    expect(h).toContain('id="cMsg"');
  });
  it('keeps static help available without substituting demo contacts when data is unavailable',()=>{
    const h=page('help',{status:'loading',key:'u1:c1'});
    expect(h).toContain('Help and support');expect(h).toContain('Recruiter details are not available in this workspace.');expect(h).not.toContain('Alex Kim');
  });
});
