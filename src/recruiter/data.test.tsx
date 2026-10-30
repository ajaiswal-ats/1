import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { recruiterFixture } from "./fictional";
import { AssessmentEditor } from "./RecruiterApp";
import { checkAssessment, createGateway, initialReview, shareProblems, type Gateway } from "./data";

describe("hosted recruiter review boundaries", () => {
  it("does not infer evidence statuses or copy internal strengths into a client summary", () => {
    const a = recruiterFixture(), r = initialReview(a);
    expect(r.whyShared).toBe(""); expect(r.strengths).toEqual([]);
    expect(r.evidence[0]).toMatchObject({ status: "", evidence: "", source: "" });
    expect(r.screening.every((x) => x.rating === null)).toBe(true);
    expect(shareProblems(a)).toContain("Scoring rules await approval.");
  });
  it("discards requirement decisions if the agreed set changes, but keeps recorded screening answers", () => {
    const a = recruiterFixture(); a.review = initialReview(a);
    a.review.evidence[0].status = "supported"; a.review.screening[0].answer = "A synthetic answer.";
    a.setId = "55555555-5555-4555-8555-555555555555";
    const r = initialReview(a); expect(r.evidence[0].status).toBe(""); expect(r.screening[0].answer).toBe("A synthetic answer.");
  });
  it("refuses mismatched or incomplete records instead of inventing defaults", () => {
    const a = recruiterFixture(); a.inputs.criteria.pop();
    expect(() => checkAssessment(a)).toThrow(/incomplete/);
  });
  it("sends the exact revision on saves, and exposes database setup and stale-save failures", async () => {
    const a = recruiterFixture(), rpc = vi.fn().mockResolvedValueOnce({ data: 2, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "PT409", message: "assessment_changed_reload" } })
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST202" } });
    const gateway = createGateway({ rpc });
    await gateway.save(a, a.inputs, initialReview(a), "Reviewed the evidence.");
    expect(rpc).toHaveBeenCalledWith("recruiter_save_review", expect.objectContaining({ p_id: a.id, p_expected_revision: 1 }));
    await expect(gateway.share(a)).rejects.toThrow(/changed since/);
    await expect(gateway.account()).rejects.toThrow(/not configured/);
  });
  it("shows separate screening and recruiter decisions without enabling client sharing for draft rules", () => {
    const a = recruiterFixture(), gateway = {} as Gateway;
    const html = renderToStaticMarkup(<AssessmentEditor assessment={a} gateway={gateway} onSaved={() => {}} onDirty={() => {}} />);
    expect(html).toContain("CV assessment"); expect(html).toContain("Client summary"); expect(html).toContain("Review history");
    expect(html).toContain("An overall screening score and combined score are not calculated");
    expect(html).toContain("Draft scoring rules");
    expect(html).toMatch(/disabled=""[^>]*>Share reviewed summary/);
    expect(html).not.toContain("/__scoring/");
  });
  it("explains a refused replacement without exposing or inventing client content", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "PT409", message: "existing_client_content_needs_review" } });
    await expect(createGateway({ rpc }).share(recruiterFixture())).rejects.toThrow(/existing key facts or reviewed screening summary.*review.*Nothing was replaced/i);
  });
  it("explains that recruiter sharing cannot reinstate a withdrawn client package", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "PT409", message: "client_package_withdrawn" } });
    await expect(createGateway({ rpc }).share(recruiterFixture())).rejects.toThrow(/withdrawn.*cannot reinstate.*Nothing was published/i);
  });
});
