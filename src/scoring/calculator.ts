import type { CapTrigger, Criterion, CriterionInput, Fraction, GateInput, Policy, ScoringConfig } from "./types";

/* The deterministic calculator for the scoring test. It works only from structured ratings and a frozen configuration:
   no model, no text, no I/O. All arithmetic is on whole numbers, so thresholds, rounding and bands are exact.

   CV-only score, in order (specification 3e, with the configuration's test choices):
   1. validate the inputs; 2. must-have gates (a Fail without an approved exception stops here);
   3. Disputed criteria (policy "no-score": no score until resolved); 4. overall and Critical coverage;
   5. coverage thresholds ("Insufficient evidence — no score"); 6. raw score over known criteria only;
   7. the Critical-gap cap; 8. rounding, halves up; 9. the band from the rounded value. */

export type ScoreStatus = "invalid" | "stopped" | "disputed" | "insufficient" | "scored";

export interface BreakdownRow { id: string; label: string; importance: Criterion["importance"]; weight: number; max: number; state: "rated" | "unknown" | "disputed"; rating: number | null; points: number; possible: number }

export interface CvResult {
  status: ScoreStatus;
  /** Plain-language reason for a status other than "scored". */
  reason: string | null;
  errors: string[];
  gates: { id: string; result: GateInput["result"]; exception: boolean }[];
  failedGates: string[];
  unknownGates: string[];
  disputed: string[];
  rows: BreakdownRow[];
  knownWeight: number;
  totalWeight: number;
  criticalKnownWeight: number;
  criticalTotalWeight: number;
  points: number;
  possible: number;
  /** Coverage as exact fractions of weight. */
  overall: Fraction;
  critical: Fraction;
  /** Unrounded raw score, for display only; every decision below uses exact whole-number arithmetic. */
  raw: number | null;
  capApplied: boolean;
  capReasons: string[];
  /** Capped, unrounded. */
  capped: number | null;
  score: number | null;
  band: string | null;
}

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

/** Checks a configuration's criteria and policy. Returns problems; an empty list means usable. */
export function configProblems(config: Pick<ScoringConfig, "criteria" | "policy">): string[] {
  const p: string[] = [], seen = new Set<string>();
  for (const c of config.criteria) {
    if (seen.has(c.id)) p.push(`${c.id}: listed twice`);
    seen.add(c.id);
    if (!isInt(c.weight) || c.weight <= 0) p.push(`${c.id}: weight must be a positive whole number`);
    if (!isInt(c.max) || c.max < 1) p.push(`${c.id}: maximum must be a whole number of 1 or more`);
    if (!c.included && !c.exclusionReason) p.push(`${c.id}: excluded without a recorded reason`);
  }
  const { cap, minOverallCoverage: o, minCriticalCoverage: k } = config.policy;
  if (!isInt(cap.value) || cap.value < 0 || cap.value > 100) p.push("cap must be a whole number from 0 to 100");
  for (const [n, f] of [["overall", o], ["Critical", k]] as const) if (!isInt(f[0]) || !isInt(f[1]) || f[1] <= 0 || f[0] < 0 || f[0] > f[1]) p.push(`${n} coverage threshold must be a fraction from 0 to 1`);
  if (!config.criteria.some((c) => c.included)) p.push("no criterion is included");
  return p;
}

/** a/b >= c/d (or >) on whole numbers. */
const atLeast = ([a, b]: Fraction, [c, d]: Fraction, inclusive: boolean) => (inclusive ? a * d >= c * b : a * d > c * b);

/** Rounds n/d to a whole number, halves up, exactly (n, d whole, d > 0). */
export const roundHalfUp = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d));

export const bandFor = (score: number, policy: Pick<Policy, "bands">) => policy.bands.slice().sort((a, b) => b.min - a.min).find((b) => score >= b.min)?.label ?? null;

const TRIGGER_TEXT: Record<CapTrigger, string> = { zero: "rated 0", lowOne: "rated 0 or 1", unknown: "Unknown" };

