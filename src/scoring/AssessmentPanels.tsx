import { Fragment, useState, type FormEvent, type ReactNode } from "react";
import { fd } from "../lib/dates";
import { confirmScreeningSummary, correctScreeningRating, decideClaim, prepareClaimCheck, saveFinalDecision, proposeScreeningRatings, saveClientView, saveCorrection, saveScreeningAnswers, summariseScreening } from "./api";
import { pct, type CvResult } from "./calculator";
import { changeList, consistencyOf } from "./consistency";
import { SCREENING_SCORE_PENDING, SEPARATE, starterRouting } from "./routing";
import { DECISIONS, FORWARD_BLOCKED, decisionHistory, failedEssentials, openItems, screeningKey, type DecisionKind, type FinalDecision } from "./finalReview";
import { answerSources, answerTotals, coreSetFor, currentClaims, raisesSkill, currentScreening, currentSummary, type ClaimItem, followUpKey, followUpsFor, unansweredQuestions, type FollowUp, type Proposal, type RatingCorrection, type ScreeningSet, type SummaryContent } from "./screening";
import { type AssessmentRecord, type AssessmentView, type BlockedAssessment, type ClientView, type Evidence, type EvidenceStatus, type LoadedConfig } from "./model";
import { GATE, clientWording, explanationText, sentences, STATUS, TERMS, capExplanation, coverageLabel, labelsFor, plain, reasonLabel, resultLabel, stateLabel, storedStateLabel } from "./plainText";
import type { ReviewChange } from "./run";
import type { Criterion } from "./types";
import type { InputState } from "./versions";

/* The scoring test's assessment inside the portal's own pages (candidate Summary, Screening and Notes tabs, Next step panel,
   role page), with the portal's existing classes, in two views:
   - Client view (the local address "/"): one draft notice; a short first screen (overall assessment, summary, main strengths,
     important information to confirm, screening status). Requirement-level evidence is in the recruiter review only. Evidence statuses
     are recorded per requirement (client-view.json) and never derived from the numeric ratings, which stay internal.
     No score, formula, weight, score limit, internal ID, model detail, screening question or correction form.
   - Recruiter review (the separate local address "/review", never linked from the client view): the draft result, "View evidence", and "Review assessment" for the
     recruiter's tools (questions, how the result is worked out, where the information came from, the client summary
     review, corrections and the assessment rules). Every number comes from the calculator; nothing ranks, decides, moves
     or publishes anything.
   All wording is plain English (plainText.ts); stored statuses, ratings, reasons and history keep their recorded form.
   Developer records (fingerprints, run IDs, raw times, extraction diagnostics) stay in the private files, not on screen.
   Page references are plain text: opening the source page beside its quote is not built (it needs a reviewer-only access
   boundary that this local test does not have). */

export const EXPERIMENTAL = "Experimental — not validated or approved";
export { STATUS };
/** Reviewer flags about score mechanics (shown in the review controls, not with the evidence). */
const MECHANICS_FLAG = /\bcap\b|score limit|triggers/i;

/** Said once wherever quotes appear, so page references are not mistaken for links to the source. */
/** The shortest reason accepted for approving a strength held for review (the same as the server's). */
export const HELD_REASON_MIN = 10;
export const PAGE_NOTE = "Page numbers refer to the original CV. Opening the source page from here is not available yet.";

const statusOf = (cv: ClientView | null | undefined, id: string) => cv?.statuses[id] ?? null;
const StatusChip = ({ s }: { s: { status: EvidenceStatus } | null }) => s ? <span className={`chip ${STATUS[s.status].chip}`}>{STATUS[s.status].label}</span> : <span className="chip c-warn">Status not recorded</span>;
export const ResultChip = ({ r }: { r: CvResult }) => <span className={`chip ${r.status === "scored" ? "c-info" : r.status === "insufficient" ? "c-mute" : "c-warn"}`}>{resultLabel(r)}</span>;
const Problems = ({ list }: { list: string[] }) => list.length ? <div className="banner warn" role="alert"><b>Check before relying on this:</b><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{list.map((p) => <li key={p}>{p}</li>)}</ul></div> : null;
const Quote = ({ e, kind }: { e: Evidence; kind: AssessmentRecord["kind"] }) => (
  <div className="sc-q"><q>{e.quote}</q><div className="src">{kind === "real" ? `CV page ${e.page}` : `Invented example, page ${e.page}`}{kind === "real" && e.verified === false && <span className="sc-bad"> · not found on the stated page</span>}</div></div>
);
const Expand = ({ title, children, open }: { title: string; children: ReactNode; open?: boolean }) => <details className="jd sc-details" open={open}><summary>{title}</summary>{children}</details>;

/* ---------- Shared first-screen pieces ---------- */

type Kind = "essential" | "critical" | "important" | "preferred";
const TIER: Record<Kind, string> = { essential: "Essential requirement", critical: "Critical skill", important: "Important skill", preferred: "Preferred" };

/** The requirements in the configuration's order, with their recorded evidence status, reason and quotes. */
export function evidenceRows(v: AssessmentView) {
  const a = v.record, cv = a.clientView, labels = labelsFor(v.config);
  const row = (id: string, text: string, kind: Kind, evidence: Evidence[]) => {
    const s = statusOf(cv, id);
    /* A server rule check's status on an essential check, unless a recruiter has since changed that check. */
    const g = a.gates.find((x) => x.id === id), check = g?.check && v.latest.gates.find((x) => x.id === id)?.result === g.result ? g.check : null;
    return { id, text, kind, tier: TIER[kind], s, check, reason: s ? plain(s.reason ?? STATUS[s.status].reason, labels) : "No status has been recorded for this requirement.",
      evidence: s && ["needs-review", "claimed", "conflicting"].includes(s.status) ? evidence : [] };
  };
  return [
    ...v.config.gates.map((g) => row(g.id, g.label, "essential", a.gates.find((x) => x.id === g.id)?.evidence ?? [])),
    ...v.config.criteria.filter((c) => c.included).map((c) => row(c.id, labels.get(c.id)!, c.importance === "Critical" ? "critical" : c.importance === "Important" ? "important" : "preferred", a.criteria.find((x) => x.id === c.id)?.evidence ?? [])),
  ];
}

/** Every essential requirement and critical skill, by name. None can be resolved yet: no pass level is agreed, so even
    quoted evidence ("Needs review") is not shown as met, and missing information is not a fail. */
function ToConfirm({ rows, points, title = "Important information to confirm" }: { rows: ReturnType<typeof evidenceRows>; points: string[]; title?: string }) {
  /* Every essential requirement and critical skill, plus any other requirement whose information conflicts. */
  const open = rows.filter((r) => r.kind === "essential" || r.kind === "critical" || r.s?.status === "conflicting");
  return (
    <div className="box sc-open">
      <h3>{`${title} (${open.length})`}</h3>
      <p className="xs muted" style={{ margin: "4px 0 0" }}>Essential requirements, critical skills and anything with conflicting information. None is confirmed yet. Missing information is not a failure, and a quote from the CV is not proof that a requirement is met.</p>
      {open.length ? <ul className="reqlist">{open.map((r) => <li key={r.id}><span>{r.text}<span className="xs muted">{` · ${r.tier}`}</span></span>{r.check ? <span className="chip c-warn">{r.check.status}</span> : <StatusChip s={r.s} />}</li>)}</ul>
        : <p className="muted small">No essential requirements or critical skills are defined for this role.</p>}
      {points.length > 0 && <><h3 style={{ marginTop: 12 }}>Points to clarify</h3><ul>{points.map((x) => <li key={x}>{x}</li>)}</ul></>}
    </div>
  );
}

/** One sentence on how complete the information is, from the recorded statuses (no score). */
function overallLine(rows: ReturnType<typeof evidenceRows>) {
  const key = rows.filter((r) => r.kind === "essential" || r.kind === "critical"), n = (s: EvidenceStatus) => key.filter((r) => r.s?.status === s).length;
  const say = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const parts = [say(n("needs-review"), "has information that needs review", "have information that needs review"), n("claimed") && say(n("claimed"), "is claimed but not described", "are claimed but not described"),
    n("not-stated") && say(n("not-stated"), "is not stated", "are not stated"), n("separate") && say(n("separate"), "is checked separately", "are checked separately"),
    n("conflicting") && say(n("conflicting"), "has conflicting information", "have conflicting information")].filter(Boolean);
  return `Of ${key.length} essential requirements and critical skills, ${parts.join(", ")}. None is confirmed yet.`;
}

const ScreeningLine = ({ v }: { v: AssessmentView }) => (
  <p className="small" style={{ margin: "14px 0 0" }}><b>Screening: </b>{v.screening.status === "not-assessed" ? "not assessed. No screening answers have been added." : v.screening.status === "scored" ? `answers recorded (screening score ${v.screening.score}, invented example).` : "answers recorded, but not enough are rated for a screening score."}</p>
);

/* ---------- Client preview ---------- */

/** `proposed`: render a reviewer's proposed content instead of the current client view (for the review preview only). */
export function ClientAssessmentSummary({ v, proposed }: { v: AssessmentView; proposed?: ClientView }) {
  const a = proposed ? { ...v.record, clientView: proposed } : v.record, cv = a.clientView, rows = evidenceRows({ ...v, record: a }), labels = labelsFor(v.config);
  /* The same consistency check as the recruiter page; the client sees no internal detail, only that items are being checked. */
  const fit = cv ? consistencyOf(v, cv.strengths.map((x) => ({ text: x.text, raw: x.text, quotes: x.evidence ?? [] }))) : null;
  /* No client view describes the current assessment (it changed after review): show none of the older claims. */
  if (!cv) return (
    <section aria-label="Draft assessment" className="sc-panel">
      <div className="banner warn"><b>Draft assessment · update pending after review</b></div>
      <p className="muted small">The assessment changed after its client summary was reviewed. Nothing is shown until a recruiter confirms an updated summary.</p>
    </section>
  );
  return (
    <section aria-label="Draft assessment" className="sc-panel">
      <div className="banner warn"><b>Draft assessment · recruiter review pending</b></div>
      <div className="box sc-overall"><h3>Overall assessment (draft)</h3><p className="small" style={{ margin: "4px 0 0" }}>{overallLine(rows)}</p></div>
      <p className="why" style={{ marginTop: 16 }}><b>Summary.</b>{` ${clientWording(cv.summary, labels)}`}</p>
      {fit!.summaryFlag && <p className="xs sc-flag">A recruiter is checking parts of this summary against the requirements below.</p>}
      <div className="two">
        <div className="box"><h3>Main strengths</h3>{fit!.shown.length ? <ul>{fit!.shown.map((x) => <li key={x.text}>{clientWording(x.text, labels)}</li>)}</ul> : <p className="small muted">None shown yet.</p>}
          {fit!.held.length > 0 && <p className="xs muted">{`${fit!.held.length === 1 ? "One further strength is" : `${fit!.held.length} further strengths are`} being checked by a recruiter.`}</p>}</div>
        <ToConfirm rows={rows} points={cv.gaps.map((x) => clientWording(x, labels))} />
      </div>
      {fit!.raised.length > 0 && !fit!.confirmed && <p className="xs sc-flag">A recruiter has updated some requirements since these points were written; they are being checked.</p>}
      <ScreeningLine v={v} />
      {/* Requirement-level evidence (quotes and explanations) is shown in the recruiter review only, for now. */}
    </section>
  );
}

/** The Next step panel's content where one is shown without a score (blocked assessments): no actions. The client
    preview hides the panel instead of reserving a column for it. */
export const ClientNextStep = () => <p className="small muted">Actions are off in this local test.</p>;

/* ---------- Screening and Notes tabs (both views) ---------- */

export function ScreeningNotAssessed() {
  return (
    <>
      <div className="sec-h"><h2>Screening interview</h2><span className="chip c-mute">Not assessed</span></div>
      <p>No screening answers have been added.</p>
    </>
  );
}

/** Notes and history for a test candidate: when it was added to the local test, and nothing invented. */
export function TestHistory({ addedAt }: { addedAt: string | null | undefined }) {
  return (
    <>
      <div className="sec-h"><h2>Notes</h2></div>
      <p className="muted small">No notes in this test assessment.</p>
      <h2 style={{ margin: "22px 0 8px" }}>History</h2>
      {addedAt ? <ol className="hist"><li><span className="t">{fd(addedAt.slice(0, 10))}</span><span>Added to local test</span></li></ol> : <p className="muted small">No history recorded.</p>}
      <p className="xs muted" style={{ marginTop: 10 }}>The date is when the candidate was added to this test. Nothing has been shared with a client, and no stage change or decision has been recorded.</p>
    </>
  );
}

/* ---------- Internal review ---------- */

