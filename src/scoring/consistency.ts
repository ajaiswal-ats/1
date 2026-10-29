import type { AssessmentView, Evidence } from "./model";
import { GATE, labelsFor, stateLabel } from "./plainText";
import type { InputState } from "./versions";

/* Keeps the AI's summary, strengths and gaps consistent with the final checked assessment, for every presentation
   (recruiter page, client view, saved preview). The AI wrote its summary, strengths and gaps before the server's rule
   checks and before any recruiter correction, so they can claim more (or less) than the final assessment supports.
   - A strength is held for review (not shown as a strength) when it rests on a requirement that the checks or a recruiter
     lowered: one of its quotes is, word for word, evidence for that requirement, or its text names it. Nothing is matched
     by similarity, and no replacement wording is written. A later higher rating does not release it, because a rating
     does not show that the whole claim holds: it stays held until a recruiter, confirming the client summary for the
     current assessment ("reviewer-confirmed"), actively keeps that strength and records a reason for approving it.
   - The summary has no quotes, so the sentence that disagrees cannot be identified safely. After any change in either
     direction (a check or correction lowering a requirement, or a correction raising one, which can contradict a summary
     saying it is missing), it is shown unchanged and marked for review, until a recruiter confirms the client summary.
   - The gaps are flagged when a recruiter has raised a requirement after they were written.
   Nothing here changes a stored record, a rating or a score; the AI's own output stays in its run record. */

export interface Change { id: string; name: string; now: string; by: "rule check" | "recruiter" }
/** `raw`: the strength as stored, for matching a recruiter's confirmation (`text` may be reworded for display). */
export interface Strength { text: string; quotes: Evidence[]; raw?: string }
export interface Consistency {
  /** Requirements the checks or a recruiter lowered from the AI's proposal (whatever happened later), with their state now. */
  undercut: Change[];
  /** Requirements a recruiter raised after the AI wrote its summary and gaps. */
  raised: Change[];
  /** Every requirement changed since the AI wrote its summary, in either direction, with its state now. */
  changed: Change[];
  /** The current client summary was confirmed by a recruiter for the current assessment. */
  confirmed: boolean;
  /** The summary is marked for review: something changed and no recruiter has confirmed it since. */
  summaryFlag: boolean;
  shown: Strength[];
  held: (Strength & { because: Change[] })[];
}

const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
/** Higher is more supported: met / a rating above not confirmed or conflicting / not met. */
const rank = (s: InputState) => (s.status === "gate" ? ({ Pass: 2, Unknown: 1, Fail: 0 } as const)[s.result] : s.status === "rated" ? 1 + s.rating : 0);

export function consistencyOf(v: AssessmentView, strengths: Strength[]): Consistency {
  const a = v.record, labels = labelsFor(v.config), name = (id: string) => labels.get(id) ?? id;
  /* The last recruiter correction of each requirement, against the original (version 1) state. */
  const last = new Map<string, NonNullable<(typeof v.versions)[number]["correction"]>>();
  for (const x of v.versions) if (x.correction) last.set(x.correction.criterionId, x.correction);
  const original = (id: string): InputState | null => {
    const g = v.versions[0].gates.find((x) => x.id === id); if (g) return { status: "gate", result: g.result };
    const i = v.versions[0].inputs.find((x) => x.id === id); return i ? (i.status === "rated" ? { status: "rated", rating: i.rating } : { status: i.status }) : null;
  };
  const words = (s: InputState) => (s.status === "gate" ? GATE[s.result].label : stateLabel(s));
  const ruleChecked = new Set([...a.gates.filter((g) => g.check).map((g) => g.id), ...a.criteria.filter((c) => /^Rule check: /.test(c.explanation)).map((c) => c.id)]);
  /** The requirement's state now: the last recruiter correction, else the rule check's status. */
  const now = (id: string) => { const c = last.get(id); if (c) return words(c.next); return a.gates.find((g) => g.id === id)?.check?.status ?? "Not confirmed"; };
  const change = (id: string, by: Change["by"]): Change => ({ id, name: name(id), now: now(id), by });

  const undercut: Change[] = [], raised: Change[] = [];
  for (const id of ruleChecked) undercut.push(change(id, last.has(id) ? "recruiter" : "rule check"));
  /* Any correction in the history that lowered a requirement below the AI's proposal undercuts the strengths resting on
     it, even if a later correction raised it again: a rating does not show that the whole claim holds. */
  const everLowered = new Set(v.versions.flatMap((x) => { const c = x.correction, from = c && original(c.criterionId); return c && from && rank(c.next) < rank(from) ? [c.criterionId] : []; }));
  for (const id of everLowered) if (!ruleChecked.has(id)) undercut.push(change(id, "recruiter"));
  for (const [id, c] of last) { const from = original(id); if (from && rank(c.next) > rank(from) && !everLowered.has(id)) raised.push(change(id, "recruiter")); }
  const changed = [...undercut, ...raised.filter((r) => !undercut.some((u) => u.id === r.id))];

  /* An explicit confirmation: the current client summary was confirmed by a recruiter, and keeps the strength. */
  /* The latest current revision: after an initial review, the prepared draft and the reviewer's revision both describe the
     current state, and the reviewer's (later) one is what applies. */
  const current = (a.clientViews ?? []).filter((r) => r.current).pop(), confirmed = !!a.clientView && current?.preparation.method === "reviewer-confirmed";
  /* Kept and actively approved with a reason: keeping alone (a default tick, or an older confirmation) does not release it. */
  const approved = new Set(confirmed ? (current!.review?.approvedHeld ?? []).filter((x) => typeof x.reason === "string" && x.reason.trim().length >= 10).map((x) => norm(x.text)) : []);
  const kept = new Set(confirmed ? (current!.content.strengths ?? []).map((x) => norm(x.text)).filter((t) => approved.has(t)) : []);

  const evidenceOf = (id: string) => [...(a.gates.find((g) => g.id === id)?.evidence ?? []), ...(a.criteria.find((c) => c.id === id)?.evidence ?? [])].map((e) => norm(e.quote));
  const shown: Strength[] = [], held: Consistency["held"] = [];
  for (const s of strengths) {
    const quotes = s.quotes.map((e) => norm(e.quote)), text = norm(s.text);
    const because = undercut.filter((ch) => evidenceOf(ch.id).some((q) => quotes.includes(q)) || text.includes(norm(ch.name)));
    if (because.length && !kept.has(norm(s.raw ?? s.text))) held.push({ ...s, because }); else shown.push(s);
  }
  return { undercut, raised, changed, confirmed, summaryFlag: changed.length > 0 && !confirmed, shown, held };
}

/** One sentence naming what changed, for a flag. */
export const changeList = (list: Change[]) => list.map((c) => `${c.name} (now ${c.now.replace(/^Not confirmed — .*/, "Not confirmed")})`).join(", ");
