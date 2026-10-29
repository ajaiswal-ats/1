import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { fd } from "../lib/dates";
import { addCv, assessCv, intakeText, loadIntakes, reviewText, type IntakeOverview, type IntakeSummary } from "./api";
import type { LoadedConfig } from "./model";
import { labelsFor, plain } from "./plainText";

/* The recruiter's local CV assessment flow (scoring-test mode only): choose role → add CV → check the text → assess →
   view the result. Every step is done by the local scoring server; this page only shows what it reports. The AI route
   only proposes: its output is validated before anything is calculated, and invalid output is shown as rejected, never
   replaced by a fallback. Nothing here ranks, rejects, moves or publishes a candidate. */

const when = (iso: string) => `${fd(iso.slice(0, 10))} ${iso.slice(11, 16)} UTC`;
/** How a background job is shown. Results stay drafts until a recruiter reviews them. */
const JOB_LABEL = { queued: "Queued", processing: "Processing", ready: "Ready for review", failed: "Failed" } as const;
const JOB_CHIP = { queued: "c-mute", processing: "c-info", ready: "c-ok", failed: "c-warn" } as const;
const active = (x: IntakeSummary) => x.job?.state === "queued" || x.job?.state === "processing";
const REVIEW_LABEL = { matches: "Checked: matches the PDF", differences: "Checked: differences found", partly: "Partly checked", "not reviewed": "Not checked yet" } as const;

export function AssessFlow({ configs, onAssessed }: { configs: LoadedConfig[]; onAssessed(): void }) {
  const [data, setData] = useState<IntakeOverview | null>(null), [failed, setFailed] = useState(false);
  const [roleKey, setRoleKey] = useState(""), [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState<string | null>(null), [problems, setProblems] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const reload = useCallback(() => loadIntakes().then((d) => { setData(d); setFailed(!d); }, () => setFailed(true)), []);
  useEffect(() => { void reload(); }, [reload]);
  /* While any job is queued or processing, check again every few seconds (also after a refresh or coming back). */
  const running = !!data?.intakes.some(active);
  useEffect(() => { if (!running) return; const t = setInterval(() => { void reload(); }, 2500); return () => clearInterval(t); }, [running, reload]);
  useEffect(() => { if (data?.intakes.some((x) => x.job?.state === "ready")) onAssessed(); }, [data?.intakes.map((x) => x.job?.state).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (data && !roleKey && data.roles[0]) setRoleKey(`${data.roles[0].id}@${data.roles[0].version}`); }, [data, roleKey]);
  if (failed) return <Page><div className="rempty dberr" role="alert">The local assessment service did not respond.</div></Page>;
  if (!data) return <Page><div className="rempty" role="status">Loading…</div></Page>;
  const role = data.roles.find((r) => `${r.id}@${r.version}` === roleKey) ?? null;
  const config = configs.find((c) => role && c.id === role.id && c.version === role.version) ?? null, labels = config ? labelsFor(config) : new Map<string, string>();

  const upload = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !role) return;
    setBusy("Reading the PDF and extracting its text…"); setProblems([]);
    const r = await addCv(file, { id: role.id, version: role.version });
    setBusy(null);
    if (r.ok) { setFile(null); setOpen(r.intake.id); (e.target as HTMLFormElement).reset(); } else setProblems(r.problems);
    void reload();
  };

  return (
    <Page>
      <section className="card pad sc-panel sc-flow">
        <h2 className="sc-step">1. Choose the role</h2>
        {data.roles.length === 0 ? <p className="small">No role has assessment rules set up on this computer.</p> : <>
          <div className="form sc-form" style={{ background: "none", border: "none", padding: 0 }}>
            <div className="f"><label htmlFor="asRole">Role</label><select id="asRole" value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>{data.roles.map((r) => <option key={`${r.id}@${r.version}`} value={`${r.id}@${r.version}`}>{`${r.title} (rules version ${r.version})`}</option>)}</select></div>
          </div>
          {role && <div className="reqsum" style={{ marginTop: 8 }}>
            <span className={`chip ${role.approved ? "c-ok" : "c-warn"}`}>{role.approved ? "Approved rules" : "Test rules — awaiting approval"}</span>
            {!role.intact && <span className="chip c-crit">The rules file has changed since it was fixed</span>}
          </div>}
          {role && <p className="small" style={{ margin: "6px 0 0" }}>{`${role.location}. Role setup: ${role.roleSetup}. Results use exactly these rules; nothing is tuned to a candidate. `}{config && <a href={`#role-${config.role.id}`}>See the rules</a>}</p>}
        </>}
      </section>

      <section className="card pad sc-panel sc-flow">
        <h2 className="sc-step">2. Add a CV</h2>
        <form className="form sc-form" onSubmit={upload}>
          <div className="f"><label htmlFor="asFile">CV (PDF)</label><input id="asFile" type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /><div className="help">The PDF stays in the private scoring folder on this computer. The candidate is shown as "New CV n", never by file name.</div></div>
          {problems.length > 0 && <div className="err" role="alert">{problems.map((p) => <div key={p}>{p}</div>)}</div>}
          {busy && <div className="banner info" role="status">{busy}</div>}
          <div className="row"><button type="submit" className="btn btn-p" disabled={!file || !role || !!busy || !role.intact}>Add CV</button></div>
        </form>
      </section>

      <section className="card pad sc-panel sc-flow">
        <h2 className="sc-step">3–4. Check the text, then assess</h2>
        <p className="small" style={{ margin: "0 0 8px" }}>{data.route.configured ? <><b>AI route: </b>{data.route.label}{!data.route.isAi && <b> — this is a test route, not AI.</b>}</> : <><b>No AI route is set up: </b>{data.route.reason}</>}</p>
        {data.intakes.length === 0 ? <p className="muted small">No CVs have been added yet.</p>
          : data.intakes.map((x) => <IntakeCard key={x.id} x={x} open={open === x.id} onToggle={() => setOpen(open === x.id ? null : x.id)} canAssess={data.route.configured} labels={labels} onChanged={() => { void reload(); onAssessed(); }} />)}
      </section>
    </Page>
  );
}