/** What this prototype does and does not do, against the starter's steps (collapsed by default). */
export function AboutPrototype() {
  const rows: [string, string, string][] = [
    ["Agreed role setup and assessment rules", "Draft", "The role setup and assessment rules are drafts. One test version was fixed before the CVs were read. It is not approved."],
    ["Essential requirement checks", "Draft", "Each is marked met, not met or not confirmed, with quotes, under draft pass levels."],
    ["CV ratings with quotes, and a CV score", "Draft", "Ratings were prepared by an AI assistant (Claude, in a Claude Code session) from blinded CV text. The assistant's reading was processed by Anthropic's service, not on this computer, without an approved processing route. A fixed calculator does the arithmetic. What the client preview shows is recorded separately from the ratings."],
    ["Strengths, gaps and 3–5 screening questions", "Draft", "Prepared with the ratings; recruiter review pending. Questions appear in this internal review only."],
    ["Screening answers, ratings and a screening score", "Not done", "The calculator can do this (see the invented example on the role page). No answers have been added for these candidates."],
    ["Communication notes and a short call summary", "Not started", "Needs a screening call."],
    ["Combined result under agreed rules", "Not started", "No rule for combining the CV and screening has been agreed."],
    ["Recruiter review and recorded changes", "This computer only", "Recruiter changes are saved as new versions on this computer; the original is kept. The history is checked for edits, but reviewer names are typed in, not signed in. No recruiter has reviewed these assessments."],
    ["Text extraction and blinding", "This computer only", "Text is extracted and names are hidden on this computer (macOS). The four test CVs were re-extracted on 28 October 2026 and the text matched what each assessment uses. It has not been checked by a person against the PDFs. Hiding names is not full anonymisation."],
    ["Checking a quote against its source page", "Not built", "Quotes give a CV page number. Opening that page from here needs a reviewer-only access boundary, which this test does not have."],
    ["Automatic rating of a new CV", "Not built", "There is no upload or automatic rating. Each assessment so far was prepared by hand with the assistant."],
  ];
  return (
    <Expand title="About this prototype">
      <p className="small" style={{ margin: "8px 0" }}>{`${EXPERIMENTAL}. The client view and this recruiter review are separate local addresses on this computer, with no link between them. It is not a sign-in or access control.`}</p>
      <table className="req"><thead><tr><th>Step</th><th>Status here</th><th>Detail</th></tr></thead><tbody>
        {rows.map(([s, st, d]) => <tr key={s}><td className="rq">{s}</td><td className="st"><span className={`chip ${["Draft", "This computer only"].includes(st) ? "c-info" : "c-mute"}`}>{st}</span></td><td className="ev">{d}</td></tr>)}
      </tbody></table>
    </Expand>
  );
}

