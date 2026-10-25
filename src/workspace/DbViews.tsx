import { Fragment, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { CheckIcon, PinIcon, VideoIcon } from "../components/icons";
import type { Stage } from "../data/fixtures";
import { STAGES } from "../domain/candidates";
import { fd, weeksBefore } from "../lib/dates";
import { navFor } from "../lib/route";
import { ProgressView } from "../progress/HiringProgress";
import { Seg, plural, stageColor } from "../progress/shared";
import { ReportDataError, reportData } from "../reporting/fromWorkspace";
import { StatusChip } from "../roles/StatusChip";
import { alsoFor, countByStage, forRole, history, person, roleFor, roleRow, uniquePeople, type DbEvidenceStatus, type DbRole, type DbSubmission, type HistoryEntry, type Workspace } from "./data";
import { DECLINE_CATEGORIES } from "../domain/actions";
import { MOVE_MESSAGES, canDecline, canGiveFeedback, moveTargets, type Intent, type MoveState, type MoveTarget } from "./moves";
import { deriveNext, feedbackTask, interviewLabel, offerStatus, ordered, requirementLine, waitingCount, waitingOnYou } from "./next";
import type { WorkspaceState } from "./store";

/* Supabase-mode pages, drawn only from the loaded workspace data with the reviewed markup and classes (2h). They do not use
   the demo's DataProvider, fixtures or saved demo actions. What the database does not hold yet is marked "not connected"
   or shown as "—"; it is never filled in. There are no client actions here: stage changes, decline and feedback are off. */

const COLS: Stage[] = [...STAGES, "Declined"];
const NA = <span className="muted" title="Not connected yet">—</span>;
/* No summary is shared, so there is no requirement evidence to count. */
const NO_EVIDENCE = <span className="muted">—</span>;
const NEXT_CHIP = { you: "c-warn", sched: "c-info", done: "c-ok", ro: "c-mute" } as const;
const ACTIONS_OFF = "Stage changes, decline and interview feedback are on each candidate's page.";
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const year = (d: string) => d.slice(0, 4);
/* As in the demo's candidate page (2h). */
const REQ_ST: Record<DbEvidenceStatus, [string, string]> = { supported: ["Supported", "c-ok"], partly_supported: ["Partly supported", "c-info"], not_evidenced: ["Not evidenced", "c-mute"], confirmed_not_met: ["Confirmed not met", "c-warn"] };
const first = (name: string) => name.split(" ")[0];

/** Stage changes for the signed-in account: its key (moves for another account are ignored), the state and the actions. */
export interface MovesProps {
  account: string; state: MoveState; retry(): void; dismiss(): void;
  move(sub: DbSubmission, to: MoveTarget, seen: { version: number; stage: Stage }): boolean;
  /** A client decision (decline or feedback), sent with the version and stage the user saw when opening the form. */
  act(sub: DbSubmission, intent: Intent, seen: { version: number; stage: Stage }): boolean;
}
export const NO_MOVES: MovesProps = { account: "", state: { status: "idle" }, move: () => false, act: () => false, retry: () => {}, dismiss: () => {} };

/** `memberId`: the signed-in member, so history can say "You" only for that member's own recorded changes. */
export function WorkspacePage({ route, state, onRetry, today, moves = NO_MOVES, memberId = "" }: { route: string; state: WorkspaceState; onRetry(): void; today: string; moves?: MovesProps; memberId?: string }) {
  const current = navFor(route);
  if (state.status === "idle" || state.status === "loading") return <Notice title={titleFor(route)} role="status">Loading workspace data…</Notice>;
  if (state.status === "error") {
    return (
      <Notice title={titleFor(route)} role="alert" crit>
        <span>Workspace data could not be loaded. Nothing is shown in its place.</span>{" "}
        <button type="button" className="btn btn-s btn-sm" onClick={onRetry}>Try again</button>
      </Notice>
    );
  }
  const ws = state.ws;
  if (route === "progress") return <Progress ws={ws} today={today} />;
  if (route.startsWith("c-")) return <CandidateDetail ws={ws} id={route.slice(2)} moves={moves} memberId={memberId} today={today} />;
  if (route.startsWith("role-")) return <RoleDetail ws={ws} id={route.slice(5)} today={today} />;
  if (current === "roles") return <RolesList ws={ws} today={today} />;
  return <CandidatesList ws={ws} today={today} />;
}

const titleFor = (route: string) => (route.startsWith("c-") ? "Candidate" : route.startsWith("role-") ? "Role" : { candidates: "Candidates", roles: "Roles", progress: "Hiring progress" }[navFor(route)]);

function Notice({ title, children, role, crit }: { title: string; children: ReactNode; role: "status" | "alert"; crit?: boolean }) {
  return (
    <>
      <div className="pagehead"><div><h1>{title}</h1></div></div>
      <div className={`rempty${crit ? " dberr" : ""}`} role={role}>{children}</div>
    </>
  );
}

const NotConnected = ({ title, text }: { title: string; text: string }) => (
  <>
    <div className="pagehead"><div><h1>{title}</h1></div></div>
    <div className="rempty" role="status">{text}</div>
  </>
);

/* ---- Hiring progress ---------------------------------------------------------------------------------------------- */

/* The demo's four charts and counting rules, on rows from this same workspace snapshot (src/reporting/fromWorkspace.ts),
   with today's UTC date and the 6 full weeks before it. */
function Progress({ ws, today }: { ws: Workspace; today: string }) {
  let data;
  try { data = reportData(ws); } catch (e) {
    if (!(e instanceof ReportDataError)) throw e;
    return <Notice title="Hiring progress" role="alert" crit>Hiring progress could not be calculated: a candidate's recorded history does not add up. Nothing is shown in its place.</Notice>;
  }
  if (!data) return <NotConnected title="Hiring progress" text="Hiring progress is not connected yet: it needs interview and offer records (milestone 4) on this database." />;
  return <ProgressView data={data} today={today} weeks={weeksBefore(today)} period="Fictional data · development"
    asOf={`As of ${fd(today)} ${year(today)} (UTC) · candidates currently shared with your team; withdrawn or unshared candidates are not included`} />;
}

/* ---- Roles --------------------------------------------------------------------------------------------------------- */

function RolesList({ ws, today }: { ws: Workspace; today: string }) {
  return (
    <>
      <div className="pagehead"><div><h1>Roles</h1><p className="lede">Roles Revenue Optics is filling for you.</p></div></div>
      <section className="card pad">
        {ws.roles.length === 0 ? <div className="rempty">No roles yet.</div> : (
          <div className="ltab-wrap">
            <table className="rtab">
              <thead><tr><th>Role</th><th>Status</th><th className="n">Shared</th>
                {COLS.map((s) => <th key={s} className="n stc"><i className="sw" style={{ background: stageColor(s) }} />{s}</th>)}
                <th className="n">Waiting on you</th><th className="n">Last 7 days</th></tr></thead>
              <tbody>
                {ws.roles.map((r) => {
                  const x = roleRow(ws, r, today);
                  return (
                    <tr key={r.id}>
                      <td><a className="rname" href={`#role-${r.id}`}>{r.title}</a>{r.location && <div className="xs muted">{r.location}</div>}</td>
                      <td><StatusChip status={r.status} /></td>
                      <td className="n shared">{x.shared}</td>
                      {x.byStage.map((n, i) => <td key={i} className={`n stn${n ? "" : " zero"}`}>{n}</td>)}
                      <td className="n">{!ws.steps ? NA : (() => { const n = waitingCount(ws, forRole(ws, r.id), today); return n ? <span className="chip c-warn">{n}</span> : "0"; })()}</td>
                      <td className="n small">{`${x.shared7} shared · ${x.moved7} moved`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!ws.steps && <p className="xs muted dbnote">"Waiting on you" is not connected yet.</p>}
      </section>
    </>
  );
}

function RoleDetail({ ws, id, today }: { ws: Workspace; id: string; today: string }) {
  const r = ws.roles.find((x) => x.id === id);
  if (!r) return <><nav className="crumb"><a href="#roles">← Roles</a></nav><p>Role not found.</p></>;
  const x = roleRow(ws, r, today), info = ws.content?.roleInfo.get(r.id), set = ws.content?.sets.get(r.id);
  return (
    <>
      <nav className="crumb"><a href="#roles">← Roles</a></nav>
      {info?.holdNote && <div className="banner warn">{info.holdNote}</div>}
      <div className="card pad">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}><h1>{r.title}</h1><StatusChip status={r.status} /></div>
        {info?.summary && <p className="lede">{info.summary}</p>}
        <dl className="rmeta">
          {r.location && <div><dt>Location</dt><dd>{r.location}</dd></div>}
          <div><dt>Opened</dt><dd>{`${fd(r.openedOn)} ${year(r.openedOn)}`}</dd></div>
          {r.recruiterName && <div><dt>Recruiter</dt><dd>{`${r.recruiterName}, Revenue Optics`}</dd></div>}
          {set && <div><dt>Requirements</dt><dd>{set.label}</dd></div>}
        </dl>
        <div className="funnel">
          <div className="ftile total"><div className="n num">{x.shared}</div><div className="l">Shared with you</div></div>
          {COLS.map((s, i) => <div key={s} className="ftile" style={{ boxShadow: `inset 0 3px 0 ${stageColor(s)}` }}><div className="n num">{x.byStage[i]}</div><div className="l">{s}</div></div>)}
        </div>
        {!ws.content ? <div className="rempty">The role summary, what the role involves, the job description and the requirements are not connected yet.</div>
          : Boolean(info?.responsibilities.length || info?.jobDescription || set) && (
            <div className="rd">
              <div>
                {info && info.responsibilities.length > 0 && <><h2>What the role involves</h2><ul className="rd-ul" style={{ paddingLeft: 18 }}>{info.responsibilities.map((t) => <li key={t}>{t}</li>)}</ul></>}
                {info?.jobDescription && <details className="jd"><summary>Read the full job description</summary><p>{info.jobDescription}</p></details>}
              </div>
              {set && <div className="box"><h2>Requirements</h2><p className="xs muted" style={{ margin: "2px 0 6px" }}>{set.label}</p>
                <ul className="reqlist">{set.requirements.map((q) => <li key={q.id}><span>{q.text}</span><span className={`chip ${q.tier === "must" ? "c-stage" : "c-mute"}`}>{q.tier === "must" ? "Must-have" : "Preferred"}</span></li>)}</ul></div>}
            </div>
          )}
      </div>
      <section className="card pad" style={{ marginTop: 18 }}>
        <div className="sec-h"><h2>Candidates for this role</h2></div>
        <SubmissionTable ws={ws} list={ws.steps ? ordered(ws, forRole(ws, r.id), today) : forRole(ws, r.id)} noRole today={today} />
      </section>
    </>
  );
}

/* ---- Candidates ---------------------------------------------------------------------------------------------------- */

function CandidatesList({ ws, today }: { ws: Workspace; today: string }) {
  /* Page controls are kept for this visit only (not saved in the browser), and reset for each account. */
  const [view, setView] = useState<"pipeline" | "list">("pipeline"), [role, setRole] = useState<string>("all"), [showDeclined, setShowDeclined] = useState(false);
  const [filter, setFilter] = useState<"all" | "you">("all");
  const choice = role === "all" || ws.roles.some((r) => r.id === role) ? role : "all";
  /* The lede counts the role's submissions; the filter and the waiting-first order use the shared derivation (next.ts). */
  const base = forRole(ws, choice), n = uniquePeople(base), waiting = ws.steps ? waitingCount(ws, base, today) : 0;
  const list = !ws.steps ? base : ordered(ws, filter === "you" ? base.filter((c) => waitingOnYou(ws, c, today)) : base, today);
  const scope = choice === "all" ? `${ws.roles.length} ${plural(ws.roles.length, "role")}` : ws.roles.find((r) => r.id === choice)!.title;
  return (
    <>
      <div className="pagehead">
        <div><h1>Candidates</h1><p className="lede">{`${base.length} ${plural(base.length, "submission")} · ${n} ${n === 1 ? "person" : "people"} · ${scope}`}</p></div>
        <Seg label="View" value={view} options={[["pipeline", "Pipeline"], ["list", "List"]]} onChange={setView} />
      </div>
      <div className="toolbar">
        <label className="sr" htmlFor="roleSel">Role</label>
        <select id="roleSel" className="sel" value={choice} onChange={(e) => setRole(e.target.value)}>
          <option value="all">All roles</option>
          {ws.roles.map((r) => <option key={r.id} value={r.id}>{r.title + (r.status !== "Open" ? ` (${r.status.toLowerCase()})` : "")}</option>)}
        </select>
        {ws.steps ? <>
          <button type="button" className="fchip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All candidates</button>
          <button type="button" className="fchip wait" aria-pressed={filter === "you"} onClick={() => setFilter("you")}>Waiting on you <span className="ct">{waiting}</span></button>
        </> : <>
          <button type="button" className="fchip" aria-pressed="true">All candidates</button>
          <button type="button" className="fchip wait" disabled aria-disabled="true" title="Not connected yet">Waiting on you <span className="ct">—</span></button>
        </>}
      </div>
      <p className="xs muted dbnote">{ws.steps ? ACTIONS_OFF : `Next steps, requirement evidence and interviews are not connected yet. ${ACTIONS_OFF}`}</p>
      {view === "pipeline" ? (
        <>
          <div className={`board ${showDeclined ? "with-dec" : ""}`}>
            {(showDeclined ? COLS : STAGES).map((s) => {
              const cs = list.filter((c) => c.stage === s);
              return (
                <section key={s} className="col" aria-label={s} style={{ "--c": stageColor(s) } as CSSProperties}>
                  <div className="col-h"><h2>{s}</h2><span className="ct">{cs.length}</span></div>
                  {cs.length ? cs.map((c) => <Card key={c.id} ws={ws} c={c} showRole={choice === "all"} today={today} />) : <div className="col-empty">{`No candidates here${filter !== "all" ? " for this filter" : ""}`}</div>}
                </section>
              );
            })}
          </div>
          <p className="small" style={{ marginTop: 12 }}>
            <button type="button" className="btn-link" id="decTgl" onClick={() => setShowDeclined(!showDeclined)}>
              {showDeclined ? "Hide declined" : `Show declined (${countByStage(list, ["Declined"])[0]})`}
            </button>
          </p>
        </>
      ) : <SubmissionTable ws={ws} list={list} today={today} empty={filter !== "all" ? "No candidates match this filter." : undefined} />}
    </>
  );
}

function Card({ ws, c, showRole, today }: { ws: Workspace; c: DbSubmission; showRole: boolean; today: string }) {
  const p = person(ws, c), also = alsoFor(ws, c), t = deriveNext(ws, c, today), iv = interviewLabel(ws, c);
  return (
    <a className={t ? `ccard ${t.cls}` : "ccard"} href={`#c-${c.id}`}>
      <span className="av" aria-hidden="true">{initials(p.name)}</span>
      <div className="b">
        <div className="nm">{p.name}</div>
        {p.headline && <div className="hd">{p.headline}</div>}
        {showRole && <div className="rl">{roleFor(ws, c).title}</div>}
        {also.length > 0 && <div className="also2">{`Same person · also for ${also.join(", ")}`}</div>}
        {t && iv && <>
          <div className="meta"><span><CheckIcon />{requirementLine(ws, c) ?? "—"}</span><span><VideoIcon />{iv[1]}</span></div>
          <div className={`nextbar ${t.cls}`}><span>{t.short}</span></div>
        </>}
      </div>
    </a>
  );
}

function SubmissionTable({ ws, list, noRole = false, today, empty }: { ws: Workspace; list: DbSubmission[]; noRole?: boolean; today: string; empty?: string }) {
  return (
    <div className={noRole ? "ltab-wrap" : "card ltab-wrap"}>
      <table className="ltab">
        <thead><tr><th>Candidate</th>{!noRole && <th>Role</th>}<th>Stage</th><th>Next step</th><th>Requirements</th><th>Interview</th><th>Shared</th></tr></thead>
        <tbody>
          {list.length ? list.map((c) => {
            const p = person(ws, c), also = alsoFor(ws, c), t = deriveNext(ws, c, today), iv = interviewLabel(ws, c), req = ws.steps ? requirementLine(ws, c) : null;
            return (
              <tr key={c.id} className={t?.who === "you" ? "you" : ""}>
                <td><a className="nm" href={`#c-${c.id}`}>{p.name}</a>{p.headline && <div className="xs muted">{p.headline}</div>}</td>
                {!noRole && <td>{roleFor(ws, c).title}{also.length > 0 && <div className="alsoline">{`Same person · also for ${also.join(", ")}`}</div>}</td>}
                <td><span className="chip c-stage"><i className="sw" style={{ background: stageColor(c.stage) }} />{c.stage}</span></td>
                <td>{t ? <span className={`chip ${NEXT_CHIP[t.cls]}`}>{t.short}</span> : NA}</td>
                <td className="small">{!t ? NA : req ?? NO_EVIDENCE}</td>
                <td>{iv ? <span className={`chip ${iv[0]}`}>{iv[1]}</span> : NA}</td>
                <td className="small num">{fd(c.sharedOn)}</td>
              </tr>
            );
          }) : <tr><td colSpan={noRole ? 6 : 7} className="muted">{empty ?? "No candidates have been shared yet."}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* The candidate page's tabs, as in 2h. Summary (milestone 3) and Notes and history have database data. */
const TABS = [["summary", "Summary"], ["interview", "Screening interview"], ["resume", "Resume"], ["notes", "Notes and history"]] as const;
type Tab = (typeof TABS)[number][0];
const TAB_NOT_CONNECTED: Record<Exclude<Tab, "notes">, string> = {
  summary: "The summary, why Revenue Optics shared this candidate, requirement evidence, strengths, points to clarify and key facts are not connected yet.",
  interview: "Screening interviews are not connected yet.",
  resume: "Resumes are not connected yet.",
};

function CandidateDetail({ ws, id, moves, memberId, today }: { ws: Workspace; id: string; moves: MovesProps; memberId: string; today: string }) {
  const [tab, setTab] = useState<Tab>("summary");
  const c = ws.subs.find((s) => s.id === id);
  if (!c) return <><nav className="crumb"><a href="#candidates">← Back to candidates</a></nav><p>Candidate not found. <a href="#candidates">Back to Candidates</a></p></>;
  const p = person(ws, c), r = roleFor(ws, c), others = ws.subs.filter((x) => x.personId === c.personId && x.id !== c.id), si = STAGES.indexOf(c.stage);
  const t = deriveNext(ws, c, today), iv = interviewLabel(ws, c), offer = offerStatus(ws, c);
  return (
    <>
      <nav className="crumb" aria-label="Breadcrumb"><a href="#candidates">← Back to candidates</a><span className="muted">/</span><a href={`#role-${r.id}`}>{r.title}</a></nav>
      <div className="cd">
        <div className="card" style={{ minWidth: 0 }}>
          <div className="chead">
            <div className="chead-top"><span className="av">{initials(p.name)}</span><div style={{ minWidth: 0 }}><h1>{p.name}</h1>
              <div className="for">for <a href={`#role-${r.id}`}>{r.title}</a></div>
              <div className="facts">{p.headline && <span>{p.headline}</span>}{p.location && <span><PinIcon />{` ${p.location}`}</span>}<span>{`Shared ${fd(c.sharedOn)}`}</span></div></div></div>
            {others.length > 0 && <div className="also">Also shared for {others.map((o, i) => <Fragment key={o.id}>{i > 0 && ", "}<a href={`#c-${o.id}`}>{roleFor(ws, o).title}</a>{` (${o.stage})`}</Fragment>)}</div>}
            {c.stage === "Declined"
              ? <p className="small" style={{ margin: "14px 0 0" }}><span className="chip c-mute">Declined</span></p>
              : <ol className="steps" aria-label="Stage">{STAGES.map((s, i) => <li key={s} className={i < si ? "done" : i === si ? "cur" : ""} aria-current={i === si ? "step" : undefined}>{s}</li>)}</ol>}
          </div>
          <div className="tabs" role="tablist">
            {TABS.map(([k, l]) => <button key={k} type="button" role="tab" data-tab={k} aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          <div className="tabp" role="tabpanel">
            {tab === "notes" ? <History ws={ws} sub={c} memberId={memberId} /> : tab === "summary" && ws.content ? <Summary ws={ws} sub={c} /> : <div className="rempty">{TAB_NOT_CONNECTED[tab]}</div>}
          </div>
        </div>
        <aside className="card act" aria-label="Next step"><div className="pad">
          <h2>Next step</h2>
          {t && <div className={`nextbox ${t.cls}`}><b>{t.long}</b>{t.sub && <span className="small">{t.sub}</span>}</div>}
          <dl className="statusdl"><dt>Stage</dt><dd>{c.stage}</dd>{iv && <><dt>Interview</dt><dd>{iv[1]}</dd></>}{offer && <><dt>Offer status</dt><dd>{offer}</dd></>}{r.recruiterName && <><dt>Recruiter</dt><dd>{`${r.recruiterName}, Revenue Optics`}</dd></>}</dl>
          <ActionPanel key={c.id} sub={c} role={r} moves={moves} decisions={ws.notes !== null} feedbackRound={ws.steps ? feedbackTask(ws, c)?.id ?? null : undefined} />
          <p className="mock">{NOT_NOTIFIED}</p>
        </div></aside>
      </div>
    </>
  );
}

/** One history line, in 2h's wording: "Revenue Optics shared Priya for this role", "You moved Priya to Interview". */
/** The Summary tab (2h's markup): the submission's published package, if one is shared, on its role's agreed requirements.
    Sources are plain text here (the screening interview and resume tabs are not connected). Nothing is filled in. */
export function Summary({ ws, sub }: { ws: Workspace; sub: DbSubmission }) {
  const pkg = ws.content?.packages.get(sub.id), set = ws.content?.sets.get(sub.roleId);
  if (!pkg || !set || set.id !== pkg.setId) return <div className="rempty">No summary is currently shared for this candidate.</div>;
  const rows = set.requirements.map((q) => [q, pkg.evidence.get(q.id)!] as const);
  const counts = (Object.keys(REQ_ST) as DbEvidenceStatus[]).map((k) => [k, rows.filter(([, e]) => e.status === k).length] as const).filter(([, n]) => n);
  return (
    <>
      <p className="why"><b>{`Why Revenue Optics shared ${first(person(ws, sub).name)}.`}</b>{` ${pkg.whyShared}`}</p>
      <div className="sec-h"><h2>Requirement check</h2><span className="xs muted">{`Requirements ${set.label}`}</span></div>
      <div className="reqsum">{counts.map(([k, n]) => <span key={k} className={`chip ${REQ_ST[k][1]}`}>{`${n} ${REQ_ST[k][0].toLowerCase()}`}</span>)}</div>
      <table className="req"><thead><tr><th>Requirement</th><th>Status</th><th>Evidence</th></tr></thead><tbody>
        {rows.map(([q, e]) => (
          <tr key={q.id}>
            <td className="rq">{q.text}<span className="tier">{q.tier === "must" ? "Must-have" : "Preferred"}</span></td>
            <td className="st"><span className={`chip ${REQ_ST[e.status][1]}`}>{REQ_ST[e.status][0]}</span></td>
            <td className="ev">{e.evidence}{e.source && <div className="src">{`Source: ${e.source}`}</div>}</td>
          </tr>
        ))}
      </tbody></table>
      <div className="two">
        <div className="box"><h3>Strengths</h3>{pkg.strengths.length ? <ul>{pkg.strengths.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="muted small">None recorded.</p>}</div>
        <div className="box"><h3>Points to clarify</h3>{pkg.pointsToClarify.length ? <ul>{pkg.pointsToClarify.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="muted small">None recorded.</p>}</div>
      </div>
      <div className="box" style={{ marginTop: 16 }}><h3 style={{ marginBottom: 8 }}>Key facts</h3>
        <dl className="kf">{pkg.keyFacts.length ? pkg.keyFacts.map((f) => <Fragment key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></Fragment>) : <dd className="muted">None recorded.</dd>}</dl>
      </div>
    </>
  );
}

export function historyText(e: HistoryEntry, firstName: string) {
  if (e.kind === "shared") return `${e.actor} shared ${firstName} for this role`;
  if (e.kind === "feedback") return `${e.actor} shared interview feedback`;
  return e.toStage === "Declined" ? `${e.actor} declined ${firstName}` : `${e.actor} moved ${firstName} to ${e.toStage}`;
}

export function History({ ws, sub, memberId }: { ws: Workspace; sub: DbSubmission; memberId: string }) {
  const first = person(ws, sub).name.split(/\s+/)[0], h = history(ws, sub, memberId);
  return (
    <>
      <div className="sec-h"><h2>Your notes on this candidate</h2><span className="xs muted">Not shared with the candidate.</span></div>
      <Notes ws={ws} sub={sub} memberId={memberId} />
      <h2 style={{ margin: "22px 0 8px" }}>History</h2>
      {h.entries.length
        ? <ol className="hist">{h.entries.slice().reverse().map((e) => <li key={e.version}><span className="t">{fd(e.date)}</span><span>{historyText(e, first)}</span></li>)}</ol>
        : <p className="muted small">No history is available for this candidate.</p>}
      {h.missing > 0 && <p className="small muted" role="note">{`${h.missing} ${plural(h.missing, "change is", "changes are")} not shown: ${plural(h.missing, "its", "their")} history ${plural(h.missing, "entry is", "entries are")} not available.`}</p>}
      {h.beyondCurrent && <p className="small muted" role="note">The history has changes newer than the stage shown. Reload the page to see the latest stage.</p>}
      <p className="xs muted" style={{ marginTop: 10 }}>Newest first; dates are calendar days in UTC. &ldquo;You&rdquo; marks changes you made in the portal. &ldquo;Client team&rdquo; is someone else at your company, or a change recorded without who made it.</p>
    </>
  );
}

/** Decline notes and interview feedback, in 2h's note boxes; "You" only for the signed-in member's own notes. */
function Notes({ ws, sub, memberId }: { ws: Workspace; sub: DbSubmission; memberId: string }) {
  if (ws.notes === null) return <p className="muted small">Notes are not available on this database yet.</p>;
  const mine = ws.notes.filter((n) => n.submissionId === sub.id).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  if (!mine.length) return <p className="muted small">No notes yet. Notes you add with a decision or after an interview appear here.</p>;
  const by = (n: (typeof mine)[number]) => <p className="xs muted" style={{ margin: "6px 0 0" }}>{`${n.authorMemberId === memberId && memberId !== "" ? "You" : "Client team"} · ${fd(n.createdAt.slice(0, 10))}`}</p>;
  return (
    <>
      {mine.map((n) => (
        <div key={n.id} className="box" style={{ marginBottom: 10 }}>
          {n.kind === "decline"
            ? <><b>Decline note</b> <span className="chip c-mute">{n.category ?? "No category"}</span></>
            : <><b>Interview feedback</b>{n.about && <> <span className="xs muted">{`about ${n.about}`}</span></>}</>}
          <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{n.text}</p>{by(n)}
        </div>
      ))}
    </>
  );
}

const NOT_NOTIFIED = "Development: stage changes and decisions are saved in the portal database only. Your recruiter is not notified automatically, and Manatal is not updated: neither is connected. Who may act, and when, is provisional.";
const SAVED_SUB = "Confirmed by the server and saved in the portal database. Lists and counts are refreshed. Nobody is notified and Manatal is not updated.";

type Form = { kind: "move"; to: MoveTarget; version: number; stage: Stage } | { kind: "decline" | "feedback"; version: number; stage: Stage; round?: string | null };
const label = (r: { action?: string; toStage: string }) => (r.action === "decline" ? "decline" : r.action === "feedback" ? "interview feedback" : `move to ${r.toStage}`);

/** The Next step panel's actions: stage change, decline and interview feedback; choose, confirm, then the server's answer.
    Which actions are offered follows the PROVISIONAL development rules (moves.ts); the server decides. */
/* `feedbackRound`: the interview round a feedback form completes (the same rule as the Waiting on you task, next.ts); null
   when feedback would be general; undefined without milestone 4. */
function ActionPanel({ sub, role, moves, decisions, feedbackRound }: { sub: DbSubmission; role: DbRole; moves: MovesProps; decisions: boolean; feedbackRound?: string | null }) {
  const targets = moveTargets(sub, role), [choice, setChoice] = useState<MoveTarget | "">("");
  /* The version and stage the user is looking at when they open a form are the ones sent: a change in between is a conflict. */
  const [form, setForm] = useState<Form | null>(null);
  const m = moves.state, mine = m.status !== "idle" && m.account === moves.account, here = mine && ("request" in m ? m.request.submissionId : m.submissionId) === sub.id;

  if (here && m.status === "saving") return <div className="nextbox ro" role="status"><b>{`Saving the ${label(m.request)}…`}</b><span className="small">{m.attempt > 0 ? "No answer yet: asking the server again with the same request." : "Waiting for the server to confirm."}</span></div>;
  if (here && m.status === "uncertain") return (
    <div role="alert">
      <div className="nextbox you"><b>{`The ${label(m.request)} could not be confirmed`}</b><span className="small">The server did not answer, so it may or may not have been saved. Checking again sends the same request; it cannot be saved twice.</span></div>
      <div className="row" style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button type="button" className="btn btn-p btn-sm" onClick={moves.retry}>Check again</button>
        <button type="button" className="btn btn-s btn-sm" onClick={moves.dismiss}>Show the latest information</button>
      </div>
    </div>
  );
  if (here && m.status === "saved") return (
    <>
      <div className="nextbox done" role="status" style={{ marginBottom: 4 }}>
        <b>{m.action === "decline" ? "Declined for this role" : m.action === "feedback" ? "Feedback saved" : `Stage saved: ${m.toStage}`}</b>
        <span className="small">{m.action === "feedback" ? `Stage unchanged. ${SAVED_SUB}` : SAVED_SUB}</span>
      </div>
      <div style={{ display: "flex", gap: 8 }}><a className="btn btn-p" href="#candidates" onClick={moves.dismiss}>Back to pipeline</a><button type="button" className="btn btn-s" onClick={moves.dismiss}>Done</button></div>
    </>
  );
  if (here && m.status === "conflict") return (
    <div role="alert"><div className="banner warn" style={{ margin: "0 0 8px" }}>{MOVE_MESSAGES.conflict}</div><button type="button" className="btn btn-s btn-sm" onClick={moves.dismiss}>Review the latest stage</button></div>
  );
  if (here && m.status === "failed") return (
    <div role="alert"><div className="err">{m.message}</div><button type="button" className="btn btn-s btn-sm" style={{ marginTop: 8 }} onClick={moves.dismiss}>OK</button></div>
  );
  if (mine && (m.status === "saving" || m.status === "uncertain")) return <p className="small muted">Another change is still being saved or confirmed. Finish it first.</p>;

  if (form?.kind === "move") {
    const big = form.to === "Offer" || form.to === "Hired";
    return (
      <form className="form" id="moveForm" onSubmit={(e) => { e.preventDefault(); if (moves.move(sub, form.to, { version: form.version, stage: form.stage })) setForm(null); }}>
        <h3 style={{ marginBottom: 10 }}>{`Move to ${form.to}`}</h3>
        {big && <div className="banner warn" style={{ margin: "0 0 10px" }}>{`Provisional for development testing: client moves to Offer and Hired are not approved for production. This saves the ${form.to} stage only; it does not record that an offer was ${form.to === "Hired" ? "accepted" : "made"}.`}</div>}
        <p className="small muted" style={{ margin: "0 0 10px" }}>{`From ${sub.stage} to ${form.to}. Saved in the portal database only; nobody is notified and Manatal is not updated.`}</p>
        <div className="row"><button type="button" className="btn btn-s" onClick={() => setForm(null)}>Cancel</button><button type="submit" className="btn btn-p">{`Move to ${form.to}`}</button></div>
      </form>
    );
  }
  if (form) return <DecisionForm form={form} roleTitle={role.title} onCancel={() => setForm(null)}
    onSubmit={(intent) => { if (moves.act(sub, intent.action === "feedback" && form.kind === "feedback" && form.round ? { ...intent, interviewId: form.round } : intent, { version: form.version, stage: form.stage })) setForm(null); }} />;

  const decline = decisions && canDecline(sub, role), feedback = decisions && canGiveFeedback(sub, role), to = (choice || targets[0]) as MoveTarget;
  const why = !decisions ? "Not available on this database yet" : "Not available for this stage or role (provisional rules)";
  return (
    <>
      {sub.stage === "Declined" && <p className="small muted">Declined for this role. The note is in Notes and history.</p>}
      {targets.length > 0 ? <>
        <label className="small" htmlFor="mv" style={{ display: "block", fontWeight: 600, marginTop: 4 }}>Move to another stage</label>
        <div style={{ display: "flex", gap: 8 }}>
          <select id="mv" className="sel" style={{ minWidth: 0, flex: 1 }} value={to} onChange={(e) => setChoice(e.target.value as MoveTarget)}>
            {targets.map((s) => <option key={s} value={s}>{s === "Offer" || s === "Hired" ? `${s} (provisional)` : s}</option>)}
          </select>
          <button type="button" className="btn btn-s btn-sm" data-form="move" onClick={() => setForm({ kind: "move", to, version: sub.version, stage: sub.stage })}>Continue</button>
        </div>
      </> : sub.stage !== "Declined" && <p className="small muted">{role.status !== "Open" ? `This role is ${role.status.toLowerCase()}, so stage changes are paused.` : `Stage changes from ${sub.stage} are not available in this version.`}</p>}
      <div className="abtns" style={{ marginTop: 12 }}>
        <button type="button" className={`btn btn-d${decline ? "" : " btn-off"}`} data-form="decline" disabled={!decline} title={decline ? undefined : why}
          onClick={() => setForm({ kind: "decline", version: sub.version, stage: sub.stage })}>Decline</button>
        <button type="button" className={`btn btn-s${feedback ? "" : " btn-off"}`} data-form="feedback" disabled={!feedback} title={feedback ? undefined : why}
          onClick={() => setForm({ kind: "feedback", version: sub.version, stage: sub.stage, round: feedbackRound ?? null })}>Share interview feedback</button>
      </div>
      {!decisions && <p className="small muted">Decline and interview feedback are not available on this database yet.</p>}
    </>
  );
}

/** 2h's decline and interview-feedback forms (formHtml). The note is required; 2h's messages for an empty note. */
function DecisionForm({ form, roleTitle, onCancel, onSubmit }: { form: { kind: "decline" | "feedback" }; roleTitle: string; onCancel(): void; onSubmit(i: Intent): void }) {
  const [note, setNote] = useState(""), [cat, setCat] = useState(DECLINE_CATEGORIES[0]), [about, setAbout] = useState("General feedback"), [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!note.trim()) { setErr(form.kind === "decline" ? "Add a short note so the recruiter knows why." : "Add your feedback before sharing."); return; }
    onSubmit(form.kind === "decline" ? { action: "decline", note: note.trim(), category: cat === "No category" ? null : cat } : { action: "feedback", about: about.trim() || null, text: note.trim() });
  };
  const error = err && <div className="err">{err}</div>;
  const textarea = <textarea id="fNote" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />;
  const buttons = (text: string, cls: string) => <div className="row"><button type="button" className="btn btn-s" data-cancel onClick={onCancel}>Cancel</button><button type="submit" className={`btn ${cls}`}>{text}</button></div>;
  if (form.kind === "decline") return (
    <form className="form" id="actForm" onSubmit={submit}><h3 style={{ marginBottom: 10 }}>{`Decline for ${roleTitle}`}</h3>
      <div className="f"><label htmlFor="fNote">Decline note (required)</label>{textarea}{error}<div className="help">Keep to job-related points. Not shared with the candidate.</div></div>
      <div className="f"><label htmlFor="fCat">Reason category (optional)</label><select id="fCat" value={cat} onChange={(e) => setCat(e.target.value)}>{DECLINE_CATEGORIES.map((x) => <option key={x}>{x}</option>)}</select></div>
      {buttons("Decline", "btn-d")}
    </form>
  );
  return (
    <form className="form" id="actForm" onSubmit={submit}><h3 style={{ marginBottom: 10 }}>Interview feedback</h3>
      <div className="f"><label htmlFor="fAbout">About</label><input id="fAbout" maxLength={120} value={about} onChange={(e) => setAbout(e.target.value)} /></div>
      <div className="f"><label htmlFor="fNote">Your feedback (required)</label>{textarea}{error}<div className="help">Feedback does not change the stage.</div></div>
      {buttons("Share feedback", "btn-p")}
    </form>
  );
}