const Page = ({ children }: { children: ReactNode }) => (
  <>
    <div className="pagehead"><div><h1>Assess a CV</h1><p className="lede">Local test: choose the role, add a CV, check the extracted text, then ask the AI route for a draft assessment. A recruiter reviews every result. Nothing is ranked, rejected, moved or shared.</p></div></div>
    {children}
  </>
);

function IntakeCard({ x, open, onToggle, canAssess, labels, onChanged }: { x: IntakeSummary; open: boolean; onToggle(): void; canAssess: boolean; labels: Map<string, string>; onChanged(): void }) {
  const latest = x.runs[x.runs.length - 1], valid = [...x.runs].reverse().find((r) => r.outcome === "valid");
  const [pages, setPages] = useState<{ page: number; text: string; blinded: string; messages: string[] }[] | null>(null), [showBlinded, setShowBlinded] = useState(false);
  const [reviewer, setReviewer] = useState(""), [result, setResult] = useState<"matches" | "differences found" | "">(""), [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false), [problems, setProblems] = useState<string[]>([]);
  useEffect(() => { if (open && !pages && x.extraction.status === "completed") void intakeText(x.id).then((t) => setPages(t.pages)); }, [open, pages, x.id, x.extraction.status]);
  const status = x.extraction.status !== "completed" ? "Text could not be extracted" : x.review.status !== "matches" ? REVIEW_LABEL[x.review.status] : valid ? "Assessed (draft)" : latest ? (latest.outcome === "failed" ? "Assessment failed" : "AI output rejected") : "Ready to assess";
  const saveReview = async (e: FormEvent) => {
    e.preventDefault();
    if (!result) return;
    setProblems([]);
    const r = await reviewText(x.id, { reviewer, result, notes });
    if (r.ok) onChanged(); else setProblems(r.problems);
  };
  /* Starts a background job; the server returns the running job for repeated clicks, and the button stays disabled
     while one is queued or processing. */
  const job = x.job ?? null, running = active(x), hasResult = job?.state === "ready" || !!valid;
  const [confirming, setConfirming] = useState(false);
  /* A CV with a result needs a second, explicit step (also enforced by the server) before another AI run. */
  const assess = async (confirmNew: boolean) => {
    if (busy || running) return;
    if (hasResult && !confirmNew) { setConfirming(true); return; }
    setBusy(true); setProblems([]); setConfirming(false);
    const r = await assessCv(x.id, confirmNew);
    setBusy(false);
    if (!r.ok) setProblems(r.problems.map((p) => plain(p, labels)));
    onChanged();
  };
  return (
    <div className="box" style={{ marginTop: 10 }}>
      <div className="sec-h" style={{ marginBottom: 0 }}>
        <h3 style={{ margin: 0 }}>{x.label}<span className="xs muted" style={{ fontWeight: 400 }}>{` · added ${when(x.uploadedAt)}`}</span></h3>
        {job ? <span className={`chip ${JOB_CHIP[job.state]}`}>{JOB_LABEL[job.state]}</span>
          : <span className={`chip ${valid ? "c-info" : x.extraction.status !== "completed" || x.review.status === "differences" ? "c-warn" : "c-mute"}`}>{status}</span>}
        <button type="button" className="btn btn-s btn-sm" onClick={onToggle} aria-expanded={open}>{open ? "Close" : "Open"}</button>
      </div>
      {open && <>
        <h4 className="sc-sub">Extraction</h4>
        {x.extraction.status === "completed" ? <p className="small" style={{ margin: 0 }}>{`Text was read from ${x.extraction.pages} page${x.extraction.pages === 1 ? "" : "s"}.`}{x.blinding && ` ${x.blinding.replacements} ${x.blinding.replacements === 1 ? "name or contact detail was" : "names or contact details were"} hidden from the copy the AI reads. ${x.blinding.itemsToCheck} possible ${x.blinding.itemsToCheck === 1 ? "identifier or personal detail remains and is" : "identifiers or personal details remain and are"} listed for a person to check. Hiding names is not full anonymisation.`}</p>
          : <div className="banner warn" role="alert">{x.extraction.messages.join(" ")}</div>}
        {x.extraction.status === "completed" && (x.extraction.messages.length ? <ul className="small">{x.extraction.messages.map((m) => <li key={m}>{m}</li>)}</ul> : <p className="xs muted">No page problems were detected. That is not a check against the PDF.</p>)}

        {x.extraction.status === "completed" && <>
          <h4 className="sc-sub">Check the text against the PDF</h4>
          <p className="small" style={{ margin: "0 0 6px" }}>Open the PDF you added in your own PDF viewer and compare it with the text below. Assessment uses this text, so missing or jumbled text must be caught here.</p>
          <label className="small"><input type="checkbox" checked={showBlinded} onChange={(e) => setShowBlinded(e.target.checked)} style={{ width: "auto", marginRight: 6 }} />Show the copy the AI reads (names and contact details hidden)</label>
          <div className="sc-text">{pages === null ? <p className="xs muted">Loading text…</p> : pages.map((p) => <div key={p.page}><div className="xs muted" style={{ margin: "8px 0 2px" }}>{`Page ${p.page}`}{p.messages.length > 0 && ` · ${p.messages.join(" ")}`}</div><pre>{showBlinded ? p.blinded : p.text}</pre></div>)}</div>
          {x.review.status === "not reviewed" || x.review.status === "partly" ? (
            <form className="form sc-form" onSubmit={saveReview} style={{ marginTop: 10 }}>
              <div className="f"><span className="small" style={{ fontWeight: 600 }}>Does the text match the PDF?</span>
                <label className="small" style={{ display: "block", fontWeight: 400 }}><input type="radio" name={`r-${x.id}`} checked={result === "matches"} onChange={() => setResult("matches")} style={{ width: "auto", marginRight: 6 }} />Yes, nothing is missing or out of order</label>
                <label className="small" style={{ display: "block", fontWeight: 400 }}><input type="radio" name={`r-${x.id}`} checked={result === "differences found"} onChange={() => setResult("differences found")} style={{ width: "auto", marginRight: 6 }} />No, there are differences</label></div>
              <div className="f"><label htmlFor={`n-${x.id}`}>Notes (optional)</label><textarea id={`n-${x.id}`} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
              <div className="f"><label htmlFor={`w-${x.id}`}>Your name</label><input id={`w-${x.id}`} maxLength={100} value={reviewer} onChange={(e) => setReviewer(e.target.value)} /><div className="help">Recorded as typed. It is not a sign-in.</div></div>
              <div className="row"><button type="submit" className="btn btn-p" disabled={!result || !reviewer.trim()}>Save check</button></div>
            </form>
          ) : <p className="small"><b>{REVIEW_LABEL[x.review.status]}</b>{x.review.by && ` · ${x.review.by}`}{x.review.on && ` · ${when(x.review.on)}`}{x.review.notes && ` · ${x.review.notes}`}</p>}

          <h4 className="sc-sub">Assess</h4>
          {x.review.status === "matches"
            ? <><p className="small" style={{ margin: "0 0 6px" }}>The AI route reads the role's rules, the job description and the copy with names hidden. Its draft is checked before anything is calculated: every quote must be found on its page, and missing information must stay "not confirmed". This can take a few minutes.</p>
              {confirming && !running
                ? <div className="banner info" role="alert"><b>Run a new assessment? </b>It uses your AI allowance. Earlier results are kept.
                    <div className="row"><button type="button" className="btn btn-s" onClick={() => setConfirming(false)}>Cancel</button><button type="button" className="btn btn-p" onClick={() => assess(true)}>Confirm new run</button></div></div>
                : <div className="row"><button type="button" className="btn btn-p" onClick={() => assess(false)} disabled={busy || running || !canAssess}>{running ? JOB_LABEL[job!.state] + "…" : hasResult ? "Assess again" : x.runs.length ? "Try again" : "Assess with AI"}</button></div>}</>
            : <p className="small muted">Check the text first. Assessment is not available until the text is confirmed to match the PDF.</p>}
          {job && <div className={`banner ${job.state === "failed" ? "warn" : "info"}`} role="status" style={{ marginTop: 8 }}>
            <b>{`${JOB_LABEL[job.state]}. `}</b>
            {job.state === "queued" ? "Waiting for the assessment runner. You can leave or refresh this page."
              : job.state === "processing" ? `Started ${when(job.startedAt ?? job.createdAt)}. This runs in the background on this computer; you can leave or refresh this page.`
              : job.state === "ready" ? <>{`Finished ${when(job.finishedAt ?? job.createdAt)}. The result is an AI draft for a recruiter to review. `}<a href={`#c-${job.assessmentId}`}>View result</a></>
              : <>{job.error}{job.problems.length > 0 && <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{job.problems.slice(0, 8).map((p) => <li key={p}>{plain(p, labels)}</li>)}</ul>}</>}
          </div>}
          {problems.length > 0 && <div className="banner warn" role="alert" style={{ marginTop: 8 }}><b>No assessment was made.</b><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{problems.slice(0, 12).map((p) => <li key={p}>{p}</li>)}</ul></div>}

          {x.runs.length > 0 && <>
            <h4 className="sc-sub">Assessment runs (all kept)</h4>
            <ul className="small">{[...x.runs].reverse().map((r) => <li key={r.runId}>
              {`${when(r.at)} · ${r.isAi ? "AI" : "Test route (not AI)"}${r.models.length ? ` · ${r.models.join(", ")}` : ""}${r.durationMs ? ` · ${Math.round(r.durationMs / 1000)} s` : ""} · `}
              {r.outcome === "valid" ? <><b>Accepted.</b> <a href={`#c-${r.assessmentId}`}>View result</a>{r.warnings.length > 0 && ` (${r.warnings.length} note${r.warnings.length === 1 ? "" : "s"} for the reviewer)`}</>
                : r.outcome === "invalid" ? <><b>Rejected: the draft did not pass the checks.</b><ul>{r.problems.slice(0, 8).map((p) => <li key={p}>{plain(p, labels)}</li>)}{r.problems.length > 8 && <li>{`…and ${r.problems.length - 8} more`}</li>}</ul></>
                : <><b>Failed:</b> {r.problems[0] ?? "the AI route did not return a draft."}</>}
            </li>)}</ul>
          </>}
        </>}
      </>}
    </div>
  );
}