/** An assessment the local server refused: no ratings, evidence or results exist on the page. */
export function BlockedAssessmentPanel({ b, internal }: { b: BlockedAssessment; internal: boolean }) {
  return (
    <section aria-label="Assessment unavailable" className="sc-panel">
      <div className="banner warn"><b>Assessment unavailable</b></div>
      <p className="small">{internal ? "The files or records behind this assessment do not match what was recorded, so no ratings, evidence or results are shown. The reasons are below." : "No assessment details are available for this candidate."}</p>
      {internal && <ul className="small">{b.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
    </section>
  );
}

function changeText(c: ReviewChange, labels: Map<string, string>) {
  const name = (id?: string) => (id ? labels.get(id) ?? id : "");
  if (c.kind === "inputs") return "The information behind the assessment changed, so every part must be reviewed again.";
  if (c.kind === "rating") return `${name(c.id)}: ${storedStateLabel(c.from)} → ${storedStateLabel(c.to)}`;
  return `${name(c.id)} corrected in version ${c.version}: ${storedStateLabel(c.from)} → ${storedStateLabel(c.to)}. Reason: ${c.reason}`;
}

/** Client-summary versions, current or older, and the explicit review that ties a new one to the current assessment:
    the reviewer sees what changed and the summary as the client would see it, and gives a reason for any wording kept. */
function ClientViewReview({ v, onChanged }: { v: AssessmentView; onChanged(): void }) {
  /* A review after the assessment changed, or an initial review of the prepared draft (no rating change needed). Either
     way the confirmation records that the summary wording was reviewed; it does not approve ratings or decide anything. */
  const initial = !v.record.review && !!v.record.initialReview;
  const a = v.record, revs = a.clientViews ?? [], rv = a.review ?? (a.initialReview ? { ...a.initialReview, changes: [] as ReviewChange[], affected: [] as string[] } : null), base = rv ? revs.find((r) => r.revision === rv.baseRevision) : undefined, labels = labelsFor(v.config);
  const ids = [...v.config.gates.map((g) => g.id), ...v.config.criteria.filter((c) => c.included).map((c) => c.id)];
  const [summary, setSummary] = useState(base?.content.summary ?? ""), [gaps, setGaps] = useState((base?.content.gaps ?? []).join("\n"));
  /* Strengths held for review (consistency.ts) start unticked: keeping one needs an active tick and a short reason, recorded
     with the confirmation. Other strengths start ticked, as before. */
  /* The strengths offered: the base summary's, plus any held strength an earlier summary left out (from the revision that
     had it, with its quotes), so a held strength can still be approved later. */
  const offered = base ? [...base.content.strengths, ...revs.flatMap((r) => r.content.strengths).filter((x, i, all) => !base.content.strengths.some((b) => b.text === x.text) && all.findIndex((y) => y.text === x.text) === i)] : [];
  const fitNow = consistencyOf(v, offered.map((x) => ({ text: x.text, raw: x.text, quotes: x.evidence ?? [] })));
  const heldBy = new Map(fitNow.held.map((h) => [h.text, h.because] as const)), strengthsOffered = offered.filter((x) => base!.content.strengths.includes(x) || heldBy.has(x.text));
  const [keep, setKeep] = useState<boolean[]>(strengthsOffered.map((x) => !heldBy.has(x.text)));
  const [approve, setApprove] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, { status: EvidenceStatus; reason?: string }>>(base?.content.statuses ?? {});
  const [retained, setRetained] = useState<{ summary: string; strengths: string; gaps: string; statuses: Record<string, string> }>({ summary: "", strengths: "", gaps: "", statuses: {} });
  const [reviewer, setReviewer] = useState(""), [confirmed, setConfirmed] = useState(false), [problems, setProblems] = useState<string[]>([]), [saved, setSaved] = useState<string | null>(null);
  const reviewedBy = a.clientView ? revs.filter((r) => r.current && r.preparation.method === "reviewer-confirmed").pop() : undefined;
  if (!a.run || !rv || !base) return a.clientView ? <p className="small" style={{ margin: 0 }}>{reviewedBy
    ? `Reviewed by ${reviewedBy.preparation.actor} on ${fd(reviewedBy.preparation.at.slice(0, 10))}, and matches the current assessment. This records that the summary wording was reviewed; it does not approve the ratings and is not a hiring decision.`
    : "It matches the current assessment and is what the client view shows."}</p> : null;
  const content = { summary, gaps: gaps.split("\n").map((x) => x.trim()).filter(Boolean), strengths: strengthsOffered.filter((_, i) => keep[i]), statuses };
  const unchanged = { summary: summary.trim() === base.content.summary.trim(), strengths: content.strengths.length > 0, gaps: content.gaps.some((g) => base.content.gaps.includes(g)) };
  const approvedHeld = strengthsOffered.filter((x, i) => keep[i] && heldBy.has(x.text)).map((x) => ({ text: x.text, reason: (approve[x.text] ?? "").trim() }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const missing = approvedHeld.filter((x) => x.reason.length < HELD_REASON_MIN);
    if (missing.length) { setProblems([`Give a short reason (at least ${HELD_REASON_MIN} characters) for keeping each strength that was held for review, or untick it.`]); return; }
    const statusReasons = Object.fromEntries(Object.entries(retained.statuses).filter(([, x]) => x.trim()));
    const r = await saveClientView({ assessmentId: a.id, describes: { assessmentFingerprint: a.run!.assessmentFingerprint, assessmentVersion: v.latest.version, stateSha256: a.latestStateSha!, rubric: a.rubric! },
      changesSha256: rv.changesSha256, content, reviewer, confirmed, approvedHeld,
      retained: { ...(retained.summary.trim() ? { summary: retained.summary } : {}), ...(retained.strengths.trim() ? { strengths: retained.strengths } : {}), ...(retained.gaps.trim() ? { gaps: retained.gaps } : {}), statuses: statusReasons } });
    if (r.ok) { setProblems([]); setSaved(initial ? "Saved. The client summary is reviewed; the ratings are unchanged and are not approved by this." : "Saved. This summary now matches the current assessment."); onChanged(); } else setProblems(r.problems);
  };
  const reasonField = (id: string, show: boolean, value: string, set: (x: string) => void) => show && !initial && <div className="f"><label htmlFor={id}>Why keep this unchanged?</label><input id={id} maxLength={500} value={value} onChange={(e) => set(e.target.value)} /></div>;
  return (
    <>
      {initial
        ? <p className="small"><b>Not reviewed yet: this is the prepared draft summary.</b>{` Review it, edit it if needed, and confirm it for assessment version ${v.latest.version}. Confirming records that the summary wording was reviewed. It does not change or approve the ratings, and it is not a hiring decision.`}</p>
        : <><p className="small"><b>The client summary is out of date: the assessment changed after it was written.</b>{` The client preview shows nothing until a recruiter confirms a summary for assessment version ${v.latest.version}. Nothing is rewritten automatically.`}</p>
          <div className="box"><h3>{`What changed since client summary version ${rv.baseRevision}`}</h3><ul>{rv.changes.map((c, i) => <li key={i} className="small">{changeText(c, labels)}</li>)}</ul></div></>}
      <form className="form sc-form" onSubmit={submit} style={{ marginTop: 12 }}>
        <h3 style={{ marginBottom: 10 }}>{initial ? `Review the draft client summary (assessment version ${v.latest.version})` : `Review the client summary for assessment version ${v.latest.version}`}</h3>
        <p className="xs muted" style={{ margin: "0 0 8px" }}>{initial ? "Edit the summary, keep or remove strengths and review the points to clarify. Strengths keep their quotes, which are checked against the CV page." : `This starts from client summary version ${rv.baseRevision}. Anything kept unchanged after the assessment changed needs a reason. Strengths keep their quotes, which are checked against the CV page.`}</p>
        <div className="f"><label htmlFor="cvSummary">Summary</label><textarea id="cvSummary" maxLength={1500} value={summary} onChange={(e) => setSummary(e.target.value)} /></div>
        {reasonField("cvKeepSummary", unchanged.summary, retained.summary, (x) => setRetained({ ...retained, summary: x }))}
        <div className="f"><span className="small" style={{ fontWeight: 600 }}>Strengths to keep</span>{strengthsOffered.map((x, i) => { const because = heldBy.get(x.text); return <div key={x.text}>
          <label className="small" style={{ display: "block", fontWeight: 400 }}><input type="checkbox" checked={keep[i]} onChange={(e) => setKeep(keep.map((k, j) => (j === i ? e.target.checked : k)))} style={{ width: "auto", marginRight: 6 }} />{x.text}</label>
          {because && <div className="xs sc-flag" style={{ marginLeft: 22 }}>{`Held for review: it rests on ${changeList(because)}. Not kept unless you tick it and give a reason.`}</div>}
          {because && keep[i] && <input aria-label={`Why approve this held strength: ${x.text}`} placeholder="Why does this strength still stand? (required)" maxLength={500} value={approve[x.text] ?? ""} onChange={(e) => setApprove({ ...approve, [x.text]: e.target.value })} style={{ marginLeft: 22, marginTop: 4, width: "calc(100% - 22px)" }} />}
        </div>; })}</div>
        {reasonField("cvKeepStrengths", unchanged.strengths, retained.strengths, (x) => setRetained({ ...retained, strengths: x }))}
        <div className="f"><label htmlFor="cvGaps">Points to clarify (one per line)</label><textarea id="cvGaps" maxLength={3000} value={gaps} onChange={(e) => setGaps(e.target.value)} /></div>
        {reasonField("cvKeepGaps", unchanged.gaps, retained.gaps, (x) => setRetained({ ...retained, gaps: x }))}
        <div className="f"><span className="small" style={{ fontWeight: 600 }}>What we found, per requirement</span>
          {ids.map((id) => { const name = labels.get(id) ?? id, changedHere = rv.affected.includes(id), same = changedHere && statuses[id]?.status === base.content.statuses[id]?.status;
            return <div key={id} style={{ marginTop: 6 }}><div style={{ display: "flex", gap: 8, alignItems: "center" }}><span className="small" style={{ flex: 1 }}>{name}{changedHere && <b className="sc-flag"> · changed in the assessment</b>}</span>
              <select aria-label={`${name}: what we found`} value={statuses[id]?.status ?? ""} onChange={(e) => setStatuses({ ...statuses, [id]: { status: e.target.value as EvidenceStatus } })} style={{ width: 260 }}>
                <option value="" disabled>Choose…</option>{(Object.keys(STATUS) as EvidenceStatus[]).map((k) => <option key={k} value={k}>{STATUS[k].label}</option>)}</select></div>
              {same && <input aria-label={`${name}: why keep this status`} placeholder="Why keep this status?" maxLength={300} value={retained.statuses[id] ?? ""} onChange={(e) => setRetained({ ...retained, statuses: { ...retained.statuses, [id]: e.target.value } })} style={{ marginTop: 4 }} />}</div>; })}</div>
        <div className="box" style={{ marginTop: 12 }}><h3>The client summary as it would appear</h3><ClientAssessmentSummary v={v} proposed={{ ...content, preparedBy: "", statusRule: "" }} /></div>
        <div className="f"><label htmlFor="cvWho">Your name</label><input id="cvWho" maxLength={100} value={reviewer} onChange={(e) => setReviewer(e.target.value)} /><div className="help">Recorded as typed. It is not a sign-in.</div></div>
        <label className="small" style={{ display: "block", marginTop: 8 }}><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} style={{ width: "auto", marginRight: 6 }} />{initial ? `I have reviewed this client summary against assessment version ${v.latest.version}.` : `I have reviewed the changes and this client summary against assessment version ${v.latest.version}.`}</label>
        {problems.length > 0 && <div className="err">{problems.join(" ")}</div>}
        {saved && <div className="banner info">{saved}</div>}
        <div className="row"><button type="submit" className="btn btn-p">Confirm client summary</button></div>
      </form>
    </>
  );
}

const gatesLine = (r: CvResult) => r.failedGates.length ? `${r.failedGates.length} not met` : r.unknownGates.length ? `${r.unknownGates.length} not confirmed — ask in screening` : "None open";

export function AssessmentStatus({ v }: { v: AssessmentView }) {
  const r = v.latest.result;
  return (
    <>
      <div className={`nextbox ${r.status === "scored" ? "sched" : "you"}`}><b>{`Draft CV result: ${resultLabel(r)}`}</b><span className="small">{`Assessment version ${v.latest.version} · test rules version ${v.config.version}`}</span></div>
      <dl className="statusdl">
        <dt>Information in CV</dt><dd>{coverageLabel(r)}</dd>
        <dt>Essential</dt><dd>{gatesLine(r)}</dd>
        <dt>Screening</dt><dd>{v.screening.status === "not-assessed" ? "Not assessed" : v.screening.status === "scored" ? `${v.screening.score} (invented example)` : "No screening score"}</dd>
        <dt>Combined</dt><dd>Not calculated</dd>
      </dl>
      <p className="small muted">Actions are off in this local test.</p>
    </>
  );
}

/** The candidate summary, read-only, shared by the recruiter's assessment page and the read-only preview:
    - one draft result, with the draft label;
    - a short, balanced summary: two of the draft's own whole sentences (shortSummary);
    - three strengths, each expandable to its quotes;
    - a short checklist of the essential requirements and critical skills that are still unresolved (not yet settled by
      a recruiter), plus anything with conflicting information, each expandable to its quotes and full explanation;
    - "All requirements": every other requirement the same way, and the draft's own wording kept in full (the complete
      summary, further strengths, other sales results and its list of gaps), so nothing recorded is lost.
    Explanations keep the draft's complete sentences: names replace internal codes, and only standalone boilerplate
    sentences are left out (explanationText). Nothing here changes a score, status or record. `preview` leaves out
    references to the recruiter's review section, which the preview does not have. No form, no action. */
export function DraftAssessment({ v, preview = false }: { v: AssessmentView; preview?: boolean }) {
  const a = v.record, r = v.latest.result, latest = new Map(v.latest.inputs.map((i) => [i.id, i])), cv = a.clientView, labels = labelsFor(v.config);
  /* Evidence statuses: the current client view's, or (labelled older) the latest revision's. */
  const statusView = cv ?? (a.clientViews?.length ? { ...a.clientViews[a.clientViews.length - 1].content, preparedBy: "", statusRule: "" } : null);
  const rows = evidenceRows({ ...v, record: { ...a, clientView: statusView } });
  const correctedTo = (id: string) => [...v.versions].reverse().find((x) => x.correction?.criterionId === id)?.correction?.next ?? null;
  const why = reasonLabel(r, v.config) ?? capExplanation(r, v.config);
  const fullSummary = statusView ? plain(statusView.summary, labels) : null, summary = fullSummary && shortSummary(fullSummary), ai = /\(ai-proposed\)/.test(a.producedBy);
  /* A strength's quotes from any client-summary revision (the AI's first one included), so a strength left out of a later
     summary keeps its link to the evidence it rests on. */
  const strengthQuotes = new Map([...(a.clientViews ?? []).flatMap((r) => r.content.strengths), ...(statusView?.strengths ?? [])].map((x) => [x.text, x.evidence ?? []]));
  /* Strengths, the summary and the gaps were written by the AI before the rule checks and any recruiter correction: a
     strength that rests on a requirement the final assessment no longer supports is held for review, and the summary and
     gaps are flagged with what changed (consistency.ts). */
  /* The active strengths are the current summary's (the reviewed one once a recruiter has confirmed it, otherwise the
     draft's); a strength removed from it stays removed, and is listed only as history. Strengths from the AI's draft and
     earlier summaries are still checked, so a held strength stays held for an explicit review wherever it came from. */
  const activeTexts = statusView ? statusView.strengths.map((x) => x.text) : a.strengths, active = new Set(activeTexts);
  const known = [...new Set([...activeTexts, ...a.strengths, ...(a.clientViews ?? []).flatMap((r) => r.content.strengths.map((x) => x.text))])];
  const fit = consistencyOf(v, known.map((text) => ({ text: plain(text, labels), raw: text, quotes: strengthQuotes.get(text) ?? [] })));
  const strengths = fit.shown.filter((x) => active.has(x.raw!)), removed = fit.shown.filter((x) => !active.has(x.raw!));
  const reviewedNow = (a.clientViews ?? []).some((r) => r.current && r.preparation.method === "reviewer-confirmed") && !!a.clientView;
  /* Unresolved: not yet settled by a recruiter's correction. A conflict is always listed, whatever its tier. */
  const settled = (id: string) => { const c = correctedTo(id); return !!c && (c.status === "gate" ? c.result !== "Unknown" : c.status === "rated"); };
  const open = rows.filter((x) => ((x.kind === "essential" || x.kind === "critical") && !settled(x.id)) || x.s?.status === "conflicting");
  const rest = rows.filter((x) => !open.includes(x)), excluded = v.config.criteria.filter((c) => !c.included);
  const changedNote = preview ? "A recruiter has changed this." : "A recruiter has changed this (see Review and corrections).";

  const item = (row: (typeof rows)[number]) => {
    const g = a.gates.find((x) => x.id === row.id), c = a.criteria.find((x) => x.id === row.id), rec = g ?? c;
    const gateNow = g ? v.latest.gates.find((x) => x.id === g.id)?.result ?? g.result : null, st = c ? latest.get(c.id) ?? { status: "unknown" } : null;
    const chip = g?.check && gateNow === g.result ? <span className="chip c-warn">{g.check.status}</span> : <StatusChip s={row.s} />;
    const text = rec ? explanationText(rec.explanation, labels) : "";
    const flags = (c?.flags ?? []).filter((f) => !MECHANICS_FLAG.test(f)).map((f) => explanationText(f, labels)).filter(Boolean);
    return (
      <li key={row.id}><details className="sc-item">
        <summary><span className="sc-item-n">{row.text}<span className="xs muted">{` · ${row.tier}`}</span></span><span className="sc-item-s">{chip}{!cv && statusView && <span className="xs muted">older</span>}</span></summary>
        <div className="sc-item-b">
          {rec?.evidence.map((e, i) => <Quote key={i} e={e} kind={a.kind} />)}
          <p className="small">{text || (row.s ? STATUS[row.s.status].reason : "No explanation was recorded.")}</p>
          {rec?.basis === "interpretation" && rec.evidence.length > 0 && <p className="xs muted">This is an interpretation: the CV does not say it directly.</p>}
          {gateNow === "Pass" && <p className="xs muted">The draft records this as met on the CV, provisionally.</p>}
          {g?.check && gateNow === g.result && <p className="xs muted">{`${g.check.reason} The AI proposed: ${({ Pass: "met", Fail: "not met", Unknown: "not confirmed" } as const)[g.check.aiProposed]}.`}</p>}
          {gateNow === "Fail" && <p className="xs sc-flag">The draft records this as not met. A recruiter must check it; nothing is rejected automatically.</p>}
          {st?.status === "rated" && st.rating === 0 && <p className="xs sc-flag">The CV states that this was not part of the role.</p>}
          {st?.status === "disputed" && <p className="xs sc-flag">The information conflicts, so there is no score until a recruiter resolves it.</p>}
          {c?.detail === "Brief" && <p className="xs muted">The CV gives only brief detail.</p>}
          {flags.map((f) => <p key={f} className="xs sc-flag">{f}</p>)}
          {correctedTo(row.id) && <p className="xs muted">{changedNote}</p>}
        </div>
      </details></li>
    );
  };
  return (
    <>
      {v.versionProblems.length > 0 && <Problems list={v.versionProblems} />}
      <div className="box sc-overall">
        <h3 style={{ margin: 0 }}>{ai ? "AI draft — recruiter review needed" : "Draft — recruiter review needed"}</h3>
        <div className="reqsum" style={{ margin: "6px 0 0" }}><ResultChip r={r} /><span className="xs muted">{`${ai ? "Proposed by AI from the CV" : "Prepared by hand with an AI assistant"}${v.latest.version > 1 ? `; changed by a recruiter (version ${v.latest.version})` : ""}${cv ? "" : "; the client summary is out of date"}`}</span></div>
        {why && <p className="small" style={{ margin: "6px 0 0" }}>{why}</p>}
        <div className="sc-rules"><span className={`chip ${v.config.approved ? "c-ok" : "c-warn"}`}>{v.config.approved ? "Approved rules" : "Test rules — awaiting approval"}</span>
          <span className="xs muted">{`Assessed against the ${v.config.approved ? "approved" : "draft"} rules for this role (version ${v.config.version}), which set the requirements, how each is rated and how the score is worked out. The full rules are kept in the reference document, not on this page.`}</span></div>
      </div>
      {summary && <p className="why" style={{ marginTop: 16 }}><b>Summary.</b>{` ${summary}`}</p>}
      {summary && fit.summaryFlag && <p className="xs sc-flag">{`Marked for review: the AI wrote this summary before these changes, so parts of it may no longer hold. Its wording is kept as written. Changed since: ${changeList(fit.changed)}.`}</p>}
      <div className="two">
        <div className="box sc-checklist"><h3>Strengths</h3>
          {strengths.length ? <ul className="sc-items">{strengths.slice(0, 3).map((x) => <li key={x.text}>{x.quotes.length ? <details className="sc-item"><summary><span className="sc-item-n">{x.text}</span></summary><div className="sc-item-b">{x.quotes.map((e, i) => <Quote key={i} e={e} kind={a.kind} />)}</div></details> : <div className="sc-item-plain">{x.text}</div>}</li>)}</ul>
            : <p className="small muted">No strength is shown until a recruiter reviews the ones held below.</p>}
          {fit.held.length > 0 && <div className="sc-held"><p className="xs sc-flag" style={{ margin: "8px 0 2px" }}>{`Held for review (${fit.held.length}): not shown as ${fit.held.length === 1 ? "a strength" : "strengths"}, because the final assessment does not support what ${fit.held.length === 1 ? "it rests" : "they rest"} on.`}</p>
            <ul className="sc-items">{fit.held.map((x) => <li key={x.text}><details className="sc-item"><summary><span className="sc-item-n">{x.text}</span></summary><div className="sc-item-b">
              {x.quotes.map((e, i) => <Quote key={i} e={e} kind={a.kind} />)}
              <p className="xs muted">{`It rests on ${changeList(x.because)}. It stays held, even if a rating is later raised, until a recruiter keeps this strength when confirming the client summary. No replacement wording is written.`}</p></div></details></li>)}</ul></div>}
        </div>
        <div className="box sc-checklist"><h3>{`To confirm (${open.length})`}</h3>
          <p className="xs muted" style={{ margin: "2px 0 6px" }}>None of these is confirmed yet. Missing information is not a failure.</p>
          {open.length ? <ul className="sc-items">{open.map(item)}</ul> : <p className="small muted">Every essential requirement and critical skill has been settled by a recruiter.</p>}
        </div>
      </div>
      <Expand title={`All requirements (${rest.length + excluded.length} more)`}>
        {rest.length > 0 && <ul className="sc-items" style={{ marginTop: 8 }}>{rest.map(item)}</ul>}
        {excluded.length > 0 && <p className="small">{`Not scored in this version of the rules: ${excluded.map((d) => labels.get(d.id) ?? d.id).join(", ")}.`}</p>}
        {a.otherResults.length > 0 && <><h3 style={{ margin: "14px 0 6px" }}>Other sales results (recorded, no points)</h3><ul>{a.otherResults.map((o, i) => <li key={i}><b>{`${o.type.replace(/^P\d(?:\s*\/\s*P\d)?\s*/, "").replace(/^./, (x) => x.toUpperCase())}:`}</b> <Quote e={o} kind={a.kind} /></li>)}</ul></>}
        {strengths.length > 3 && <><h3 style={{ margin: "14px 0 6px" }}>Further strengths in the current summary</h3><ul>{strengths.slice(3).map((x) => <li key={x.text}>{x.text}{x.quotes.map((e, i) => <Quote key={i} e={e} kind={a.kind} />)}</li>)}</ul></>}
        {removed.length > 0 && <><h3 style={{ margin: "14px 0 6px" }}>Strengths not in the current summary (kept for the record, not active)</h3><ul>{removed.map((x) => <li key={x.text} className="small">{x.text}
          <span className="xs muted">{reviewedNow ? " Removed in the reviewed summary." : " Not in the current summary."}</span>{x.quotes.map((e, i) => <Quote key={i} e={e} kind={a.kind} />)}</li>)}</ul></>}
        {fullSummary && fullSummary !== summary && <><h3 style={{ margin: "14px 0 6px" }}>The draft's full summary</h3><p className="small">{fullSummary}</p></>}
        {a.gaps.length > 0 && <><h3 style={{ margin: "14px 0 6px" }}>The draft's list of gaps</h3>
          {fit.raised.length > 0 && <p className="xs sc-flag">{`Check these gaps: written before a recruiter changed ${changeList(fit.raised)}.`}</p>}
          <ul>{a.gaps.map((x) => <li key={x} className="small">{plain(x, labels)}</li>)}</ul></>}
        {a.kind === "real" && <p className="xs muted">{PAGE_NOTE}</p>}
      </Expand>
    </>
  );
}

/** A short, balanced summary from the draft's own whole sentences: its opening sentence (the main strength) and its first
    later sentence about missing information (the main concern); the first two sentences when none is found. */
export function shortSummary(t: string) {
  const s = sentences(t), concern = s.slice(1).find((x) => /\b(?:[Nn]o|not|without|only|absent|missing|lacks?)\b/.test(x));
  return (concern ? [s[0], concern] : s.slice(0, 2)).join(" ");
}

/** The recruiter's assessment page: the draft (above), then named sections for screening questions, review and
    corrections, and earlier assessments. */
/** The recruiter's screening questions (W1): the role's versioned core set, the same for every candidate, then this
    candidate's own follow-ups for gaps. Each shows what it checks, whether it is scored or only confirms a requirement,
    and the proposed answer points (marked as needing business review). Nothing has been asked: every question is "Not
    asked yet" and screening stays "Not assessed". Recruiter page only; the client view never shows questions. */
/** The CV assessment and the screening assessment, each on its own (final review). Combined scoring is deferred
    (Akansha, 28 October 2026). The screening shows each scored question's current rating; no agreed rule turns the 1–5
    ratings into an overall score, so none is calculated. */
export function SeparateAssessments({ v, sets }: { v: AssessmentView; sets?: ScreeningSet[] }) {
  const a = v.record, r = v.latest.result, st = currentScreening(a.screeningRecord), saved = st.answers;
  const set = saved ? (sets ?? []).find((x) => x.id === saved.set.id && x.version === saved.set.version && x.sha256 === saved.set.sha256 && !x.loadProblems?.length) ?? null : null;
  const followUps = set ? followUpsFor(a, set) : [];
  /* The scored questions of the recorded set, or, when that set is not available here, the questions that have a rating. */
  const ids = set ? set.questions.filter((q) => q.use === "scored").map((q) => q.id) : [...new Set([...Object.keys(st.proposal?.ratings ?? {}), ...st.corrections.map((c) => c.questionId)])];
  const row = (qid: string) => {
    const q = set?.questions.find((x) => x.id === qid), x = st.ratingOf(qid), answered = saved ? (set ? answerSources(qid, saved, followUps).length > 0 : true) : false;
    const state = x.rating !== null ? `${x.rating} of 5 (${x.by === "recruiter" ? "set by a recruiter" : st.proposal?.isAi ? "AI draft, not reviewed" : "draft, not reviewed"})`
      : x.by === "recruiter" ? "Not rated (a recruiter removed the rating)" : answered ? "Not rated yet" : "Not answered";
    return <li key={qid}>{`${q?.text ?? qid}: ${state}`}</li>;
  };
  return (
    <div className="sc-separate">
      <p className="small" style={{ margin: "4px 0" }}><b>CV assessment: </b><ResultChip r={r} />{` ${starterRouting(r).text}`}</p>
      <div className="small"><b>Screening assessment: </b>{saved
        ? <><ul className="sc-points">{ids.map(row)}</ul><span>{SCREENING_SCORE_PENDING}</span></>
        : "Not assessed: no screening answers are recorded."}</div>
      <p className="xs muted" style={{ margin: "4px 0 0" }}>{SEPARATE}</p>
    </div>
  );
}

/** W6: the recruiter's final review (recruiter page only). The recruiter's own decision, a required reason, their name
    and the date, kept apart from AI suggestions; earlier decisions stay in the history. Open essential requirements and
    conflicts are shown first and must be acknowledged. Nothing is moved, published or notified, and no score changes. */
export function FinalReview({ v, sets, onChanged = () => {} }: { v: AssessmentView; sets?: ScreeningSet[]; onChanged?(): void }) {
  const a = v.record, labels = labelsFor(v.config), sKey = screeningKey(a.screeningRecord);
  const { current, outOfDate, earlier, revision } = decisionHistory(a.finalDecisions, { stateSha256: a.latestStateSha ?? "", screeningKey: sKey });
  const open = openItems(v.config, a, v.latest, a.screeningRecord), forwardBlocked = failedEssentials(open).length > 0;
  const [decision, setDecision] = useState<DecisionKind | "">(""), [reason, setReason] = useState(""), [reviewer, setReviewer] = useState(""), [seen, setSeen] = useState(false);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    if (!a.run) return;
    const r = await guarded(() => saveFinalDecision({ assessmentId: a.id, expectedRevision: revision, expected: { assessmentFingerprint: a.run!.assessmentFingerprint, assessmentVersion: v.latest.version, stateSha256: a.latestStateSha ?? "" },
      expectedScreeningKey: sKey, decision, reason, reviewer, acknowledgedOpenItems: seen }), setBusy, (t) => setMsg({ ok: false, text: t }), RETRY.final);
    if (r?.ok) { setMsg({ ok: true, text: "Decision recorded. Nothing has been moved, published or sent." }); setDecision(""); setReason(""); setSeen(false); onChanged(); } else if (r) setMsg({ ok: false, text: r.problems.join(" ") });
  };
  const line = (d: FinalDecision) => `${DECISIONS[d.decision]}: ${d.reason} (${d.reviewer}, ${fd(d.at.slice(0, 10))}; CV version ${d.cv.version})`;
  return (
    <div className="box sc-final" style={{ marginTop: 16 }}>
      <h3>Recruiter final review</h3>
      <p className="xs muted" style={{ margin: "2px 0 6px" }}>Your own decision, kept apart from the AI suggestions above. Recording it does not accept, reject, move, publish or notify anything; the candidate's stage is unchanged.</p>
      <SeparateAssessments v={v} sets={sets} />
      {current ? <div className="small">{outOfDate ? <b className="sc-flag">Out of date — review again: </b> : <b>Current decision: </b>}{line(current)}
        {outOfDate && <div className="xs sc-flag">The CV assessment or the screening evidence (answers, ratings or CV-check findings) has changed since this decision. It is kept; record a new decision after reviewing.</div>}</div>
        : <p className="small muted">No decision has been recorded.</p>}
      {earlier.length > 0 && <div className="xs muted"><b>Earlier decisions (kept): </b><ul className="sc-points">{earlier.map((d) => <li key={d.revision}>{line(d)}</li>)}</ul></div>}
      <div className={open.length ? "banner warn" : "banner info"} style={{ marginTop: 8 }}><b>{open.length ? `Still open (${open.length}): ` : "Nothing open: "}</b>
        {open.length ? <ul className="sc-points">{open.map((x) => <li key={`${x.kind}-${x.id}`}>{`${labels.get(x.id) ?? x.id} (${x.kind === "essential" ? "essential requirement" : x.kind}): ${x.state}`}</li>)}</ul> : "no essential requirement or conflict is open."}</div>
      <div className="sc-form sc-fix">
        <label className="small">Decision <select aria-label="Final decision" value={decision} onChange={(e) => setDecision(e.target.value as DecisionKind)}><option value="">Choose…</option>{(Object.keys(DECISIONS) as DecisionKind[]).map((k) => <option key={k} value={k} disabled={k === "forward" && forwardBlocked}>{k === "forward" && forwardBlocked ? `${DECISIONS[k]} (not available)` : DECISIONS[k]}</option>)}</select></label>
        {forwardBlocked && <p className="xs sc-flag" style={{ margin: 0 }}>{FORWARD_BLOCKED}</p>}
        <textarea aria-label="Reason for the decision" placeholder="Reason (required)" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
        <input aria-label="Final review name" placeholder="Your name" value={reviewer} maxLength={100} onChange={(e) => setReviewer(e.target.value)} />
        {open.length > 0 && <label className="small"><input type="checkbox" checked={seen} onChange={(e) => setSeen(e.target.checked)} style={{ width: "auto", marginRight: 6 }} />I have seen the open items above.</label>}
        {msg && <div className={msg.ok ? "banner info" : "err"} role="status">{msg.text}</div>}
        <div className="row"><button type="button" className="btn btn-p" disabled={busy} onClick={save}>Record decision</button></div>
        <p className="xs muted">The date is recorded by this computer, and the name is recorded as typed (it is not a sign-in).</p>
      </div>
    </div>
  );
}

/** Where the candidate stands under the starter's own rules (recruiter page only): the CV score and its routing and the
    screening status, kept separate (combined scoring is deferred). */
export function WhereThisStands({ v }: { v: AssessmentView }) {
  const r = v.latest.result, routing = starterRouting(r), labels = labelsFor(v.config), st = currentScreening(v.record.screeningRecord);
  const rated = st.answers ? Object.keys(st.proposal?.ratings ?? {}).length + st.corrections.length : 0;
  return (
    <div className="box sc-stands">
      <h3>Where this stands</h3>
      <dl className="statusdl">
        <dt>CV score</dt><dd><ResultChip r={r} />{` ${routing.text}`}{routing.askInCall.length > 0 && <div className="xs muted">{`Ask in the call (the starter): ${routing.askInCall.map((id) => labels.get(id) ?? id).join(", ")}.`}</div>}</dd>
        <dt>Screening</dt><dd>{st.answers ? `Answers recorded${rated ? "; draft ratings exist" : ""}. ` : "Not assessed. "}No screening score is calculated: the starter rates answers 1 to 5 but does not say how they become a score out of 100.</dd>
        <dt>Combined</dt><dd>{SEPARATE}</dd>
      </dl>
    </div>
  );
}

/** Plain-English messages when a request to the local server does not complete. Typed answers stay on the page, and
    nothing is retried automatically (an AI request may already have run). */
export const RETRY = {
  save: "The answers were not saved: the local scoring server could not be reached. Your answers are still on this page. Refresh first if you are not sure whether the save went through, then select Save answers again.",
  propose: "Draft ratings were not prepared: the request did not complete. It is not retried automatically, and it may already have used AI allowance. Refresh the page to see whether ratings were saved before you try again.",
  summarise: "The draft summary was not prepared: the request did not complete. It is not retried automatically, and it may already have used AI allowance. Refresh the page to see whether a draft was saved before you try again.",
  summary: "The summary was not confirmed: the local scoring server could not be reached. Your edits are still here. Refresh first if you are not sure whether it was saved, then select Confirm summary again.",
  claims: "The CV check was not prepared: the request did not complete. It is not retried automatically, and it may already have used AI allowance. Refresh the page to see whether a check was saved before you try again.",
  decision: "The decision was not saved: the local scoring server could not be reached. Your reason is still here. Refresh first to see whether it was saved, then try again.",
  final: "The decision was not recorded: the local scoring server could not be reached. Your entries are still here. Refresh first to see whether it was saved, then select Record decision again.",
  correct: "The rating was not saved: the local scoring server could not be reached. Your entries are still here. Refresh first if you are not sure whether it was saved, then select Save rating again.",
};
/** Runs one request with the busy state always cleared, and a plain message if the request fails. Never retries. */
export async function guarded<T>(task: () => Promise<T>, setBusy: (b: boolean) => void, onError: (text: string) => void, failure: string): Promise<T | null> {
  setBusy(true);
  try { return await task(); } catch { onError(failure); return null; } finally { setBusy(false); }
}

/** W4: CV claims against the saved screening evidence (recruiter page only). Proposed corrections and unresolved
    conflicts are listed separately; nothing changes until a recruiter accepts or dismisses each with a reason. An
    accepted correction is a new CV-assessment version (source "screening call"), rescored by the calculator. */
function ClaimCheck({ v, followUps, dirty, onChanged }: { v: AssessmentView; followUps: FollowUp[]; dirty: boolean; onChanged(): void }) {
  const a = v.record, rec = a.screeningRecord, st = currentScreening(rec), { review, decisionOf } = currentClaims(rec), labels = labelsFor(v.config);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null), [confirmCost, setConfirmCost] = useState<string | null>(null);
  const [form, setForm] = useState<{ itemId: string; decision: "accepted" | "dismissed"; reason: string; reviewer: string } | null>(null);
  if (!st.answers) return null;
  const failed = (t: string) => setMsg({ ok: false, text: t }), fkeys = followUps.map((f, i) => followUpKey(i, f.text));
  const shown = (s: InputState, id: string) => (s.status === "gate" ? GATE[s.result].label : stateLabel(s, v.config.criteria.find((c) => c.id === id)?.max));
  const source = (c: ClaimItem["callSource"]) => { const i = c.followUp ? fkeys.indexOf(c.followUp) : -1; return i >= 0 ? `follow-up ${i + 1}: ${followUps[i].text}` : `${c.questionId}`; };
  const prepare = async (confirm = false) => {
    const r = await guarded(() => prepareClaimCheck({ assessmentId: a.id, expectedRevision: st.revision, confirmCost: confirm }), setBusy, failed, RETRY.claims);
    if (!r) { setConfirmCost(null); return; }
    if (!r.ok && r.needsConfirm) { setConfirmCost(r.problems.join(" ")); return; }
    setConfirmCost(null); if (r.ok) { setMsg({ ok: true, text: "CV check prepared. Nothing has changed yet." }); onChanged(); } else setMsg({ ok: false, text: r.problems.join(" ") });
  };
  const decide = async () => { if (!form || !review) return;
    const r = await guarded(() => decideClaim({ assessmentId: a.id, expectedRevision: st.revision, claimReviewRevision: review.revision, ...form }), setBusy, failed, RETRY.decision);
    if (r?.ok) { setForm(null); setMsg({ ok: true, text: form.decision === "accepted" ? "Accepted: a new CV-assessment version was created and rescored. Earlier versions are kept." : "Dismissed. Nothing in the CV assessment changed." }); onChanged(); }
    else if (r) setMsg({ ok: false, text: r.problems.join(" ") });
  };
  const item = (c: ClaimItem) => { const d = decisionOf(review!, c.id), open = form?.itemId === c.id;
    /* Whether the CV records evidence for this requirement, and why a saved proposal cannot be accepted (if so). */
    const cvEvidence = [...a.gates, ...a.criteria].find((x) => x.id === c.requirementId)?.evidence.length ?? 0;
    const kind = v.config.gates.some((g) => g.id === c.requirementId) ? "gate" as const : "criterion" as const;
    const blocked = c.proposal.type === "correction" && raisesSkill({ kind }, c.cvState, c.proposal.next) ? "Cannot be accepted: call evidence cannot raise a CV skill rating or make an unconfirmed skill rated. The answer stays with the screening."
      : !c.cvQuote && cvEvidence ? "Cannot be accepted: the CV records evidence for this requirement, but the proposal does not cite it." : null;
    return (
      <li key={c.id} className="small sc-claim">
        <div><b>{labels.get(c.requirementId) ?? c.requirementId}</b>{` · in the CV assessment: ${shown(c.cvState, c.requirementId)}`}{c.proposal.type === "correction" ? <b>{` · proposed: ${shown(c.proposal.next, c.requirementId)}`}</b> : <b className="sc-flag"> · conflict: no value proposed</b>}</div>
        {c.cvQuote ? <div className="sc-q"><q>{c.cvQuote}</q><div className="src">{`CV page ${c.cvPage}`}</div></div>
          : cvEvidence ? <div className="xs sc-flag">No CV quote was cited, although the CV records evidence for this.</div> : <div className="xs muted">The CV does not state this.</div>}
        <div className="sc-q"><q>{c.callQuote}</q><div className="src">{`Call: answer to ${source(c.callSource)}`}</div></div>
        <div className="xs">{c.explanation}</div>
        {d ? <div className="xs"><span className={`chip ${d.decision === "accepted" ? "c-ok" : "c-mute"}`}>{d.decision === "accepted" ? `${c.proposal.type === "conflict" ? "Recorded as conflicting" : "Accepted"} · CV version ${d.correctionVersion}` : "Dismissed"}</span>{` ${d.reviewer}: ${d.reason}`}</div>
          : open ? <div className="sc-form sc-fix">
            <input aria-label={`${c.id} reason`} placeholder={form!.decision === "accepted" ? "Why accept this? (required)" : "Why dismiss this? (required)"} value={form!.reason} onChange={(e) => setForm({ ...form!, reason: e.target.value })} />
            <input aria-label={`${c.id} your name`} placeholder="Your name" value={form!.reviewer} onChange={(e) => setForm({ ...form!, reviewer: e.target.value })} />
            <div className="row"><button type="button" className="btn btn-s btn-sm" onClick={() => setForm(null)}>Cancel</button><button type="button" className="btn btn-p btn-sm" disabled={busy || dirty} onClick={decide}>{form!.decision === "accepted" ? "Accept" : "Dismiss"}</button></div></div>
          : <div className="row">
            {blocked ? <div className="xs sc-flag">{blocked}</div>
              : <button type="button" className="btn btn-s btn-sm" disabled={dirty} onClick={() => setForm({ itemId: c.id, decision: "accepted", reason: "", reviewer: st.answers!.by })}>{c.proposal.type === "correction" ? "Accept correction" : "Record as conflicting"}</button>}
            <button type="button" className="btn btn-s btn-sm" disabled={dirty} onClick={() => setForm({ itemId: c.id, decision: "dismissed", reason: "", reviewer: st.answers!.by })}>Dismiss</button></div>}
      </li>
    ); };
  const corrections = review?.items.filter((c) => c.proposal.type === "correction") ?? [], conflicts = review?.items.filter((c) => c.proposal.type === "conflict") ?? [];
  const stale = !!review && review.answersRevision !== st.answers.revision;
  return (
    <div className="sc-callsum">
      <h3 style={{ margin: "16px 0 6px" }}>CV claims and the call</h3>
      <p className="xs muted" style={{ margin: "0 0 6px" }}>Proposed differences between the CV assessment and the saved answers. Nothing changes until you accept or dismiss each one with a reason. An unanswered question is never a contradiction or a zero. Not shown to the client.</p>
      {review ? <>
        <p className="xs"><b className="sc-flag">{`Draft — recruiter review needed (prepared by ${review.route}).`}</b></p>
        {stale && <div className="banner warn" role="status"><b>Out of date: </b>the screening answers changed after this check. Prepare a new CV check before deciding.</div>}
        <div className="box"><h3>{`Proposed corrections (${corrections.length})`}</h3><p className="xs muted" style={{ margin: "2px 0 4px" }}>The call clearly supports a different value under the assessment rules. Call evidence can lower a CV skill rating, never raise it; what the call adds stays with the screening.</p>
          {corrections.length ? <ol className="sc-qs">{corrections.map(item)}</ol> : <p className="small muted">None.</p>}</div>
        <div className="box"><h3>{`Unresolved conflicts (${conflicts.length})`}</h3><p className="xs muted" style={{ margin: "2px 0 4px" }}>The CV and the call disagree, or the call is unclear: no value is proposed. Recording one as conflicting applies the rules' "conflicting information" status (skills only; there is no score until a recruiter resolves it).</p>
          {conflicts.length ? <ol className="sc-qs">{conflicts.map(item)}</ol> : <p className="small muted">None.</p>}</div>
        {review.dropped.length > 0 && <p className="xs muted">{`Left out of the check: ${review.dropped.join("; ")}.`}</p>}
      </> : <p className="small muted">No CV check has been prepared yet.</p>}
      {msg && <div className={msg.ok ? "banner info" : "err"} role="status">{msg.text}</div>}
      {confirmCost && <div className="banner warn" role="alert">{confirmCost}<div className="row"><button type="button" className="btn btn-s" onClick={() => setConfirmCost(null)}>Cancel</button><button type="button" className="btn btn-p" onClick={() => prepare(true)}>Confirm and send</button></div></div>}
      <div className="row"><button type="button" className="btn btn-s" disabled={busy || dirty} onClick={() => prepare(false)}>{review ? "Prepare a new CV check" : "Prepare CV check"}</button></div>
    </div>
  );
}

/** W3: the screening-call summary (recruiter page only), from the saved answers and current ratings. A generated draft is
    labelled for review; a recruiter edits and confirms it as a new version; earlier versions are kept. A summary written
    for other answers or ratings is marked out of date. Unanswered questions are listed by the system, never as failures. */
function CallSummary({ v, set, followUps, dirty, onChanged }: { v: AssessmentView; set: ScreeningSet; followUps: FollowUp[]; dirty: boolean; onChanged(): void }) {
  const a = v.record, rec = a.screeningRecord, st = currentScreening(rec), save = st.answers, { latest, versions, outOfDate } = currentSummary(rec, set);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null), [confirmCost, setConfirmCost] = useState<string | null>(null);
  const blank = (): SummaryContent => ({ strengths: [], concerns: [], communication: { text: "" }, summary: [] });
  const [edit, setEdit] = useState<SummaryContent | null>(null), [lines, setLines] = useState(""), [reviewer, setReviewer] = useState(""), [confirmed, setConfirmed] = useState(false);
  if (!save) return <><h3 style={{ margin: "16px 0 6px" }}>Screening call summary</h3><p className="small muted">No answers have been saved, so there is no call summary.</p></>;
  const unanswered = unansweredQuestions(set, save, followUps), failed = (t: string) => setMsg({ ok: false, text: t });
  const qName = (id?: string) => (id ? `${id}${set.questions.find((q) => q.id === id) ? ` (${set.questions.find((q) => q.id === id)!.area})` : ""}` : "");
  /** Where a quote comes from: a core question, or one follow-up by its position and question. */
  const fkeys = followUps.map((f, i) => followUpKey(i, f.text));
  const sourceName = (x: { questionId?: string; followUp?: string }) => { const i = x.followUp ? fkeys.indexOf(x.followUp) : -1;
    return i >= 0 ? `follow-up ${i + 1}: ${followUps[i].text}` : qName(x.questionId); };
  const totals = answerTotals(set, save, followUps);
  const summarise = async (confirm = false) => {
    const r = await guarded(() => summariseScreening({ assessmentId: a.id, expectedRevision: st.revision, confirmCost: confirm }), setBusy, failed, RETRY.summarise);
    if (!r) { setConfirmCost(null); return; }
    if (!r.ok && r.needsConfirm) { setConfirmCost(r.problems.join(" ")); return; }
    setConfirmCost(null);
    if (r.ok) { setMsg({ ok: true, text: "Draft summary prepared." }); onChanged(); } else setMsg({ ok: false, text: r.problems.join(" ") });
  };
  const startEdit = () => { const c = latest?.content ?? blank(); setEdit(JSON.parse(JSON.stringify(c))); setLines((c.summary ?? []).join("\n")); setConfirmed(false); setMsg(null); };
  const confirm = async () => { if (!edit) return;
    const content = { ...edit, strengths: edit.strengths.filter((x) => x.text.trim()), concerns: edit.concerns.filter((x) => x.text.trim()), summary: lines.split("\n").map((x) => x.trim()).filter(Boolean) };
    const r = await guarded(() => confirmScreeningSummary({ assessmentId: a.id, expectedRevision: st.revision, content, reviewer, confirmed, basedOnRevision: latest?.revision ?? null }), setBusy, failed, RETRY.summary);
    if (r?.ok) { setEdit(null); setMsg({ ok: true, text: "Summary confirmed as a new version. Earlier versions are kept." }); onChanged(); } else if (r) setMsg({ ok: false, text: r.problems.join(" ") });
  };
  const quote = (x: { quote?: string; questionId?: string; followUp?: string }) => x.quote ? <div className="sc-q"><q>{x.quote}</q><div className="src">{`Answer to ${sourceName(x)}`}</div></div> : null;
  /** The source of a quote in the edit form: a core question or a follow-up (stored as questionId or followUp). */
  const qSelect = (x: { questionId?: string; followUp?: string }, onChange: (r: { questionId?: string; followUp?: string }) => void, label: string) =>
    <select aria-label={label} value={x.followUp ?? x.questionId ?? ""} onChange={(e) => { const v = e.target.value; onChange(fkeys.includes(v) ? { followUp: v, questionId: undefined } : { questionId: v || undefined, followUp: undefined }); }}>
      <option value="">No source</option>{set.questions.map((q) => <option key={q.id} value={q.id}>{q.id}</option>)}{fkeys.map((k, i) => <option key={k} value={k}>{`Follow-up ${i + 1}`}</option>)}</select>;
  return (
    <div className="sc-callsum">
      <h3 style={{ margin: "16px 0 6px" }}>Screening call summary</h3>
      <p className="xs muted" style={{ margin: "0 0 6px" }}>From the saved answers only. A summary of the call, not a score or a recommendation; it is not shown to the client.</p>
      {latest ? <>
        <p className="xs" style={{ margin: "0 0 4px" }}>{latest.kind === "summaryDraft"
          ? <b className="sc-flag">{`Draft — recruiter review needed (prepared by ${latest.route}).`}</b>
          : <span className="chip c-ok">{`Reviewed by ${latest.reviewer} on ${fd(latest.at.slice(0, 10))}`}</span>}</p>
        {outOfDate && <div className="banner warn" role="status"><b>Out of date: </b>the answers or ratings changed after this summary was written. Review it again before relying on it.</div>}
        <div className="box"><h3>Strengths</h3>{latest.content.strengths.length ? <ul>{latest.content.strengths.map((x) => <li key={x.text} className="small">{x.text}{quote(x)}</li>)}</ul> : <p className="small muted">None recorded.</p>}</div>
        <div className="box"><h3>Concerns</h3>{latest.content.concerns.length ? <ul>{latest.content.concerns.map((x) => <li key={x.text} className="small">{x.text}{quote(x)}</li>)}</ul> : <p className="small muted">None recorded.</p>}</div>
        <div className="box"><h3>Communication</h3>{latest.content.communication.text ? <p className="small">{latest.content.communication.text}</p> : <p className="small muted">Not recorded.</p>}{quote(latest.content.communication)}</div>
        <div className="box"><h3>Summary</h3>{latest.content.summary.length ? latest.content.summary.map((l) => <p key={l} className="small" style={{ margin: "2px 0" }}>{l}</p>) : <p className="small muted">No summary lines.</p>}</div>
        {latest.kind === "summaryDraft" && latest.dropped.length > 0 && <p className="xs muted">{`Left out of the draft: ${latest.dropped.join("; ")}.`}</p>}
      </> : <p className="small muted">No summary has been prepared yet.</p>}
      <div className="box"><h3>{`Not answered yet (${unanswered.length})`}</h3>
        <p className="xs muted" style={{ margin: "2px 0 4px" }}>{`From the saved answers: ${totals.scored.answered} of ${totals.scored.total} scored questions and ${totals.confirms.answered} of ${totals.confirms.total} confirmation-only questions answered. Counts are never taken from the summary text.`}</p>
        {unanswered.length ? <ul>{unanswered.map((q) => <li key={q.id} className="small">{`${q.id} (${q.area}; ${q.use === "scored" ? "scored" : "confirmation only"}). Not answered yet; this is not a failure.`}</li>)}</ul> : <p className="small muted">Every core question has an answer.</p>}</div>
      {versions.length > 1 && <p className="xs muted">{`Earlier versions: ${versions.slice(0, -1).map((x) => (x.kind === "summaryDraft" ? `draft ${fd(x.at.slice(0, 10))}` : `reviewed by ${x.reviewer} ${fd(x.at.slice(0, 10))}`)).join(" · ")}`}</p>}
      {msg && <div className={msg.ok ? "banner info" : "err"} role="status">{msg.text}</div>}
      {confirmCost && <div className="banner warn" role="alert">{confirmCost}<div className="row"><button type="button" className="btn btn-s" onClick={() => setConfirmCost(null)}>Cancel</button><button type="button" className="btn btn-p" onClick={() => summarise(true)}>Confirm and send</button></div></div>}
      {edit ? <div className="sc-form sc-fix">
        <b className="small">Edit and confirm the summary</b>
        {edit.strengths.map((x, i) => <div key={`s${i}`} className="sc-fix">
          <input aria-label={`Strength ${i + 1}`} placeholder="Strength" value={x.text} onChange={(e) => setEdit({ ...edit, strengths: edit.strengths.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)) })} />
          <input aria-label={`Strength ${i + 1} quote`} placeholder="Quote, word for word from the answer" value={x.quote} onChange={(e) => setEdit({ ...edit, strengths: edit.strengths.map((y, j) => (j === i ? { ...y, quote: e.target.value } : y)) })} />
          {qSelect(x, (r) => setEdit({ ...edit, strengths: edit.strengths.map((y, j) => (j === i ? { ...y, ...r } : y)) }), `Strength ${i + 1} source`)}</div>)}
        <button type="button" className="btn btn-s btn-sm" onClick={() => setEdit({ ...edit, strengths: [...edit.strengths, { text: "", quote: "", questionId: "" }] })}>Add a strength</button>
        {edit.concerns.map((x, i) => <div key={`c${i}`} className="sc-fix">
          <input aria-label={`Concern ${i + 1}`} placeholder="Concern" value={x.text} onChange={(e) => setEdit({ ...edit, concerns: edit.concerns.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)) })} />
          <input aria-label={`Concern ${i + 1} quote`} placeholder="Quote (optional), word for word" value={x.quote ?? ""} onChange={(e) => setEdit({ ...edit, concerns: edit.concerns.map((y, j) => (j === i ? { ...y, quote: e.target.value || undefined } : y)) })} />
          {qSelect(x, (r) => setEdit({ ...edit, concerns: edit.concerns.map((y, j) => (j === i ? { ...y, ...r } : y)) }), `Concern ${i + 1} source`)}</div>)}
        <button type="button" className="btn btn-s btn-sm" onClick={() => setEdit({ ...edit, concerns: [...edit.concerns, { text: "" }] })}>Add a concern</button>
        <textarea aria-label="Communication" placeholder="Communication: did they answer the questions asked, and explain their actions and results?" value={edit.communication.text} onChange={(e) => setEdit({ ...edit, communication: { ...edit.communication, text: e.target.value } })} />
        <textarea aria-label="Summary lines" placeholder="Four or five short lines, one per line" value={lines} onChange={(e) => setLines(e.target.value)} />
        <input aria-label="Summary reviewer" placeholder="Your name" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
        <label className="small"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} style={{ width: "auto", marginRight: 6 }} />I have reviewed this summary against the saved answers.</label>
        <div className="row"><button type="button" className="btn btn-s" onClick={() => setEdit(null)}>Cancel</button><button type="button" className="btn btn-p" disabled={busy || dirty} onClick={confirm}>Confirm summary</button></div>
      </div> : <div className="row">
        <button type="button" className="btn btn-s" disabled={busy || dirty} onClick={() => summarise(false)}>{latest ? "Prepare a new draft summary" : "Prepare draft summary"}</button>
        <button type="button" className="btn btn-s" disabled={busy || dirty} onClick={startEdit}>{latest ? "Edit and confirm summary" : "Write the summary"}</button></div>}
      {dirty && <p className="xs muted">Save the answers before preparing or confirming a summary.</p>}
    </div>
  );
}

