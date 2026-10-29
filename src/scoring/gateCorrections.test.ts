/* Recruiter corrections to essential checks (gates), alongside rating corrections, on synthetic data: each creates a new
   version, earlier versions stay unchanged, the calculator uses the corrected gate, and the state changes so any client
   summary describing the earlier state becomes out of date. */
import { describe, expect, it } from "vitest";
import { calculateCv } from "./calculator";
import { stateSha } from "./run";
import { syntheticRubric } from "./syntheticFixture";
import { buildVersions, type Correction } from "./versions";
import type { CriterionInput, GateInput } from "./types";

const config = syntheticRubric(), hash = (s: string) => `h${s.length}:${s.slice(0, 60)}`;
const inputs: CriterionInput[] = [{ id: "C1", status: "rated", rating: 3 }, { id: "C2", status: "rated", rating: 2 }, { id: "I1", status: "unknown" }];
const gates: GateInput[] = [{ id: "G1", result: "Unknown" }, { id: "G2", result: "Pass" }];
const fix = (over: Partial<Correction> = {}): Correction => ({ assessmentId: "a", version: 2, criterionId: "G1", previous: { status: "gate", result: "Unknown" }, next: { status: "gate", result: "Fail" },
  evidence: "Synthetic: confirmed by phone.", reason: "Synthetic reason.", reviewer: "Synthetic reviewer", at: "2026-01-10T00:00:00Z", source: "reviewer", configId: config.id, configVersion: 1, ...over });

describe("essential-check corrections", () => {
  it("create a new version with the corrected gate; version 1 is unchanged", () => {
    const { versions, problems } = buildVersions(config, inputs, [fix()], gates);
    expect(problems).toEqual([]);
    expect(versions.map((v) => v.gates.find((g) => g.id === "G1")?.result)).toEqual(["Unknown", "Fail"]);
    expect(versions[1].inputs).toEqual(versions[0].inputs);
    expect(gates[0].result).toBe("Unknown");
  });
  it("change the result the calculator gives, without adding points", () => {
    const { versions } = buildVersions(config, inputs, [fix()], gates);
    expect(calculateCv(config, versions[0].gates, versions[0].inputs).status).toBe("scored");
    const after = calculateCv(config, versions[1].gates, versions[1].inputs);
    expect([after.status, after.failedGates]).toEqual(["stopped", ["G1"]]);
    const met = buildVersions(config, inputs, [fix({ next: { status: "gate", result: "Pass" } })], gates).versions[1];
    expect(calculateCv(config, met.gates, met.inputs).points).toBe(calculateCv(config, gates, inputs).points);
  });
  it("change the assessment state, so an earlier client summary is out of date", () => {
    const { versions } = buildVersions(config, inputs, [fix()], gates);
    expect(stateSha("fp", 2, versions[1].inputs, versions[1].gates, hash)).not.toBe(stateSha("fp", 2, versions[1].inputs, gates, hash));
  });
  it.each([
    ["a previous value that is not the current one", fix({ previous: { status: "gate", result: "Pass" } }), /previous value does not match/],
    ["a rating given to an essential check", fix({ next: { status: "rated", rating: 2 } }), /values must be Pass, Fail or Unknown/],
    ["the same value", fix({ next: { status: "gate", result: "Unknown" } }), /same as the previous/],
    ["a gate value given to a scored skill", fix({ criterionId: "C1", previous: { status: "rated", rating: 3 }, next: { status: "gate", result: "Pass" } }), /must be a rating, Unknown or Disputed/],
    ["a missing reason", fix({ reason: " " }), /reason is required/],
  ])("are refused for %s", (_, c, re) => expect(buildVersions(config, inputs, [c], gates).problems.join(" ")).toMatch(re));
  it("rating corrections still work and keep the gate results", () => {
    const { versions, problems } = buildVersions(config, inputs, [fix({ criterionId: "C2", previous: { status: "rated", rating: 2 }, next: { status: "unknown" } })], gates);
    expect(problems).toEqual([]);
    expect(versions[1].gates).toEqual(gates);
    expect(versions[1].inputs.find((i) => i.id === "C2")).toEqual({ id: "C2", status: "unknown" });
  });
});
