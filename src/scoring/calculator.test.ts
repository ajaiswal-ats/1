import { describe, expect, it } from "vitest";
import { bandFor, calculateCv, calculateScreening, capSensitivity, roundHalfUp, type AnswerInput } from "./calculator";
import type { Criterion, CriterionInput, GateInput, ScoringConfig } from "./types";
import { buildVersions, type Correction } from "./versions";

/* Synthetic, fictional rubric used only by these tests: three Critical (weight 3), two Important (2), two Nice to have (1),
   one of which is excluded, and one criterion with a maximum of 2. No real role or candidate is involved. */
const crit = (id: string, importance: Criterion["importance"], weight: number, extra: Partial<Criterion> = {}): Criterion =>
  ({ id, label: `Criterion ${id}`, importance, weight, max: 3, included: true, anchors: {}, ...extra });
const CONFIG: Pick<ScoringConfig, "id" | "version" | "criteria" | "policy" | "gates"> = {
  id: "synthetic", version: 1,
  gates: [{ id: "G1", label: "Gate one" }, { id: "G2", label: "Gate two" }],
  criteria: [
    crit("C1", "Critical", 3), crit("C2", "Critical", 3), crit("C3", "Critical", 3),
    crit("I1", "Important", 2), crit("I2", "Important", 2, { max: 2 }),
    crit("N1", "Nice to have", 1, { unavailableLevels: [2] }), crit("N2", "Nice to have", 1, { included: false, exclusionReason: "Anchor undecided" }),
  ],
  policy: {
    unknown: "exclude", minOverallCoverage: [1, 2], minCriticalCoverage: [1, 2], coverageInclusive: true,
    cap: { value: 64, triggers: ["zero", "unknown"] }, rounding: "half-up", capBeforeRounding: true, bandFrom: "rounded", disputed: "no-score",
    bands: [{ min: 80, label: "Strong" }, { min: 65, label: "Good" }, { min: 50, label: "Borderline" }, { min: 0, label: "Weak" }],
    screening: { scaleMin: 1, scaleMax: 5, minCoverage: [3, 4] }, combination: "none",
  },
};
const PASS: GateInput[] = [{ id: "G1", result: "Pass" }, { id: "G2", result: "Unknown" }];
const r = (id: string, rating: number): CriterionInput => ({ id, status: "rated", rating });
const u = (id: string): CriterionInput => ({ id, status: "unknown" });
const all = (over: Record<string, CriterionInput>) => ["C1", "C2", "C3", "I1", "I2", "N1"].map((id) => over[id] ?? u(id));
const calc = (inputs: CriterionInput[], gates = PASS, triggers?: Parameters<typeof calculateCv>[3]) => calculateCv(CONFIG, gates, inputs, triggers);

describe("CV score arithmetic", () => {
  it("weights ratings, uses each criterion's own maximum and leaves Unknown out of both sides", () => {
    const x = calc(all({ C1: r("C1", 3), C2: r("C2", 2), C3: r("C3", 1), I1: r("I1", 3), I2: r("I2", 2), N1: u("N1") }));
    // points 9+6+3+6+4 = 28; possible 9+9+9+6+(2×2=4) = 37; raw 75.68 → 76
    expect([x.status, x.points, x.possible, x.score, x.band]).toEqual(["scored", 28, 37, 76, "Good"]);
    expect(x.rows.find((row) => row.id === "I2")).toMatchObject({ max: 2, points: 4, possible: 4 });
    expect(x.overall).toEqual([13, 14]);
    expect(x.critical).toEqual([9, 9]);
  });

  it("excluded criteria count in no total and cannot be rated", () => {
    const x = calc(all({ C1: r("C1", 3), C2: r("C2", 3), C3: r("C3", 3) }));
    expect(x.totalWeight).toBe(14); // 9 + 4 + 1, without N2
    expect(x.rows.map((row) => row.id)).not.toContain("N2");
    const bad = calc([...all({ C1: r("C1", 3), C2: r("C2", 3), C3: r("C3", 3) }), r("N2", 3)]);
    expect(bad.status).toBe("invalid");
    expect(bad.errors.join()).toMatch(/N2: excluded/);
  });

  it("rounds halves up exactly and takes the band from the rounded value", () => {
    expect(roundHalfUp(129, 2)).toBe(65); // 64.5 → 65
    expect(roundHalfUp(1289, 20)).toBe(64); // 64.45 → 64
    expect(bandFor(65, CONFIG.policy)).toBe("Good");
    expect(bandFor(64, CONFIG.policy)).toBe("Borderline");
    expect(bandFor(80, CONFIG.policy)).toBe("Strong");
    expect(bandFor(49, CONFIG.policy)).toBe("Weak");
    expect(bandFor(0, CONFIG.policy)).toBe("Weak");
    // 100 × 20 ÷ 31 = 64.516 → 65, "Good" (rounded value decides the band)
    const x = calc(all({ C1: r("C1", 2), C2: r("C2", 2), C3: r("C3", 2), I2: r("I2", 1) }));
    expect([x.points, x.possible, x.score, x.band]).toEqual([20, 31, 65, "Good"]);
  });

  it("gives 0 and 100 at the extremes", () => {
    const top = calc(all({ C1: r("C1", 3), C2: r("C2", 3), C3: r("C3", 3), I1: r("I1", 3), I2: r("I2", 2), N1: r("N1", 3) }));
    expect([top.score, top.band]).toEqual([100, "Strong"]);
    const zeroCritical = calc(all({ C1: r("C1", 0), C2: r("C2", 0), C3: r("C3", 0) }));
    expect([zeroCritical.status, zeroCritical.score, zeroCritical.band]).toEqual(["scored", 0, "Weak"]);
  });
});

