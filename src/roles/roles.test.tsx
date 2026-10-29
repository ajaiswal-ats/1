/* Roles and role pages: counts from the shared dataset (before and after saved demo actions, replayed as after a reload),
   candidate links per submission, on-hold treatment and empty states. Compared with 2h pixel for pixel by compare:roles. */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { DataProvider, DEMO_KEY } from "../data/DataProvider";
import { FIXTURE, TODAY, type Dataset } from "../data/fixtures";
import { replay, type DemoAction } from "../domain/actions";
import { roleSummary } from "../domain/candidates";
import { openCandidatesFor } from "../lib/candidatesUi";
import { RolePage } from "./RolePage";
import { Roles } from "./Roles";

function withStorage(items: Record<string, unknown>) {
  const m = new Map(Object.entries(items).map(([k, v]) => [k, JSON.stringify(v)]));
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v) };
  return m;
}
afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage; });

const ACTIONS: DemoAction[] = [
  { type: "decline", sid: "tb-isl", text: "Needs CRM reporting from day one.", cat: "No category", d: TODAY },
  { type: "feedback", sid: "tb-rsm", about: "Interview on 6 Oct", text: "Regional scope is the open question.", d: TODAY },
  { type: "move", sid: "pr-isl", to: "Interview", note: "", d: TODAY },
  { type: "move", sid: "en-pa", to: "Offer", note: "", d: TODAY },
  { type: "move", sid: "je-isl", to: "To review", note: "", d: TODAY },
];
const summary = (d: Dataset) => Object.fromEntries(d.roles.map((r) => { const x = roleSummary(d, r, TODAY); return [r.id, [x.subs.length, x.byStage, x.waiting, `${x.shared7} shared · ${x.moved7} moved`]]; }));
const html = (el: React.ReactElement) => renderToStaticMarkup(<DataProvider>{el}</DataProvider>);
const count = (s: string, sub: string) => s.split(sub).length - 1;

describe("role counts", () => {
  it("seed data: shared, stages (To review, Interview, Offer, Hired, Declined), waiting on you, last 7 days", () => {
    expect(summary(FIXTURE)).toEqual({
      isl: [4, [2, 1, 0, 0, 1], 2, "2 shared · 0 moved"],
      pa: [3, [1, 1, 0, 0, 1], 1, "1 shared · 1 moved"],
      fsr: [1, [1, 0, 0, 0, 0], 1, "1 shared · 0 moved"],
      rsm: [4, [0, 2, 1, 1, 0], 1, "0 shared · 0 moved"],
    });
  });
  it("after saved actions: the declines, moves and feedback show up on the right roles only", () => {
    expect(summary(replay(FIXTURE, ACTIONS).data)).toEqual({
      isl: [4, [1, 1, 0, 0, 2], 0, "2 shared · 3 moved"],
      pa: [3, [0, 1, 1, 0, 1], 0, "1 shared · 2 moved"],
      fsr: [1, [1, 0, 0, 0, 0], 1, "1 shared · 0 moved"],
      rsm: [4, [0, 2, 1, 1, 0], 0, "0 shared · 0 moved"],
    });
  });
});

describe("Roles page", () => {
  it("lists every role with its status and links to its page", () => {
    const h = html(<Roles />);
    expect(count(h, 'class="rv-name"')).toBe(4);
    for (const id of ["isl", "pa", "fsr", "rsm"]) expect(h).toContain(`href="#role-${id}"`);
    expect(h).toContain('<span class="rv-chip rv-wait"><i></i>On hold</span>');
  });
  it("after a reload with saved actions, the table shows the changed counts", () => {
    withStorage({ [DEMO_KEY]: ACTIONS });
    const h = html(<Roles />);
    expect(h).toContain("2 shared · 3 moved");
    expect(h).not.toContain('<span class="chip c-warn">2</span>');
  });
});

describe("role page", () => {
  it("open role: no hold banner, six stage tiles, Role column left out of its candidate list", () => {
    const h = html(<RolePage id="isl" />);
    expect(h).not.toContain("banner warn");
    expect(count(h, 'class="rv-stage"') + count(h, 'class="rv-stage rv-total"')).toBe(6);
    expect(h).not.toContain("<th>Role</th>");
    expect(count(h, "<tr>")).toBe(4);
  });
  it("on-hold role: hold note banner and On hold chip; its candidates stay listed", () => {
    const h = html(<RolePage id="rsm" />);
    expect(h).toContain('<div class="rv-banner">On hold since 8 Oct 2026.');
    expect(h).toContain("On hold</span>");
    expect(count(h, "<tr>")).toBe(5);
  });
  it("the same person links to the submission for this role", () => {
    expect(html(<RolePage id="isl" />)).toContain('href="#c-tb-isl"');
    expect(html(<RolePage id="isl" />)).toContain('href="#c-tb-rsm"'); // Also for preserves the other submission link
    expect(html(<RolePage id="rsm" />)).toContain('href="#c-tb-rsm"');
  });
  it("candidates waiting on you come first", () => {
    const h = html(<RolePage id="isl" />), at = (id: string) => h.indexOf(`href="#c-${id}"`);
    expect(Math.max(at("tb-isl"), at("pr-isl"))).toBeLessThan(at("je-isl"));
  });
  it("after a reload with saved actions, the role page shows the declined candidate and updated tiles", () => {
    withStorage({ [DEMO_KEY]: ACTIONS });
    const h = html(<RolePage id="isl" />);
    expect(h).toMatch(/<b>2<\/b><span>Declined<\/span>/);
    expect(h).toContain("2 declined hidden");
  });
  it("unknown role: 'Role not found.'", () => {
    expect(html(<RolePage id="nope" />)).toBe("<p>Role not found.</p>");
  });
});

describe("links into Candidates", () => {
  it("open Candidates on the role with All candidates, keeping the chosen view", () => {
    const m = withStorage({ "ro-portal-candidates": { view: "list", role: "all", filter: "you", showDeclined: true } });
    openCandidatesFor("rsm");
    expect(JSON.parse(m.get("ro-portal-candidates")!)).toEqual({ view: "list", role: "rsm", filter: "all", showDeclined: true });
  });
});
