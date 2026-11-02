import {InfoIcon} from "../components/icons";
import { CandidateSummary } from "./CandidateSummary";
import { demoSummary } from "./demoSummary";
import {readBoardAction} from "./boardActions";
import { useCandidatesHref, useCandidateReturn } from "../lib/candidatesRoute";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {CandidateDetailFrame,RecruiterScreening} from "./CandidateDetailFrame";
import {useDetailLocation} from "./detailNavigation";
import {demoCandidateRows} from "./Candidates";
import { useToast } from "../components/Toast";
import { useAct, useData } from "../data/DataProvider";
import { CURRENT_USER, TODAY, type ReqStatus, type Stage, type Submission } from "../data/fixtures";
import { DECLINE_CATEGORIES, permitted, savedHeading, savedToast, validationError, type DemoAction } from "../domain/actions";
import { nextStep, otherSubmissions, roleOf } from "../domain/candidates";
import { fd } from "../lib/dates";

/* Candidate page for one submission (2h vCand): header, four tabs, and the Next step panel with the client's actions.
   Actions change only this submission and are saved in this browser; nothing is sent. */

const REQ_ST: Record<ReqStatus, [string, string]> = { sup: ["Supported", "c-ok"], part: ["Partly supported", "c-info"], none: ["Not evidenced", "c-mute"], notmet: ["Confirmed not met", "c-warn"] };
const first = (name: string) => name.split(" ")[0];
const mmss = (sec: number) => { const n = Math.max(0, Math.round(sec || 0)); return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`; };


/** An open form: a stage move (to a stage), a decline, or interview feedback. */
type Form = { kind: "move"; to: Exclude<Stage, "Declined"> } | { kind: "decline" } | { kind: "feedback" };

export function CandidatePage({ id }: { id: string }) {
  const candidatesHref=useCandidatesHref();
  const back=useCandidateReturn();
  const data = useData(), c = data.subs.find((s) => s.id === id);
  const {tab,setTab,from}=useDetailLocation();
  const [form, setForm] = useState<Form | null>(()=>{if(!c||typeof location==='undefined')return null;const p=permitted(data,c);return readBoardAction(location.hash,p.moveTo,p.decline);}), [saved, setSaved] = useState<string | null>(null);
  if (!c) return <p>Candidate not found. <a href={candidatesHref}>Back to Candidates</a></p>;

  const role = roleOf(data, c), others = otherSubmissions(data, c), t = nextStep(c, TODAY), rows=demoCandidateRows(data,TODAY), row=rows.find(r=>r.id===c.id)!;
  const outcome = c.outcome ? `${c.outcome.status} · recorded by Revenue Optics ${fd(c.outcome.d)}` : c.stage === "Offer" || c.stage === "Hired" ? "Not recorded yet" : null;
  const seek = () => setTab("interview");
  /* "Source: …" line under the evidence. Interview times and Resume open that tab; other sources are plain text. */
  const src = (s: string) => s.startsWith("Interview") ? <>Source: <button type="button" className="btn-link" data-seek={s.split(" ")[1]} onClick={() => seek()}>{s}</button></>
    : s === "Resume" ? <>Source: <button type="button" className="btn-link" data-tab="resume" onClick={() => setTab("resume")}>Resume</button></> : `Source: ${s}`;

  return (
    <CandidateDetailFrame id={c.id} name={c.name} headline={c.head} location={c.loc} stage={c.stage} shared={c.shared}
      facts={Object.entries(c.facts).map(([label,value])=>({label,value}))} role={{...role,location:role.loc}} others={others.map(o=>({id:o.id,title:roleOf(data,o).title,stage:o.stage}))}
      rows={rows} roles={data.roles} today={TODAY} back={back} from={from} tab={tab} setTab={setTab} rail={
        <aside className="card act" aria-label="Next step"><div className="pad">
          <h2>Next step</h2>
          <div className={`nextbox ${t.cls}`}><b>{t.long}</b>{t.sub && <span className="small">{t.sub}</span>}</div>
          <dl className="statusdl"><dt>Recruiter screening</dt><dd>{c.iv?`Held ${fd(c.iv.date)} by ${c.iv.by}`:row.screening}</dd>{outcome && <><dt>Offer status</dt><dd>{outcome}</dd></>}<dt>Recruiter</dt><dd>{`${role.contact}, Revenue Optics`}</dd></dl>
          <Actions c={c} form={form} saved={saved} onOpen={setForm} onDone={(a) => { setForm(null); setSaved(savedHeading(a)); }} />
          <p className="mock"><InfoIcon/><span>Mockup: actions are saved only in this browser. Nothing is sent to your recruiter.</span></p>
        </div></aside>}>
      {tab === "summary" ? <Summary c={c} src={src} /> : tab === "interview" ? <Interview c={c} /> : tab === "resume" ? <Resume c={c} /> : <Notes c={c} />}
    </CandidateDetailFrame>
  );
}

function Summary({ c, src }: { c: Submission; src: (s: string) => ReactNode }) {
  const role = roleOf(useData(), c), copy = demoSummary(c);
  return <CandidateSummary roleTitle={role.title} summary={copy.summary} summaryPoints={copy.summaryPoints} strengths={copy.strengths}
    requirementsVersion={role.reqVer} additionalInformation={copy.additionalInformation} reportedResults={copy.reportedResults}
    requirements={role.req.map((q, i) => {
      const e = c.req[i] ?? (["none", "Not mentioned.", ""] as const);
      return { id: String(i), tier: q[1] === "must" ? "must" : "preferred", text: q[0], status: REQ_ST[e[0]][0], statusClass: REQ_ST[e[0]][1], evidence: e[1], source: e[2] ? src(e[2]) : undefined, concerns: copy.concernsByRequirement[i] };
    })} />;
}

function Interview({c}:{c:Submission}) {
  if(!c.iv)return <p className="muted">No screening interview has been shared for this candidate.</p>;
  const v=c.iv;
  return <RecruiterScreening date={v.date} duration={v.dur} by={v.by} summary={v.summary} notes={v.notes} moments={v.moments.map(([minute,label])=>({time:mmss(minute*60),label}))} demo/>;
}

function Resume({ c }: { c: Submission }) {
  const [title, company] = c.head.split(" · ");
  return (
    <>
      <div className="banner info">Contact details withheld. Reach the candidate through your recruiter.</div>
      <div className="doc"><h2 style={{ fontSize: 20 }}>{c.name}</h2><p className="small">{`${c.loc} · `}<span className="withheld">Email and phone withheld</span></p>
        <h3>Summary</h3><p>{c.why}</p>
        <h3>Experience</h3><p><b>{title}</b>{`, ${company || ""}`}</p><p className="small muted">2022 – present</p>
        <ul>{c.req.filter((x) => x[2] === "Resume").map((x, i) => <li key={i}>{x[1]}</li>)}</ul>
        <h3>Earlier roles</h3><p className="small">Earlier roles summarised by Revenue Optics. Full history available on request.</p>
      </div>
    </>
  );
}

function Notes({ c }: { c: Submission }) {
  const data = useData(), mine = data.notes[c.id] || [], hist = data.hist[c.id] || [[c.shared, `Revenue Optics shared ${first(c.name)} for this role`]];
  const by = (d: string) => <p className="xs muted" style={{ margin: "6px 0 0" }}>{`${CURRENT_USER.name} · ${fd(d)}`}</p>;
  return (
    <>
      <div className="sec-h"><h2>Your notes on this candidate</h2><span className="xs muted">Not shared with the candidate.</span></div>
      {c.declineNote && <div className="box" style={{ marginBottom: 10 }}><b>Decline note</b> <span className="chip c-mute">{c.declineNote.cat}</span><p style={{ margin: "6px 0 0" }}>{c.declineNote.text}</p>{by(c.declineNote.date)}</div>}
      {mine.map((n, i) => <div key={i} className="box" style={{ marginBottom: 10 }}><b>{n.kind}</b>{n.about && <> <span className="xs muted">{`about ${n.about}`}</span></>}<p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{n.text}</p>{by(n.d)}</div>)}
      {!c.declineNote && !mine.length && <p className="muted small">No notes yet. Notes you add with a decision or after an interview appear here.</p>}
      <h2 style={{ margin: "22px 0 8px" }}>History</h2>
      <ol className="hist">{hist.slice().reverse().map((x, i) => <li key={i}><span className="t">{fd(x[0])}</span><span>{x[1]}</span></li>)}</ol>
    </>
  );
}

/* The Next step panel's actions (2h actions() and formHtml()). */
function Actions({ c, form, saved, onOpen, onDone }: {
  c: Submission; form: Form | null; saved: string | null; onOpen: (f: Form | null) => void; onDone: (a: DemoAction) => void;
}) {
  const candidatesHref=useCandidatesHref();
  const data = useData(), role = roleOf(data, c), p = permitted(data, c);
  if (saved) return (
    <>
      <div className="nextbox done" style={{ marginBottom: 4 }}><b>{saved}</b><span className="small">Saved in this mockup only. Nothing was sent.</span></div>
      <a className="btn btn-p" href={candidatesHref} id="backPipe">Back to pipeline</a>
    </>
  );
  if (form) return <ActionForm c={c} form={form} onCancel={() => onOpen(null)} onDone={onDone} />;
  if (c.stage === "Declined") return <p className="small muted">{`You declined ${first(c.name)} for this role. The note is in Notes and history.`}</p>;
  if (c.stage === "Hired" && c.outcome) return <p className="small muted">Nothing more is needed here.</p>;
  if (c.stage === "Hired") return <p className="small muted">Hired stage saved. Revenue Optics will record whether the offer was accepted.</p>;

  const decline = <button type="button" className="btn btn-d" data-form="decline" onClick={() => onOpen({ kind: "decline" })}>Decline</button>;
  return (
    <>
      <div className="abtns">
        {c.stage === "To review" && p.decline && <>
          <button type="button" className="btn btn-p" data-form="interview" onClick={() => onOpen({ kind: "move", to: "Interview" })}>Move to Interview</button>
          {decline}
        </>}
        {p.feedback && <button type="button" className={`btn ${c.next.kind === "feedback" ? "btn-p" : "btn-s"}`} data-form="feedback" onClick={() => onOpen({ kind: "feedback" })}>Share interview feedback</button>}
        {c.stage !== "To review" && p.decline && decline}
        {role.status === "On hold" && c.stage === "To review" && <p className="small muted">This role is on hold, so stage changes are paused.</p>}
      </div>
    </>
  );
}

function ActionForm({ c, form, onCancel, onDone }: { c: Submission; form: Form; onCancel: () => void; onDone: (a: DemoAction) => void }) {
  const data = useData(), act = useAct(), toast = useToast(), ref = useRef<HTMLFormElement>(null);
  const [note, setNote] = useState(""), [times, setTimes] = useState(""), [cat, setCat] = useState(DECLINE_CATEGORIES[0]);
  const [about, setAbout] = useState(c.client.date ? `Interview on ${fd(c.client.date)}` : "General feedback"), [err, setErr] = useState<string | null>(null);
  /* As in 2h, the first field gets focus when the form opens. */
  useEffect(() => { ref.current?.querySelector<HTMLElement>("textarea, input")?.focus(); }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const a: DemoAction = form.kind === "decline" ? { type: "decline", sid: c.id, text: note, cat, d: TODAY }
      : form.kind === "feedback" ? { type: "feedback", sid: c.id, about, text: note, d: TODAY }
      : { type: "move", sid: c.id, to: form.to, note, ...(form.to === "Interview" ? { times } : {}), d: TODAY };
    const problem = validationError(a);
    if (problem) { setErr(problem); ref.current?.querySelector<HTMLElement>("#fNote")?.focus(); return; }
    if (!act(a)) { setErr("This change is no longer available for this candidate."); return; }
    toast(savedToast(a));
    onDone(a);
  };
  const error = err && <div className="err">{err}</div>;
  const buttons = (label: string, cls: string) => <div className="row"><button type="button" className="btn btn-s" data-cancel onClick={onCancel}>Cancel</button><button type="submit" className={`btn ${cls}`}>{label}</button></div>;
  const textarea = <textarea id="fNote" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />;

  if (form.kind === "decline") return (
    <form className="form" id="actForm" ref={ref} onSubmit={submit}><h3 style={{ marginBottom: 10 }}>{`Decline for ${roleOf(data, c).title}`}</h3>
      <div className="f"><label htmlFor="fNote">Decline note (required)</label>{textarea}{error}<div className="help">Keep to job-related points. Not shared with the candidate.</div></div>
      <div className="f"><label htmlFor="fCat">Reason category (optional)</label><select id="fCat" value={cat} onChange={(e) => setCat(e.target.value)}>{DECLINE_CATEGORIES.map((x) => <option key={x}>{x}</option>)}</select></div>
      {buttons("Decline", "btn-d")}
    </form>
  );
  if (form.kind === "feedback") return (
    <form className="form" id="actForm" ref={ref} onSubmit={submit}><h3 style={{ marginBottom: 10 }}>Interview feedback</h3>
      <div className="f"><label htmlFor="fAbout">About</label><input id="fAbout" value={about} onChange={(e) => setAbout(e.target.value)} /></div>
      <div className="f"><label htmlFor="fNote">Your feedback (required)</label>{textarea}{error}<div className="help">Feedback does not change the stage.</div></div>
      {buttons("Share feedback", "btn-p")}
    </form>
  );
  const to = form.to, big = to === "Offer" || to === "Hired";
  return (
    <form className="form" id="actForm" ref={ref} onSubmit={submit}><h3 style={{ marginBottom: 10 }}>{`Move to ${to}`}</h3>
      {to === "Interview" && <div className="f"><label htmlFor="fTimes">Times that suit you (optional)</label><input id="fTimes" placeholder="For example: Tue or Wed afternoon" value={times} onChange={(e) => setTimes(e.target.value)} /><div className="help">Revenue Optics arranges the interview. A request is not a booking.</div></div>}
      {big && <div className="banner warn" style={{ margin: "0 0 10px" }}>{`This saves the ${to} stage only. It does not record that an offer was ${to === "Hired" ? "accepted" : "made"}; Revenue Optics records that separately.`}</div>}
      <div className="f"><label htmlFor="fNote">Note for the recruiter (optional)</label>{textarea}</div>
      {error}
      {buttons(`Move to ${to}`, "btn-p")}
    </form>
  );
}
