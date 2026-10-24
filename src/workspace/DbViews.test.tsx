/* Supabase-mode Roles and Candidates pages: database values only, "not connected" where the database has nothing,
   no actions, loading / empty / error states, and data shown only for the account it belongs to. */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthView } from "../auth/AuthViews";
import type { AuthState } from "../auth/session";
import { CLIENT, CURRENT_USER, FIXTURE } from "../data/fixtures";
import type { Workspace } from "./data";
import { WorkspacePage } from "./DbViews";
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
};
const ready: WorkspaceState = { status: "ready", key: "u1:c1", ws: WS };
const page = (route: string, state: WorkspaceState = ready) => renderToStaticMarkup(<WorkspacePage route={route} state={state} onRetry={() => {}} today="2026-10-12" />);
const DEMO = [CLIENT.note, CURRENT_USER.name, ...FIXTURE.subs.map((s) => s.name), ...FIXTURE.roles.map((r) => r.title)];
const ROUTES = ["candidates", "roles", "progress", "c-s1", "role-r1", "c-unknown", "role-unknown"];

describe("Roles (database)", () => {
  it("lists each role with status, shared, stage counts and last 7 days; Waiting on you is not connected", () => {
    const h = page("roles");
    expect(h).toContain('href="#role-r1">Warehouse Lead</a><div class="xs muted">Reno, NV</div>');
    expect(h).toContain('href="#role-r2">Buyer</a></td>');                   // no location: nothing invented
    expect(h).toContain('<span class="chip c-warn"><i class="d"></i>On hold</span>');
    expect(h).toContain("2 shared · 1 moved");
    expect(h).toContain("&quot;Waiting on you&quot; is not connected yet.");
    expect(h).toContain('title="Not connected yet">—</span>');
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
    expect(h).toContain('<div class="nm">Jo Doe</div><div class="hd">Ops · Example Co</div><div class="rl">Warehouse Lead</div><div class="also2">Same person · also for Buyer</div>');
    expect(h).not.toContain("nextbar");
    expect(h).not.toContain("must-haves");
    expect(h).toContain("Show declined (1)");
    expect(h).toMatch(/disabled="" aria-disabled="true" title="Not connected yet">Waiting on you/);
    expect(h).toContain("Next steps, requirement evidence and interviews are not connected yet.");
  });
  it("a candidate page shows database fields; decline and feedback are disabled", () => {
    const h = page("c-s1");
    expect(h).toContain("<h1>Jo Doe</h1>");
    expect(h).toContain("for <a href=\"#role-r1\">Warehouse Lead</a>");
    expect(h).toContain("<span>Shared 8 Oct</span>");
    expect(h).toMatch(/<button type="button" class="btn btn-d btn-off" disabled="" title="Not available yet">Decline<\/button>/);
    expect(h).toMatch(/disabled="" title="Not available yet">Share interview feedback<\/button>/);
    expect(h).toContain("Manatal is not updated");
    expect(page("c-unknown")).toContain("Candidate not found.");
  });
  it("stage choices follow the provisional rule: open role, not from Offer/Hired/Declined, Offer and Hired marked provisional", () => {
    const h = page("c-s1");                                     // Interview, open role
    expect(h).toContain('<option value="To review" selected="">To review</option><option value="Offer">Offer (provisional)</option><option value="Hired">Hired (provisional)</option>');
    expect(page("c-s2")).toContain("This role is on hold, so stage changes are paused.");
    expect(page("c-s3")).toContain("Stage changes from Declined are not available in this version.");
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

describe("states", () => {
  it("loading, error with retry, and Hiring progress not connected", () => {
    expect(page("candidates", { status: "loading", key: "u1:c1" })).toContain("Loading workspace data…");
    const e = page("roles", { status: "error", key: "u1:c1" });
    expect(e).toContain('role="alert"');
    expect(e).toContain(">Try again</button>");
    expect(e).not.toContain("Warehouse Lead");
    expect(page("progress")).toContain("Hiring progress is not connected yet.");
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
