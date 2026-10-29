import type { CriterionInput, GateInput, GateResult, ScoringConfig } from "./types";

/* Assessment versions. Version 1 is the suggested CV-only assessment and is never changed. Each reviewer correction
   (or a post-screening revision) creates the next version from the latest one, recording the previous and new state,
   evidence, reason, who, when, the source and the configuration it was made under. Earlier versions stay as they were.
   A correction changes either a scored criterion (rating, Unknown or Disputed) or an essential check (gate: Pass, Fail
   or Unknown). Gate corrections never add points; they change only the gate result the calculator checks first. */

export type InputState = { status: "rated"; rating: number } | { status: "unknown" } | { status: "disputed" } | { status: "gate"; result: GateResult };

export interface Correction {
  assessmentId: string;
  /** The version this correction creates; always the latest version + 1. */
  version: number;
  criterionId: string;
  previous: InputState;
  next: InputState;
  evidence: string;
  reason: string;
  reviewer: string;
  at: string;
  source: "reviewer" | "screening call";
  configId: string;
  configVersion: number;
}

export interface Version { version: number; inputs: CriterionInput[]; gates: GateInput[]; correction: Correction | null }

export const sameState = (a: InputState, b: InputState) => a.status === b.status && (a.status === "rated" ? a.rating === (b as { rating: number }).rating : a.status === "gate" ? a.result === (b as { result: GateResult }).result : true);
export const stateOf = (i: CriterionInput): InputState => (i.status === "rated" ? { status: "rated", rating: i.rating } : { status: i.status });
export const stateText = (s: InputState) => (s.status === "rated" ? String(s.rating) : s.status === "gate" ? s.result : s.status === "unknown" ? "Unknown" : "Disputed");

/** Problems with a correction against the latest version; an empty list means it can be recorded. */
export function correctionProblems(config: Pick<ScoringConfig, "id" | "version" | "criteria"> & { gates?: ScoringConfig["gates"] }, latest: Version, c: Correction): string[] {
  const p: string[] = [], crit = config.criteria.find((x) => x.id === c.criterionId), gate = config.gates?.find((g) => g.id === c.criterionId);
  if (c.configId !== config.id || c.configVersion !== config.version) p.push("made under a different configuration version");
  if (c.version !== latest.version + 1) p.push(`must create version ${latest.version + 1} (the assessment has changed since it was opened)`);
  if (gate) {
    const current = latest.gates.find((g) => g.id === c.criterionId);
    if (c.previous?.status !== "gate" || c.next?.status !== "gate") p.push(`${c.criterionId} is an essential check: its values must be Pass, Fail or Unknown`);
    else {
      if (!current || current.result !== c.previous.result) p.push(`the previous value does not match version ${latest.version}`);
      if (!["Pass", "Fail", "Unknown"].includes(c.next.result)) p.push("new value must be Pass, Fail or Unknown");
    }
  } else {
    if (!crit || !crit.included) p.push(`${c.criterionId} is not a scored criterion or essential check in this configuration`);
    const current = latest.inputs.find((i) => i.id === c.criterionId);
    if (crit && current && c.previous && !sameState(stateOf(current), c.previous)) p.push(`the previous value does not match version ${latest.version}`);
    if (c.next?.status === "rated" && crit && (!Number.isInteger(c.next.rating) || c.next.rating < 0 || c.next.rating > crit.max || crit.unavailableLevels?.includes(c.next.rating))) p.push(`rating must be an available whole number from 0 to ${crit.max}`);
    if (!["rated", "unknown", "disputed"].includes(c.next?.status)) p.push("new value must be a rating, Unknown or Disputed");
  }
  if (c.previous && c.next && sameState(c.previous, c.next)) p.push("the new value is the same as the previous one");
  for (const [k, v] of [["evidence", c.evidence], ["reason", c.reason], ["reviewer", c.reviewer]] as const) if (typeof v !== "string" || !v.trim()) p.push(`${k} is required`);
  if (typeof c.at !== "string" || Number.isNaN(Date.parse(c.at))) p.push("timestamp is missing or invalid");
  if (c.source !== "reviewer" && c.source !== "screening call") p.push("source must be reviewer or screening call");
  return p;
}

/** Builds every version from the suggested inputs and the corrections, in order. Stops at the first invalid correction. */
export function buildVersions(config: Pick<ScoringConfig, "id" | "version" | "criteria"> & { gates?: ScoringConfig["gates"] }, suggested: CriterionInput[], corrections: Correction[], gates: GateInput[] = []): { versions: Version[]; problems: string[] } {
  const versions: Version[] = [{ version: 1, inputs: suggested, gates, correction: null }];
  for (const c of corrections) {
    const latest = versions[versions.length - 1], p = correctionProblems(config, latest, c);
    if (p.length) return { versions, problems: p.map((x) => `Version ${c.version} (${c.criterionId}): ${x}`) };
    if (c.next.status === "gate") {
      const result = c.next.result;
      versions.push({ version: c.version, inputs: latest.inputs, gates: latest.gates.map((g) => (g.id === c.criterionId ? { ...g, result } : g)), correction: c });
      continue;
    }
    const nextInput = { id: c.criterionId, ...c.next } as CriterionInput;
    versions.push({ version: c.version, inputs: latest.inputs.map((i) => (i.id === c.criterionId ? nextInput : i)), gates: latest.gates, correction: c });
  }
  return { versions, problems: [] };
}
