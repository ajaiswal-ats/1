import {readBoardAction} from "../candidates/boardActions";
import {STAGES} from "../domain/candidates";
import {RolesView,RoleDetailView,type RolePresentation} from "../roles/RoleViews";
import { HelpPage } from "../help/HelpPage";
import { useCandidatesHref, useCandidateReturn } from "../lib/candidatesRoute";
import { CandidatesView, type CandidateRow } from "../candidates/CandidatesView";
import { Fragment, useState, type FormEvent, type ReactNode } from "react";
import { PinIcon } from "../components/icons";
import type { Stage } from "../data/fixtures";
import { fd, fdw, weeksBefore } from "../lib/dates";
import { navFor } from "../lib/route";
import { ProgressView } from "../progress/HiringProgress";
import { plural } from "../progress/shared";
import { ReportDataError, reportData } from "../reporting/fromWorkspace";
import { forRole, history, person, roleFor, roleRow, type DbEvidenceStatus, type DbRole, type DbSubmission, type HistoryEntry, type Workspace } from "./data";
import { DECLINE_CATEGORIES } from "../domain/actions";
import { MOVE_MESSAGES, canDecline, canGiveFeedback, moveTargets, type Intent, type MoveState, type MoveTarget } from "./moves";
import { currentRound, roundFeedback, deriveNext, feedbackTask, interviewLabel, offerStatus, requirementLine, waitingCount } from "./next";
import type { WorkspaceState } from "./store";
import { useWorkspaceExtension } from "./extensions";

/* Supabase-mode pages, drawn only from the loaded workspace data with the reviewed markup and classes (2h). They do not use
   the demo's DataProvider, fixtures or saved demo actions. What the database does not hold yet is marked "not connected"
   or shown as "—"; it is never filled in. There are no client actions here: stage changes, decline and feedback are off. */

/* No summary is shared, so there is no requirement evidence to count. */
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
  const current = navFor(route), ext = useWorkspaceExtension(), tool = ext?.tools?.find((t) => t.route === route);
  if (route === "help") return <HelpPage roles={state.status==="ready" ? state.ws.roles.map(r=>({title:r.title,recruiterName:r.recruiterName})) : []}/>;
  if (tool) return <>{tool.render()}</>;
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
  const page = ext?.candidatesPage?.();
  if (page) return <>{page}</>;
  return <CandidatesList ws={ws} today={today} moves={moves} />;
}

const titleFor = (route: string) => (route.startsWith("c-") ? "Candidate" : route.startsWith("role-") ? "Role" : { candidates: "Candidates", roles: "Roles", progress: "Hiring progress", help:"Help and support" }[navFor(route)]);

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

function workspaceRoles(ws:Workspace,today:string):RolePresentation[]{return ws.roles.map(r=>{const x=roleRow(ws,r,today),info=ws.content?.roleInfo.get(r.id),set=ws.content?.sets.get(r.id);return {id:r.id,title:r.title,status:r.status,location:r.location,opened:r.openedOn,recruiter:r.recruiterName,shared:x.shared,byStage:x.byStage,waiting:ws.steps?waitingCount(ws,forRole(ws,r.id),today):null,shared7:x.shared7,moved7:x.moved7,summary:info?.summary??undefined,holdNote:info?.holdNote??undefined,responsibilities:info?.responsibilities,jobDescription:info?.jobDescription??undefined,requirementsLabel:set?.label,requirements:set?.requirements.map(q=>({text:q.text,tier:q.tier==='must'?'must':'preferred'})),contentAvailable:!!ws.content};});}
function RolesList({ws,today}:{ws:Workspace;today:string}){const added=useWorkspaceExtension()?.added;return <RolesView roles={workspaceRoles(ws,today)} sharedLabel={added?.short} note={!ws.steps?'"Waiting on you" is not connected yet.':undefined}/>;}
function RoleDetail({ws,id,today}:{ws:Workspace;id:string;today:string}){const ext=useWorkspaceExtension(),role=workspaceRoles(ws,today).find(r=>r.id===id),raw=ws.roles.find(r=>r.id===id);return role&&raw?<RoleDetailView role={role} rows={workspaceCandidateRows(ws,today)} roles={ws.roles} today={today} extension={ext?.role?.(raw)} candidateSharedLabel={ext?.added?.short} sharedLabel={ext?.added?.long??"Shared with you"} note={ACTIONS_OFF}/>:<><nav className="crumb"><a href="#roles">← Roles</a></nav><p>Role not found.</p></>;}

/* ---- Candidates ---------------------------------------------------------------------------------------------------- */