describe("Unknown, insufficient evidence and confirmed mismatch", () => {
  it("all Unknown gives no score and never divides by zero", () => {
    const x = calc(all({}));
    expect([x.status, x.score, x.raw]).toEqual(["insufficient", null, null]);
    expect(x.reason).toMatch(/no criterion has a rating/);
  });

  it("an Unknown is not a 0: Unknown leaves the fraction, a confirmed 0 stays in it", () => {
    const base = { C1: r("C1", 3), C2: r("C2", 3), C3: r("C3", 3), I1: r("I1", 3) };
    const unknown = calc(all({ ...base, I2: u("I2") }), PASS, []);
    const zero = calc(all({ ...base, I2: r("I2", 0) }), PASS, []);
    expect([unknown.score, unknown.possible]).toEqual([100, 33]);
    expect([zero.score, zero.possible]).toEqual([89, 37]); // 33 ÷ 37 = 89.19
  });

  it("coverage thresholds are inclusive at exactly 50% and fail just below", () => {
    // Critical 6/9 = 66.7%, overall 7/14 = 50%: allowed
    const at = calc(all({ C1: r("C1", 3), C2: r("C2", 3), N1: r("N1", 3) }), PASS, []);
    expect([at.status, at.overall]).toEqual(["scored", [7, 14]]);
    // overall 6/14 = 42.9%: insufficient
    const below = calc(all({ C1: r("C1", 3), C2: r("C2", 3) }), PASS, []);
    expect([below.status, below.score]).toEqual(["insufficient", null]);
    // one high item alone: Critical 0%
    const one = calc(all({ I1: r("I1", 3) }));
    expect([one.status, one.critical]).toEqual(["insufficient", [0, 9]]);
    expect(one.reason).toMatch(/overall and Critical/);
  });
});

describe("Critical-gap cap and the order of calculation", () => {
  const strong = { C1: r("C1", 3), C2: r("C2", 3), I1: r("I1", 3), I2: r("I2", 2), N1: r("N1", 3) };
  it("caps at 64 when a Critical criterion is Unknown, before rounding", () => {
    const x = calc(all({ ...strong, C3: u("C3") }));
    expect([x.raw, x.capApplied, x.score, x.band]).toEqual([100, true, 64, "Borderline"]);
    expect(x.capReasons).toEqual(["C3 Unknown"]);
  });

  it("caps when a Critical criterion is rated 0, but not when rated 1 under triggers a + c", () => {
    expect(calc(all({ ...strong, C3: r("C3", 0) })).score).toBe(64); // raw 31/40 = 77.5 → capped
    const one = calc(all({ ...strong, C3: r("C3", 1) }));
    expect([one.capApplied, one.score]).toEqual([false, 85]); // 34/40 = 85
  });

  it("shows each single trigger's result for comparison", () => {
    const s = capSensitivity(CONFIG, PASS, all({ ...strong, C3: r("C3", 1) }));
    expect(s.map((x) => x.result.score)).toEqual([85, 64, 85]);
  });

  it("does not raise a score that is already below the cap", () => {
    const x = calc(all({ C1: r("C1", 1), C2: r("C2", 1), C3: u("C3"), I1: r("I1", 1), I2: r("I2", 1), N1: r("N1", 1) }));
    expect([x.capApplied, x.score, x.capReasons]).toEqual([false, 35, ["C3 Unknown"]]); // 11/31 = 35.48 → 35
  });

  it("a failed must-have stops the calculation before anything else; an approved exception lets it continue", () => {
    const inputs = all({ ...strong, C3: r("C3", 3) });
    const stopped = calc(inputs, [{ id: "G1", result: "Fail" }, { id: "G2", result: "Pass" }]);
    expect([stopped.status, stopped.score, stopped.failedGates]).toEqual(["stopped", null, ["G1"]]);
    const excepted = calc(inputs, [{ id: "G1", result: "Fail", exception: { approvedBy: "Client (fictional)", reason: "Test", at: "2026-10-27" } }, { id: "G2", result: "Pass" }]);
    expect([excepted.status, excepted.score]).toEqual(["scored", 100]);
    const unexplained = calc(inputs, [{ id: "G1", result: "Fail", exception: { approvedBy: "", reason: "", at: "" } }, { id: "G2", result: "Pass" }]);
    expect(unexplained.status).toBe("invalid");
  });

  it("Unknown must-haves do not stop the calculation", () => {
    expect(calc(all({ ...strong, C3: r("C3", 3) }), [{ id: "G1", result: "Unknown" }, { id: "G2", result: "Unknown" }]).status).toBe("scored");
  });
});

