/* Extracted documents (pure: no file system or clock). Works on the page texts produced by scripts/extract/ and checks
   them without changing anything: per-page problem flags, quote locations, and page-by-page comparison of two
   extractions. Extraction status, manual-review need and human verification are kept separate:
   - "completed" only means the extraction tool ran;
   - "manual review required" means missing, sparse or suspicious output was detected on a page;
   - "checked against PDF" needs an explicit human verification record (reviewer, date, scope); nothing here sets it
     because a tool ran or a fingerprint matched.

   Whitespace: quotes and page texts are compared after collapsing every run of whitespace (spaces, tabs, line breaks) to
   one space. Nothing else is normalised: case, punctuation, hyphenation at line ends and ligature characters (for example
   "ﬁ" versus "fi") must match. Finding a quote confirms the text is present on that page; it does not confirm what it
   means, or that the extraction is faithful to the PDF. */

export const PAGE_MARKER = (n: number, of: number) => `=== PAGE ${n} of ${of} ===`;
export const EXTRACTION_OPTIONS = { textSource: "PDFPage.string", sparseMinChars: 40, columnGapRatio: 0.25, minLinesPerColumn: 2 } as const;

export const normaliseSpace = (s: string) => s.replace(/\s+/g, " ").trim();

/** Page texts in the page-marked format the run inputs use. */
export const pagesToText = (pages: string[]) => pages.map((t, i) => `${PAGE_MARKER(i + 1, pages.length)}\n${t}\n`).join("");
/** The raw page texts of a page-marked file (in page order; a file with no markers has no pages). */
export const parsePages = (text: string) => text.split(/^=== PAGE \d+ of \d+ ===\n?/m).slice(1).map((p) => p.replace(/\n$/, ""));

export interface ToolPage { page: number; text: string; images: number; lineStarts: number[]; width: number }

/** Problems on one page, as plain labels (never the page text). */
export function pageFlags(p: ToolPage, opts = EXTRACTION_OPTIONS): string[] {
  const chars = p.text.replace(/\s/g, "").length, f: string[] = [];
  if (chars === 0 && p.images > 0) f.push("image-only: no text layer (text inside images is not extracted; no OCR in this version)");
  else if (chars === 0) f.push("empty: no text found");
  else if (chars < opts.sparseMinChars) f.push("sparse: very little text");
  if (chars > 0 && p.images > 0) f.push("contains images: any text inside them is not extracted");
  if (/�|[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(p.text)) f.push("suspicious characters: replacement or control characters in the text");
  if (/\w-\n\w/.test(p.text)) f.push("hyphenated line breaks: quotes across them may not match");
  if (/[ﬀ-ﬆ]/.test(p.text)) f.push("ligature characters: quotes typed without them will not match");
  /* Line starts in two or more separate horizontal bands suggest columns: the reading order needs a human check. */
  const xs = [...p.lineStarts].sort((a, b) => a - b), bands: number[][] = [];
  for (const x of xs) { const b = bands[bands.length - 1]; if (b && x - b[b.length - 1] <= p.width * opts.columnGapRatio) b.push(x); else bands.push([x]); }
  if (bands.filter((b) => b.length >= opts.minLinesPerColumn).length >= 2) f.push("multiple columns: check the reading order");
  return f;
}

/* ---- quotes ------------------------------------------------------------------------------------------------- */

export type QuoteLocation =
  | { status: "found"; page: number; start: number; end: number }
  | { status: "found-multiple"; page: number; count: number }
  | { status: "found-on-other-pages"; pages: number[] }
  /** `nearMatch`: the quote would match only after a normalisation this check does not apply (it is a review signal,
      never an automatic match): compatibility characters such as ligatures, or a word split by a line-end hyphen. */
  | { status: "not-found"; nearMatch?: ("compatibility-characters" | "hyphenation")[] }
  | { status: "invalid"; reason: string };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const matcher = (quote: string) => new RegExp(normaliseSpace(quote).split(" ").map(escape).join("\\s+"), "g");

/** Where a quote is in the raw page texts. Offsets are character positions in the raw text of that page, given only
    when the quote occurs exactly once there; otherwise they would be unreliable. Empty quotes are rejected. */
export function locateQuote(pages: string[], quote: string, page: number): QuoteLocation {
  if (typeof quote !== "string" || !normaliseSpace(quote)) return { status: "invalid", reason: "empty quote" };
  if (!Number.isInteger(page) || page < 1 || page > pages.length) return { status: "invalid", reason: `page ${page} is outside 1–${pages.length}` };
  const hits = [...pages[page - 1].matchAll(matcher(quote))];
  if (hits.length === 1) return { status: "found", page, start: hits[0].index!, end: hits[0].index! + hits[0][0].length };
  if (hits.length > 1) return { status: "found-multiple", page, count: hits.length };
  const elsewhere = pages.map((t, i) => (matcher(quote).test(t) ? i + 1 : 0)).filter(Boolean);
  if (elsewhere.length) return { status: "found-on-other-pages", pages: elsewhere };
  const page0 = normaliseSpace(pages[page - 1]), q = normaliseSpace(quote), near: ("compatibility-characters" | "hyphenation")[] = [];
  if (page0.normalize("NFKC").includes(q.normalize("NFKC"))) near.push("compatibility-characters");
  if (page0.replace(/(\p{L})- (\p{L})/gu, "$1$2").includes(q)) near.push("hyphenation");
  return near.length ? { status: "not-found", nearMatch: near } : { status: "not-found" };
}

/** A quote linked to an exact extraction and page (with offsets when reliable). */
export const quoteLink = (extractionId: string, pages: string[], quote: string, page: number) => ({ extractionId, quotePage: page, location: locateQuote(pages, quote, page) });

/* ---- comparison ------------------------------------------------------------------------------------------- */

export interface QuoteRef { id: string; quote: string; page: number }
export type PageChange =
  | { page: number; status: "unchanged" | "whitespace-only" }
  | { page: number; status: "changed"; wordsRemoved: number; wordsAdded: number; similarity: number }
  | { page: number; status: "missing-in-new" | "added-in-new" };

/** Word-level difference counts (longest common subsequence; pages are short). */
function wordDiff(a: string[], b: string[]) {
  const m = a.length, n = b.length, prev = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    let diag = 0;
    for (let j = 1; j <= n; j++) { const up = prev[j]; prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(prev[j], prev[j - 1]); diag = up; }
  }
  const common = prev[n];
  return { removed: m - common, added: n - common, similarity: m + n === 0 ? 1 : (2 * common) / (m + n) };
}