export function ScreeningQuestions({ v, sets, onChanged = () => {} }: { v: AssessmentView; sets?: ScreeningSet[]; onChanged?(): void }) {
  const a = v.record, labels = labelsFor(v.config), st = currentScreening(a.screeningRecord), saved = st.answers;
  /* Answers keep the exact question-set version they were saved with; before any answer, the current set for these rules. */
  const recordedSet = saved ? (sets ?? []).find((x) => x.id === saved.set.id && x.version === saved.set.version && x.sha256 === saved.set.sha256 && !x.loadProblems?.length) ?? null : null;
  const current = coreSetFor(sets, v.config), set = saved ? recordedSet : current.set, problems = saved && !recordedSet ? ["the question set these answers were saved with is no longer available unchanged"] : current.problems;
  const followUps = followUpsFor(a, set), fkey = (i: number) => followUpKey(i, followUps[i].text);
  const [answers, setAnswers] = useState<Record<string, string>>(saved?.answers ?? {});
  const [fu, setFu] = useState<Record<string, string>>(Object.fromEntries(Object.entries(saved?.followUps ?? {}).map(([k, x]) => [k, x.answer])));
  const [excerpt, setExcerpt] = useState(saved?.excerpt ?? ""), [by, setBy] = useState(saved?.by ?? ""), [dirty, setDirty] = useState(false);
  const [excerptFor, setExcerptFor] = useState<string[]>(saved?.excerptFor ?? []);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null), [confirmCost, setConfirmCost] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null), [fix, setFix] = useState({ rating: "", quote: "", reason: "", reviewer: "" });
  const checks = (ids: string[], area: string) => (ids.length ? ids.map((id) => labels.get(id) ?? id).join(", ") : area);
  const points = (title: string, xs: string[]) => <div className="xs"><b>{title}</b><ul className="sc-points">{xs.map((x) => <li key={x}>{plain(x, labels)}</li>)}</ul></div>;
  const answeredChip = (t: string | undefined) => (t?.trim() ? <span className="chip c-info">Answered</span> : <span className="chip c-mute">Not answered</span>);
  const box = (id: string, value: string, set: (x: string) => void, label: string) => <textarea id={id} aria-label={label} className="sc-answer" maxLength={5000} value={value} placeholder="Not answered" onChange={(e) => { set(e.target.value); setDirty(true); }} />;
  const scored = set ? set.questions.filter((q) => q.use === "scored") : [], answeredScored = scored.filter((q) => saved && answerSources(q.id, saved, followUps).length);
  const result = (r: { ok: true } | { ok: false; problems: string[]; needsConfirm?: boolean }, done: string) => {
    if (r.ok) { setMsg({ ok: true, text: done }); setDirty(false); onChanged(); } else setMsg({ ok: false, text: r.problems.join(" ") });
  };
  /* Each request is guarded: on a network failure the busy state is cleared, typed answers stay, a retry message shows,
     and nothing is sent again automatically. */
  const failed = (text: string) => setMsg({ ok: false, text });
  const save = async () => { if (!set) return;
    const r = await guarded(() => saveScreeningAnswers({ assessmentId: a.id, expectedRevision: st.revision, set: { id: set.id, version: set.version, sha256: set.sha256! }, answers, followUps: fu, excerpt, excerptFor: excerpt.trim() ? excerptFor : [], by }), setBusy, failed, RETRY.save);
    if (r) result(r, "Answers saved."); };
  const propose = async (confirm = false) => {
    const r = await guarded(() => proposeScreeningRatings({ assessmentId: a.id, expectedRevision: st.revision, confirmCost: confirm }), setBusy, failed, RETRY.propose);
    if (!r) { setConfirmCost(null); return; }
    if (!r.ok && r.needsConfirm) setConfirmCost(r.problems.join(" ")); else { setConfirmCost(null); result(r, r.ok && r.dropped?.length ? `Draft ratings prepared. Not rated: ${r.dropped.map((d) => `${d.questionId} (${d.problem})`).join("; ")}.` : "Draft ratings prepared."); } };
  const correct = async (qid: string) => {
    const r = await guarded(() => correctScreeningRating({ assessmentId: a.id, expectedRevision: st.revision, questionId: qid, rating: fix.rating === "" ? null : Number(fix.rating), quote: fix.quote, reason: fix.reason, reviewer: fix.reviewer }), setBusy, failed, RETRY.correct);
    if (r) { result(r, "Rating saved as a new version. Earlier versions are kept."); if (r.ok) setFixing(null); } };
  /** The rating of a scored question: proposed draft, recruiter's, or none; with its quote, reason and history. */
  const rating = (qid: string) => {
    if (!saved || !answerSources(qid, saved, followUps).length) return <div className="xs muted sc-rating">Not answered, so not rated.</div>;
    const r = st.ratingOf(qid), dropped = st.proposal?.dropped.find((d) => d.questionId === qid);
    const history = st.history.filter((e): e is Proposal | RatingCorrection => (e.kind === "correction" && e.questionId === qid) || (e.kind === "proposal" && !!e.ratings[qid]));
    return (
      <div className="sc-rating">
        {r.rating === null ? <div className="xs"><span className="chip c-mute">Not rated</span>{dropped ? ` No draft rating: ${dropped.problem}.` : r.by === "recruiter" ? " A recruiter set this to Not rated." : ""}</div> : <>
          <div className="xs"><span className={`chip ${r.by === "recruiter" ? "c-ok" : "c-warn"}`}>{`${r.by === "recruiter" ? "Recruiter rating" : "Proposed rating"} ${r.rating} of 5`}</span>
            {r.by === "proposal" && <b className="sc-flag">{` Draft — recruiter review needed (prepared by ${st.proposal!.route}).`}</b>}</div>
          <div className="sc-q"><q>{r.quote}</q><div className="src">From the answer given</div></div>
          <div className="xs">{r.reason}</div></>}
        {history.length > 1 && <div className="xs muted">{`Earlier versions: ${history.slice(0, -1).map((e) => (e.kind === "proposal" ? `proposed ${e.ratings[qid].rating}` : `${e.reviewer}: ${e.to ?? "Not rated"} (${e.reason})`)).join(" · ")}`}</div>}
        {fixing === qid ? <div className="sc-form sc-fix">
          <label className="xs">Rating <select aria-label={`${qid} rating`} value={fix.rating} onChange={(e) => setFix({ ...fix, rating: e.target.value })}><option value="">Not rated</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <textarea aria-label={`${qid} supporting quote`} placeholder="Quote copied word for word from the answer" value={fix.quote} onChange={(e) => setFix({ ...fix, quote: e.target.value })} />
          <input aria-label={`${qid} reason`} placeholder="Reason for this rating (required)" value={fix.reason} onChange={(e) => setFix({ ...fix, reason: e.target.value })} />
          <input aria-label={`${qid} your name`} placeholder="Your name" value={fix.reviewer} onChange={(e) => setFix({ ...fix, reviewer: e.target.value })} />
          <div className="row"><button type="button" className="btn btn-s btn-sm" onClick={() => setFixing(null)}>Cancel</button><button type="button" className="btn btn-p btn-sm" disabled={busy || dirty} onClick={() => correct(qid)}>Save rating</button></div></div>
          : <button type="button" className="btn btn-s btn-sm" disabled={dirty} onClick={() => { setFixing(qid); setFix({ rating: r.rating === null ? "" : String(r.rating), quote: r.quote, reason: "", reviewer: by }); }}>Review or correct rating</button>}
      </div>
    );
  };
  return (
    <Expand title={`Screening questions (${set ? `${set.questions.length} core` : "no core set"} · ${followUps.length} follow-up${followUps.length === 1 ? "" : "s"})`}>
      <p className="small" style={{ margin: "10px 0 4px" }}><b>Screening: </b>{saved
        ? <><span className="chip c-warn">In progress</span>{` Answers recorded for ${set ? set.questions.filter((q) => saved.answers[q.id]?.trim()).length : 0} of ${set?.questions.length ?? 0} core questions; ${answeredScored.filter((q) => st.ratingOf(q.id).rating !== null).length} of ${scored.length} scored questions rated. No screening score is calculated.`}</>
        : <><span className="chip c-mute">Not assessed</span>{" No answers have been added, so there is no screening score."}</>}</p>
      {set ? <>
        <p className="xs muted" style={{ margin: "0 0 4px" }}>{`Core questions: ${set.title}, version ${set.version}. The same questions for every candidate for this role.${saved ? " Answers are kept with this version." : ""}`}</p>
        {set.status !== "approved" && <p className="xs sc-flag" style={{ margin: "0 0 4px" }}>{set.statusNote}</p>}
        <p className="xs muted" style={{ margin: "0 0 4px" }}>{set.scale}</p>
        <p className="xs" style={{ margin: "0 0 8px" }}><b>{set.neverAssess}</b></p>
        <div className="f"><label htmlFor="scExcerpt" className="small"><b>Call excerpt (optional)</b></label><textarea id="scExcerpt" className="sc-answer" maxLength={20000} value={excerpt} placeholder="Paste notes or a transcript excerpt from the call" onChange={(e) => { setExcerpt(e.target.value); setDirty(true); }} />
          <fieldset className="sc-excerpt-for" disabled={!excerpt.trim()}><legend className="xs">This excerpt answers (tick each question it answers; it counts for no other question):</legend>
            {set.questions.map((q) => <label key={q.id} className="xs"><input type="checkbox" aria-label={`Excerpt answers ${q.id}`} checked={excerptFor.includes(q.id)} onChange={(e) => { setExcerptFor(e.target.checked ? [...excerptFor, q.id] : excerptFor.filter((x) => x !== q.id)); setDirty(true); }} />{q.id}</label>)}</fieldset></div>
        <ol className="sc-qs sc-qs-core">{set.questions.map((q) => (
          <li key={q.id} className="small" id={`sq-${q.id}`}><div className="sc-q-h"><span><b>{`${q.id}. `}</b>{q.text}</span>{saved?.answers[q.id]?.trim() ? answeredChip(saved.answers[q.id]) : saved && answerSources(q.id, { ...saved, excerptFor: [] }, followUps).length ? <span className="chip c-info">Answered in a follow-up</span>
              : saved && answerSources(q.id, saved, followUps).length ? <span className="chip c-info">Answered in the excerpt</span> : answeredChip(undefined)}</div>
            <div className="xs muted">{`${q.area}${q.checks.length ? ` · Checks: ${checks(q.checks, q.area)}` : ""} · ${q.use === "scored" ? "Scored 1 to 5" : "Confirms a requirement; not scored"}`}</div>
            {points(set.status === "approved" ? "A good answer covers:" : "Proposed answer points (need business review):", q.answerPoints)}
            {box(`sa-${q.id}`, answers[q.id] ?? "", (x) => setAnswers({ ...answers, [q.id]: x }), `Answer to ${q.id}`)}
            {q.use === "scored" ? rating(q.id) : <div className="xs muted">Confirms a requirement: the answer is recorded, with no rating and no points.</div>}</li>
        ))}</ol>
      </> : <p className="small muted">{problems.length ? `No core question set is shown: ${problems.join("; ")}.` : "No core question set has been recorded for these rules."}</p>}
      <h3 style={{ margin: "14px 0 6px" }}>{`Follow-up questions for this candidate (${followUps.length})`}</h3>
      <p className="xs muted" style={{ margin: "0 0 6px" }}>Suggested for the gaps in this CV. They add to the core questions and never replace them. Their answers support the core question they add detail to; they are never rated on their own.</p>
      {followUps.length ? <ol className="sc-qs">{followUps.map((f, i) => (
        <li key={f.text} className="small"><div className="sc-q-h"><span>{plain(f.text, labels)}</span>{answeredChip(saved?.followUps[fkey(i)]?.answer)}</div>
          <div className="xs muted">{`Checks: ${checks(f.checks, "not recorded")}${f.coreIds.length ? ` · Adds detail to core question ${f.coreIds.join(", ")}` : ""}`}</div>
          {a.questions[i]?.answerPoints?.length ? points("A good answer covers:", a.questions[i].answerPoints!)
            : f.guide.length ? <div className="xs"><b>{set?.status === "approved" ? "A good answer covers:" : "Proposed answer points (need business review):"}</b>
              {f.guide.map((g) => <div key={"core" in g.from ? g.from.core : g.from.requirement} style={{ marginTop: 2 }}>
                <span className="muted">{"core" in g.from ? `From core question ${g.from.core}:` : `For ${labels.get(g.from.requirement) ?? g.from.requirement}:`}</span>
                <ul className="sc-points">{g.points.map((x) => <li key={x}>{plain(x, labels)}</li>)}</ul>
                {g.reviewNote && <div className="sc-flag">{`Needs business review: ${g.reviewNote}`}</div>}</div>)}</div> : null}
          {!a.questions[i]?.answerPoints?.length && f.missing.length > 0 && <div className="xs muted"><b>Answer guide: </b>{`Not prepared for ${f.missing.map((id) => labels.get(id) ?? id).join(", ")}`}</div>}
          {set && box(`sf-${i + 1}`, fu[fkey(i)] ?? "", (x) => setFu({ ...fu, [fkey(i)]: x }), `Answer to follow-up ${i + 1}`)}</li>
      ))}</ol> : <p className="small muted">No follow-up questions were suggested.</p>}
      {set && <div className="sc-form" style={{ marginTop: 12 }}>
        <div className="f"><label htmlFor="scBy" className="small">Your name</label><input id="scBy" maxLength={100} value={by} onChange={(e) => { setBy(e.target.value); setDirty(true); }} /><div className="help">Recorded as typed; it is not a sign-in.</div></div>
        {msg && <div className={msg.ok ? "banner info" : "err"} role="status">{msg.text}</div>}
        {confirmCost && <div className="banner warn" role="alert">{confirmCost}<div className="row"><button type="button" className="btn btn-s" onClick={() => setConfirmCost(null)}>Cancel</button><button type="button" className="btn btn-p" onClick={() => propose(true)}>Confirm and send</button></div></div>}
        <div className="row"><button type="button" className="btn btn-p" disabled={busy || !dirty} onClick={save}>Save answers</button>
          <button type="button" className="btn btn-s" disabled={busy || dirty || !saved || !answeredScored.length} onClick={() => propose(false)}>Prepare draft ratings</button></div>
        <p className="xs muted">{dirty ? "Unsaved changes: save the answers before preparing or correcting ratings." : "Draft ratings are proposals for a recruiter to review. Every rating needs a word-for-word quote from the answer; unanswered questions stay Not answered."}</p>
      </div>}
      {set && <CallSummary v={v} set={set} followUps={followUps} dirty={dirty} onChanged={onChanged} />}
      {set && <ClaimCheck v={v} followUps={followUps} dirty={dirty} onChanged={onChanged} />}
    </Expand>
  );
}

