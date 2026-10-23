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
  it("defaults to Pipeline: 4 stage columns with 10 cards, declined hidden behind 'Show declined (2)'", () => {
    const h = page();
    expect(h).toContain("12 submissions · 11 people · 4 roles");
    expect(count(h, 'class="col"')).toBe(4);
    expect(count(h, 'class="ccard ')).toBe(10);
    expect(h).toContain("Show declined (2)");
    expect(h).toContain('Waiting on you <span class="ct">5</span>');
    expect(h).toContain("Regional Sales Manager (on hold)</option>");
  });
  it("List view shows all 12 rows, declined included", () => {
    withStorage({ "ro-portal-candidates": { view: "list" } });
    expect(count(page(), "<tr class=")).toBe(12);
  });
  it("one role: lede names the role and cards drop the role line", () => {
    withStorage({ "ro-portal-candidates": { role: "rsm" } });
    const h = page();
    expect(h).toContain("4 submissions · 4 people · Regional Sales Manager");
    expect(count(h, 'class="rl"')).toBe(0);
  });
  it("remembered values that are no longer valid fall back to the defaults", () => {
    withStorage({ "ro-portal-candidates": { role: "gone", filter: "iv" } });
    expect(page()).toContain("12 submissions · 11 people · 4 roles");
  });
});

describe("empty states", () => {
  it("no submissions: every column says 'No candidates here'", () => {
    const h = page(empty);
    expect(h).toContain("0 submissions · 0 people · 4 roles");
    expect(count(h, '<div class="col-empty">No candidates here</div>')).toBe(4);
  });
  it("Waiting on you with empty columns says 'for this filter'", () => {
    withStorage({ "ro-portal-candidates": { filter: "you" } });
    expect(count(page(), "No candidates here for this filter")).toBe(2);
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
    expect(h).toContain("<h1>Taylor Brooks</h1>");
    expect(h).toContain('aria-selected="true">Summary</button>');
    expect(h).toContain("Move to Interview");
  });
  it("an unknown id says so, as 2h does", () => {
    expect(html("nope")).toContain("Candidate not found.");
  });
});
