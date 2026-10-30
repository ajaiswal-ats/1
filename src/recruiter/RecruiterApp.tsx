import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import logo from "../assets/revenue-optics-logo.png";
import { readPortalConfig } from "../auth/config";
import { createAuthController, type AuthController, type AuthState } from "../auth/session";
import { calculateCv } from "../scoring/calculator";
import { starterRouting } from "../scoring/routing";
import { stateText, type InputState } from "../scoring/versions";
import { createGateway, initialReview, shareProblems, type Assessment, type AssessmentRow, type Gateway, type Inputs, type Review, type RpcClient } from "./data";

const controllers = new Map<string, { auth: AuthController; gateway: Gateway }>();
function connection(url: string, key: string) {
  const id = `${url} ${key}`, found = controllers.get(id);
  if (found) return found;
  // A separate staff session: signing into the client portal never grants recruiter access.
  const client = createClient(url, key, { auth: { storageKey: "ro-recruiter-auth", detectSessionInUrl: false } });
  const gateway = createGateway(client as unknown as RpcClient);
  const auth = createAuthController(client.auth, async (userId) => {
    const a = await gateway.account();
    return a && a.userId === userId ? { kind: "active", client: { id: "staff", name: "Revenue Optics" },
      member: { id: a.userId, clientId: "staff", displayName: a.displayName, jobTitle: "Recruiter" } } : { kind: "none" };
  });
  const result = { auth, gateway }; controllers.set(id, result); return result;
}

export function RecruiterApp() {
  const config = readPortalConfig(import.meta.env);
  if (config.mode !== "supabase") return <Gate title="Recruiter workspace not configured"><p>{config.mode === "invalid" ? config.problem : "This workspace needs the portal's Supabase configuration. It never opens a fictional or local assessment in place of a signed-in account."}</p></Gate>;
  return <Connected {...connection(config.url, config.key)} />;
}

function Connected({ auth, gateway }: { auth: AuthController; gateway: Gateway }) {
  useEffect(() => auth.start(), [auth]);
  const state = useSyncExternalStore(auth.subscribe, auth.getState);
  if (state.status !== "ready") return <RecruiterSignIn state={state} auth={auth} />;
  return <RecruiterWorkspace key={state.user.id} gateway={gateway} name={state.member.displayName} signOut={auth.signOut} />;
}

function Gate({ title, children }: { title: string; children: ReactNode }) {
  return <main className="auth rec-auth"><section className="auth-card"><div className="auth-brand"><img src={logo} alt="Revenue Optics" /></div><div className="auth-body"><p className="auth-kicker">Recruiter workspace</p><h1>{title}</h1>{children}</div></section></main>;
}

function RecruiterSignIn({ state, auth }: { state: AuthState; auth: AuthController }) {
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");
  if (state.status === "signed-out") {
    const submit = (event: FormEvent) => { event.preventDefault(); void auth.signIn(email, password).then(() => setPassword("")); };
    return <Gate title="Sign in to review candidates"><p className="auth-lede">For authorised Revenue Optics recruiters. Client accounts cannot open this workspace.</p>
      {state.error && <p className="auth-msg crit" role="alert">{state.error}</p>}{state.notice && <p role="status">{state.notice}</p>}
      <form onSubmit={submit}><div className="auth-field"><label htmlFor="staff-email">Work email</label><input id="staff-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={state.pending} /></div>
        <div className="auth-field"><label htmlFor="staff-password">Password</label><input id="staff-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} disabled={state.pending} /></div>
        <button className="btn btn-p auth-submit" disabled={state.pending}>{state.pending ? "Signing in…" : "Sign in"}</button></form>
      <p className="auth-foot">Access is granted by the workspace administrator. <a href="/">Open client sign-in</a></p></Gate>;
  }
  if (state.status === "restoring" || state.status === "loading") return <Gate title="Checking recruiter access…"><p role="status">Restoring your session and checking your staff access.</p></Gate>;
  return <Gate title={state.status === "no-access" ? "No recruiter access" : "Recruiter workspace unavailable"}>
    <p role={state.status === "error" ? "alert" : "status"}>{state.status === "error" ? "Your recruiter access could not be checked. The recruiter database setup may still be pending, or the service could not be reached. Try again or contact the workspace administrator." : "This account is not an active recruiter account. Ask the workspace administrator to check your access."}</p>
    <div className="auth-actions">{state.status === "error" && <button className="btn btn-p" onClick={auth.retry}>Try again</button>}<button className="btn btn-s" onClick={() => void auth.signOut()}>Sign out</button></div></Gate>;
}

