/* Candidates page views and empty states, rendered to HTML. The populated page is compared with 2h pixel for pixel
   by scripts/compare-candidates.mjs. */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { DataProvider } from "../data/DataProvider";
import { FIXTURE, type Dataset } from "../data/fixtures";
import { CandidatePage } from "./CandidatePage";
import { Candidates } from "./Candidates";
import { CandidateTable } from "./CandidateTable";

/* A minimal in-memory localStorage, so remembered controls can be set for a render. */
function withStorage(items: Record<string, unknown>) {
  const m = new Map(Object.entries(items).map(([k, v]) => [k, JSON.stringify(v)]));
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v) };
}
afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage; });

const page = (data: Dataset = FIXTURE) => renderToStaticMarkup(<DataProvider data={data}><Candidates /></DataProvider>);
const count = (s: string, sub: string) => s.split(sub).length - 1;
const empty: Dataset = { ...FIXTURE, subs: [], moves: [], search: [], held: [] };

describe("Candidates page", () => {
  it("defaults to Pipeline: 4 stage columns with 10 cards, declined hidden consistently", () => {
    const h = page();
    expect(h).toContain("12 submissions · 11 people · 4 roles");
    expect(count(h, 'class="x-col"')).toBe(4);
    expect(count(h, 'class="x-card"')).toBe(10);
    expect(h).toContain("2 declined hidden");
    expect(h).toContain('Waiting on you <span class="x-n">5</span>');
    expect(h).toContain("Role on hold");
  });
  it("List view uses the same declined exclusion as the board", () => {
    withStorage({ "ro-portal-candidates": { view: "list" } });
    expect(count(page(), '<td class="x-first">')).toBe(10);
  });
  it("one role: lede names the role and cards drop the role line", () => {
    withStorage({ "ro-portal-candidates": { role: "rsm" } });
    const h = page();
    expect(h).toContain("Role: Regional Sales Manager");
    expect(count(h, 'class="x-card"')).toBe(4);
    expect(count(h, 'class="x-rl"')).toBe(0);
  });
  it("remembered values that are no longer valid fall back to the defaults", () => {
    withStorage({ "ro-portal-candidates": { role: "gone", filter: "iv" } });
    expect(page()).toContain("12 submissions · 11 people · 4 roles");
  });
});

describe("empty states", () => {
  it("no submissions: honest workspace empty state", () => {
    const h = page(empty);
    expect(h).toContain("0 submissions · 0 people · 4 roles");
    expect(h).toContain("No candidates have been shared yet.");
  });
  it("Waiting on you keeps empty stage columns", () => {
    withStorage({ "ro-portal-candidates": { filter: "you" } });
    expect(count(page(), "None in this view")).toBe(2);
  });
  it("List with nothing to show says 'No candidates match this filter.'", () => {
    const h = renderToStaticMarkup(<DataProvider><CandidateTable list={[]} /></DataProvider>);
    expect(h.toLowerCase()).toContain('<td colspan="7" class="muted">no candidates match this filter.</td>');
  });
});

describe("candidate route", () => {
  const html = (id: string) => renderToStaticMarkup(<DataProvider><CandidatePage id={id} /></DataProvider>);
  it("a known submission opens its page on the Summary tab with its own actions", () => {
    const h = html("tb-isl");
    expect(h).toContain('<h1 tabindex="-1">Taylor Brooks</h1>');
    expect(h).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Summary<\/button>/);
    expect(h).toContain("Move to Interview");
  });
  it("an unknown id says so, as 2h does", () => {
    expect(html("nope")).toContain("Candidate not found.");
  });
});


describe("Candidates metadata retains source facts", () => {
  it("does not turn the legacy feedback date into a client-interview held date", () => {
    withStorage({ "ro-portal-candidates": { view: "list" } });
    const h=page(), grace=h.match(/<tr>[\s\S]*?<\/tr>/g)?.find(row=>row.includes('>Grace Liu</a>'));
    expect(grace).toBeDefined();
    const interview=grace!.match(/data-label="Client interview"[^>]*>([\s\S]*?)<\/td>/)?.[1].replace(/<[^>]*>/g, "");
    expect(interview).toBe("Held · feedback given");
    expect(grace).toContain('data-label="Shared" class="x-num x-sm"><span class="x-nwg"><span class="x-nw">10 Sep</span>');
  });
});
