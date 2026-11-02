import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CandidateSummary, placeConcerns } from "./CandidateSummary";
import { demoSummary } from "./demoSummary";
import { FIXTURE } from "../data/fixtures";

describe("client summary evidence", () => {
  it("keeps linked concerns beside their requirement and unlinked legacy concerns visible without a gap box", () => {
    const h = renderToStaticMarkup(<CandidateSummary roleTitle="Sales Lead" summary="Existing published wording." strengths={["Existing strength"]} requirementsVersion="v1" requirements={[{ id: "crm", tier: "must", text: "CRM reporting", status: "Partly supported", statusClass: "c-info", evidence: "Uses reports", source: "Source: screening", concerns: ["Confirm personal ownership"] }]} additionalInformation={["Confirm office attendance"]} />);
    const row = h.match(/<tr><td class="rq">CRM reporting[\s\S]*?<\/tr>/)?.[0];
    expect(row).toContain("Confirm personal ownership");
    expect(row).toContain("Partly supported");
    expect(row).toContain("Source: screening");
    expect(h).toContain("Confirm office attendance");
    expect(h).toContain("Existing published wording.");
    expect(h).not.toContain("Points to clarify");
    expect(h).not.toContain("<details");
  });
  it("does not guess a legacy concern link or change evidence statuses", () => {
    const rows = [{ id: "crm", tier: "must" as const, text: "CRM reporting", status: "Partly supported", statusClass: "c-info", evidence: "Existing evidence", source: "Source: call" }];
    const placed = placeConcerns(rows, ["CRM reporting: confirm ownership", "Reporting is unclear", "Confirm office attendance"]);
    expect(placed.requirements[0].concerns).toEqual(["CRM reporting: confirm ownership"]);
    expect(placed.additionalInformation).toEqual(["Reporting is unclear", "Confirm office attendance"]);
    expect(placed.requirements[0].status).toBe("Partly supported");
    expect(rows[0]).not.toHaveProperty("concerns");
  });
  it("preserves every fictional clarification and leaves original evidence and statuses unchanged", () => {
    const original = JSON.stringify(FIXTURE);
    for (const c of FIXTURE.subs) {
      const copy = demoSummary(c);
      expect(copy.summary.match(/[.!?](?:\s|$)/g)).toHaveLength(3);
      const retained = [...Object.values(copy.concernsByRequirement).flat(), ...copy.additionalInformation];
      for (const concern of c.clarify) expect(retained).toContain(concern);
    }
    expect(JSON.stringify(FIXTURE)).toBe(original);
  });
  it("does not substitute fixture prose for a different supplied record", () => {
    const c = { ...FIXTURE.subs[0], why: "Custom supplied summary." };
    expect(demoSummary(c).summary).toBe(c.why);
  });
});
