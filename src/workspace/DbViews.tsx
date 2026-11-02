import {InfoIcon} from "../components/icons";
import { CandidateActivity, type ActivityEntry, type ActivityNote } from "../candidates/CandidateActivity";
import { CandidateSummary, placeConcerns } from "../candidates/CandidateSummary";
import {readBoardAction} from "../candidates/boardActions";
import {CandidateDetailFrame,RecruiterScreening} from "../candidates/CandidateDetailFrame";
import {useDetailLocation} from "../candidates/detailNavigation";
import {RolesView,RoleDetailView,type RolePresentation} from "../roles/RoleViews";
import { HelpPage } from "../help/HelpPage";
import { useCandidatesHref, useCandidateReturn } from "../lib/candidatesRoute";
import { CandidatesView, type CandidateRow } from "../candidates/CandidatesView";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Stage } from "../data/fixtures";
import { fd, fdw, weeksBefore } from "../lib/dates";
import { navFor } from "../lib/route";
import { ProgressView } from "../progress/HiringProgress";
import { plural } from "../progress/shared";
import { ReportDataError, reportData } from "../reporting/fromWorkspace";
import { forRole, history, person, roleFor, roleRow, type DbEvidenceStatus, type DbRole, type DbSubmission, type HistoryEntry, type Workspace } from "./data";
import { DECLINE_CATEGORIES } from "../domain/actions";
import { MOVE_MESSAGES, canDecline, canGiveFeedback, moveTargets, type Intent, type MoveState, type MoveTarget } from "./moves";
import { currentRound, roundFeedback, deriveNext, feedbackTask, offerStatus, requirementLine, waitingCount } from "./next";
import type { WorkspaceState } from "./store";
import { useWorkspaceExtension } from "./extensions";

/* Supabase-mode pages, drawn only from the loaded workspace data with the reviewed markup and classes (2h). They do not use
   the demo's DataProvider, fixtures or saved demo actions. What the database does not hold yet is marked "not connected"
   or shown as "—"; it is never filled in. There are no client actions here: stage changes, decline and feedback are off. */

/* No summary is shared, so there is no requirement evidence to count. */
const ACTIONS_OFF = "Stage changes, decline and interview feedback are on each candidate's page.";

const year = (d: string) => d.slice(0, 4);
/* As in the demo's candidate page (2h). */
const REQ_ST: Record<DbEvidenceStatus, [string, string]> = { supported: ["Supported", "c-ok"], partly_supported: ["Partly supported", "c-info"], not_evidenced: ["Not evidenced", "c-mute"], confirmed_not_met: ["Confirmed not met", "c-warn"] };

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
  if (route.startsWith("c-")) return <CandidateDetail key={route} ws={ws} id={route.slice(2)} moves={moves} memberId={memberId} today={today} />;
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
type Tab = "summary" | "interview" | "resume" | "notes";
const TAB_NOT_CONNECTED: Record<Exclude<Tab, "notes">, string> = {
  summary: "The summary, why Revenue Optics shared this candidate, requirement evidence, strengths, points to clarify and key facts are not connected yet.",
  interview: "Screening interviews are not connected yet.",
  resume: "Resumes are not connected yet.",
};

