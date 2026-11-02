import { FIXTURE, type Submission } from "../data/fixtures";

// Editorial copy for the existing fictional demo only. No claims, quotations or dates are generated.
// Original fixture records (including resume wording, screening and clarification fields) are retained.
const COPY: Record<string, { summary: string; concernRequirements: number[]; extraStrengths?: number[] }> = {
  "tb-isl": {
    summary: "Taylor leads an eight-person inside sales team at a distributor, relevant to this role’s team-leadership responsibilities. Screening describes a weekly call-review routine and a candidate-reported improvement in quote turnaround. Personal responsibility for CRM reports and agreement to the three-day office schedule need confirmation.",
    concernRequirements: [2, -1], extraStrengths: [2],
  },
  "tb-rsm": {
    summary: "Taylor leads an inside sales team supporting three branches, relevant to the regional role’s distribution context. The shared evidence describes distribution experience and a structured coaching routine. Taylor has not managed branches directly, and screening confirms no field sales management experience.",
    concernRequirements: [0],
  },
  "je-isl": {
    summary: "Jordan supervises five inside and counter sales staff at an electrical distributor, relevant to this role’s leadership responsibilities. Screening describes building the branch’s CRM pipeline dashboard. Coaching is informal, so a regular coaching and call-review routine remains to be established.",
    concernRequirements: [3],
  },
  "pr-isl": {
    summary: "Priya leads four inside sales representatives in packaging distribution, relevant to this role’s team-leadership responsibilities. Screening describes ownership of weekly CRM pipeline reports for the region. A coaching routine is not evidenced, and readiness to lead the role’s six-person team needs confirmation.",
    concernRequirements: [3, 0],
  },
  "mw-isl": {
    summary: "Marcus has account management experience in bearings distribution, relevant to the role’s customer context. Screening describes daily CRM use with limited reporting. The shared evidence confirms no team leadership experience, an essential requirement for this role.",
    concernRequirements: [],
  },
  "en-pa": {
    summary: "Elena runs margin analysis for a 40,000-item industrial catalogue, relevant to this pricing role. The shared evidence includes monthly pricing recommendations and weekly SQL use. Working-hour overlap with the Chicago team remains to be confirmed.",
    concernRequirements: [-1],
  },
  "so-pa": {
    summary: "Samuel models price changes for a manufacturer selling through distributors, relevant to this pricing role. Screening describes presenting pricing findings verbally. Written recommendations and SQL or BI experience are not established in the shared evidence.",
    concernRequirements: [2],
  },
  "bc-pa": {
    summary: "Ben has business analysis experience in retail, with advanced spreadsheet skills relevant to the analytical work. The shared evidence includes clear written reports and daily SQL use. Pricing models are not evidenced, and the recorded industry experience is retail rather than distribution or manufacturing.",
    concernRequirements: [],
  },
  "gl-rsm": {
    summary: "Grace manages three branches’ field teams at an industrial distributor, relevant to this regional leadership role. Screening describes leading six field representatives through two managers and running the region’s CRM forecast. The shared experience covers three branches, while this role covers four.",
    concernRequirements: [],
  },
  "do-rsm": {
    summary: "Daniel manages a two-branch region, relevant to the regional role’s leadership responsibilities. The shared resume describes distribution and field management experience. Screening says Daniel uses CRM forecasts but does not build them.",
    concernRequirements: [],
  },
  "ab-fsr": {
    summary: "Aisha covers a Dallas-area territory for a hydraulics distributor, relevant to this field sales role. The shared summary describes visits to about 30 accounts a month. Existing customer relationships are partly evidenced, and any non-compete terms remain to be confirmed.",
    concernRequirements: [-1],
  },
  "cm-rsm": {
    summary: "Chris manages a single industrial distribution branch, relevant to the regional role’s operating context. Screening describes managing four field representatives. Multi-branch leadership and CRM-based forecasting remain unconfirmed.",
    concernRequirements: [0],
  },
};

export function demoSummary(c: Submission) {
  const original = FIXTURE.subs.find((x) => x.id === c.id);
  const copy = original?.why === c.why && JSON.stringify(original.req) === JSON.stringify(c.req) && JSON.stringify(original.clarify) === JSON.stringify(c.clarify) ? COPY[c.id] : undefined;
  const concernsByRequirement: Record<number, string[]> = {};
  const additionalInformation: string[] = [];
  c.clarify.forEach((concern, i) => {
    const index = copy?.concernRequirements[i] ?? -1;
    if (index >= 0 && c.req[index]) (concernsByRequirement[index] ??= []).push(concern);
    else additionalInformation.push(concern);
  });
  return {
    summary: copy?.summary ?? c.why,
    summaryPoints: copy && c.id === "pr-isl" ? [
      { label: "Relevant experience", text: "Leads four inside sales representatives in packaging distribution." },
      { label: "Contribution", text: "Described owning the region’s weekly CRM pipeline reports during screening." },
      { label: "To confirm", text: "Coaching approach and readiness to lead the role’s six-person team." },
    ] : undefined,
    strengths: copy ? (copy.extraStrengths ?? []).map((i) => c.strengths[i]).filter((x): x is string => !!x) : c.strengths,
    concernsByRequirement,
    additionalInformation,
    reportedResults: copy && c.id === "tb-isl" ? [{ text: "Quote turnaround reduced from two days to same-day.", source: "Recruiter screening, 7 Oct 2026" }] : [],
  };
}
