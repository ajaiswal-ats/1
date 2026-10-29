import { fd } from "../lib/dates";
import { ResultChip } from "./AssessmentPanels";
import { isBlocked, type AssessmentPayload, type AssessmentView } from "./model";
import { resultLabel } from "./plainText";

/* The scoring tool's home screen (scoring-test mode only): one row per candidate with the latest draft result, its review
   status and Open, plus Add CV. Candidates are identified only from existing records: assessments belong to the same
   candidate when their recorded CV fingerprints are identical (the label mapping for the earlier CVs, the intake record
   for added CVs). Nothing is matched by name, label or similarity; a different file stays a separate candidate. */

export interface CandidateGroup { key: string; name: string; aliases: string[]; items: AssessmentPayload[]; latest: AssessmentPayload; firstAdded: string | null }

const when = (a: AssessmentPayload) => (isBlocked(a) ? a.addedAt ?? "" : a.createdAt || a.addedAt || "");

/** Groups assessments by recorded CV fingerprint; an assessment without one stands alone. Oldest first within a group. */
export function groupCandidates(list: AssessmentPayload[]): CandidateGroup[] {
  const groups = new Map<string, AssessmentPayload[]>();
  for (const a of list) { const key = a.cvSha256 ? `cv:${a.cvSha256}` : `id:${a.id}`; groups.set(key, [...(groups.get(key) ?? []), a]); }
  return [...groups.entries()].map(([key, items]) => {
    const sorted = [...items].sort((x, y) => (when(x) < when(y) ? -1 : when(x) > when(y) ? 1 : (x.attempt ?? 0) - (y.attempt ?? 0)));
    const named = sorted.find((a) => !a.intakeId) ?? sorted[0], labels = [...new Set(sorted.map((a) => a.label))];
    const added = sorted.map((a) => a.addedAt).filter(Boolean).sort() as string[];
    return { key, name: named.label, aliases: labels.filter((l) => l !== named.label), items: sorted, latest: sorted[sorted.length - 1], firstAdded: added[0] ?? null };
  }).sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
}

/** How an assessment was prepared, in words. */
export const preparedHow = (a: AssessmentPayload) => (isBlocked(a) ? "Unavailable" : /\(ai-proposed\)/.test(a.producedBy) ? "AI draft" : "Prepared by hand with an AI assistant");

/** Where review stands for one assessment. A typed reviewer name is attribution, not a sign-in. */
export function reviewStatus(a: AssessmentPayload, v: AssessmentView | undefined) {
  if (isBlocked(a) || !v) return "Unavailable: its records do not match";
  const changed = v.latest.version > 1 ? `Changed by a recruiter (version ${v.latest.version})` : "Not reviewed by a recruiter";
  if (!a.clientView) return `${changed} · client summary out of date`;
  /* A reviewed client summary is shown separately: it does not mean the ratings were approved. */
  const summaryReviewed = (a.clientViews ?? []).some((r) => r.current && r.preparation.method === "reviewer-confirmed");
  return summaryReviewed ? `${v.latest.version > 1 ? changed : "Ratings not reviewed by a recruiter"} · client summary reviewed` : changed;
}

export function AssessHome({ groups, views }: { groups: CandidateGroup[]; views: Map<string, AssessmentView> }) {
  return (
    <>
      <div className="pagehead"><div><h1>Assess candidates</h1><p className="lede">Draft CV assessments under test rules, awaiting approval. Listed by name, not by score. Nothing is ranked, rejected, moved or shared.</p></div>
        <div className="pageact"><a className="btn btn-p" href="#assess">Add CV</a></div></div>
      <div className="card sc-panel sc-home">
        {groups.length === 0 ? <div className="rempty">No candidates yet. Use Add CV to assess one.</div> : (
          <table className="req sc-home-t"><thead><tr><th>Candidate</th><th>Latest draft result</th><th>Review status</th><th aria-label="Open" /></tr></thead><tbody>
            {groups.map((g) => { const v = views.get(g.latest.id), earlier = g.items.length - 1; return (
              <tr key={g.key}>
                <td className="rq">{g.name}<span className="tier">{[earlier > 0 && `${earlier} earlier assessment${earlier === 1 ? "" : "s"} in history`, g.firstAdded && `added ${fd(g.firstAdded.slice(0, 10))}`].filter(Boolean).join(" · ")}</span></td>
                <td data-label="Latest draft result">{v ? <ResultChip r={v.latest.result} /> : <span className="chip c-warn">Unavailable</span>}<div className="xs muted" style={{ marginTop: 3 }}>{preparedHow(g.latest)}</div></td>
                <td data-label="Review status" className="small">{reviewStatus(g.latest, v)}</td>
                <td className="sc-open-c"><a className="btn btn-s btn-sm" href={`#c-${g.latest.id}`} aria-label={`Open ${g.name}`}>Open</a></td>
              </tr>
            ); })}
          </tbody></table>
        )}
      </div>
      <p className="xs muted dbnote">Assessments are grouped only when the records show they are of the identical CV file. Earlier assessments stay in each candidate's history.</p>
    </>
  );
}

/** Earlier assessments of the same CV file (for the assessment page), newest first. */
export function EarlierAssessments({ group, views, shownId }: { group: CandidateGroup; views: Map<string, AssessmentView>; shownId: string }) {
  const earlier = [...group.items].reverse().filter((a) => a.id !== shownId);
  return (
    <>
      <ol className="hist" style={{ marginTop: 10 }}>{earlier.map((a) => { const v = views.get(a.id), at = isBlocked(a) ? a.addedAt : a.createdAt || a.addedAt;
        return <li key={a.id}><span className="t">{at ? fd(at.slice(0, 10)) : "—"}</span><span>{`${preparedHow(a)}${a.label !== group.name ? ` (recorded as ${a.label})` : ""}: ${v ? resultLabel(v.latest.result) : "unavailable"}. ${reviewStatus(a, v)}.`}</span></li>; })}</ol>
      <p className="xs muted">Same CV file, confirmed from the records kept when each one was added. Kept unchanged; not separate candidates.</p>
    </>
  );
}

/** The candidate's history: every assessment of the same CV file, newest first, with the one shown marked current. */
export function AssessmentHistory({ group, views, shownId }: { group: CandidateGroup; views: Map<string, AssessmentView>; shownId: string }) {
  return (
    <>
      <div className="sec-h"><h2>Notes</h2></div>
      <p className="muted small">No notes in this test assessment.</p>
      <h2 style={{ margin: "22px 0 8px" }}>Assessment history</h2>
      <ol className="hist">{[...group.items].reverse().map((a) => { const v = views.get(a.id), at = isBlocked(a) ? a.addedAt : a.createdAt || a.addedAt;
        return <li key={a.id}><span className="t">{at ? fd(at.slice(0, 10)) : "—"}</span><span>
          <b>{a.id === shownId ? "Shown now: " : "Earlier, kept: "}</b>{`${preparedHow(a)}${a.label !== group.name ? ` (recorded as ${a.label})` : ""} · ${v ? resultLabel(v.latest.result) : "unavailable"} · ${reviewStatus(a, v)}`}</span></li>; })}</ol>
      <p className="xs muted" style={{ marginTop: 10 }}>{`These assessments are of the same CV file, confirmed from the records kept when each one was added. Earlier ones are kept unchanged and are not separate candidates.${group.firstAdded ? ` First added to this test on ${fd(group.firstAdded.slice(0, 10))}.` : ""} Nothing has been shared with a client.`}</p>
    </>
  );
}