function CandidateDetail({ ws, id, moves, memberId, today }: { ws: Workspace; id: string; moves: MovesProps; memberId: string; today: string }) {
  const candidatesHref=useCandidatesHref();
  const back=useCandidateReturn();
  const {tab,setTab,from}=useDetailLocation(), ext = useWorkspaceExtension();
  const [feedbackRequest, setFeedbackRequest] = useState(0);
  const c = ws.subs.find((s) => s.id === id);
  if (!c) return <><nav className="crumb"><a href={back.href}>← {back.label}</a></nav><p>Candidate not found. <a href={candidatesHref}>Back to Candidates</a></p></>;
  const p = person(ws, c), r = roleFor(ws, c), others = ws.subs.filter((x) => x.personId === c.personId && x.id !== c.id);
  const t = deriveNext(ws, c, today), offer = offerStatus(ws, c), rows=workspaceCandidateRows(ws,today), row=rows.find(x=>x.id===c.id)!, sc=ws.screening?.get(c.id);
  const pkg=ws.content?.packages.get(c.id), set=ws.content?.sets.get(c.roleId), facts=pkg&&set?.id===pkg.setId?pkg.keyFacts:[];
  /* Additions from a workspace extension (none in normal modes; see extensions.tsx). */
  const extSummary = ext?.summary?.(c) ?? null, extScreening = ext?.screening?.(c) ?? null, extActions = ext?.actions?.(c) ?? null, extHistory = ext?.history?.(c) ?? null;
  const nextStep = !ext?.hideNextStep?.(c);
  return (
    <CandidateDetailFrame id={c.id} name={p.name} headline={p.headline??''} location={p.location??''} stage={c.stage} shared={c.sharedOn} sharedLabel={ext?.added?.long??'Shared'} facts={facts}
      role={r} others={others.map(o=>({id:o.id,title:roleFor(ws,o).title,stage:o.stage}))} rows={rows} roles={ws.roles} today={today} back={back} from={from} tab={tab} setTab={setTab} rail={nextStep ? (
        <aside className="card act" aria-label="Next step"><div className="pad">
          <h2>Next step</h2>
          {t && <div className={`nextbox ${t.cls}`}><b>{t.long}</b>{t.sub && <span className="small">{t.sub}</span>}</div>}
          <dl className="statusdl"><dt>Recruiter screening</dt><dd>{sc?`Held ${fd(sc.callOn)} by ${sc.recruiterName}`:row.screening}</dd>{offer && <><dt>Offer status</dt><dd>{offer}</dd></>}{r.recruiterName && <><dt>Recruiter</dt><dd>{`${r.recruiterName}, Revenue Optics`}</dd></>}</dl>
          {extActions ?? <>
            <ActionPanel key={c.id} sub={c} role={r} moves={moves} decisions={ws.notes !== null} feedbackRound={ws.steps ? feedbackTask(ws, c)?.id ?? null : undefined} feedbackRequest={feedbackRequest} />
            <p className="mock"><InfoIcon/><span>{NOT_NOTIFIED}</span></p>
          </>}
        </div></aside>) : undefined}>
            {tab === "notes" ? extHistory ?? <History ws={ws} sub={c} memberId={memberId} onFeedback={!ext && ws.notes !== null && canGiveFeedback(c, r) && !["saving", "uncertain"].includes(moves.state.status) ? () => { if (moves.state.status !== "idle") moves.dismiss(); setFeedbackRequest((n) => n + 1); } : undefined} />
              : tab === "summary" && extSummary ? <>{ws.content?.packages.has(c.id) && <Summary ws={ws} sub={c} />}{extSummary}</>
              : tab === "summary" && ws.content ? <Summary ws={ws} sub={c} />
              : tab === "interview" && extScreening ? extScreening
              : tab === "interview" && ws.screening ? <Screening ws={ws} sub={c} /> : <div className="rempty">{TAB_NOT_CONNECTED[tab]}</div>}
    </CandidateDetailFrame>
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
  return <RecruiterScreening date={s.callOn} duration={s.durationMinutes} by={s.recruiterName} summary={s.summary} notes={s.notesForClient} moments={s.keyMoments.map(m=>({time:`About ${m.minute} min`,label:m.label}))}/>;
}

export function Summary({ ws, sub }: { ws: Workspace; sub: DbSubmission }) {
  const pkg = ws.content?.packages.get(sub.id), set = ws.content?.sets.get(sub.roleId);
  if (!pkg || !set || set.id !== pkg.setId) return <div className="rempty">No summary is currently shared for this candidate.</div>;
  const placed = placeConcerns(set.requirements.map((q) => {
    const e = pkg.evidence.get(q.id)!;
    return { id: q.id, tier: q.tier === "must" ? "must" as const : "preferred" as const, text: q.text, status: REQ_ST[e.status][0], statusClass: REQ_ST[e.status][1], evidence: e.evidence, source: e.source ? `Source: ${e.source}` : undefined };
  }), pkg.pointsToClarify);
  return <CandidateSummary roleTitle={roleFor(ws, sub).title} summary={pkg.whyShared} strengths={pkg.strengths}
    requirementsVersion={set.label} requirements={placed.requirements} additionalInformation={placed.additionalInformation} />;
}

export function historyText(e: HistoryEntry, firstName: string) {
  if (e.kind === "shared") return `${e.actor} shared ${firstName} for this role`;
  if (e.kind === "feedback") return `${e.actor} shared interview feedback`;
  return e.toStage === "Declined" ? `${e.actor} declined ${firstName}` : `${e.actor} moved ${firstName} to ${e.toStage}`;
}

export function History({ ws, sub, memberId, onFeedback }: { ws: Workspace; sub: DbSubmission; memberId: string; onFeedback?: () => void }) {
  const first = person(ws, sub).name.split(/\s+/)[0], h = history(ws, sub, memberId);
  const notes = (ws.notes ?? []).filter((n) => n.submissionId === sub.id), attached = new Set<string>();
  const present = (n: (typeof notes)[number]): ActivityNote => ({ id: n.id, label: n.kind === "decline" ? "Decline note" : "Interview feedback", text: n.text,
    date: n.createdAt.slice(0, 10), author: n.authorMemberId === memberId && memberId !== "" ? "You" : "Client team", about: n.about,
    category: n.kind === "decline" ? n.category ?? "No category" : null });
  const entries: ActivityEntry[] = h.entries.slice().reverse().map((e) => {
    const event = ws.events.find((x) => x.submissionId === sub.id && x.version === e.version);
    const linked = notes.filter((n) => n.eventId === event?.id && n.kind === event.kind && n.authorMemberId === event.actorMemberId);
    linked.forEach((n) => attached.add(n.id));
    return { id: `event-${e.version}`, date: e.date, title: historyText(e, first), notes: linked.map(present) };
  });
  // Preserve any loaded note whose event is unavailable; never attach it by matching its date.
  const unlinked = notes.filter((n) => !attached.has(n.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const n of unlinked) {
    const note = present(n), entry = { id: `note-${n.id}`, date: note.date, title: note.label, notes: [note] };
    const index = entries.findIndex((e) => e.date <= entry.date);
    entries.splice(index === -1 ? entries.length : index, 0, entry);
  }
  return <CandidateActivity entries={entries} onFeedback={onFeedback} notesUnavailable={ws.notes === null}>
    {h.missing > 0 && <p className="small muted" role="note">{`${h.missing} ${plural(h.missing, "change is", "changes are")} not shown: ${plural(h.missing, "its", "their")} history ${plural(h.missing, "entry is", "entries are")} not available.`}</p>}
    {h.beyondCurrent && <p className="small muted" role="note">The history has changes newer than the stage shown. Reload the page to see the latest stage.</p>}
    <p className="xs muted activity-help">Dates are calendar days in UTC. &ldquo;You&rdquo; marks changes you made in the portal. &ldquo;Client team&rdquo; is someone else at your company, or a change recorded without who made it.</p>
  </CandidateActivity>;
}

const NOT_NOTIFIED = "Development: stage changes and decisions are saved in the portal database only. Your recruiter is not notified automatically, and Manatal is not updated: neither is connected. Who may act, and when, is provisional.";
const SAVED_SUB = "Confirmed by the server and saved in the portal database. Lists and counts are refreshed. Nobody is notified and Manatal is not updated.";

type Form = { kind: "move"; to: MoveTarget; version: number; stage: Stage } | { kind: "decline" | "feedback"; version: number; stage: Stage; round?: string | null };
const label = (r: { action?: string; toStage: string }) => (r.action === "decline" ? "decline" : r.action === "feedback" ? "interview feedback" : `move to ${r.toStage}`);

/** The Next step panel's actions: stage change, decline and interview feedback; choose, confirm, then the server's answer.
    Which actions are offered follows the PROVISIONAL development rules (moves.ts); the server decides. */
/* `feedbackRound`: the interview round a feedback form completes (the same rule as the Waiting on you task, next.ts); null
   when feedback would be general; undefined without milestone 4. */
function ActionPanel({ sub, role, moves, decisions, feedbackRound, feedbackRequest = 0 }: { sub: DbSubmission; role: DbRole; moves: MovesProps; decisions: boolean; feedbackRound?: string | null; feedbackRequest?: number }) {
  const candidatesHref=useCandidatesHref();
  const targets = moveTargets(sub, role);
  /* The version and stage the user is looking at when they open a form are the ones sent: a change in between is a conflict. */
  const [form, setForm] = useState<Form | null>(()=>{if(typeof location==='undefined')return null;const action=readBoardAction(location.hash,targets,decisions&&canDecline(sub,role));return action?{...action,version:sub.version,stage:sub.stage}:null;});
  const handledFeedback = useRef(feedbackRequest);
  useEffect(() => {
    if (feedbackRequest === handledFeedback.current) return;
    handledFeedback.current = feedbackRequest;
    if (!decisions || !canGiveFeedback(sub, role)) return;
    setForm((current) => current ?? { kind: "feedback", version: sub.version, stage: sub.stage, round: feedbackRound ?? null });
  }, [feedbackRequest, decisions, sub, role, feedbackRound]);
  useEffect(() => {
    if (feedbackRequest > 0 && form?.kind === "feedback") document.getElementById("fNote")?.focus();
  }, [feedbackRequest, form]);
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

  const decline = decisions && canDecline(sub, role), feedback = decisions && canGiveFeedback(sub, role);
  const why = !decisions ? "Not available on this database yet" : "Not available for this stage or role (provisional rules)";
  return (
    <>
      {sub.stage === "Declined" && <p className="small muted">Declined for this role. The note is in Notes and history.</p>}
      <div className="abtns" style={{ marginTop: 12 }}>
        {sub.stage === 'To review' && targets.includes('Interview') && <button type="button" className="btn btn-p" data-form="interview" onClick={()=>setForm({kind:'move',to:'Interview',version:sub.version,stage:sub.stage})}>Move to Interview</button>}
        <button type="button" className={`btn btn-d${decline ? "" : " btn-off"}`} data-form="decline" disabled={!decline} title={decline ? undefined : why}
          onClick={() => setForm({ kind: "decline", version: sub.version, stage: sub.stage })}>Decline</button>
        <button type="button" className={`btn btn-s${feedback ? "" : " btn-off"}`} data-form="feedback" disabled={!feedback} title={feedback ? undefined : why}
          onClick={() => setForm({ kind: "feedback", version: sub.version, stage: sub.stage, round: feedbackRound ?? null })}>Share interview feedback</button>
      </div>
      {targets.length === 0 && sub.stage !== "Declined" && <p className="small muted">{role.status !== "Open" ? `This role is ${role.status.toLowerCase()}, so stage changes are paused.` : `Stage changes from ${sub.stage} are not available in this version.`}</p>}
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
