/* Regression tests for the known AI scoring errors (synthetic, fictional data; rule wording copied from the test rules).
   The server-side rule checks may only lower or withhold a proposed rating, never raise one, and must record why. */
import { describe, expect, it } from "vitest";
import { TENURE_SHORT_STATUS, TENURE_UNDATED_STATUS, applyRuleChecks, countedWinOf, customerWinOf, monthsOf, tenureRule, type AiOutput } from "./aiAssessment";
import type { ScoringConfig } from "./types";

const anchors = {
  SD1: { "0": "Explicit statement of never doing new-business selling", "1": "Prospecting or lead work described, no outcome", "2": "New customers or accounts won, described but not counted", "3": "New customers or accounts won, counted, with a period" },
  SD3: { "0": "Explicit statement that the role had no responsibility for price or margin", "1": "P1 work described without a result (for example, pricing for margin)", "2": "P1 result described, size unquantified", "3": "P1 result with numbers" },
  SD5: { "0": "Explicit statement", "1": "Updating records or reports mentioned (naming a CRM without reporting activity is Unknown; MH5 evidence only)", "2": "Regular documentation of activities, quotes or orders", "3": "As 2, plus using CRM reports for planning (pipeline or forecast)" },
  SD6: { "0": "Explicit statement", "1": "Reviewing sales reports mentioned", "2": "Analysing sales or buying patterns described", "3": "Analysis led to a described action (a resulting number counts once, in its primary criterion)" },
};
const crit = (id: keyof typeof anchors, label: string) => ({ id, label, importance: "Critical" as const, weight: 3, max: 3, included: true, anchors: anchors[id] });
const config = {
  id: "syn", version: 1, status: "Synthetic", approved: false, frozenAt: "", role: { id: "r", title: "Synthetic role", client: "", loc: "", summary: "", roleSetupVersion: "", resp: [] },
  gates: [{ id: "MH1", label: "Outside-sales tenure", testRule: "Pass when the CV describes outside or field selling duties, with dates, totalling at least 3 years (or 1 year in battery-industry outside sales) on the conservative minimum reading of the dates; overlapping jobs count once. Titles and dates alone do not count." }],
  criteria: [crit("SD1", "Winning new customers"), { ...crit("SD3", "Profitability (P1 profit or margin only; Option P)"), note: "Revenue, volume, quota and awards (P2–P4) are recorded as other sales results and earn no SD3 points." }, crit("SD5", "CRM use and reporting discipline"), crit("SD6", "Sales-data analysis")],
  constraints: [], gateExceptions: [], testChoices: [],
  policy: { referenceDate: "2026-10-27" },
} as unknown as ScoringConfig;
const pages = [
  "Synthetic Depot Rep, Invented Region Jan 2024 - July 2026\nDrove to synthetic depots across the invented region.\nBooked $7.7M of synthetic widget orders. Grew a $3.3M synthetic pipeline by cold prospecting.\nHaggled list prices with synthetic depots.",
  "Synthetic Field Rep 2015 - 2016\nVisited synthetic depots in person each week.\nUsed SynthCRM to watch the synthetic pipeline.\nForecast synthetic opportunities in SynthCRM. Opened 12 new synthetic accounts in 2025.\nLogged every synthetic call and quote in SynthCRM weekly.\nAnalysed synthetic buying patterns to change route plans.\nGeneral market analysis for the synthetic team.",
];
const q = (quote: string, page: number) => ({ quote, page });
const base = (): AiOutput => ({
  summary: "s", strengths: [], gaps: [], questions: [],
  gates: [{ id: "MH1", result: "Pass", basis: "explicit", evidenceKind: "described", explanation: "Field selling across roles adds up to more than 3 years.", evidence: [q("Drove to synthetic depots across the invented region.", 1)],
    periods: [{ from: "Jan 2024", to: "July 2026", quote: "Drove to synthetic depots across the invented region.", page: 1, batteryIndustry: false }, { from: "2015", to: "2016", quote: "Visited synthetic depots in person each week.", page: 2, batteryIndustry: false }] }],
  criteria: [
    { id: "SD1", status: "rated", rating: 2, basis: "interpretation", detail: "Full", evidenceKind: "described", evidence: [q("Booked $7.7M of synthetic widget orders.", 1), q("Grew a $3.3M synthetic pipeline by cold prospecting.", 1)], explanation: "Closings imply new buyers.", flags: [] },
    { id: "SD3", status: "rated", rating: 1, basis: "explicit", detail: "Brief", evidenceKind: "described", evidence: [q("Haggled list prices with synthetic depots.", 1)], explanation: "Price negotiation is pricing work.", flags: [] },
    { id: "SD5", status: "rated", rating: 2, basis: "explicit", detail: "Brief", evidenceKind: "described", evidence: [q("Used SynthCRM to watch the synthetic pipeline.", 2)], explanation: "Pipeline management is level-3 activity, falling back to 2 for recency.", flags: [] },
    { id: "SD6", status: "rated", rating: 2, basis: "interpretation", detail: "Brief", evidenceKind: "described", evidence: [q("Forecast synthetic opportunities in SynthCRM.", 2)], explanation: "Forecasting implies analysis of sales data.", flags: [] },
  ],
});
const run = (o: AiOutput) => applyRuleChecks(o, config, pages);
const get = (o: AiOutput, id: string) => o.criteria.find((c) => c.id === id)!;