export function calculateCv(config: Pick<ScoringConfig, "criteria" | "policy" | "gates">, gateInputs: GateInput[], inputs: CriterionInput[], triggers?: CapTrigger[]): CvResult {
  const policy = config.policy, capTriggers = triggers ?? policy.cap.triggers;
  const errors = [...configProblems(config)];
  const included = config.criteria.filter((c) => c.included), byId = new Map(config.criteria.map((c) => [c.id, c]));

  /* Inputs: exactly one per included criterion, none for excluded or unknown ids, ratings whole and within range. */
  const given = new Map<string, CriterionInput>();
  for (const i of inputs) {
    const c = byId.get(i.id);
    if (!c) { errors.push(`${i.id}: not a criterion in this configuration`); continue; }
    if (given.has(i.id)) { errors.push(`${i.id}: more than one input`); continue; }
    given.set(i.id, i);
    if (!c.included) { errors.push(`${i.id}: excluded from this configuration, so it cannot be rated`); continue; }
    if (i.status === "rated") {
      const r = (i as { rating: unknown }).rating;
      if (!isInt(r)) errors.push(`${i.id}: rating must be a whole number`);
      else if (r < 0 || r > c.max) errors.push(`${i.id}: rating ${r} is outside 0–${c.max}`);
      else if (c.unavailableLevels?.includes(r)) errors.push(`${i.id}: level ${r} is not available in this configuration`);
    } else if (i.status !== "unknown" && i.status !== "disputed") errors.push(`${c.id}: status must be rated, unknown or disputed`);
  }
  for (const c of included) if (!given.has(c.id)) errors.push(`${c.id}: no input (record Unknown explicitly)`);

  const gateIds = new Set(config.gates.map((g) => g.id)), gateSeen = new Set<string>();
  for (const g of gateInputs) {
    if (!gateIds.has(g.id)) errors.push(`${g.id}: not a must-have in this configuration`);
    else if (gateSeen.has(g.id)) errors.push(`${g.id}: more than one result`);
    else if (!["Pass", "Fail", "Unknown"].includes(g.result)) errors.push(`${g.id}: result must be Pass, Fail or Unknown`);
    else if (g.exception && g.result !== "Fail") errors.push(`${g.id}: an exception applies only to a Fail`);
    else if (g.exception && !(g.exception.approvedBy && g.exception.reason && g.exception.at)) errors.push(`${g.id}: an exception needs who approved it, the reason and when`);
    gateSeen.add(g.id);
  }
  for (const id of gateIds) if (!gateSeen.has(id)) errors.push(`${id}: no must-have result (record Unknown explicitly)`);

  const rows: BreakdownRow[] = included.map((c) => {
    const i = given.get(c.id), rated = i?.status === "rated" && isInt(i.rating) ? i.rating : null;
    const state = i?.status === "disputed" ? "disputed" : rated === null ? "unknown" : "rated";
    return { id: c.id, label: c.label, importance: c.importance, weight: c.weight, max: c.max, state, rating: state === "rated" ? rated : null, points: state === "rated" ? c.weight * rated! : 0, possible: state === "rated" ? c.weight * c.max : 0 };
  });
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const totalWeight = sum(included.map((c) => c.weight)), critical = rows.filter((r) => r.importance === "Critical");
  const knownWeight = sum(rows.filter((r) => r.state === "rated").map((r) => r.weight));
  const criticalTotalWeight = sum(critical.map((r) => r.weight)), criticalKnownWeight = sum(critical.filter((r) => r.state === "rated").map((r) => r.weight));
  const points = sum(rows.map((r) => r.points)), possible = sum(rows.map((r) => r.possible));
  const gates = gateInputs.filter((g) => gateIds.has(g.id)).map((g) => ({ id: g.id, result: g.result, exception: !!g.exception }));
  const base: CvResult = {
    status: "scored", reason: null, errors, gates,
    failedGates: gates.filter((g) => g.result === "Fail" && !g.exception).map((g) => g.id), unknownGates: gates.filter((g) => g.result === "Unknown").map((g) => g.id),
    disputed: rows.filter((r) => r.state === "disputed").map((r) => r.id), rows, knownWeight, totalWeight, criticalKnownWeight, criticalTotalWeight, points, possible,
    overall: [knownWeight, totalWeight], critical: [criticalKnownWeight, criticalTotalWeight],
    raw: null, capApplied: false, capReasons: [], capped: null, score: null, band: null,
  };
  const stop = (status: ScoreStatus, reason: string): CvResult => ({ ...base, status, reason });

  if (errors.length) return stop("invalid", "The inputs or configuration are invalid, so no score is calculated.");
  if (base.failedGates.length) return stop("stopped", `Must-have not met (${base.failedGates.join(", ")}) and no approved exception: the candidate stops here, whatever the score.`);
  if (base.disputed.length) return stop("disputed", `Disputed — review required (${base.disputed.join(", ")}). No CV score until a reviewer resolves it.`);
  if (knownWeight === 0) return stop("insufficient", "Insufficient evidence — no score: no criterion has a rating.");
  const okOverall = atLeast(base.overall, policy.minOverallCoverage, policy.coverageInclusive);
  const okCritical = criticalTotalWeight === 0 || atLeast(base.critical, policy.minCriticalCoverage, policy.coverageInclusive);
  if (!okOverall || !okCritical) return stop("insufficient", `Insufficient evidence — no score: ${[!okOverall && "overall", !okCritical && "Critical"].filter(Boolean).join(" and ")} coverage below the minimum.`);

  /* Raw = 100 × points ÷ possible. Capping compares 100 × points with cap × possible, so it is exact. */
  const capReasons = critical.flatMap((r) => capTriggers.filter((t) => (t === "zero" && r.rating === 0) || (t === "lowOne" && r.rating !== null && r.rating <= 1) || (t === "unknown" && r.state === "unknown")).map((t) => `${r.id} ${TRIGGER_TEXT[t]}`));
  const uniqueReasons = [...new Set(capReasons)], over = 100 * points > policy.cap.value * possible;
  const capApplied = uniqueReasons.length > 0 && over;
  const score = capApplied ? policy.cap.value : roundHalfUp(100 * points, possible);
  return { ...base, raw: (100 * points) / possible, capApplied, capReasons: uniqueReasons, capped: capApplied ? policy.cap.value : (100 * points) / possible, score, band: bandFor(score, policy) };
}

