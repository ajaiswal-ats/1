/* Extraction checks (src/scoring/extraction.ts) on synthetic page data: problem flags, quote locations, comparison and
   human verification status. The macOS extraction itself is tested in scripts/extract/extract.test.mjs. */
import { describe, expect, it } from "vitest";
import { compareExtractions, locateQuote, pageFlags, pagesToText, parsePages, verificationStatus, type ToolPage } from "./extraction";

const page = (text: string, over: Partial<ToolPage> = {}): ToolPage => ({ page: 1, text, images: 0, lineStarts: [72, 72, 72], width: 612, ...over });
const LONG = "This synthetic page has plenty of ordinary text for the sparse threshold.";

describe("page flags", () => {
  it.each([
    ["an empty page", page(""), /^empty/],
    ["an image-only page", page("", { images: 1 }), /^image-only/],
    ["a sparse page", page("Short."), /^sparse/],
    ["a page with text and images", page(LONG, { images: 2 }), /contains images/],
    ["replacement characters", page(`${LONG} �`), /suspicious characters/],
    ["hyphenated line breaks", page(`${LONG} manage-\nment`), /hyphenated line breaks/],
    ["ligature characters", page(`${LONG} eﬃcient`), /ligature characters/],
    ["two columns", page(LONG, { lineStarts: [72, 72, 72, 330, 330, 330] }), /multiple columns/],
  ])("flags %s", (_, p, re) => expect(pageFlags(p).join(" | ")).toMatch(re));
  it("does not flag an ordinary page, or a single indented line, as a problem", () => {
    expect(pageFlags(page(LONG))).toEqual([]);
    expect(pageFlags(page(LONG, { lineStarts: [72, 72, 72, 330] }))).toEqual([]);
  });
});

describe("page-marked text", () => {
  it("round-trips page texts exactly, including empty pages", () => {
    const pages = ["first\nline", "", "third"];
    expect(parsePages(pagesToText(pages))).toEqual(pages);
  });
});

describe("quote locations", () => {
  const pages = ["Opened 12 new\naccounts in 2024. Also opened accounts.", "Managed 30 key accounts. Managed 30 key accounts.", "eﬃcient work, manage-\nment"];
  it("finds a quote across a line break, with offsets in the raw page text", () => {
    const r = locateQuote(pages, "Opened 12 new accounts", 1);
    expect(r).toEqual({ status: "found", page: 1, start: 0, end: 22 });
    if (r.status === "found") expect(pages[0].slice(r.start, r.end)).toBe("Opened 12 new\naccounts");
  });
  it("gives no offsets when the quote occurs more than once on its page", () => {
    expect(locateQuote(pages, "Managed 30 key accounts.", 2)).toEqual({ status: "found-multiple", page: 2, count: 2 });
  });
  it("reports a quote that is only on other pages, or nowhere", () => {
    expect(locateQuote(pages, "Managed 30 key", 1)).toEqual({ status: "found-on-other-pages", pages: [2] });
    expect(locateQuote(pages, "Never written", 1)).toEqual({ status: "not-found" });
  });
  it("rejects empty quotes and pages outside the document", () => {
    expect(locateQuote(pages, "   ", 1)).toEqual({ status: "invalid", reason: "empty quote" });
    expect(locateQuote(pages, "x", 4)).toEqual({ status: "invalid", reason: "page 4 is outside 1–3" });
  });
  it("normalises whitespace only: ligatures, case and hyphenation must match", () => {
    expect(locateQuote(pages, "efficient work", 3)).toEqual({ status: "not-found", nearMatch: ["compatibility-characters"] });
    expect(locateQuote(pages, "eﬃcient work", 3).status).toBe("found");
    expect(locateQuote(pages, "management", 3)).toEqual({ status: "not-found", nearMatch: ["hyphenation"] });
    expect(locateQuote(pages, "manage- ment", 3).status).toBe("found");
    expect(locateQuote(pages, "OPENED 12 NEW", 1).status).toBe("not-found");
  });
});

describe("comparison", () => {
  const oldPages = ["Opened 12 new accounts in 2024.", "Managed 30 key accounts with quarterly visits.", "B.S. in Synthetic Studies."];
  const newPages = ["Opened 12 new\naccounts in 2024.", "Managed 25 key accounts with monthly visits."];
  const quotes = [{ id: "q1", quote: "Opened 12 new accounts", page: 1 }, { id: "q2", quote: "Managed 30 key accounts", page: 2 }, { id: "q3", quote: "B.S. in Synthetic Studies", page: 3 }];
  const c = compareExtractions(oldPages, newPages, quotes);
  it("reports each page as unchanged, whitespace-only, changed, missing or added", () => {
    expect(c.pages).toEqual([{ page: 1, status: "whitespace-only" }, { page: 2, status: "changed", wordsRemoved: 2, wordsAdded: 2, similarity: 0.714 }, { page: 3, status: "missing-in-new" }]);
    expect(compareExtractions(["a"], ["a", "b"]).pages).toEqual([{ page: 1, status: "unchanged" }, { page: 2, status: "added-in-new" }]);
  });
  it("reports quotes no longer found, and what needs a reviewer's attention", () => {
    expect(c.quotes.map((q) => [q.id, q.before, q.after.status])).toEqual([["q1", "found", "found"], ["q2", "found", "not-found"], ["q3", "found", "invalid"]]);
    expect(c.attention).toEqual(["page 2: changed", "page 3: missing-in-new", "q2: no longer found on its page", "q3: no longer found on its page"]);
    expect(c.safeToAdoptWithoutQuoteChanges).toBe(false);
  });
  it("changes nothing it is given", () => {
    const a = [...oldPages], b = [...newPages], q = JSON.stringify(quotes);
    compareExtractions(a, b, quotes);
    expect([a, b, JSON.stringify(quotes)]).toEqual([oldPages, newPages, q]);
  });
});

describe("human verification status", () => {
  const ext = { extractionId: "ext-1", pageCount: 3 };
  const rec = (pages: number[] | "all", result: "matches" | "differences found" = "matches") => ({ extractionId: "ext-1", reviewer: "Synthetic reviewer", reviewedOn: "2026-01-10", scope: { pages, method: "read side by side" }, result, notes: "" });
  it("is never set without a human record", () => expect(verificationStatus(ext, []).status).toBe("not checked against PDF"));
  it("counts only the pages a reviewer covered", () => {
    expect(verificationStatus(ext, [rec([1, 2])]).status).toBe("partly checked against PDF");
    expect(verificationStatus(ext, [rec([1, 2]), rec([3])]).status).toBe("checked against PDF");
    expect(verificationStatus(ext, [rec("all")]).status).toBe("checked against PDF");
  });
  it("reports differences found, and ignores records for other extractions or without a reviewer", () => {
    expect(verificationStatus(ext, [rec("all"), rec([2], "differences found")]).status).toBe("differences found by a reviewer");
    expect(verificationStatus(ext, [{ ...rec("all"), extractionId: "ext-2" }, { ...rec("all"), reviewer: " " }]).status).toBe("not checked against PDF");
  });
});