/* The full assessment rules are not shown on candidate pages: they stay in the reference document and on the role page.
   The result box says which rules were used and that they await approval (DraftAssessment). `rules` is accepted for
   existing callers and not shown.
   Below the candidate summary there are three sections only: Screening questions, Review or change assessment, and
   Previous assessments. The calculation tables, score-limit scenarios, source-file details, AI and run identifiers,
   client-summary version tables and the prototype report are not shown here; the records behind them are unchanged. */
export function AssessmentSummary({ v, onChanged, earlier, screeningSets }: { v: AssessmentView; rules?: string[]; onChanged(): void; earlier?: { count: number; node: ReactNode }; screeningSets?: ScreeningSet[] }) {
  const a = v.record, cv = a.clientView, labels = labelsFor(v.config), r = v.latest.result, why = reasonLabel(r, v.config) ?? capExplanation(r, v.config);
  return (
    <section aria-label="Internal review" className="sc-panel">
      <DraftAssessment v={v} />
      <WhereThisStands v={v} />

      <ScreeningQuestions v={v} sets={screeningSets} onChanged={onChanged} />

      <Expand title="Review or change assessment">
        <p className="small" style={{ margin: "10px 0 0" }}><b>Current result: </b><ResultChip r={r} />{why && <span>{` ${why}`}</span>}</p>
        {(a.manualReview.length > 0 || a.constraints.length > 0) && <div className="box" style={{ marginTop: 12 }}><h3 style={{ marginBottom: 8 }}>For the recruiter to check</h3><ul>
          {a.manualReview.map((m) => <li key={m}>{plain(m, labels)}</li>)}
          {a.constraints.map((c) => <li key={c.id}><b>{`${labels.get(c.id) ?? "Practical point"} (not scored): `}</b>{plain(c.note, labels)}</li>)}
        </ul></div>}
        <Review v={v} onChanged={onChanged} />
        <h3 style={{ margin: "18px 0 4px" }}>Client summary</h3>
        <ClientViewReview v={v} onChanged={onChanged} />
        {!cv && !a.review && <p className="small">The client summary is out of date, and it cannot be reviewed here for this assessment.</p>}
        <FinalReview v={v} sets={screeningSets} onChanged={onChanged} />
      </Expand>

      <Expand title={`Previous assessments (${earlier?.count ?? 0})`}>
        {earlier && earlier.count > 0 ? earlier.node : <p className="small muted" style={{ marginTop: 10 }}>None. This is the first assessment of this CV.</p>}
      </Expand>
    </section>
  );
}

