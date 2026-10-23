/* Client actions on one submission, ported from client-workspace-v1-visual-2h (actions, formHtml, submitForm).
   Pure functions: each action changes only the submission it names (never the same person's other submissions),
   and stage changes are recorded as moves, which the reports count (see reporting/metrics.ts).
   Nothing is sent anywhere: these are fictional demo changes kept in this browser. */
import type { Dataset, Stage, Submission } from "../data/fixtures";
import { STAGES, roleOf } from "./candidates";

export const DECLINE_CATEGORIES = ["No category", "Experience not aligned", "Key skills gap", "Location or work arrangement",
  "Compensation expectations", "Role requirements changed", "Other"];

export type DemoAction =
  /** Saved stage change. `times` only for a move to Interview (a request, not a booking). */
  | { type: "move"; sid: string; to: Exclude<Stage, "Declined">; note: string; times?: string; d: string }
  | { type: "decline"; sid: string; text: string; cat: string; d: string }
  | { type: "feedback"; sid: string; about: string; text: string; d: string };

const first = (name: string) => name.split(" ")[0];
const ENDED: Stage[] = ["Declined", "Hired"];

/** What the client may do on this submission now (2h actions()). */
export function permitted(data: Dataset, c: Submission) {
  const open = roleOf(data, c).status === "Open", active = !ENDED.includes(c.stage);
  return {
    /** Stages the client may move to (the To review → Interview move is its own button). */
    moveTo: open && active && c.stage !== "Offer" ? STAGES.filter((s) => s !== c.stage) : [],
    decline: open && active,
    feedback: active && ["held", "feedback", "scheduled"].includes(c.client.status),
  };
}

export function isPermitted(data: Dataset, a: DemoAction): boolean {
  const c = data.subs.find((s) => s.id === a.sid);
  if (!c) return false;
  const p = permitted(data, c);
  if (a.type === "move") return p.moveTo.includes(a.to);
  if (a.type === "decline") return p.decline;
  return p.feedback;
}

/** The note a decline or feedback needs, or null when the action can be saved. */
export function validationError(a: Pick<DemoAction, "type"> & { text?: unknown }): string | null {
  const empty = typeof a.text !== "string" || !a.text.trim();
  if (a.type === "decline" && empty) return "Add a short note so the recruiter knows why.";
  if (a.type === "feedback" && empty) return "Add your feedback before sharing.";
  return null;
}

/** Applies one action to a dataset in place (2h submitForm). Callers pass a copy. */
export function applyAction(data: Dataset, a: DemoAction): void {
  const c = data.subs.find((s) => s.id === a.sid);
  if (!c) return;
  const hist = (data.hist[c.id] ??= [[c.shared, `Revenue Optics shared ${first(c.name)} for this role`]]);
  const notes = () => (data.notes[c.id] ??= []);
  if (a.type === "decline") {
    c.declineNote = { text: a.text.trim(), cat: a.cat, date: a.d };
    c.stage = "Declined";
    c.next = { who: "none", kind: "closed" };
    data.moves.push({ sid: c.id, to: "Declined", d: a.d, by: "you" });
    hist.push([a.d, `You declined ${first(c.name)}`]);
  } else if (a.type === "feedback") {
    notes().push({ kind: "Interview feedback", about: a.about, text: a.text.trim(), d: a.d });
    if (c.client.status === "held") { c.client = { ...c.client, status: "feedback" }; c.next = { who: "ro", kind: "followup", since: a.d }; }
    hist.push([a.d, "You shared interview feedback"]);
  } else {
    c.stage = a.to;
    if (a.to === "Interview") { c.client = { status: "requested", date: a.d, slots: a.times || "No times suggested" }; c.next = { who: "ro", kind: "scheduling", since: a.d }; }
    else if (a.to === "Offer" || a.to === "Hired") { c.outcome = null; c.next = { who: "ro", kind: "moved-outcome", since: a.d }; }
    else c.next = { who: "ro", kind: "moved", since: a.d };
    if (a.note.trim()) notes().push({ kind: "Note with stage move", text: a.note.trim(), d: a.d });
    data.moves.push({ sid: c.id, to: a.to, d: a.d, by: "you" });
    hist.push([a.d, `You moved ${first(c.name)} to ${a.to}`]);
  }
}

const MOVE_TO = new Set<string>(STAGES);
const isText = (v: unknown): v is string => typeof v === "string";
const isDay = (v: unknown): v is string => isText(v) && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** Reads one saved action, or returns null if it is not a well-formed action (saved data can be edited or corrupted). */
export function parseAction(v: unknown): DemoAction | null {
  if (!v || typeof v !== "object") return null;
  const x = v as Record<string, unknown>;
  if (!isText(x.sid) || !isDay(x.d)) return null;
  const { sid, d } = x;
  if (x.type === "move" && isText(x.to) && MOVE_TO.has(x.to) && isText(x.note) && (x.times === undefined || isText(x.times)))
    return { type: "move", sid, to: x.to as Exclude<Stage, "Declined">, note: x.note, ...(x.times !== undefined ? { times: x.times } : {}), d };
  if (x.type === "decline" && isText(x.text) && isText(x.cat)) return { type: "decline", sid, text: x.text, cat: x.cat, d };
  if (x.type === "feedback" && isText(x.about) && isText(x.text)) return { type: "feedback", sid, about: x.about, text: x.text, d };
  return null;
}

/** The well-formed actions in a saved value, in order. Anything else (not a list, or malformed entries) is left out. */
export function parseActions(raw: unknown): DemoAction[] {
  return Array.isArray(raw) ? raw.map(parseAction).filter((a): a is DemoAction => a !== null) : [];
}

/** The base dataset with the saved actions replayed, in order, on a copy. Malformed actions, and actions that are
    no longer permitted, are skipped; `applied` lists the ones that took effect. */
export function replay(base: Dataset, actions: unknown): { data: Dataset; applied: DemoAction[] } {
  const data = structuredClone(base), applied: DemoAction[] = [];
  for (const a of parseActions(actions)) if (isPermitted(data, a) && !validationError(a)) { applyAction(data, a); applied.push(a); }
  return { data, applied };
}

/** Panel heading after saving, and the status line under it (2h JUSTMSG). */
export function savedHeading(a: DemoAction): string {
  return a.type === "decline" ? "Declined" : a.type === "feedback" ? "Feedback saved" : `${a.to} stage saved`;
}

/** Toast after saving. Always says nothing was sent. */
export function savedToast(a: DemoAction): string {
  if (a.type === "decline") return "Declined. Recorded in this mockup; nothing was sent.";
  if (a.type === "feedback") return "Feedback recorded in this mockup. Stage unchanged.";
  return a.to === "Offer" || a.to === "Hired" ? `${a.to} stage saved in this mockup. Offer status is not recorded; nothing was sent.` : `Moved to ${a.to}. Saved in this mockup; nothing was sent.`;
}
