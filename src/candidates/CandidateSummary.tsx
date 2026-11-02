import { RequirementGroups, type RequirementPresentation } from "./RequirementGroups";

interface Props {
  roleTitle: string;
  summary: string;
  strengths: string[];
  summaryPoints?: { label: string; text: string }[];
  requirementsVersion: string;
  requirements: RequirementPresentation[];
  additionalInformation?: string[];
  reportedResults?: { text: string; source: string }[];
}

/** Presentation only: published evidence, statuses and original records are never rewritten. */
export function CandidateSummary({ roleTitle, summary, strengths, summaryPoints, requirementsVersion, requirements, additionalInformation = [], reportedResults = [] }: Props) {
  const points = summaryPoints ?? Array.from(new Intl.Segmenter("en", { granularity: "sentence" }).segment(summary), ({ segment }) => ({ label: "", text: segment.trim() })).filter((p) => p.text);
  return <>
    <section className="why summary-opening"><h3>{`Summary for ${roleTitle}`}</h3><ul>{points.map((point, i) => <li key={i}>{point.label && <b>{`${point.label}: `}</b>}{point.text}</li>)}</ul></section>
    {reportedResults.length > 0 && <ul>{reportedResults.map((r) => <li key={r.text}><b>Reported result: </b>{r.text}<div className="src small muted">{`Candidate-reported, not independently verified · Source: ${r.source}`}</div></li>)}</ul>}
    {strengths.length > 0 && <section><h3>Strengths</h3><ul>{strengths.map((x) => <li key={x}>{x}</li>)}</ul></section>}
    <div className="sec-h requirement-heading"><h2>Requirement check</h2><span className="xs muted">{`Requirements ${requirementsVersion}`}</span></div>
    <RequirementGroups rows={requirements} />
    {additionalInformation.length > 0 && <section><h3>Additional information</h3><ul>{additionalInformation.map((x) => <li key={x}>{x}</li>)}</ul></section>}
    <p className="xs muted">Not evidenced means the information is not established, not that the candidate cannot do it.</p>
  </>;
}

/** Only an explicit requirement-name prefix establishes a link. Never infer one from keywords. */
export function placeConcerns(rows: RequirementPresentation[], concerns: string[]) {
  const requirements = rows.map((r) => ({ ...r, concerns: [...(r.concerns ?? [])] }));
  const additionalInformation: string[] = [];
  for (const concern of concerns) {
    const row = requirements.find((r) => concern.startsWith(`${r.text}:`));
    if (row) row.concerns.push(concern);
    else additionalInformation.push(concern);
  }
  return { requirements, additionalInformation };
}