const TRIGGER_PLAIN = { zero: "a critical skill is rated 0", lowOne: "a critical skill is rated 0 or 1", unknown: "a critical skill is not confirmed" };

export function Calculation({ v }: { v: AssessmentView }) {
  const r = v.latest.result, p = v.config.policy, labels = labelsFor(v.config), rated = r.rows.filter((x) => x.state === "rated");
  const names = (ids: string[]) => ids.map((id) => labels.get(id) ?? id).join(", ");
  return (
    <>
      <ol className="sc-steps" style={{ marginTop: 10 }}>
        <li><b>{`${TERMS.essential}. `}</b>{r.failedGates.length ? `Not met: ${names(r.failedGates)}. Scoring stops here until a recruiter checks it.` : "None is recorded as not met."}{r.unknownGates.length ? ` Not confirmed: ${names(r.unknownGates)}. Ask in screening; this does not stop the score.` : ""}</li>
        <li><b>Conflicting information. </b>{r.disputed.length ? `${names(r.disputed)}: no score until a recruiter resolves it.` : "None."}</li>
        <li><b>{`${TERMS.coverage}. `}</b>{`${pct(r.overall)} of the role (at least ${pct(p.minOverallCoverage)} needed) and ${pct(r.critical)} of critical skills (at least ${pct(p.minCriticalCoverage)} needed).`}</li>
        <li><b>Points. </b>{rated.length ? `Each rated skill earns its rating times its importance weight. Skills that are not confirmed are left out of both the points earned and the points possible.` : "No skill is rated."}</li>
      </ol>
      {rated.length > 0 && <table className="req"><thead><tr><th>Rated skill</th><th>Importance</th><th>Rating</th><th>Points</th></tr></thead><tbody>
        {rated.map((x) => <tr key={x.id}><td className="rq">{labels.get(x.id) ?? x.label}</td><td data-label="Importance">{`${x.importance} (weight ${x.weight})`}</td><td data-label="Rating">{`${x.rating} of ${x.max}`}</td><td className="num" data-label="Points">{`${x.points} of ${x.possible}`}</td></tr>)}
        <tr><td className="rq">Total</td><td /><td /><td className="num" data-label="Points"><b>{`${r.points} of ${r.possible}`}</b></td></tr>
      </tbody></table>}
      <ol className="sc-steps" start={5}>
        <li><b>Score. </b>{r.raw === null ? "Not calculated." : `${r.points} of ${r.possible} points is ${r.raw.toFixed(1)} out of 100.`}</li>
        <li><b>Score limit. </b>{capExplanation(r, v.config) ?? "No score limit applies."}</li>
        <li><b>Result. </b>{r.score === null ? (reasonLabel(r, v.config) ?? resultLabel(r)) : `${r.score} after rounding: ${r.band}. The label is for reading only; it does not move or rank the candidate.`}</li>
      </ol>
      {r.errors.length > 0 && <Problems list={r.errors} />}
      <h3 style={{ margin: "12px 0 6px" }}>If the score limit were set off differently</h3>
      <table className="req"><thead><tr><th>The score is limited to {p.cap.value} only when…</th><th>Result</th></tr></thead><tbody>
        {v.sensitivity.map((s) => <tr key={s.trigger}><td>{TRIGGER_PLAIN[s.trigger]}</td><td data-label="Result">{resultLabel(s.result)}</td></tr>)}
        <tr><td><b>{`Current test rules: when ${p.cap.triggers.map((t) => TRIGGER_PLAIN[t]).join(", or ")}`}</b></td><td data-label="Result"><b>{resultLabel(r)}</b></td></tr>
      </tbody></table>
      <p className="small muted">{v.frozenCheck === "match" ? "The original version still recalculates to the result recorded when it was created." : v.frozenCheck === "mismatch" ? "Warning: the original version no longer matches its recorded result. The rules or the calculator have changed." : "No original result was recorded to check against."}</p>
    </>
  );
}

