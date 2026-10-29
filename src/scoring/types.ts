/* Scoring test prototype: the shapes the calculator and the local scoring workspace use.
   Everything here is generic. The role, rubric, candidates and evidence are loaded at run time from the private,
   Git-ignored scoring folder by the local scoring server only; none of it is part of this source tree or any build. */

export type Importance = "Critical" | "Important" | "Nice to have";
export type GateResult = "Pass" | "Fail" | "Unknown";
/** Which Critical-criterion states trigger the cap: (a) rated 0, (b) rated 0 or 1, (c) Unknown. */
export type CapTrigger = "zero" | "lowOne" | "unknown";
/** A fraction as [numerator, denominator], so thresholds are compared exactly. */
export type Fraction = [number, number];

export interface Criterion {
  id: string;
  label: string;
  importance: Importance;
  weight: number;
  /** Highest rating this criterion allows (criterion-specific maximum). */
  max: number;
  /** Excluded criteria take no rating and count in no total. */
  included: boolean;
  exclusionReason?: string;
  anchors: Partial<Record<"0" | "1" | "2" | "3", string>>;
  /** Ratings this configuration does not allow for the criterion (an anchor left undecided). */
  unavailableLevels?: number[];
  source?: string;
  note?: string;
  testRule?: string;
  recency?: boolean;
  duration?: boolean;
}

export interface Gate { id: string; label: string; source?: string; testRule?: string }
export interface Constraint { id: string; label: string; detail: string }
export interface Band { min: number; label: string }

export interface Policy {
  unknown: "exclude";
  minOverallCoverage: Fraction;
  minCriticalCoverage: Fraction;
  coverageInclusive: boolean;
  cap: { value: number; triggers: CapTrigger[] };
  rounding: "half-up";
  capBeforeRounding: boolean;
  bandFrom: "rounded";
  disputed: "no-score";
  bands: Band[];
  screening: { scaleMin: number; scaleMax: number; minCoverage: Fraction };
  combination: "none";
  recencyYears?: number;
  durationYears?: number;
  referenceDate?: string;
  recencyDurationRule?: string;
  evidenceDetail?: string;
}

export interface TestChoice { id: string; choice: string; specStatus: string }

/** A frozen rubric configuration. Changing any part of it means a new version. */
export interface ScoringConfig {
  id: string;
  version: number;
  status: string;
  approved: boolean;
  frozenAt: string;
  frozenNote?: string;
  basedOn?: Record<string, string>;
  role: { id: string; title: string; client: string; loc: string; summary: string; roleSetupVersion: string; resp: string[] };
  gates: Gate[];
  gateExceptions: { gate: string; subject: string; approvedBy: string; reason: string; at: string }[];
  criteria: Criterion[];
  constraints: Constraint[];
  policy: Policy;
  testChoices: TestChoice[];
}

/** One criterion's input: a rating, Unknown, or Disputed (CV and another source disagree, unresolved). */
export type CriterionInput =
  | { id: string; status: "rated"; rating: number }
  | { id: string; status: "unknown" }
  | { id: string; status: "disputed" };

export interface GateInput { id: string; result: GateResult; exception?: { approvedBy: string; reason: string; at: string } }
