/* Best-effort blinding of extracted page texts (pure). It produces a separate, derived text; the source extraction is never
   changed. It removes supplied name variants, email addresses, phone numbers, links, street addresses, postcodes and school
   or institution names, and keeps qualification wording (for example "B.S. in Marketing" survives when the school is
   removed). It is NOT guaranteed anonymisation: rules miss identifiers they do not know (an unsupplied nickname, a name in
   an unusual format, identifying details in free text), and they can remove useful text (a supplied name that is also a
   company or place name). Every replacement is recorded, and a residual review report lists what a person should check.
   The report contains document text, so it stays private with the other derived files. */

export const BLINDING_METHOD = { name: "rule-based best-effort blinding", version: "2" } as const;

export interface BlindingOptions {
  /** Name variants to remove: full names, first and last names, nicknames, initials as written. */
  names: string[];
  /** School or institution names to remove (in addition to the generic institution pattern). */
  schools?: string[];
  /** Any other exact terms to remove. */
  extraTerms?: string[];
}
export type Category = "name" | "email" | "phone" | "link" | "address" | "postcode" | "school" | "term";
export interface Replacement { page: number; category: Category; start: number; end: number }
export interface ResidualItem { page: number; kind: string; context: string }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Qualification words the institution pattern must never consume. */
const DEGREE = String.raw`(?:B\.?\s?S|B\.?\s?A|M\.?\s?S|M\.?\s?A|MBA|Ph\.?\s?D|A\.?\s?A|A\.?\s?S|Bachelor|Master|Associate|Diploma|Certificate|Degree|Doctor)\b\.?`;
const TOKEN = { name: "[NAME]", email: "[EMAIL]", phone: "[PHONE]", link: "[LINK]", address: "[ADDRESS]", postcode: "[POSTCODE]", school: "[SCHOOL]", term: "[REDACTED]" } as const;

/** The rules, in the order they are applied. Single-word name variants match case-sensitively (so "Grant" does not remove
    "grant writing"); multi-word variants, schools and terms match case-insensitively. */
function rules(o: BlindingOptions): [Category, RegExp][] {
  const words = (xs: string[] | undefined) => (xs ?? []).map((x) => x.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  const names = words(o.names), schools = words(o.schools), terms = words(o.extraTerms);
  const nameRe = (n: string) => new RegExp(`(?<![\\w-])${escape(n).replace(/\\?\s+/g, "\\s+")}(?:'s)?(?![\\w-])`, /\s/.test(n) ? "gi" : "g");
  return [
    ["email", /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g],
    ["link", /\b(?:https?:\/\/|www\.)\S+|\b(?:linkedin|github)\.com\/\S*/gi],
    /* 10-digit numbers with separators (optionally +1): years, ranges and amounts are not matched. */
    ["phone", /(?<![\w])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\w])/g],
    ["address", /\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,3}(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Boulevard|Way|Ct|Court|Pl|Place)\b\.?(?:,?\s*(?:Apt|Suite|Unit)\.?\s*\w+)?/g],
    ["postcode", /\b(?<=[A-Z]{2}\s)\d{5}(?:-\d{4})?\b/g],
    ...schools.map((s): [Category, RegExp] => ["school", new RegExp(`(?<![\\w])${escape(s).replace(/\\?\s+/g, "\\s+")}(?![\\w])`, "gi")]),
    /* Generic institutions: capitalised words ending in an institution keyword, optionally "of …". Degree wording such as
       "Bachelor of Science" has no institution keyword and is kept. */
    /* Words are joined by spaces or tabs only, never line breaks, so a degree or field of study on the line above an
       institution is not consumed. */
    ["school", new RegExp(`(?<![\\w.])(?:(?!${DEGREE})[A-Z][\\w&.'-]*[ \\t]+){0,4}(?:University|College|Institute|Academy|Polytechnic|School)\\b(?:[ \\t]+of[ \\t]+(?:[A-Z][\\w&.'-]*)(?:[ \\t]+[A-Z][\\w&.'-]*){0,3})?`, "g")],
    ...names.map((n): [Category, RegExp] => ["name", nameRe(n)]),
    ...terms.map((t): [Category, RegExp] => ["term", new RegExp(`(?<![\\w])${escape(t)}(?![\\w])`, "gi")]),
  ];
}

/** Blinds one page. Positions refer to the source page text. */
function blindPage(text: string, page: number, o: BlindingOptions) {
  const hits: Replacement[] = [];
  for (const [category, re] of rules(o)) for (const m of text.matchAll(re)) {
    const start = m.index!, end = start + m[0].length;
    if (!m[0].trim() || hits.some((h) => start < h.end && end > h.start)) continue; // earlier rules win overlaps
    hits.push({ page, category, start, end });
  }
  hits.sort((a, b) => a.start - b.start);
  let out = "", at = 0;
  for (const h of hits) { out += text.slice(at, h.start) + TOKEN[h.category]; at = h.end; }
  return { text: out + text.slice(at), hits };
}