export function RecruiterWorkspace({ gateway, name, signOut }: { gateway: Gateway; name: string; signOut(): void }) {
  const dirty = useRef(false), [route, setRoute] = useState(() => location.hash.slice(1)), [refresh, setRefresh] = useState(0), [notice, setNotice] = useState("");
  useEffect(() => {
    let previous = location.hash;
    const change = () => {
      if (dirty.current && !window.confirm("Discard your unsaved assessment changes?")) { history.replaceState(null, "", `${location.pathname}${previous}`); return; }
      previous = location.hash; dirty.current = false; setRoute(location.hash.slice(1)); setNotice(""); window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", change); return () => window.removeEventListener("hashchange", change);
  }, []);
  const id = /^assessment-([a-f0-9-]{36})$/.exec(route)?.[1];
  const reload = (message: string) => { dirty.current = false; setNotice(message); setRefresh((x) => x + 1); };
  return <div className="recruiter"><header className="rec-header"><a href="#" className="rec-brand"><img src={logo} alt="Revenue Optics" /><span>Recruiter workspace</span></a><div><span>{name}</span><button type="button" className="btn btn-s" onClick={() => { if (!dirty.current || window.confirm("Discard your unsaved changes and sign out?")) signOut(); }}>Sign out</button></div></header>
    <div className="rec-body"><nav className="rec-nav" aria-label="Recruiter navigation"><a href="#" aria-current={!id ? "page" : undefined}>Candidate assessments</a><span>Internal review</span></nav>
      <main id="page" className="rec-main">{notice && <p className="banner" role="status">{notice}</p>}
        {id ? <AssessmentLoader key={`${id}:${refresh}`} id={id} gateway={gateway} onSaved={reload} onDirty={(value) => { dirty.current = value; }} />
          : <AssessmentList key={refresh} gateway={gateway} />}</main></div></div>;
}

function AssessmentList({ gateway }: { gateway: Gateway }) {
  const [rows, setRows] = useState<AssessmentRow[] | null>(null), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  useEffect(() => { let active = true; gateway.list().then((data) => { if (active) { setRows(data); setError(""); } }, (e: unknown) => { if (active) setError(message(e)); }); return () => { active = false; }; }, [gateway, retry]);
  return <><div className="pagehead"><div><p className="rec-kicker">Recruiter tools</p><h1>Candidate assessments</h1><p className="lede">Review CV evidence, record screening and prepare summaries for clients.</p></div><button className="btn btn-s" onClick={() => { setRows(null); setRetry((x) => x + 1); }}>Refresh</button></div>
    <p className="rec-note">CV intake and AI drafting currently run in the local assessment tool. Imported assessments appear here for review; importing never shares them with a client.</p>
    {error ? <ErrorBox error={error} retry={() => setRetry((x) => x + 1)} /> : rows === null ? <p role="status">Loading assessments…</p> : <section className="card rec-table"><table><thead><tr><th>Candidate</th><th>Client and role</th><th>Review</th><th><span className="sr">Open assessment</span></th></tr></thead><tbody>
      {rows.map((a) => <tr key={a.id}><td><b>{a.candidate}</b><span className="rec-secondary">Version {a.revision}</span></td><td>{a.client}<span className="rec-secondary">{a.role}</span></td><td><span className={`chip ${a.published ? "c-good" : a.reviewed ? "c-info" : "c-warn"}`}>{a.published ? "Summary shared" : a.reviewed ? "Reviewed · not shared" : "Needs review"}</span></td><td><a className="btn btn-s" href={`#assessment-${a.id}`} aria-label={`Review ${a.candidate}`}>Review</a></td></tr>)}
    </tbody></table>{rows.length === 0 && <div className="rempty"><h2>No assessments to review</h2><p>Assessments appear after the administrator imports them and assigns you access to their client.</p></div>}</section>}</>;
}

function AssessmentLoader({ id, gateway, onSaved, onDirty }: { id: string; gateway: Gateway; onSaved(message: string): void; onDirty(value: boolean): void }) {
  const [a, setAssessment] = useState<Assessment | null>(null), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  useEffect(() => { let active = true; gateway.get(id).then((data) => { if (active) { setAssessment(data); setError(""); } }, (e: unknown) => { if (active) setError(message(e)); }); return () => { active = false; }; }, [id, gateway, retry]);
  if (error) return <ErrorBox error={error} retry={() => setRetry((x) => x + 1)} />;
  if (!a) return <p role="status">Loading the assessment…</p>;
  return <AssessmentEditor assessment={a} gateway={gateway} onSaved={onSaved} onDirty={onDirty} />;
}

const TABS = ["CV assessment", "Screening", "Client summary", "Review history"] as const;
type Tab = typeof TABS[number];
const essentialLabels = { Pass: "Met", Fail: "Not met", Unknown: "Not confirmed" };
const criterionState = (s: Inputs["criteria"][number]) => s.status === "rated" ? String(s.rating) : s.status;

export function AssessmentEditor({ assessment: a, gateway, onSaved, onDirty }: { assessment: Assessment; gateway: Gateway; onSaved(message: string): void; onDirty(value: boolean): void }) {
  const [inputs, setInputs] = useState<Inputs>(() => structuredClone(a.inputs)), [review, setReview] = useState<Review>(() => initialReview(a));
  const [tab, setTab] = useState<Tab>("CV assessment"), [reason, setReason] = useState(""), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [confirmShare, setConfirmShare] = useState(false);
  const result = useMemo(() => calculateCv(a.rubric, inputs.gates, inputs.criteria), [a.rubric, inputs]);
  const blockers = shareProblems(a), shareBlocked = dirty || busy || blockers.length > 0;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", leave); return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  function editReview(next: Partial<Review>) { setReview((r) => ({ ...r, ...next })); setDirty(true); setConfirmShare(false); }
  function changeInput(id: string, value: string, gate: boolean) {
    if (gate) setInputs((x) => ({ ...x, gates: x.gates.map((g) => g.id === id ? { id, result: value as GateInputResult } : g) }));
    else setInputs((x) => ({ ...x, criteria: x.criteria.map((c) => c.id === id ? (value === "unknown" || value === "disputed" ? { id, status: value } : { id, status: "rated", rating: Number(value) }) : c) }));
    setDirty(true); setConfirmShare(false);
  }
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { await gateway.save(a, inputs, review, reason.trim()); onSaved("Recruiter review saved. Nothing was shared with the client."); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function share() {
    setBusy(true); setError("");
    try { await gateway.share(a); onSaved("The reviewed summary is now shared in the client's candidate page. No notification was sent."); }
    catch (e) { setError(message(e)); } finally { setBusy(false); setConfirmShare(false); }
  }
  function correction(id: string, current: InputState, previous: InputState) {
    if (stateText(current) === stateText(previous)) return null;
    const c = review.changes.find((x) => x.id === id) ?? { id, source: "cv" as const, evidence: "", reason: "" };
    const update = (next: Partial<typeof c>) => editReview({ changes: [...review.changes.filter((x) => x.id !== id), { ...c, ...next }] });
    return <div className="rec-correction"><p>Changed from {stateText(previous)}. Record the evidence for this correction.</p>
      <label>Evidence source<select value={c.source} onChange={(e) => update({ source: e.target.value as "cv" | "screening" })}><option value="cv">CV / recruiter verification</option><option value="screening">Screening call</option></select></label>
      <label>Evidence<textarea minLength={5} maxLength={2000} value={c.evidence} onChange={(e) => update({ evidence: e.target.value })} /></label>
      <label>Reason for correction<textarea minLength={5} maxLength={2000} value={c.reason} onChange={(e) => update({ reason: e.target.value })} /></label></div>;
  }
  return <><a className="rec-back" href="#">← Candidate assessments</a><header className="pagehead"><div><p className="rec-kicker">{a.client} · {a.role}</p><h1>{a.candidate}</h1><p className="lede">Version {a.revision} · {a.preparedBy}</p></div><span className="chip c-info">Internal review</span></header>
    {!a.rubric.approved && <p className="banner warn">Draft scoring rules · reviews can be saved, but client sharing stays blocked until these rules are approved.</p>}
    <div className="rec-stats"><section className="card"><span>CV assessment</span><b>{result.score === null ? "No score" : `${result.score} / 100`}</b><p>{result.band ?? result.reason}</p>{result.capApplied && <p>Score limited by a critical skill gap.</p>}</section><section className="card"><span>Next review step</span><p>{starterRouting(result).text}</p></section><section className="card"><span>Client summary</span><b>{a.published ? "Shared" : a.reviewed ? "Reviewed" : "Not reviewed"}</b><p>{dirty ? "You have unsaved changes." : a.published ? "This saved version is visible to the client." : "Internal until explicitly shared."}</p></section></div>
    <nav className="rec-tabs" aria-label="Assessment sections">{TABS.map((t) => <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>)}</nav>
    <form onSubmit={(e) => void save(e)} className="rec-form"><fieldset disabled={busy}>
      <div hidden={tab !== "CV assessment"}>
        <section className="card rec-section"><h2>Essential requirements</h2><p>These checks add no points. Missing information is not a failure.</p>{a.rubric.gates.map((g) => { const now = inputs.gates.find((x) => x.id === g.id)!, prev = a.inputs.gates.find((x) => x.id === g.id)!; return <div className="rec-item" key={g.id}><label>{g.label}<select value={now.result} onChange={(e) => changeInput(g.id, e.target.value, true)}>{Object.entries(essentialLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><Evidence id={g.id} assessment={a} />{correction(g.id, { status: "gate", result: now.result }, { status: "gate", result: prev.result })}</div>; })}</section>
        <section className="card rec-section"><h2>CV skills and evidence</h2><p>Rate only against the written guide. An unknown skill is excluded from the score; silence is never zero.</p>{a.rubric.criteria.filter((c) => c.included).map((c) => { const now = inputs.criteria.find((x) => x.id === c.id)!, prev = a.inputs.criteria.find((x) => x.id === c.id)!; return <div className="rec-item" key={c.id}><label>{c.label}<span className="rec-secondary">{c.importance} · weight {c.weight}</span><select value={criterionState(now)} onChange={(e) => changeInput(c.id, e.target.value, false)}><option value="unknown">Not confirmed</option><option value="disputed">Conflicting</option>{Array.from({ length: c.max + 1 }, (_, n) => n).filter((n) => !c.unavailableLevels?.includes(n)).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <details><summary>Rating guide</summary><ul>{Object.entries(c.anchors).map(([n, text]) => <li key={n}><b>{n}: </b>{text}</li>)}</ul>{c.testRule && <p>{c.testRule}</p>}</details><Evidence id={c.id} assessment={a} />{correction(c.id, now, prev)}</div>; })}</section>
        <details className="card rec-section"><summary>How the CV result is calculated</summary><p>Points {result.points} / possible {result.possible}. Evidence coverage: {result.knownWeight} of {result.totalWeight} weighted points; critical coverage {result.criticalKnownWeight} of {result.criticalTotalWeight}.</p><p>{result.reason ?? `Raw result ${result.raw?.toFixed(1)}; final result ${result.score}.`}</p><p>Rules: {a.rubric.id}, version {a.rubric.version}. CV and screening are kept separate.</p></details>
      </div>
      <section hidden={tab !== "Screening"} className="card rec-section"><h2>Screening answers and ratings</h2><p>Record the candidate's answers, then rate against the answer points. Unanswered questions stay unrated. An overall screening score and combined score are not calculated.</p>
        {!a.screeningQuestions.length && <p>No screening question set has been imported for these rules. No questions or ratings have been invented.</p>}
        {a.screeningQuestions.map((q) => { const answer = review.screening.find((x) => x.id === q.id)!; const update = (next: Partial<typeof answer>) => editReview({ screening: review.screening.map((x) => x.id === q.id ? { ...x, ...next } : x) }); return <div className="rec-item" key={q.id}><h3>{q.text}</h3><details><summary>Answer points</summary><ul>{q.answerPoints.map((p) => <li key={p}>{p}</li>)}</ul></details><label>Answer<textarea maxLength={10000} value={answer.answer} onChange={(e) => update({ answer: e.target.value })} /></label>
          {q.use === "scored" ? <><label>Rating<select value={answer.rating ?? ""} onChange={(e) => update({ rating: e.target.value === "" ? null : Number(e.target.value) })}><option value="">Not rated</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}</select></label><label>Exact quote from the answer<textarea maxLength={10000} value={answer.quote} onChange={(e) => update({ quote: e.target.value })} /></label><label>Reason for rating<textarea maxLength={2000} value={answer.reason} onChange={(e) => update({ reason: e.target.value })} /></label></> : <p className="rec-secondary">Fact check · not scored</p>}</div>; })}</section>
      <section hidden={tab !== "Client summary"} className="card rec-section"><h2>Prepare the client summary</h2><p>Write only the information you have reviewed for this client. Numeric scores, internal notes and screening ratings stay in this workspace.</p><label>Why this candidate is being shared<textarea maxLength={2000} value={review.whyShared} onChange={(e) => editReview({ whyShared: e.target.value })} /></label><Lines label="Strengths" value={review.strengths} onChange={(strengths) => editReview({ strengths })} /><Lines label="Points to clarify" value={review.pointsToClarify} onChange={(pointsToClarify) => editReview({ pointsToClarify })} />
        <h3>Evidence against agreed role requirements</h3><p>Choose each status explicitly after checking its evidence. Scoring importance does not determine a requirement's status or tier.</p>{!a.setId && <p className="banner warn">This role has no agreed requirement set. A review can be saved, but sharing is unavailable.</p>}
        {a.requirements.map((q) => { const evidence = review.evidence.find((e) => e.requirementId === q.id)!; const update = (next: Partial<typeof evidence>) => editReview({ evidence: review.evidence.map((e) => e.requirementId === q.id ? { ...e, ...next } : e) }); return <div className="rec-item" key={q.id}><h3>{q.text}</h3><p className="rec-secondary">{q.tier === "must" ? "Must-have" : "Preferred"}</p><label>Reviewed status<select value={evidence.status} onChange={(e) => update({ status: e.target.value as typeof evidence.status })}><option value="">Choose after review</option><option value="supported">Supported</option><option value="partly_supported">Partly supported</option><option value="not_evidenced">Not evidenced</option><option value="confirmed_not_met">Confirmed not met</option></select></label><label>Evidence for the client<textarea maxLength={1000} value={evidence.evidence} onChange={(e) => update({ evidence: e.target.value })} /></label><label>Source label<input maxLength={120} value={evidence.source} onChange={(e) => update({ source: e.target.value })} /></label></div>; })}
        <details className="rec-section"><summary>Preview what the client will see</summary><h3>Why shared</h3><p>{review.whyShared || "Not written yet."}</p><h3>Strengths</h3><ul>{review.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul><h3>Points to clarify</h3><ul>{review.pointsToClarify.map((x, i) => <li key={i}>{x}</li>)}</ul></details></section>
      <section hidden={tab !== "Review history"} className="card rec-section"><h2>Review history</h2><p>The original assessment is retained. Each saved review records its author, reason and time.</p><details><summary>Original imported assessment</summary><ul>{a.originalInputs.gates.map((g) => <li key={g.id}>{a.rubric.gates.find((x) => x.id === g.id)?.label}: {essentialLabels[g.result]}</li>)}{a.originalInputs.criteria.map((c) => <li key={c.id}>{a.rubric.criteria.find((x) => x.id === c.id)?.label}: {criterionState(c)}</li>)}</ul></details>{!a.history.length && <p>No recruiter reviews have been saved.</p>}<ol className="rec-history">{a.history.map((h, i) => <li key={i}><b>Version {h.revision} · {h.kind === "share" ? "Client summary shared" : "Review saved"}</b><span className="rec-secondary">{h.reviewer} · {new Date(h.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</span><p>{h.reason}</p>{h.changes?.map((c) => <details key={c.id}><summary>{a.rubric.criteria.find((x) => x.id === c.id)?.label ?? a.rubric.gates.find((x) => x.id === c.id)?.label ?? c.id}</summary><p>{c.evidence}</p><p>{c.reason} · {c.source === "screening" ? "Screening call" : "CV / recruiter verification"}</p></details>)}</li>)}</ol></section>
      <section className="card rec-section rec-decision"><h2>Recruiter decision</h2><p>Save your review first. Sharing the reviewed client summary is a separate action.</p><label>Decision<select value={review.decision} onChange={(e) => editReview({ decision: e.target.value as Review["decision"] })}><option value="hold">Hold — more information needed</option><option value="forward" disabled={inputs.gates.some((g) => g.result === "Fail") || inputs.criteria.some((c) => c.status === "disputed")}>Put forward to the client</option><option value="decline">Do not put forward</option></select></label><label>Reason for decision<textarea required minLength={10} maxLength={2000} value={review.decisionReason} onChange={(e) => editReview({ decisionReason: e.target.value })} /></label><label>What did you review or change?<textarea required minLength={10} maxLength={2000} value={reason} onChange={(e) => { setReason(e.target.value); setDirty(true); }} /></label><p className="rec-secondary">Your signed-in recruiter account and the save time are recorded automatically.</p>
        {error && <p className="banner warn" role="alert">{error}</p>}<div className="rec-actions"><button className="btn btn-p" type="submit" disabled={busy || !dirty}>{busy ? "Saving…" : "Save recruiter review"}</button><button className="btn btn-s" type="button" disabled={shareBlocked} onClick={() => setConfirmShare(true)}>Share reviewed summary</button></div>
        {(blockers.length > 0 || dirty) && <details className="rec-blockers"><summary>What is needed before sharing?</summary><ul>{dirty && <li>Save your current changes.</li>}{blockers.map((p) => <li key={p}>{p}</li>)}</ul></details>}
        {confirmShare && <div className="rec-share" role="group" aria-label="Confirm client sharing"><h3>Share this saved summary with {a.client}?</h3><p>The reviewed summary and requirement evidence will replace the client's current summary. Internal assessment details stay private. No notification is sent.</p><div className="rec-actions"><button type="button" className="btn btn-p" disabled={shareBlocked} onClick={() => void share()}>Confirm sharing</button><button type="button" className="btn btn-s" onClick={() => setConfirmShare(false)}>Cancel</button></div></div>}
      </section></fieldset></form></>;
}
type GateInputResult = "Pass" | "Fail" | "Unknown";
function Evidence({ id, assessment }: { id: string; assessment: Assessment }) {
  const quotes = assessment.evidence[id] ?? [];
  return quotes.length ? <div className="rec-evidence">{quotes.map((q, i) => <blockquote key={i}><p>{q.quote}</p><cite>CV page {q.page}</cite></blockquote>)}</div> : <p className="rec-secondary">No original CV quote was recorded for this item.</p>;
}
function Lines({ label, value, onChange }: { label: string; value: string[]; onChange(value: string[]): void }) {
  // Keep blank lines while typing; trim/validate when saving, rather than moving the cursor on every keystroke.
  const [text, setText] = useState(value.join("\n"));
  return <label>{label}<span className="rec-secondary">One item per line · up to 20 items, 300 characters each</span><textarea value={text} onChange={(e) => { setText(e.target.value); onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean)); }} /></label>;
}
function ErrorBox({ error, retry }: { error: string; retry(): void }) { return <section className="card rec-section"><p role="alert">{error}</p><button type="button" className="btn btn-s" onClick={retry}>Try again</button></section>; }
function message(error: unknown) { return error instanceof Error ? error.message : "The service could not be reached. Reload to check the saved version before trying again."; }