describe("Disputed evidence", () => {
  it("gives no score until resolved and names the item", () => {
    const x = calc(all({ C1: r("C1", 3), C2: r("C2", 3), C3: r("C3", 3), I1: { id: "I1", status: "disputed" } }));
    expect([x.status, x.score, x.disputed]).toEqual(["disputed", null, ["I1"]]);
    expect(x.reason).toMatch(/Disputed — review required/);
  });
});

describe("invalid, missing and out-of-range inputs", () => {
  const good = all({ C1: r("C1", 3), C2: r("C2", 3), C3: r("C3", 3) });
  it.each([
    ["rating above the criterion's maximum", good.map((i) => (i.id === "I2" ? r("I2", 3) : i)), /I2: rating 3 is outside 0–2/],
    ["negative rating", good.map((i) => (i.id === "C1" ? r("C1", -1) : i)), /outside/],
    ["fractional rating", good.map((i) => (i.id === "C1" ? r("C1", 1.5) : i)), /whole number/],
    ["level not available", good.map((i) => (i.id === "N1" ? r("N1", 2) : i)), /level 2 is not available/],
    ["missing criterion", good.filter((i) => i.id !== "I1"), /I1: no input/],
    ["duplicate input", [...good, r("C1", 1)], /C1: more than one input/],
    ["unknown criterion", [...good, r("Z9", 1)], /Z9: not a criterion/],
  ])("%s", (_, inputs, msg) => {
    const x = calc(inputs as CriterionInput[]);
    expect([x.status, x.score]).toEqual(["invalid", null]);
    expect(x.errors.join("; ")).toMatch(msg);
  });

  it("a missing must-have result is invalid, not a Pass", () => {
    expect(calc(good, [{ id: "G1", result: "Pass" }]).errors.join()).toMatch(/G2: no must-have result/);
  });

  it("rejects a configuration with bad weights or an unexplained exclusion", () => {
    const bad = { ...CONFIG, criteria: [crit("C1", "Critical", 0), crit("C2", "Critical", 3, { included: false })] };
    const x = calculateCv(bad, PASS, [r("C1", 1)]);
    expect(x.status).toBe("invalid");
    expect(x.errors.join()).toMatch(/weight must be a positive whole number.*excluded without a recorded reason/);
  });
});

describe("no double counting", () => {
  it("each criterion contributes once and gates add no points", () => {
    const inputs = all({ C1: r("C1", 3), C2: r("C2", 3), C3: r("C3", 3) });
    const allPass = calc(inputs, [{ id: "G1", result: "Pass" }, { id: "G2", result: "Pass" }]);
    const unknownGates = calc(inputs, [{ id: "G1", result: "Unknown" }, { id: "G2", result: "Unknown" }]);
    expect(allPass.points).toBe(27);
    expect(unknownGates.points).toBe(allPass.points);
    expect(allPass.rows.reduce((s, row) => s + row.points, 0)).toBe(allPass.points);
  });
});

