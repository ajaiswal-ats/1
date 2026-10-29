import type { AssessmentRecord, LoadedConfig } from "./model";
import { currentClaims, currentScreening, type ScreeningRecord } from "./screening";

/* W6: the recruiter's final review. A person records their own decision, a required reason, their name and the date, in
   a private, append-only file per assessment (decisions/<assessmentId>.json), separate from every AI suggestion. Earlier
   decisions are kept. Before confirming, the recruiter sees what is still open: essential requirements not confirmed or
   not met, conflicting information, and undecided CV-check conflicts. Recording a decision moves, publishes or notifies
   nothing, adds no threshold and changes no score. The combined recommendation awaits agreed rules. */

export const DECISIONS = { forward: "Put forward to the client", decline: "Do not put forward", hold: "Hold — more information needed" } as const;
export type DecisionKind = keyof typeof DECISIONS;
export interface OpenItem { id: string; kind: "essential" | "conflict" | "cv-check conflict"; state: string }
export interface FinalDecision { kind: "finalDecision"; revision: number; at: string; reviewer: string; decision: DecisionKind; reason: string;
  cv: { version: number; stateSha256: string }; screeningRevision: number; openItems: OpenItem[]; acknowledgedOpenItems: boolean;
  /** The screening evidence the decision was made on (screeningKey); absent on decisions recorded before it was kept. */
  screeningKey?: string }
export interface DecisionRecord { schema: "final-decisions/1"; assessmentId: string; entries: FinalDecision[] }

/** What is still open for the recruiter, from the current CV state (after any corrections) and the screening record. */
export function openItems(config: Pick<LoadedConfig, "gates" | "criteria">, record: Pick<AssessmentRecord, "gates">, latest: { gates: { id: string; result: string }[]; inputs: { id: string; status: string }[] }, screening: ScreeningRecord | null | undefined): OpenItem[] {
  const items: OpenItem[] = [];
  for (const g of config.gates) {
    const now = latest.gates.find((x) => x.id === g.id)?.result ?? "Unknown", check = record.gates.find((x) => x.id === g.id)?.check;
    if (now === "Fail") items.push({ id: g.id, kind: "essential", state: "Not met" });
    else if (now === "Unknown") items.push({ id: g.id, kind: "essential", state: check && record.gates.find((x) => x.id === g.id)?.result === "Unknown" ? check.status : "Not confirmed" });
  }
  for (const c of config.criteria) if (c.included && latest.inputs.find((x) => x.id === c.id)?.status === "disputed") items.push({ id: c.id, kind: "conflict", state: "Conflicting information" });
  const { review, decisionOf } = currentClaims(screening);
  for (const c of review?.items ?? []) if (c.proposal.type === "conflict" && !decisionOf(review!, c.id) && !items.some((x) => x.id === c.requirementId && x.kind === "conflict"))
    items.push({ id: c.requirementId, kind: "cv-check conflict", state: "The CV and the call disagree; not yet decided" });
  return items;
}

/** The screening evidence a decision rests on: the saved answers, the screening ratings (proposed or corrected), and the
    CV-check findings and their decisions. A change to any of these makes an earlier decision out of date. */
export function screeningKey(rec: ScreeningRecord | null | undefined): string {
  const st = currentScreening(rec), { review, decisions } = currentClaims(rec);
  const qids = [...new Set([...Object.keys(st.proposal?.ratings ?? {}), ...st.corrections.map((c) => c.questionId)])].sort();
  return JSON.stringify({ answers: st.answers?.revision ?? 0, ratings: qids.map((q) => { const r = st.ratingOf(q); return [q, r.rating, r.by, r.quote]; }),
    claims: review ? { review: review.revision, decided: decisions.filter((d) => d.claimReviewRevision === review.revision).map((d) => [d.itemId, d.decision]) } : null });
}

/** "Put forward" is not available while an essential requirement is not met: the starter allows it only with a client
    exception, and this tool has no recorded client-exception mechanism. An unconfirmed requirement does not block it. */
export const failedEssentials = (open: OpenItem[]) => open.filter((x) => x.kind === "essential" && x.state === "Not met");
export const FORWARD_BLOCKED = "An essential requirement is not met. Putting the candidate forward needs a client exception, and this tool has no way to record one yet. Choose Hold or Do not put forward.";

/** The latest decision and every earlier one (newest first). The latest is out of date when the CV assessment or the
    screening evidence it was made on has changed since: it is kept, but needs reviewing again. */
export function decisionHistory(rec: DecisionRecord | null | undefined, now?: { stateSha256: string; screeningKey: string }) {
  const entries = [...(rec?.entries ?? [])].reverse(), latest = entries[0] ?? null;
  const outOfDate = !!latest && !!now && (latest.cv.stateSha256 !== now.stateSha256 || latest.screeningKey !== now.screeningKey);
  return { current: latest, outOfDate, earlier: entries.slice(1), revision: rec?.entries.length ?? 0 };
}