function CandidatesList({ ws, today, moves }: { ws: Workspace; today: string; moves:MovesProps }) {
  const ext = useWorkspaceExtension();
  const rows=workspaceCandidateRows(ws,today);
  return <CandidatesView rows={rows} roles={ws.roles} today={today} waitingAvailable={Boolean(ws.steps)} boardPermissions={moves.account ? row=>{const c=ws.subs.find(s=>s.id===row.id)!,r=roleFor(ws,c);return {targets:[...moveTargets(c,r),...(ws.notes!==null&&canDecline(c,r)?["Declined" as const]:[])],reason:r.status!=="Open"?`This role is ${r.status.toLowerCase()}, so stage changes are paused.`:"Stage changes are not available from this stage."};}:undefined}
    note={ext?.candidatesNote ?? (ws.steps ? ACTIONS_OFF : `Next steps, requirement evidence and interviews are not connected yet. ${ACTIONS_OFF}`)} />;
}

function workspaceCandidateRows(ws:Workspace,today:string):CandidateRow[]{
  return ws.subs.map(c => {
    const p = person(ws,c), iv = currentRound(ws,c), t = deriveNext(ws,c,today), sc = ws.screening?.get(c.id);
    const interview = !ws.steps ? "Not connected yet" : !iv ? "None recorded" : iv.status === "cancelled" ? "Cancelled" : iv.status === "held" ? `Held ${fd(iv.heldOn!)}${roundFeedback(ws,iv) ? " · feedback given" : ""}` : iv.status === "scheduled" ? `Scheduled ${fdw(iv.scheduledOn!)}${iv.timeText ? `, ${iv.timeText}` : ""}` : `Requested ${fd(iv.requestedOn!)}`;
    return { id:c.id, personId:c.personId, name:p.name, headline:p.headline, location:p.location, roleId:c.roleId, stage:c.stage, shared:c.sharedOn,
      requirements:ws.steps ? requirementLine(ws,c) : null, screening:ws.screening === null ? "Not connected yet" : sc ? fd(sc.callOn) : "None shared", interview, hasInterview:Boolean(iv),
      next:t ? {cls:t.cls,text:t.short,since:t.since,kind:t.kind} : null };
  });
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
  const candidatesHref=useCandidatesHref();
  const back=useCandidateReturn();
  const [tab, setTab] = useState<Tab>("summary"), ext = useWorkspaceExtension();
  const c = ws.subs.find((s) => s.id === id);
  if (!c) return <><nav className="crumb"><a href={back.href}>← {back.label}</a></nav><p>Candidate not found. <a href={candidatesHref}>Back to Candidates</a></p></>;
  const p = person(ws, c), r = roleFor(ws, c), others = ws.subs.filter((x) => x.personId === c.personId && x.id !== c.id), si = STAGES.indexOf(c.stage);
  const t = deriveNext(ws, c, today), iv = interviewLabel(ws, c), offer = offerStatus(ws, c);
  /* Additions from a workspace extension (none in normal modes; see extensions.tsx). */
  const extSummary = ext?.summary?.(c) ?? null, extScreening = ext?.screening?.(c) ?? null, extActions = ext?.actions?.(c) ?? null, extHistory = ext?.history?.(c) ?? null;
  const nextStep = !ext?.hideNextStep?.(c);
  return (
    <>
      <nav className="crumb" aria-label="Breadcrumb"><a href={back.href}>← {back.label}</a><span className="muted">/</span><a href={`#role-${r.id}`}>{r.title}</a></nav>
      <div className={nextStep ? "cd" : "cd cd-solo"}>
        <div className="card" style={{ minWidth: 0 }}>
          <div className="chead">
            <div className="chead-top"><span className="av">{initials(p.name)}</span><div style={{ minWidth: 0 }}><h1>{p.name}</h1>
              <div className="for">for <a href={`#role-${r.id}`}>{r.title}</a></div>
              <div className="facts">{p.headline && <span>{p.headline}</span>}{p.location && <span><PinIcon />{` ${p.location}`}</span>}<span>{`${ext?.added?.long ?? "Shared"} ${fd(c.sharedOn)}`}</span></div></div></div>
            {others.length > 0 && <div className="also">Also shared for {others.map((o, i) => <Fragment key={o.id}>{i > 0 && ", "}<a href={`#c-${o.id}`}>{roleFor(ws, o).title}</a>{` (${o.stage})`}</Fragment>)}</div>}
            {c.stage === "Declined"
              ? <p className="small" style={{ margin: "14px 0 0" }}><span className="chip c-mute">Declined</span></p>
              : <ol className="steps" aria-label="Stage">{STAGES.map((s, i) => <li key={s} className={i < si ? "done" : i === si ? "cur" : ""} aria-current={i === si ? "step" : undefined}>{s}</li>)}</ol>}
          </div>
          <div className="tabs" role="tablist">
            {TABS.map(([k, l]) => <button key={k} type="button" role="tab" data-tab={k} aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          <div className="tabp" role="tabpanel">
            {tab === "notes" ? extHistory ?? <History ws={ws} sub={c} memberId={memberId} />
              : tab === "summary" && extSummary ? <>{ws.content?.packages.has(c.id) && <Summary ws={ws} sub={c} />}{extSummary}</>
              : tab === "summary" && ws.content ? <Summary ws={ws} sub={c} />
              : tab === "interview" && extScreening ? extScreening
              : tab === "interview" && ws.screening ? <Screening ws={ws} sub={c} /> : <div className="rempty">{TAB_NOT_CONNECTED[tab]}</div>}
          </div>
        </div>
        {nextStep && <aside className="card act" aria-label="Next step"><div className="pad">
          <h2>Next step</h2>
          {t && <div className={`nextbox ${t.cls}`}><b>{t.long}</b>{t.sub && <span className="small">{t.sub}</span>}</div>}
          <dl className="statusdl"><dt>Stage</dt><dd>{c.stage}</dd>{iv && <><dt>Interview</dt><dd>{iv[1]}</dd></>}{offer && <><dt>Offer status</dt><dd>{offer}</dd></>}{r.recruiterName && <><dt>Recruiter</dt><dd>{`${r.recruiterName}, Revenue Optics`}</dd></>}</dl>
          {extActions ?? <>
            <ActionPanel key={c.id} sub={c} role={r} moves={moves} decisions={ws.notes !== null} feedbackRound={ws.steps ? feedbackTask(ws, c)?.id ?? null : undefined} />
            <p className="mock">{NOT_NOTIFIED}</p>
          </>}
        </div></aside>}
      </div>
    </>
  );
}

/** One history line, in 2h's wording: "Revenue Optics shared Priya for this role", "You moved Priya to Interview". */
/** The Summary tab (2h's markup): the submission's published package, if one is shared, on its role's agreed requirements.
    Sources are plain text here (the screening interview and resume tabs are not connected). Nothing is filled in. */
/* The Screening interview tab (milestone 6): the client-safe summary Revenue Optics reviewed for the client, with the
   published package. The reviewed layout without the demo's simulated player: key moments are descriptive text at
   approximate minutes, with nothing to play or seek. */
export function Screening({ ws, sub }: { ws: Workspace; sub: DbSubmission }) {
  const s = ws.screening?.get(sub.id);
  if (!s) return <p className="muted">No screening interview has been shared for this candidate.</p>;
  return (
    <>
      <div className="sec-h"><h2>Screening interview with Revenue Optics</h2></div>
      <p className="small muted" style={{ margin: "-6px 0 14px" }}>{`${fd(s.callOn)} ${year(s.callOn)} · ${s.durationMinutes} minutes · ${s.recruiterName}, Revenue Optics`}</p>
      <div className="ivgrid">
        <div>
          <h3>Key moments</h3>
          <p className="xs muted" style={{ margin: "4px 0 0" }}>Topics Revenue Optics noted, at about the minute they came up. No recording is shared in the portal.</p>
          {s.keyMoments.length ? <ul className="moments">{s.keyMoments.map((m) => <li key={m.minute}><span className="num muted">{`About ${m.minute} min`}</span><span>{m.label}</span></li>)}</ul>
            : <p className="muted small">None noted.</p>}
        </div>
        <div>
          <div className="box"><h3>Short summary</h3><p style={{ margin: "6px 0 0" }}>{s.summary}</p></div>
          <div className="box" style={{ marginTop: 12 }}><h3>Recruiter notes</h3>
            {s.notesForClient ? <><p style={{ margin: "6px 0 0" }}>{s.notesForClient}</p><p className="xs muted" style={{ margin: "8px 0 0" }}>{`${s.recruiterName}, Revenue Optics`}</p></>
              : <p className="muted small" style={{ margin: "6px 0 0" }}>None shared.</p>}
          </div>
        </div>
      </div>
    </>
  );
}

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
  const candidatesHref=useCandidatesHref();
  const targets = moveTargets(sub, role), [choice, setChoice] = useState<MoveTarget | "">("");
  /* The version and stage the user is looking at when they open a form are the ones sent: a change in between is a conflict. */
  const [form, setForm] = useState<Form | null>(()=>{if(typeof location==='undefined')return null;const action=readBoardAction(location.hash,targets,decisions&&canDecline(sub,role));return action?{...action,version:sub.version,stage:sub.stage}:null;});
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
      <div style={{ display: "flex", gap: 8 }}><a className="btn btn-p" href={candidatesHref} onClick={moves.dismiss}>Back to pipeline</a><button type="button" className="btn btn-s" onClick={moves.dismiss}>Done</button></div>
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
