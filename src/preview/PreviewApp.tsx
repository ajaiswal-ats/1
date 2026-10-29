import { useEffect, useMemo, useState } from "react";
import { fd } from "../lib/dates";
import { DraftAssessment, EXPERIMENTAL, PAGE_NOTE, ResultChip } from "../scoring/AssessmentPanels";
import { viewOf, type AssessmentRecord, type AssessmentView, type LoadedConfig } from "../scoring/model";

/* Read-only preview of the supplied candidates' latest draft assessments: the draft result, summary, strengths, gaps and
   expandable evidence, in the recruiter page's own plain-English wording (DraftAssessment). No uploads, AI calls,
   correction forms, review controls or links to other pages. Results are calculated here from the exported records, by
   the same calculator; nothing is ranked (candidates are listed by label), decided, moved or shared. */

export interface PreviewData { schema: "assessment-preview/1"; generatedAt: string; config: LoadedConfig; assessments: AssessmentRecord[] }

export function previewViews(data: PreviewData): AssessmentView[] {
  if (data?.schema !== "assessment-preview/1" || !data.config || !Array.isArray(data.assessments)) throw new Error("The preview data is not in the expected format.");
  return data.assessments.map((a) => viewOf(a, data.config, a.corrections ?? [], []));
}

export function PreviewPage({ data }: { data: PreviewData }) {
  const views = useMemo(() => previewViews(data), [data]), role = data.config.role;
  return (
    <main className="pv">
      <header className="pv-head">
        <div className="pv-brand">Revenue Optics · Talent Solutions</div>
        <h1>Candidate assessments — read-only preview</h1>
        <p className="lede">{`${role.title}${role.loc ? ` · ${role.loc}` : ""}. Latest draft CV assessment for each supplied candidate, listed by label, not by score.`}</p>
        <div className="banner warn"><b>{`${EXPERIMENTAL}. `}</b>{`These are AI drafts under test rules (version ${data.config.version}) that are awaiting approval. A recruiter must review each one. Nothing here ranks, rejects, moves or shares a candidate.`}</div>
        <nav aria-label="Candidates" className="pv-nav">{views.map((v) => <a key={v.record.id} href={`#${anchor(v)}`}><span>{v.record.label}</span><ResultChip r={v.latest.result} /></a>)}</nav>
      </header>
      {views.map((v) => (
        <section key={v.record.id} id={anchor(v)} className="card pv-cand" aria-label={v.record.label}>
          <div className="pv-cand-h"><h2>{v.record.label}</h2><span className="xs muted">{v.record.createdAt ? `Assessed ${fd(v.record.createdAt.slice(0, 10))}` : ""}</span></div>
          <DraftAssessment v={v} preview />
        </section>
      ))}
      <footer className="xs muted pv-foot"><p>{PAGE_NOTE}</p><p>{`Prepared ${fd(data.generatedAt.slice(0, 10))} from the local assessment records. Read-only: changes are made in the recruiter's local tool, not here.`}</p></footer>
    </main>
  );
}

const anchor = (v: AssessmentView) => v.record.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export function PreviewApp() {
  const [state, setState] = useState<{ data: PreviewData } | { error: string } | null>(null);
  useEffect(() => {
    fetch("data/assessments.json", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: PreviewData) => { previewViews(data); setState({ data }); })
      .catch(() => setState({ error: "The assessments could not be loaded." }));
  }, []);
  if (!state) return <main className="pv"><p className="muted">Loading…</p></main>;
  if ("error" in state) return <main className="pv"><div className="banner warn" role="alert">{state.error}</div></main>;
  return <PreviewPage data={state.data} />;
}