/** Words suggesting a protected characteristic or an irrelevant personal detail (religion, military or veteran status,
    disability, pregnancy, sexuality, family status). Flagged for review so they are not scored; never removed silently. */
const PERSONAL = /\b(?:Christian|Catholic|Church|Jewish|Muslim|Islamic|Hindu|Buddhist|Mormon|Faith|Ministr(?:y|ies)|Veterans?'?|Navy|Army|Marine Corps|Air Force|National Guard|Military|Disabilit(?:y|ies)|Pregnan\w*|LGBTQ\+?|my family|married|spouse|wife|husband|children|kids)\b/gi;
/** A line naming a qualification or an institution. */
const QUALIFICATION_LINE = new RegExp(`${DEGREE}|\\[SCHOOL\\]|\\b(?:University|College|Institute|Academy|School)\\b|\\bGPA\\b`);
const JOB_WORDS = /\b(?:Inc|LLC|Ltd|Corp|Corporation|Company|Co|Group|Enterprises|Industries|Systems|Services|Sales|Partners|Distribution|Territory|County|State)\b/;

/** Blinds every page, and builds the residual review: things a person should check (missed identifiers, and replacements
    that may have removed job-relevant text). */
export function blindPages(pages: string[], o: BlindingOptions) {
  const results = pages.map((t, i) => blindPage(t, i + 1, o));
  const replacements = results.flatMap((r) => r.hits);
  const residual: ResidualItem[] = [];
  const ctx = (t: string, s: number, e: number) => t.slice(Math.max(0, s - 30), Math.min(t.length, e + 30)).replace(/\s+/g, " ");
  results.forEach((r, i) => {
    const page = i + 1, out = r.text, src = pages[i];
    /* Case variants of single-word names that the case-sensitive rule left in place. */
    for (const n of o.names.filter((x) => x.trim() && !/\s/.test(x.trim()))) for (const m of out.matchAll(new RegExp(`(?<![\\w])${escape(n.trim())}(?![\\w])`, "gi"))) residual.push({ page, kind: "possible name (different case)", context: ctx(out, m.index!, m.index! + m[0].length) });
    for (const m of out.matchAll(/@|\b\d{3}[\s.-]?\d{4}\b|\b(?:https?|www)\b/gi)) residual.push({ page, kind: "possible contact detail", context: ctx(out, m.index!, m.index! + m[0].length) });
    /* Capitalised words or an initial directly before or after a removed name: another part of the same name (a first
       name or nickname that was not supplied) may remain. */
    for (const m of out.matchAll(/(?:\b[A-Z][a-z]*\.?[ \t]+){1,3}\[NAME\]|\[NAME\](?:[ \t]+[A-Z][a-z]*\.?\b){1,2}/g)) residual.push({ page, kind: "possible name part next to a removed name", context: ctx(out, m.index!, m.index! + m[0].length) });
    /* Capitalised word pairs at the top of the first page: where a name or address usually is. */
    if (page === 1) for (const line of out.split("\n").slice(0, 4)) if (/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(line) && !/\[NAME\]/.test(line)) residual.push({ page, kind: "page-1 header: check for a name", context: line.trim().slice(0, 80) });
    /* Personal details that must not be scored, and graduation years (an age proxy) on qualification lines. */
    for (const m of out.matchAll(PERSONAL)) residual.push({ page, kind: "possible protected-characteristic or personal detail (do not score)", context: ctx(out, m.index!, m.index! + m[0].length) });
    for (const line of out.split("\n")) if (QUALIFICATION_LINE.test(line) && /\b(?:19|20)\d{2}\b/.test(line)) residual.push({ page, kind: "possible age proxy (graduation year)", context: line.trim().slice(0, 100) });
    /* Replacements next to organisation or place words may have removed job-relevant text. */
    for (const h of r.hits.filter((x) => x.category === "name" || x.category === "term")) {
      const around = src.slice(Math.max(0, h.start - 25), Math.min(src.length, h.end + 25));
      if (JOB_WORDS.test(around)) residual.push({ page, kind: "replacement may have removed job-relevant text", context: ctx(src, h.start, h.end) });
    }
  });
  const counts = replacements.reduce((c, r) => ({ ...c, [r.category]: (c[r.category] ?? 0) + 1 }), {} as Partial<Record<Category, number>>);
  return { pages: results.map((r) => r.text), replacements, counts, residual };
}