describe("outside-sales tenure is added up by the server on the most cautious reading of the dates", () => {
  it("reads the rule's thresholds from the rule text, not from a guess", () => expect(tenureRule(config.gates[0])).toEqual({ months: 36, batteryMonths: 12 }));
  it("reads dates cautiously: a year-only start is December, a year-only end is January, Present is the reference date", () => {
    expect(monthsOf("Jan 2024", "July 2026", "2026-10-27")).toBe(30);
    expect(monthsOf("2015", "2016", "2026-10-27")).toBe(1);
    expect(monthsOf("Mar 2023", "Present", "2026-10-27")).toBe(43);
    expect(monthsOf("someday", "2016", "2026-10-27")).toBeNull();
  });
  it("dates under the requirement: not confirmed, with the AI's proposal and explanation kept and the reason recorded separately", () => {
    const o = base(), r = run(o), g = r.output.gates[0];
    expect(g.result).toBe("Unknown");
    expect(g.check).toEqual({ aiProposed: "Pass", status: TENURE_SHORT_STATUS, reason: expect.stringMatching(/about 31 months on the most cautious reading of the dates, under the 36 needed/) });
    expect(g.explanation).toBe(o.gates[0].explanation); // the AI's explanation, unchanged
    expect(r.adjustments.join(" ")).toMatch(/Outside-sales tenure: the AI proposed met; shown as "Not confirmed — the dated field-selling periods are under the required time"/);
  });
  it("dates that meet the requirement never certify field selling: not confirmed — recruiter must check field duties", () => {
    const ok = base(); ok.gates[0].periods = [{ from: "Jan 2020", to: "July 2026", quote: "Drove to synthetic depots across the invented region.", page: 1, batteryIndustry: false }];
    const r = run(ok), g = r.output.gates[0];
    expect(g.result).toBe("Unknown");
    expect(g.check).toEqual({ aiProposed: "Pass", status: "Not confirmed — recruiter must check field duties", reason: expect.stringMatching(/about 78 months .* meets the time needed\. The server cannot establish that each role involved outside or field selling/) });
    expect(g.explanation).toBe(ok.gates[0].explanation);
    expect(r.notes).toEqual([]);
  });
  it("no usable dates in the cited evidence: duration cannot be confirmed, never '0 months' or 'under the required time'", () => {
    for (const periods of [undefined, [], [{ from: "", to: "", quote: "Drove to synthetic depots across the invented region.", page: 1, batteryIndustry: false }],
      [{ from: "early career", to: "later", quote: "Drove to synthetic depots across the invented region.", page: 1, batteryIndustry: false }], [{ from: "2016", to: "2015", quote: "Visited synthetic depots in person each week.", page: 2, batteryIndustry: false }]]) {
      const o = base(); o.gates[0].periods = periods as AiOutput["gates"][0]["periods"];
      const r = run(o), g = r.output.gates[0];
      expect(g.result).toBe("Unknown"); // still not confirmed
      expect(g.check).toEqual({ aiProposed: "Pass", status: TENURE_UNDATED_STATUS, reason: expect.stringMatching(/^Field-sales duration cannot be confirmed from the cited evidence: no cited period has usable start and end dates\./) });
      expect(`${g.check!.status} ${g.check!.reason} ${r.adjustments.join(" ")}`).not.toMatch(/\b0 months|under the required time|under the \d+ needed/);
    }
  });
  it("some periods dated, some not: the dated total is given, but no shorter duration is claimed", () => {
    const o = base(); o.gates[0].periods = [{ from: "Jan 2024", to: "July 2026", quote: "Drove to synthetic depots across the invented region.", page: 1, batteryIndustry: false }, { from: "early career", to: "2016", quote: "Visited synthetic depots in person each week.", page: 2, batteryIndustry: false }];
    const g = run(o).output.gates[0];
    expect(g.check).toEqual({ aiProposed: "Pass", status: TENURE_UNDATED_STATUS, reason: expect.stringMatching(/periods with usable dates add up to about 30 months .* but 1 other cited period has no usable dates, so the total is not known/) });
    expect(g.check!.reason).not.toMatch(/under the/);
  });
  it("partly dated evidence that already reaches the requirement still only asks the recruiter to check field duties", () => {
    const o = base(); o.gates[0].periods = [{ from: "Jan 2020", to: "July 2026", quote: "Drove to synthetic depots across the invented region.", page: 1, batteryIndustry: false }, { from: "early career", to: "later", quote: "Visited synthetic depots in person each week.", page: 2, batteryIndustry: false }];
    expect(run(o).output.gates[0].check?.status).toBe("Not confirmed — recruiter must check field duties");
  });
  it("leaves a proposal of not confirmed or not met as it is", () => {
    for (const result of ["Unknown", "Fail"] as const) { const o = base(); o.gates[0].result = result; const g = run(o).output.gates[0]; expect([g.result, g.check]).toEqual([result, undefined]); }
  });
  it("counts overlapping periods once", () => {
    const o = base(); o.gates[0].periods = [{ from: "Jan 2022", to: "Dec 2023", quote: "Drove to synthetic depots across the invented region.", page: 1, batteryIndustry: false }, { from: "Jan 2023", to: "Dec 2024", quote: "Drove to synthetic depots across the invented region.", page: 1, batteryIndustry: false }];
    expect(run(o).output.gates[0].check?.reason).toMatch(/about 35 months/);
  });
});