/** The assessment rules (test version): essential requirements, skills and rating levels, practical points, and every
    test-only choice, in words. */
export function RubricDetails({ config, rules }: { config: LoadedConfig; rules: string[] }) {
  const p = config.policy, inc = config.criteria.filter((c) => c.included), labels = labelsFor(config);
  const weights = (["Critical", "Important", "Nice to have"] as Criterion["importance"][]).map((k) => { const c = inc.find((x) => x.importance === k); return c ? `${k} ${c.weight}` : null; }).filter(Boolean).join(", ");
  return (
    <>
      <dl className="kf" style={{ marginTop: 10 }}>
        <dt>Status</dt><dd>{`${EXPERIMENTAL}. Test version ${config.version}.`}</dd>
        <dt>Fixed</dt><dd>{config.hashOk ? "Fixed before any CV was read. Any change needs a new version." : "Warning: the rules file has changed since it was fixed."}</dd>
        <dt>Role setup</dt><dd>{config.role.roleSetupVersion}</dd>
        <dt>How the score works</dt><dd>Only skills with information count. The score is the points earned out of the points possible on those skills, out of 100. Skills that are not confirmed are left out, not counted as zero.</dd>
        <dt>Minimum information</dt><dd>{`The CV must give information on at least ${pct(p.minOverallCoverage)} of the role and ${pct(p.minCriticalCoverage)} of the critical skills. Otherwise: ${TERMS.notEnough}.`}</dd>
        <dt>Score limit</dt><dd>{`At most ${p.cap.value} when ${p.cap.triggers.map((t) => TRIGGER_PLAIN[t]).join(", or ")}.`}</dd>
        <dt>Rounding and labels</dt><dd>{`Halves round up. Labels: ${p.bands.map((b, i) => (b.min > 0 ? `${b.label} ${b.min}+` : `${b.label} below ${p.bands[i - 1]?.min ?? 0}`)).join(", ")}. Labels are for reading only; nothing moves automatically.`}</dd>
        <dt>Conflicting information</dt><dd>No CV score until a recruiter resolves it.</dd>
        <dt>Screening</dt><dd>{`Answers are rated ${p.screening.scaleMin} to ${p.screening.scaleMax}. At least ${pct(p.screening.minCoverage)} of all the agreed questions must be rated; skipped or missing questions still count. Not combined with the CV score.`}</dd>
        <dt>Importance weights</dt><dd>{`${weights}. Not scored: ${config.criteria.filter((c) => !c.included).map((c) => labels.get(c.id)).join(", ") || "none"}.`}</dd>
      </dl>
      {config.testChoices.length > 0 && <><h3 style={{ margin: "16px 0 6px" }}>Choices made for this test (not approved)</h3>
        <table className="req"><thead><tr><th>Choice</th><th>Status in the draft specification</th></tr></thead><tbody>
          {config.testChoices.map((t) => <tr key={t.id}><td>{plain(t.choice, labels)}</td><td className="ev">{plain(t.specStatus, labels)}</td></tr>)}
        </tbody></table></>}
      {rules.length > 0 && <><h3 style={{ margin: "16px 0 6px" }}>Rules applied to every CV</h3><ul className="small">{rules.map((x) => <li key={x}>{plain(x, labels)}</li>)}</ul></>}
      <h3 style={{ margin: "16px 0 6px" }}>{`${TERMS.essential} (met, not met or not confirmed; never add points)`}</h3>
      <table className="req"><thead><tr><th>Requirement</th><th>How it is checked in this test</th></tr></thead><tbody>
        {config.gates.map((g) => <tr key={g.id}><td className="rq">{g.label}</td><td className="ev">{plain(g.testRule ?? "", labels)}</td></tr>)}
      </tbody></table>
      <h3 style={{ margin: "16px 0 6px" }}>Skills and rating levels</h3>
      <div className="sc-scroll"><table className="req sc-anchors"><thead><tr><th>Skill</th><th>Weight</th><th>0 only if</th><th>1</th><th>2</th><th>3</th></tr></thead><tbody>
        {config.criteria.map((c) => (
          <tr key={c.id} className={c.included ? "" : "sc-excluded"}>
            <td className="rq">{labels.get(c.id)}<span className="tier">{`${c.importance}${c.recency || c.duration ? ` · rating 3 needs ${[c.recency && "recent experience", c.duration && "enough time in the role"].filter(Boolean).join(" and ")}` : ""}`}</span>{!c.included && <span className="tier"><b>Not scored:</b>{` ${plain(c.exclusionReason ?? "", labels)}`}</span>}{c.testRule && <span className="tier">{plain(c.testRule, labels)}</span>}</td>
            <td className="num">{c.included ? `${c.weight}` : "—"}</td>
            {(["0", "1", "2", "3"] as const).map((k) => <td key={k} className="ev">{c.anchors[k] ? plain(c.anchors[k]!, labels) : "—"}</td>)}
          </tr>
        ))}
      </tbody></table></div>
      <h3 style={{ margin: "16px 0 6px" }}>Practical points (checked, never scored)</h3>
      <dl className="kf">{config.constraints.map((c) => <Fragment key={c.id}><dt>{c.label}</dt><dd>{plain(c.detail, labels)}</dd></Fragment>)}</dl>
    </>
  );
}

