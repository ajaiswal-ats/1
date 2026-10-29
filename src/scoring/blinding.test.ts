/* Best-effort blinding (src/scoring/blinding.ts) with synthetic sentinel identities: what it removes, what it keeps, and
   the limits a person must review (missed variants, accidental removal of job-relevant text). */
import { describe, expect, it } from "vitest";
import { blindPages } from "./blinding";

const NAME = { full: "Zqxvname Sentinelperson", first: "Zqxvname", last: "Sentinelperson", nick: "Zqx" };
const page1 = [
  `${NAME.full}`,
  "Lives at 42 Maple Grove Road, Billtown, MT 59102 · zq.sentinel@example.invalid · (406) 555-0199 · linkedin.com/in/zq-sentinel · https://zq.example.invalid/cv",
  `Summary: ${NAME.first} led field sales 2019–2022, grew revenue $4.5M (+12%) and ran 40+ demos for Lee Enterprises.`,
  `${NAME.last}'s team won 18 accounts. GRANT writing is not a name here, nor is grant.`,
].join("\n");
const page2 = [
  "Education",
  "B.S. Synthetic State University",
  "Bachelor of Arts in Synthetic Studies, University of Synthetica, 2009",
  "Associate degree, Fictional Community College",
  `Nickname used once: ${NAME.nick} closed the deal.`,
].join("\n");
const opts = { names: [NAME.full, NAME.first, NAME.last, "Lee"], schools: ["Fictional Community College"] };
const out = blindPages([page1, page2], opts), [b1, b2] = out.pages;

describe("removes supplied identifiers and contact details", () => {
  it("removes the supplied name variants, including possessives", () => {
    for (const x of [NAME.full, NAME.first, NAME.last]) expect(out.pages.join("\n")).not.toContain(x);
    expect(b1).toMatch(/^\[NAME\]\n/);
    expect(b1).toContain("[NAME] team won 18 accounts");
  });
  it("removes email, phone, links, street address and postcode", () => {
    for (const x of ["zq.sentinel@example.invalid", "(406) 555-0199", "linkedin.com/in", "https://zq.example", "42 Maple Grove Road", "59102"]) expect(b1).not.toContain(x);
    for (const t of ["[EMAIL]", "[PHONE]", "[LINK]", "[ADDRESS]", "[POSTCODE]"]) expect(b1).toContain(t);
    expect(out.counts).toMatchObject({ email: 1, phone: 1, link: 2, address: 1, postcode: 1 });
  });
  it("removes school names but keeps the qualification wording", () => {
    expect(b2).toContain("B.S. [SCHOOL]");
    expect(b2).toContain("Bachelor of Arts in Synthetic Studies, [SCHOOL], 2009");
    expect(b2).toContain("Associate degree, [SCHOOL]");
    for (const x of ["Synthetic State University", "University of Synthetica", "Fictional Community College"]) expect(b2).not.toContain(x);
  });
});

describe("qualification lines next to an institution", () => {
  it("keeps the degree and field of study when the institution is on the next line", () => {
    const r = blindPages(["Education\nBachelor of Arts in Synthetic Studies\nSynthetic State University\nMaster of Science in Synthetic Analytics\nUniversity of Synthetica"], { names: [] });
    expect(r.pages[0]).toBe("Education\nBachelor of Arts in Synthetic Studies\n[SCHOOL]\nMaster of Science in Synthetic Analytics\n[SCHOOL]");
  });
  it("still removes a field-of-study word written directly before an institution on the same line (a known limit), and keeps the degree", () => {
    const r = blindPages(["B.A. Studies Synthetic State University"], { names: [] });
    expect(r.pages[0]).toBe("B.A. [SCHOOL]");
  });
});

describe("keeps job-relevant text", () => {
  it("keeps years, ranges, amounts, percentages and counts", () => {
    for (const x of ["2019–2022", "$4.5M", "(+12%)", "40+ demos", "18 accounts", ", 2009"]) expect(out.pages.join("\n")).toContain(x);
  });
  it("leaves lower-case and capitalised common words alone when only a case-sensitive single-word variant matches", () => {
    expect(b1).toContain("GRANT writing");
    expect(b1).toContain("nor is grant.");
  });
  it("never changes the source pages", () => {
    const src = [page1, page2];
    blindPages(src, opts);
    expect(src).toEqual([page1, page2]);
  });
});

describe("personal details that must not be scored are flagged for review", () => {
  const r = blindPages([[
    "Education", "Bachelor of Arts in Synthetic Studies", "Synthetic State University, Synthville, 2005",
    "Affiliations", "Board Member, Synthetic Christian Fellowship", "Member, Synthetic Veterans Association",
    "Interests: time with my family and fishing.", "Managed 30 accounts from 2016 to 2023.",
  ].join("\n")], { names: [] });
  const kinds = r.residual.map((x) => `${x.kind}: ${x.context}`).join(" | ");
  it("flags a graduation year next to a qualification or institution as a possible age proxy", () => {
    expect(kinds).toMatch(/possible age proxy \(graduation year\): \[SCHOOL\], Synthville, 2005/);
    expect(kinds).not.toMatch(/age proxy[^|]*2016 to 2023/); // employment dates are job-relevant, not flagged
  });
  it("flags religious, veteran and family-status words without removing them", () => {
    for (const w of ["Christian", "Veterans", "my family"]) expect(kinds).toMatch(new RegExp(`possible protected-characteristic or personal detail \\(do not score\\)[^|]*${w}`));
    expect(r.pages[0]).toContain("Synthetic Christian Fellowship"); // flagged, not silently removed
  });
});

describe("limits that need a person's review", () => {
  it("misses an unsupplied nickname, and says so only through the review list", () => {
    expect(b2).toContain(`${NAME.nick} closed the deal`);
  });
  it("can remove job-relevant text when a supplied name is also part of an organisation, and flags it", () => {
    expect(b1).toContain("[NAME] Enterprises");
    expect(out.residual.some((r) => r.kind === "replacement may have removed job-relevant text" && /Lee Enterprises/.test(r.context))).toBe(true);
  });
  it("flags case variants of names and leftover contact-like text for residual review", () => {
    const r = blindPages(["ZQXVNAME was here. Call 555 0100."], { names: [NAME.first] });
    expect(r.pages[0]).toContain("ZQXVNAME");
    expect(r.residual.map((x) => x.kind)).toEqual(expect.arrayContaining(["possible name (different case)", "possible contact detail"]));
  });
  it("flags capitalised words left next to a removed name (a partly blinded name)", () => {
    const r = blindPages(["Quentinus Q Zqxvlast  (555) 010-9999\nSales manager"], { names: ["Zqxvlast", "Quen"] });
    expect(r.pages[0]).toMatch(/^Quentinus Q \[NAME\]/);
    expect(r.residual.some((x) => x.kind === "possible name part next to a removed name" && /Quentinus Q \[NAME\]/.test(x.context))).toBe(true);
  });
  it("flags a capitalised header line on page 1 that was not recognised as a name", () => {
    const r = blindPages(["Quentin Unlisted\nSales manager"], { names: [] });
    expect(r.residual).toEqual([{ page: 1, kind: "page-1 header: check for a name", context: "Quentin Unlisted" }]);
  });
});