describe("ratings need the evidence their level describes", () => {
  it("new customers: transaction or pipeline totals are not new customers won; a possible lower level is left to the recruiter", () => {
    const r = run(base()), c = get(r.output, "SD1");
    expect([c.status, c.rating]).toEqual(["unknown", null]);
    expect((c.flags ?? []).join(" ")).toMatch(/prospecting or lead work, which the written level 1 covers. The rule check does not assign a level/);
    const won = base(); won.criteria[0].evidence = [q("Opened 12 new synthetic accounts in 2025.", 2)];
    expect(get(run(won).output, "SD1").rating).toBe(2); // described new accounts: unchanged
    for (const quote of ["Won contracts with 4 new synthetic customers in 2025.", "Added new regional synthetic clients each quarter.", "Converted synthetic prospects into customers."]) { // contracts alone: see "business or contracts won are unclear"
      const o = base(); o.criteria[0].evidence = [q(quote, 2)]; expect(get(run(o).output, "SD1").rating, quote).toBe(2);
    }
  });
  /* F1: a rating of 2 or 3 needs a quote that states customers or accounts were won. Prospecting, pipeline, awards and
     identifying potential accounts do not establish a win (rules: level 1 "Prospecting or lead work described, no
     outcome"; awards are other sales results). Anything not clearly a win is withheld for the recruiter. */
  const sd1 = (...quotes: string[]) => sd1At(2, ...quotes);
  const sd1At = (rating: number, ...quotes: string[]) => { const o = base(); o.criteria[0].rating = rating; o.criteria[0].evidence = quotes.map((x) => q(x, 2)); return get(run(o).output, "SD1"); };
  it("new customers: clear wins keep the AI's rating", () => {
    for (const quote of ["Opened 12 new synthetic accounts in 2025.", "Won contracts with 4 new synthetic customers in 2025.", "Added new regional synthetic clients each quarter.", "Converted synthetic prospects into customers.",
      "Signed 8 new synthetic distributor accounts.", "Brought on 5 new synthetic customers in the region.", "Acquired 20 new synthetic clients through cold calling.", "Prospected weekly and won 6 new synthetic accounts."])
      expect([sd1(quote).status, sd1(quote).rating], quote).toEqual(["rated", 2]);
  });
  it("new customers: negated wins are withheld", () => {
    for (const quote of ["Prospected for new customers but did not win any accounts.", "Did not win new synthetic accounts in 2025.", "No new synthetic customers were won.", "Pursued 30 synthetic leads without winning a new account.", "Failed to convert synthetic prospects into customers.", "Never acquired new synthetic clients."])
      expect([sd1(quote).status, sd1(quote).rating], quote).toEqual(["unknown", null]);
  });
  it("new customers: prospecting, pipeline and identifying potential accounts are withheld", () => {
    for (const quote of ["Prospected for new synthetic customers by phone.", "Built a $2M synthetic pipeline of new accounts.", "Identified 40 potential new synthetic accounts.", "Targeted prospective synthetic customers across the region.",
      "Generated leads for new synthetic clients.", "Researched new synthetic accounts to approach.", "Prospected to win new synthetic accounts."])
      expect([sd1(quote).status, sd1(quote).rating], quote).toEqual(["unknown", null]);
  });
  it("new customers: unrelated awards are withheld", () => {
    for (const quote of ["Won an internal presentation award.", "Won the synthetic President's Club trophy.", "Won Rookie of the Year for synthetic sales.", "Won a regional sales competition."])
      expect([sd1(quote).status, sd1(quote).rating], quote).toEqual(["unknown", null]);
  });
  it("new customers: deals, totals and a responsibility without an outcome are withheld; an ambiguous quote is flagged", () => {
    for (const quote of ["Won 5 synthetic deals worth $2M.", "Booked $7.7M of synthetic widget orders.", "Responsible for winning new synthetic accounts.", "Tasked with acquiring new synthetic customers."])
      expect([sd1(quote).status, sd1(quote).rating], quote).toEqual(["unknown", null]);
    expect((sd1("Responsible for winning new synthetic accounts.").flags ?? []).join(" ")).toMatch(/describe winning new customers as a responsibility or aim, not as something achieved/);
  });
  it("new customers: business or contracts won are unclear (new customers, or work from existing ones?): withheld and flagged for the recruiter", () => {
    for (const quote of ["Won synthetic government and B2B business through bids.", "Opened new synthetic businesses across the region.", "Brought in new synthetic business each year.",
      "Won three synthetic depot contracts in 2025.", "Secured 12 synthetic supply contracts in 2024.", "Won a synthetic contract renewal."]) {
      const c = sd1(quote);
      expect([c.status, c.rating], quote).toEqual(["unknown", null]);
      expect((c.flags ?? []).join(" "), quote).toMatch(/a quote says business or contracts were won or opened; whether that means new customers or accounts is not clear/);
      expect(customerWinOf(quote), quote).toBe("unclear");
    }
  });
  it("new customers: one clear win among other quotes keeps the rating; the reason names what the quotes do show", () => {
    expect(sd1("Won an internal presentation award.", "Opened 12 new synthetic accounts in 2025.").rating).toBe(2);
    expect(sd1("Prospected for new customers but did not win any accounts.").explanation).toMatch(/^Rule check: no quote states that customers or accounts were won/);
  });
  it("new customers, rating 3: kept only when a stated win is counted, with a period", () => {
    for (const quote of ["Opened 12 new synthetic accounts in 2025.", "Won 6 new synthetic customers per quarter.", "Acquired 20 new synthetic clients within eight months.", "Signed 15 new synthetic distributor accounts between 2022 and 2024.", "Prospected weekly and won 6 new synthetic accounts in Q3 2025."])
      expect([sd1At(3, quote).status, sd1At(3, quote).rating], quote).toEqual(["rated", 3]);
  });
  it("new customers, rating 3: withheld (no lower rating is assigned) when the count or period is missing or describes revenue, calls or existing accounts", () => {
    for (const quote of ["Won new synthetic accounts in 2025.", "Opened 12 new synthetic accounts.", "Won $2M of new synthetic accounts in 2025.", "Grew new synthetic accounts by 40% in 2025.",
      "Made 300 calls to new synthetic customers in 2025.", "Managed 150 existing synthetic accounts in 2025.", "Won new synthetic accounts and grew revenue to 12 million in 2025.", "Won 12 synthetic contracts in 2025."]) {
      const c = sd1At(3, quote);
      expect([c.status, c.rating], quote).toEqual(["unknown", null]);
    }
    const c = sd1At(3, "Won new synthetic accounts in 2025.");
    expect(c.explanation).toMatch(/^Rule check: the quotes describe customers or accounts won, but none counts those wins with a period, which rating 3 needs\./);
    expect((c.flags ?? []).join(" ")).toMatch(/does not assign a lower rating/);
  });
  /* Independently reproduced failures (F1, third pass): the action must be winning new customers, and rating 3's count
     and period must describe those same wins. Word co-occurrence is not enough. */
  it("new customers: an action merely done for customers is not a win", () => {
    for (const quote of ["Opened support tickets for 12 customers in 2025.", "Added CRM notes for 12 customers in 2025.", "Sent renewal letters to 30 new synthetic clients in 2025.", "Closed service cases for 8 new synthetic accounts in 2025."]) {
      expect([sd1(quote).status, sd1(quote).rating], quote).toEqual(["unknown", null]);
      expect([sd1At(3, quote).status, sd1At(3, quote).rating], quote).toEqual(["unknown", null]);
      expect(customerWinOf(quote), quote).not.toBe("win");
    }
  });
  it("new customers: contracts with existing customers are not new-customer wins", () => {
    for (const quote of ["Signed contracts with 4 existing customers in 2025.", "Renewed contracts with 6 current synthetic clients in 2024.", "Signed 5 existing synthetic accounts to new terms in 2025."]) {
      expect([sd1(quote).status, sd1(quote).rating], quote).toEqual(["unknown", null]);
      expect(customerWinOf(quote), quote).not.toBe("win");
    }
    expect(customerWinOf("Signed contracts with 4 existing customers in 2025.")).toBe("existing");
  });
  it("new customers, rating 3: a period that belongs to another measure does not date the wins", () => {
    for (const quote of ["Won 4 new customers using 20 calls per week.", "Won 4 new synthetic customers while making 50 visits a month.", "Won 4 new synthetic customers from a 2025 campaign list."]) {
      expect([sd1At(3, quote).status, sd1At(3, quote).rating], quote).toEqual(["unknown", null]);
      expect(countedWinOf(quote), quote).toBe(false);
      expect([sd1(quote).status, sd1(quote).rating], quote).toEqual(["rated", 2]); // still a described win for rating 2
    }
  });
  it("new customers: a count of zero is not a win", () => {
    for (const quote of ["Opened 0 new accounts in 2025.", "Won zero new synthetic customers in 2024."]) {
      expect([sd1(quote).status, sd1(quote).rating], quote).toEqual(["unknown", null]);
      expect([sd1At(3, quote).status, sd1At(3, quote).rating], quote).toEqual(["unknown", null]);
      expect(customerWinOf(quote), quote).toBe("negated");
    }
  });
  it("new customers, rating 3: a leading period dates the win; ordinary place words between the win and its period are allowed", () => {
    for (const quote of ["In 2025, opened 12 new synthetic accounts.", "Opened 12 new synthetic accounts across the region in 2025."])
      expect([sd1At(3, quote).status, sd1At(3, quote).rating], quote).toEqual(["rated", 3]);
  });
  it("new customers: each quote is classified clause by clause", () => {
    expect(customerWinOf("Prospected for new customers but did not win any accounts.")).toBe("negated");
    expect(customerWinOf("Won an internal presentation award.")).toBe("award");
    expect(customerWinOf("Identified 40 potential new synthetic accounts.")).toBe("potential");
    expect(customerWinOf("Responsible for winning new synthetic accounts.")).toBe("duty");
    expect(customerWinOf("Prospected for new synthetic customers by phone.")).toBe("prospecting");
    expect(customerWinOf("Won 5 synthetic deals worth $2M.")).toBe("none");
    expect(customerWinOf("Prospected weekly and won 6 new synthetic accounts.")).toBe("win");
    expect(customerWinOf("Won three synthetic depot contracts in 2025.")).toBe("unclear");
    expect(countedWinOf("Opened 12 new synthetic accounts in 2025.")).toBe(true);
    for (const quote of ["Opened 12 new synthetic accounts.", "Won $2M of new synthetic accounts in 2025.", "Made 300 calls to new synthetic customers in 2025.", "Managed 150 existing synthetic accounts in 2025."]) expect(countedWinOf(quote), quote).toBe(false);
  });
  it("profitability: price negotiation alone is not rated, and the undefined point is flagged for a recruiter", () => {
    const c = get(run(base()).output, "SD3");
    expect([c.status, c.rating]).toEqual(["unknown", null]);
    expect((c.flags ?? []).join(" ")).toMatch(/^Undefined in the rules: whether price or contract negotiation alone counts as profit or margin work/);
  });
  it("CRM reporting: levels 2 and 3 need regular documentation; planning use without it is flagged, not rated", () => {
    const c = get(run(base()).output, "SD5");
    expect([c.status, c.rating]).toEqual(["unknown", null]);
    expect((c.flags ?? []).join(" ")).toMatch(/Undefined in the rules/);
    const doc = base(); doc.criteria[2].evidence = [q("Logged every synthetic call and quote in SynthCRM weekly.", 2)];
    expect(get(run(doc).output, "SD5").rating).toBe(2);
  });
  it("sales-data analysis: implied or general market analysis does not show level 2", () => {
    expect(get(run(base()).output, "SD6").status).toBe("unknown");
    const market = base(); market.criteria[3] = { ...market.criteria[3], basis: "explicit", evidence: [q("General market analysis for the synthetic team.", 2)] };
    expect(get(run(market).output, "SD6").status).toBe("unknown");
    const real = base(); real.criteria[3] = { ...real.criteria[3], basis: "explicit", evidence: [q("Analysed synthetic buying patterns to change route plans.", 2)] };
    expect(get(run(real).output, "SD6").rating).toBe(2);
  });
  it("only withholds: never raises or assigns a level, never invents evidence, and keeps the AI's proposal untouched", () => {
    const o = base(), before = JSON.stringify(o), r = run(o);
    expect(JSON.stringify(o)).toBe(before);
    for (const c of r.output.criteria) { const was = o.criteria.find((x) => x.id === c.id)!; expect(c.rating === was.rating || c.rating === null).toBe(true); expect(c.evidence).toEqual(was.evidence); }
    expect(r.adjustments.length).toBe(5);
  });
});