describe("versioned corrections", () => {
  const suggested = all({ C1: r("C1", 3), C2: r("C2", 3), C3: r("C3", 3), I1: r("I1", 2) });
  const fix = (over: Partial<Correction> = {}): Correction => ({
    assessmentId: "x", version: 2, criterionId: "I1", previous: { status: "rated", rating: 2 }, next: { status: "rated", rating: 1 },
    evidence: "Fictional call quote", reason: "Only one duty confirmed", reviewer: "Test reviewer", at: "2026-10-27T12:00:00Z", source: "screening call", configId: "synthetic", configVersion: 1, ...over,
  });

  it("keeps version 1 unchanged and recalculates the new version", () => {
    const { versions, problems } = buildVersions(CONFIG, suggested, [fix()]);
    expect(problems).toEqual([]);
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[0].inputs).toBe(suggested);
    expect(versions[0].inputs.find((i) => i.id === "I1")).toEqual(r("I1", 2));
    const v1 = calc(versions[0].inputs), v2 = calc(versions[1].inputs);
    expect([v1.points, v2.points]).toEqual([31, 29]);
  });

  it.each([
    ["stale previous value", fix({ previous: { status: "rated", rating: 3 } }), /previous value does not match/],
    ["skipped version", fix({ version: 3 }), /must create version 2/],
    ["different configuration", fix({ configVersion: 2 }), /different configuration version/],
    ["missing reason", fix({ reason: " " }), /reason is required/],
    ["missing evidence", fix({ evidence: "" }), /evidence is required/],
    ["missing reviewer", fix({ reviewer: "" }), /reviewer is required/],
    ["bad timestamp", fix({ at: "yesterday" }), /timestamp/],
    ["out of range", fix({ next: { status: "rated", rating: 4 } }), /available whole number/],
    ["excluded criterion", fix({ criterionId: "N2", previous: { status: "unknown" } }), /not a scored criterion/],
    ["no change", fix({ next: { status: "rated", rating: 2 } }), /same as the previous/],
  ])("rejects %s", (_, c, msg) => {
    const { versions, problems } = buildVersions(CONFIG, suggested, [c]);
    expect(versions).toHaveLength(1);
    expect(problems.join()).toMatch(msg);
  });

  it("can mark an item Disputed, which suspends the score for that version only", () => {
    const { versions } = buildVersions(CONFIG, suggested, [fix({ next: { status: "disputed" } })]);
    expect(calc(versions[0].inputs).status).toBe("scored");
    expect(calc(versions[1].inputs).status).toBe("disputed");
  });
});

describe("screening score", () => {
  const P = CONFIG.policy;
  const a = (q: string, rating: number): AnswerInput => ({ q, status: "rated", rating });
  it("is Not assessed when no answers exist", () => {
    expect(calculateScreening(P, null)).toMatchObject({ status: "not-assessed", score: null });
  });
  it("keeps not-rated questions in the denominator (4 of 5 = 80%)", () => {
    const x = calculateScreening(P, [a("Q1", 4), a("Q2", 3), a("Q3", 5), a("Q4", 4), { q: "Q5", status: "not-rated", reason: "Out of time" }]);
    expect([x.status, x.coverage, x.sum, x.score]).toEqual(["scored", [4, 5], 16, 75]);
  });
  it("gives no screening score with zero rated answers, without dividing by zero", () => {
    const x = calculateScreening(P, [{ q: "Q1", status: "not-rated", reason: "Skipped" }]);
    expect([x.status, x.score]).toEqual(["insufficient", null]);
    expect(calculateScreening(P, []).status).toBe("insufficient");
  });
  it("needs 75% coverage, inclusive", () => {
    const nr = (q: string): AnswerInput => ({ q, status: "not-rated", reason: "Deferred" });
    expect(calculateScreening(P, [a("Q1", 5), a("Q2", 5), a("Q3", 5), nr("Q4")]).status).toBe("scored");
    expect(calculateScreening(P, [a("Q1", 5), a("Q2", 5), nr("Q3"), nr("Q4")]).status).toBe("insufficient");
  });
  it("excludes a question only with a rule and a reason", () => {
    expect(calculateScreening(P, [a("Q1", 3), { q: "Q2", status: "excluded", rule: "R1", reason: "Not applicable" }])).toMatchObject({ status: "scored", coverage: [1, 1], score: 50 });
    expect(calculateScreening(P, [a("Q1", 3), { q: "Q2", status: "excluded", rule: "", reason: "" }]).status).toBe("invalid");
  });
  it("rejects ratings outside 1–5 (a 0 is not a screening rating)", () => {
    expect(calculateScreening(P, [a("Q1", 0)]).status).toBe("invalid");
    expect(calculateScreening(P, [a("Q1", 6)]).status).toBe("invalid");
  });
  it("maps 1 → 0 and 5 → 100", () => {
    expect(calculateScreening(P, [a("Q1", 1)]).score).toBe(0);
    expect(calculateScreening(P, [a("Q1", 5)]).score).toBe(100);
  });
});