/** Compares two extractions page by page, and where each quote stands. Pure: it changes no rating, run input or client
    output; adopting a new extraction is a separate, explicit action. Reports counts and labels, never page text. */
export function compareExtractions(oldPages: string[], newPages: string[], quotes: QuoteRef[] = []) {
  const pages: PageChange[] = [];
  for (let i = 0; i < Math.max(oldPages.length, newPages.length); i++) {
    const page = i + 1, a = oldPages[i], b = newPages[i];
    if (a === undefined) pages.push({ page, status: "added-in-new" });
    else if (b === undefined) pages.push({ page, status: "missing-in-new" });
    else if (a === b) pages.push({ page, status: "unchanged" });
    else if (normaliseSpace(a) === normaliseSpace(b)) pages.push({ page, status: "whitespace-only" });
    else { const d = wordDiff(normaliseSpace(a).split(" "), normaliseSpace(b).split(" ")); pages.push({ page, status: "changed", wordsRemoved: d.removed, wordsAdded: d.added, similarity: Math.round(d.similarity * 1000) / 1000 }); }
  }
  const quoteResults = quotes.map((q) => ({ id: q.id, page: q.page, before: locateQuote(oldPages, q.quote, q.page).status, after: locateQuote(newPages, q.quote, q.page) }));
  const attention = [
    ...pages.filter((p) => p.status !== "unchanged" && p.status !== "whitespace-only").map((p) => `page ${p.page}: ${p.status}`),
    ...quoteResults.filter((q) => q.after.status !== "found").map((q) => `${q.id}: ${q.after.status === "found-on-other-pages" ? `now on page ${q.after.pages.join(", ")}` : q.after.status === "found-multiple" ? "now ambiguous on its page" : "no longer found on its page"}`),
  ];
  return { pages, quotes: quoteResults, attention, safeToAdoptWithoutQuoteChanges: quoteResults.every((q) => q.after.status === "found") };
}

/* ---- human verification ------------------------------------------------------------------------------------ */

export interface VerificationRecord { extractionId: string; reviewer: string; reviewedOn: string; scope: { pages: number[] | "all"; method: string }; result: "matches" | "differences found"; notes: string }

/** Whether an extraction has been checked against its PDF: only explicit human records count, and only for their scope. */
export function verificationStatus(extraction: { extractionId: string; pageCount: number }, records: VerificationRecord[]) {
  const mine = records.filter((r) => r.extractionId === extraction.extractionId && r.reviewer.trim() && !Number.isNaN(Date.parse(r.reviewedOn)));
  if (mine.some((r) => r.result === "differences found")) return { status: "differences found by a reviewer" as const, records: mine };
  const pages = new Set(mine.flatMap((r) => (r.scope.pages === "all" ? Array.from({ length: extraction.pageCount }, (_, i) => i + 1) : r.scope.pages)));
  if (!mine.length) return { status: "not checked against PDF" as const, records: mine };
  return { status: pages.size >= extraction.pageCount ? "checked against PDF" as const : "partly checked against PDF" as const, records: mine, pagesChecked: [...pages].sort((a, b) => a - b) };
}