/* ---------- Role page ---------- */

/** The role page's panel: the assessment rules, and the invented worked example for screening and revisions. */
export function RoleScoringPanel({ config, rules, example }: { config: LoadedConfig; rules: string[]; example: AssessmentView | null }) {
  return (
    <section className="card pad sc-panel" style={{ marginTop: 18 }} aria-label="Assessment rules">
      <div className="sec-h"><h2>Assessment rules for this role (internal test)</h2><span className="chip c-warn">{EXPERIMENTAL}</span></div>
      <Expand title={`${TERMS.rules} (test version, not approved)`}><RubricDetails config={config} rules={rules} /></Expand>
      {example && <Expand title="Invented example: screening and a change after the call"><FictionalExample v={example} /></Expand>}
    </section>
  );
}

function FictionalExample({ v }: { v: AssessmentView }) {
  const s = v.record.screening, res = v.screening, labels = labelsFor(v.config);
  return (
    <>
      <div className="banner info" style={{ marginTop: 12 }}><b>Invented.</b>{` ${v.record.notice}`}</div>
      <table className="req"><thead><tr><th>Version</th><th>Change</th><th>CV result</th></tr></thead><tbody>
        {v.versions.map((x) => <tr key={x.version}><td className="rq">{`Version ${x.version}`}</td><td className="ev">{x.correction ? `${labels.get(x.correction.criterionId) ?? x.correction.criterionId}: ${stateLabel(x.correction.previous)} → ${stateLabel(x.correction.next)}. ${x.correction.evidence} ${x.correction.reason}` : "Suggested CV assessment (invented evidence)."}</td><td><ResultChip r={x.result} /></td></tr>)}
        {v.disputedWhatIf && <tr><td className="rq">If not resolved</td><td className="ev">{v.record.disputedIllustration?.note}</td><td><ResultChip r={v.disputedWhatIf} /></td></tr>}
      </tbody></table>
      {s && <>
        <h3 style={{ margin: "14px 0 6px" }}>{`Screening (${s.set})`}</h3>
        <table className="req"><thead><tr><th>Question, and what a good answer includes</th><th>Rating</th><th>Answer and reason</th></tr></thead><tbody>
          {s.questions.map((q) => <tr key={q.q}><td className="rq">{q.text}<span className="tier">{q.points.map((x, i) => `${i + 1}. ${x}`).join("; ")}</span></td>
            <td className="st">{q.status === "rated" ? <span className="chip c-info">{`${q.rating} of 5`}</span> : <span className="chip c-mute">Not rated</span>}</td>
            <td className="ev">{q.answer ?? "Not answered."}<div className="xs muted">{q.status === "rated" ? q.explanation : `${q.reason} ${q.explanation}`}</div></td></tr>)}
        </tbody></table>
        <dl className="kf" style={{ marginTop: 8 }}>
          <dt>Questions rated</dt><dd className="num">{`${res.rated} of ${res.applicable} agreed questions (${pct(res.coverage)}). Unanswered or skipped questions still count.`}</dd>
          <dt>Screening score</dt><dd>{res.score !== null ? `${res.score} out of 100 (average rating ${(res.sum / res.rated).toFixed(2)} on the 1 to 5 scale)` : res.reason}</dd>
          <dt>Asked, not scored</dt><dd>{s.askedNotScored.join(" ")}</dd>
          <dt>Combined result</dt><dd>Not calculated: no rule for combining has been agreed. No shortlist decision follows.</dd>
        </dl>
      </>}
    </>
  );
}

/* ---------- Corrections ---------- */

export function Review({ v, onChanged }: { v: AssessmentView; onChanged(): void }) {
  const inc = v.config.criteria.filter((c) => c.included), labels = labelsFor(v.config), [cid, setCid] = useState(inc[0].id);
  const gate = v.config.gates.find((g) => g.id === cid), crit = inc.find((c) => c.id === cid);
  const current = v.latest.inputs.find((i) => i.id === cid), gateNow = v.latest.gates.find((g) => g.id === cid);
  const prev: InputState = gate ? { status: "gate", result: gateNow?.result ?? "Unknown" } : current!.status === "rated" ? { status: "rated", rating: current!.rating } : { status: current!.status };
  const levels = crit ? Array.from({ length: crit.max + 1 }, (_, i) => i).filter((l) => !crit.unavailableLevels?.includes(l)) : [];
  const [next, setNext] = useState("unknown"), [evidence, setEvidence] = useState(""), [reason, setReason] = useState(""), [reviewer, setReviewer] = useState("");
  const [problems, setProblems] = useState<string[]>([]), [saved, setSaved] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const recordGate = v.record.gates.find((g) => g.id === cid), pending = gate && recordGate?.check && gateNow?.result === recordGate.result ? recordGate.check.status : null;
  const shown = (s: InputState) => (s.status === "gate" ? GATE[s.result].label : stateLabel(s, crit?.max));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const nextState: InputState = gate ? { status: "gate", result: next as "Pass" | "Fail" | "Unknown" } : next === "unknown" ? { status: "unknown" } : next === "disputed" ? { status: "disputed" } : { status: "rated", rating: Number(next) };
    setBusy(true);
    const r = await saveCorrection({ assessmentId: v.record.id, version: v.latest.version + 1, criterionId: cid, previous: prev, next: nextState, evidence, reason, reviewer, source: "reviewer", configId: v.config.id, configVersion: v.config.version,
      basedOn: v.record.run?.assessmentFingerprint ?? "", expected: { assessmentFingerprint: v.record.run?.assessmentFingerprint ?? "", assessmentVersion: v.latest.version, stateSha256: v.record.latestStateSha ?? "" } });
    setBusy(false);
    if (r.ok) { setProblems([]); setSaved(`Saved as version ${v.latest.version + 1}. The original is unchanged.`); setEvidence(""); setReason(""); onChanged(); } else setProblems(r.problems);
  };
  return (
    <>
      <h3 style={{ margin: "16px 0 4px" }}>Changes so far</h3>
      <ol className="hist">{v.versions.map((x) => <li key={x.version}><span className="t">{`Version ${x.version}`}</span><span className="small">{x.correction ? <>
        <b>{`${labels.get(x.correction.criterionId) ?? x.correction.criterionId}: ${shown(x.correction.previous)} → ${shown(x.correction.next)}. `}</b>
        {`${x.correction.reason} Source: ${x.correction.evidence} `}<span className="xs muted">{`${x.correction.source === "screening call" ? "After the screening call" : "Recruiter correction"} by ${x.correction.reviewer}, ${fd(x.correction.at.slice(0, 10))}.`}</span>
      </> : `Original ${/\(ai-proposed\)/.test(v.record.producedBy) ? "AI draft" : "draft"}, kept unchanged.`} <ResultChip r={x.result} /></span></li>)}</ol>
      <p className="xs muted" style={{ margin: "6px 0 0" }}>A correction adds a new version; the original is never changed. The client summary then needs confirming again.</p>
      <form className="form sc-form" onSubmit={submit} style={{ marginTop: 12 }}>
        <h3 style={{ marginBottom: 10 }}>{`Record a recruiter correction (creates version ${v.latest.version + 1})`}</h3>
        <div className="f"><label htmlFor="scCrit">Requirement or skill</label><select id="scCrit" value={cid} onChange={(e) => { setCid(e.target.value); setNext(v.config.gates.some((g) => g.id === e.target.value) ? "Pass" : "unknown"); }}>
          <optgroup label={TERMS.essential}>{v.config.gates.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</optgroup>
          <optgroup label="Scored skills">{inc.map((c) => <option key={c.id} value={c.id}>{labels.get(c.id)}</option>)}</optgroup></select>
          <div className="help">{`Now, in version ${v.latest.version}: ${pending ?? shown(prev)}`}</div></div>
        <div className="f"><label htmlFor="scNext">New value</label><select id="scNext" value={next} onChange={(e) => setNext(e.target.value)}>
          {gate ? (["Pass", "Fail", "Unknown"] as const).map((g) => <option key={g} value={g}>{GATE[g].label}</option>)
            : <><option value="unknown">{TERMS.notConfirmed}</option><option value="disputed">{TERMS.conflict}</option>{levels.map((l) => <option key={l} value={String(l)}>{`Rating ${l}${crit!.anchors[String(l) as "0"] ? `: ${plain(crit!.anchors[String(l) as "0"]!, labels)}` : ""}`}</option>)}</>}
        </select>{gate && <div className="help">Essential requirements never add points. "Not met" stops the score until a recruiter checks it; it never rejects the candidate automatically.</div>}</div>
        <div className="f"><label htmlFor="scEv">Source (quote and CV page, or where you checked)</label><textarea id="scEv" maxLength={1000} value={evidence} onChange={(e) => setEvidence(e.target.value)} /></div>
        <div className="f"><label htmlFor="scReason">Reason for the change</label><textarea id="scReason" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <div className="f"><label htmlFor="scWho">Your name</label><input id="scWho" maxLength={100} value={reviewer} onChange={(e) => setReviewer(e.target.value)} /><div className="help">Recorded as typed; it is not a sign-in. The time is recorded by this computer.</div></div>
        {problems.length > 0 && <div className="err">{problems.join(" ")}</div>}
        {saved && <div className="banner info">{saved}</div>}
        <div className="row"><button type="submit" className="btn btn-p" disabled={busy}>Save correction</button></div>
      </form>
    </>
  );
}