/** The same inputs under each single cap trigger, for showing how sensitive the result is to that undecided choice. */
export function capSensitivity(config: Pick<ScoringConfig, "criteria" | "policy" | "gates">, gateInputs: GateInput[], inputs: CriterionInput[]) {
  return (["zero", "lowOne", "unknown"] as CapTrigger[]).map((t) => ({ trigger: t, label: { zero: "(a) Critical rated 0", lowOne: "(b) Critical rated 0 or 1", unknown: "(c) Critical Unknown" }[t], result: calculateCv(config, gateInputs, inputs, [t]) }));
}

/* Screening score (specification 3h): answers rated 1–5 against their answer points. Coverage = rated questions ÷ all
   applicable questions; skipped and deferred questions stay in the denominator. A question leaves the denominator only
   with a documented reason under a named rule. Score = 100 × (average − 1) ÷ 4. */
export type AnswerInput =
  | { q: string; status: "rated"; rating: number }
  | { q: string; status: "not-rated"; reason: string }
  | { q: string; status: "excluded"; rule: string; reason: string };

export interface ScreeningResult { status: "invalid" | "not-assessed" | "insufficient" | "scored"; reason: string | null; errors: string[]; applicable: number; rated: number; sum: number; coverage: Fraction; score: number | null; exact: number | null }

export function calculateScreening(policy: Pick<Policy, "screening">, answers: AnswerInput[] | null): ScreeningResult {
  const none: ScreeningResult = { status: "not-assessed", reason: "Not assessed: no screening answers have been supplied.", errors: [], applicable: 0, rated: 0, sum: 0, coverage: [0, 0], score: null, exact: null };
  if (answers === null) return none;
  const { scaleMin: lo, scaleMax: hi, minCoverage } = policy.screening, errors: string[] = [], seen = new Set<string>();
  for (const a of answers) {
    if (seen.has(a.q)) errors.push(`${a.q}: answered more than once`);
    seen.add(a.q);
    if (a.status === "rated" && (!isInt(a.rating) || a.rating < lo || a.rating > hi)) errors.push(`${a.q}: rating must be a whole number from ${lo} to ${hi}`);
    if (a.status === "not-rated" && !a.reason?.trim()) errors.push(`${a.q}: Not rated needs a reason`);
    if (a.status === "excluded" && !(a.rule?.trim() && a.reason?.trim())) errors.push(`${a.q}: an exclusion needs an agreed rule and a documented reason`);
  }
  const applicable = answers.filter((a) => a.status !== "excluded"), rated = applicable.filter((a): a is Extract<AnswerInput, { status: "rated" }> => a.status === "rated");
  const n = rated.length, sum = rated.reduce((s, a) => s + a.rating, 0), coverage: Fraction = [n, applicable.length];
  const base = { ...none, errors, applicable: applicable.length, rated: n, sum, coverage };
  if (errors.length) return { ...base, status: "invalid", reason: "The screening inputs are invalid." };
  if (n === 0) return { ...base, status: "insufficient", reason: "Insufficient evidence — no screening score: no question is rated." };
  if (!atLeast(coverage, minCoverage, true)) return { ...base, status: "insufficient", reason: "Insufficient evidence — no screening score: screening coverage below the minimum." };
  /* 100 × (sum/n − lo) ÷ (hi − lo) = 100 × (sum − lo·n) ÷ ((hi − lo)·n) */
  const num = 100 * (sum - lo * n), den = (hi - lo) * n;
  return { ...base, status: "scored", reason: null, score: roundHalfUp(num, den), exact: num / den };
}

export const pct = ([a, b]: Fraction) => (b === 0 ? "—" : `${((100 * a) / b).toFixed(1)}%`);
