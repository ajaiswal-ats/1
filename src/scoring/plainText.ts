/* Plain-English wording for the scoring screens (presentation only). Stored values are never changed here: statuses,
   ratings, gate results, calculator reasons, cap reasons and review changes keep their recorded form (some are covered by
   run-record fingerprints). These functions only decide what a person reads. */
import { pct, type CvResult } from "./calculator";
import type { EvidenceStatus, LoadedConfig } from "./model";
import type { GateResult } from "./types";

export const TERMS = {
  essential: "Essential requirements",
  notConfirmed: "Not confirmed",
  rules: "Assessment rules",
  sources: "Where the information came from",
  conflict: "Information conflicts — review needed",
  notEnough: "Not enough information to score",
  coverage: "Requirements with information in the CV",
};

/** What the coverage percentage measures, said wherever it is shown. */
export const COVERAGE_NOTE = "The share of the role's requirements, weighted by importance, that the CV gives any information about. It shows how complete the information is, not confidence, accuracy or candidate quality.";

/** Evidence statuses. Each keeps its own meaning: none says a requirement was failed. */
export const STATUS: Record<EvidenceStatus, { label: string; chip: string; reason: string }> = {
  "needs-review": { label: "Needs review", chip: "c-info", reason: "The CV gives information about this. No pass level has been agreed yet, so a recruiter must check it." },
  "not-stated": { label: "Not stated", chip: "c-mute", reason: "The CV does not mention this. That is not a failure: ask about it." },
  claimed: { label: "Claimed · needs checking", chip: "c-mute", reason: "The CV lists this, but does not describe using it. Check it in screening." },
  separate: { label: "Checked separately", chip: "c-mute", reason: "A CV cannot show this. It is checked through the client's own process." },
  conflicting: { label: TERMS.conflict, chip: "c-warn", reason: "The sources disagree. A recruiter must review them." },
};

/** A gate result as a recruiter reads it. "Not confirmed" never means failed. */
export const GATE: Record<GateResult, { label: string; chip: string }> = {
  Pass: { label: "Met on the CV · provisional", chip: "c-ok" },
  Fail: { label: "Not met", chip: "c-crit" },
  Unknown: { label: TERMS.notConfirmed, chip: "c-mute" },
};

/** A criterion's state (rating, Unknown or Disputed) as words. */
export const stateLabel = (s: { status: string; rating?: number }, max?: number) =>
  s.status === "rated" ? `${s.rating}${max ? ` of ${max}` : ""}` : s.status === "unknown" ? TERMS.notConfirmed : s.status === "disputed" ? TERMS.conflict : s.status;
/** A stored state text ("2", "Unknown", "Disputed") as words. */
export const storedStateLabel = (t: string | undefined) => (t === "Unknown" ? TERMS.notConfirmed : t === "Disputed" ? TERMS.conflict : t === "Pass" ? GATE.Pass.label : t === "Fail" ? GATE.Fail.label : t ?? "—");

/** Requirement names by internal ID, so stored prose and choices can be shown without IDs. */
export function labelsFor(config: Pick<LoadedConfig, "gates" | "criteria" | "constraints">) {
  const m = new Map<string, string>();
  for (const g of config.gates) m.set(g.id, g.label);
  for (const c of config.criteria) m.set(c.id, c.label.replace(/\s*\(.*\)$/, ""));
  for (const c of config.constraints) m.set(c.id, c.label);
  return m;
}
/** Stored prose with internal requirement IDs replaced by names, and "Unknown" read as "not confirmed". The meaning is
    otherwise left exactly as recorded. */
export function plain(text: string, labels: Map<string, string>) {
  const ids = [...labels.keys()].sort((a, b) => b.length - a.length).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  let t = text;
  if (ids.length) {
    const any = `(?:${ids.join("|")})`;
    /* "(MH1, SD4)" follows the requirement's name in stored prose: drop it; a bare ID becomes the name. */
    t = t.replace(new RegExp(`\\s*\\(${any}(?:\\s*(?:,|and|/)\\s*${any})*\\)`, "g"), "").replace(new RegExp(`\\b${any}\\b`, "g"), (id) => labels.get(id) ?? id);
  }
  t = t
    .replace(/\s*\((?:J\d+(?:,\s*)?)+\)/g, "") // job-description line references
    .replace(/\btest cap\b/gi, "score limit").replace(/\bthe cap\b/gi, "the score limit")
    .replace(/\bCritical criteri(?:on|a)\b/g, (m) => (m.endsWith("a") ? "critical skills" : "critical skill"))
    .replace(/\brubric\b/gi, (m) => (m[0] === "R" ? "Assessment rules" : "assessment rules"))
    .replace(/Insufficient evidence(?: — no score)?/gi, TERMS.notEnough)
    .replace(/\bmust-haves?\b/gi, (m) => `${m[0] === "M" ? "E" : "e"}ssential requirement${/s$/i.test(m) ? "s" : ""}`)
    .replace(/\bgates?\b/gi, (m) => `${m[0] === "G" ? "E" : "e"}ssential requirement${/s$/i.test(m) ? "s" : ""}`)
    .replace(/\bTEST CHOICE T\d+:\s*/g, "Test choice: ").replace(/\bundefined\b/g, "not defined")
    .replace(/\bat level (\d)\b(?!\s*[-–]\s*\d)/gi, "rated $1").replace(/\blevel (\d)\b(?!\s*[-–]\s*\d)/g, "rating $1").replace(/\bLevel (\d)\b(?!\s*[-–]\s*\d)/g, "Rating $1").replace(/\blevels\b/g, "ratings")
    .replace(/\bunknown\b/gi, "not confirmed").replace(/\bDisputed\b/g, "conflicting");
  /* A replaced word that starts a sentence keeps the capital letter. */
  return t.replace(/(^|[.!?]\s+)(not confirmed|conflicting)\b/g, (_, p: string, w: string) => p + w[0].toUpperCase() + w.slice(1));
}

/** A CV result, in one line. Never a ranking or a decision. */
export function resultLabel(r: CvResult) {
  if (r.status === "scored") return `${r.score} · ${r.band}${r.capApplied ? " · score limited" : ""}`;
  if (r.status === "insufficient") return TERMS.notEnough;
  if (r.status === "disputed") return TERMS.conflict;
  if (r.status === "stopped") return "An essential requirement is not met — no score";
  return "The assessment data has errors — no score";
}

/** Why a score was limited, from the critical skills that set it off: not confirmed, rated 0 (the CV states a
    mismatch) or rated low. Read from the calculator's result rows, not from stored reason text. */
export function capExplanation(r: CvResult, config: LoadedConfig): string | null {
  if (!r.capReasons.length) return null;
  const labels = labelsFor(config), triggers = config.policy.cap.triggers, cap = config.policy.cap.value;
  const why = r.rows.filter((x) => x.importance === "Critical").flatMap((x) => {
    const name = labels.get(x.id) ?? x.label;
    if (x.state === "unknown" && triggers.includes("unknown")) return [`${name} is not confirmed in the CV`];
    if (x.rating === 0 && triggers.includes("zero")) return [`${name} is rated 0 (the CV states a mismatch)`];
    if (x.rating !== null && x.rating <= 1 && triggers.includes("lowOne")) return [`${name} is rated ${x.rating}, a low rating`];
    return [];
  });
  const list = why.join("; ");
  return r.capApplied
    ? `Score limited to ${cap} because ${list}. A critical skill without enough support keeps the score from going higher.`
    : `${list[0]?.toUpperCase() ?? ""}${list.slice(1)}. This would limit the score to ${cap}, but the score is already at or below that.`;
}

/** Why there is no score, in words. */
export function reasonLabel(r: CvResult, config: LoadedConfig): string | null {
  const labels = labelsFor(config), p = config.policy;
  if (r.status === "insufficient") {
    if (r.knownWeight === 0) return `${TERMS.notEnough}: no requirement has a rating yet.`;
    const parts = [];
    if (r.overall[0] * p.minOverallCoverage[1] < p.minOverallCoverage[0] * r.overall[1]) parts.push(`the CV gives information on ${pct(r.overall)} of the role (at least ${pct(p.minOverallCoverage)} is needed)`);
    if (r.critical[0] * p.minCriticalCoverage[1] < p.minCriticalCoverage[0] * r.critical[1]) parts.push(`it gives information on ${pct(r.critical)} of the critical skills (at least ${pct(p.minCriticalCoverage)} is needed)`);
    return `${TERMS.notEnough}: ${parts.join(", and ") || "too little of the role is covered"}. This is missing information, not a judgement of the candidate.`;
  }
  if (r.status === "disputed") return `${TERMS.conflict}: ${r.disputed.map((id) => labels.get(id) ?? id).join(", ")}. There is no score until a recruiter resolves it.`;
  if (r.status === "stopped") return `No score: ${r.failedGates.map((id) => labels.get(id) ?? id).join(", ")} is recorded as not met. A recruiter must check this.`;
  if (r.status === "invalid") return "No score: the assessment data has errors and must be fixed before anything is shown.";
  return null;
}

/** Coverage in words. */
export const coverageLabel = (r: CvResult) => `${pct(r.overall)} of the role · ${pct(r.critical)} of critical skills`;

/* ---- evidence explanations (View evidence only) ---------------------------------------------------------------- */

/** Sentences about rating mechanics or repeated boilerplate: shown in the review controls, not in the evidence. */
const MECHANICS = /\b(?:levels?|ratings?)[ -]\d\b|\brecency or duration requirement\b|\bno recency requirement\b|\brated \d\b|\b(?:rating|rated) (?:is|of|at) \d|\bno rating\b|\banchor|\bscore limit\b|\bpoints?\b|\bper the (?:rules?|[\w-]+ rule)\b|\bnothing is inferred from silence\b|\bunder this configuration\b|\btest (?:rule|choice|configuration)\b|\bweight\b/i;

/** Removes rating talk inside a sentence (a bracket, or a trailing "leaving … rated 2" clause), keeping the rest. */
export function withoutRatingTalk(text: string) {
  return text
    .replace(/,?\s*which (?:is|are) (?:required|needed) for (?:level|rating)[- ]\d\b/gi, "")
    .replace(/\b(?:Pass\/)?(?:level|rating)[- ]\d\s+(thresholds?)\b/gi, "required $1").replace(/\bthe (?:level|rating)[- ]\d threshold\b/gi, "the threshold")
    .replace(/,?\s*(?:meeting|meets|reaching|(?:which )?correspond(?:s|ing)? to)\s+(?:the\s+)?(?:level|rating)[- ]\d\b[^.;,(]*(?:\([^)]*\))?/gi, "")
    .replace(/[;,]\s*(?:so\s+)?(?:level|rating)[- ]\d\b[^.;]*(?=[.;]|$)/gi, "")
    .replace(/\s*\([^()]*\b(?:rated|rating|level)[\s-]+\d[^()]*\)/gi, "")
    .replace(/,?\s*(?:leaving|so|giving|which (?:gives|leaves))\b[^.;]*\b(?:rated|rating|level)\s+\d[^.;]*/gi, "")
    .replace(/\s+([.;,])/g, "$1").replace(/\s+/g, " ").trim();
}

/** A gap or point to clarify for View evidence: plain words, no rating talk. */
export const evidencePoint = (text: string, labels: Map<string, string>) => withoutRatingTalk(plain(text, labels));

/** Standalone sentences that repeat the method rather than say anything about this CV. */
const BOILERPLATE = new RegExp(`^(?:${[
  "Nothing is inferred from silence", "No recency or duration requirement applies(?: to [^.]*)?", "(?:With [^.]*?,\\s*)?(?:the )?rating is \\d",
  "Rated \\d(?: \\([^)]*\\))?", "Cannot rate", "No level can be assigned", "Together these meet rating \\d",
  "(?:Level|Rating) \\d (?:is the highest supportable rating|\\(listed only\\))", "(?:Level|Rating) \\d is unavailable (?:per|in|under) [^.]*",
  "Silence is not a (?:level|rating)-0 statement\\b[^.]*", "No other described evidence establishes any written level\\b[^.]*",
].join("|")})\\.?$`, "i");

/** One requirement's explanation for the candidate summary: the draft's own complete sentences, with names instead of
    internal codes, and standalone boilerplate sentences left out. No sentence is cut short or shortened; stored text is
    unchanged. Returns "" when nothing is left. */
export function explanationText(text: string, labels: Map<string, string>): string {
  const coded = text.replace(/\bP1 (?=profit)/g, "").replace(/\bP1\b(?: profit or margin)?/g, "profit or margin").replace(/\bP2\s*[–-]\s*P4\b(?: items?)?/g, "other sales results").replace(/\bP[2-4]\b/g, "other sales results");
  const t = plain(coded, labels).replace(/\s*\(Option [A-Z]\)/g, "").replace(/,\s*not Fail\b/g, ", not a failure");
  return sentences(t).filter((x) => /[A-Za-z]{2}/.test(x) && !BOILERPLATE.test(x)).join(" ");
}

/** Whole sentences of a text. An initial ("W.W. Grainger") does not end a sentence. */
export const sentences = (t: string) => t.split(/(?<=[.!?])(?<!\b[A-Z]\.)\s+(?=[A-Z("“])/).map((x) => x.trim()).filter(Boolean);

/** A short explanation for one requirement in View evidence: internal codes, rating-level talk and boilerplate removed,
    at most two sentences, never empty (falls back to what the status means). Stored text is unchanged. */
export function evidenceExplanation(text: string, labels: Map<string, string>, fallback: string): string {
  /* Profit and sales-result codes first, so a requirement ID that happens to look the same is not substituted. */
  const coded = text.replace(/\bP1\b(?: profit or margin)?/g, "profit or margin").replace(/\bP2\s*[–-]\s*P4\b(?: items?)?/g, "other sales results").replace(/\bP[2-4]\b/g, "other sales results");
  const t = withoutRatingTalk(plain(coded, labels).replace(/\s*\(?Option [A-Z]\)?/g, ""));
  const kept = t.split(/(?<=[.!?])\s+(?=[A-Z("“])/).filter((s) => /[A-Za-z]{2}/.test(s) && !MECHANICS.test(s));
  return kept.length ? kept.slice(0, 2).join(" ") : fallback;
}

/* ---- client wording (client-facing presentation only) ---------------------------------------------------------- */

/** Shown in place of a client-facing sentence whose scoring language cannot be rewritten safely. */
export const CLIENT_REVIEW = "This point needs recruiter review.";
/** Scoring and rule language that must not reach a client-facing sentence. */
export const CLIENT_JARGON = /\b(?:levels?|ratings?|rated|rate)[- ]?\d\b|\b(?:levels?|ratings?) (?:zero|one|two|three)\b|\bthresholds?\b|\bcap(?:ped|s)?\b|\bscore limit|\b\d+ points?\b|\bpoints? (?:possible|earned)\b|\banchors?\b|\bweights?\b|\bper the (?:rules?|[\w-]+ rule)\b|\brubric\b|\bcriteri(?:on|a)\b|\bP[1-4]\b|\b(?:MH|SD|PC)\d+\b|\bOption [A-Z]\b|\bgates?\b|\bpass\b|\bfail\b|\bunknown\b|\bdisputed\b|\bconfiguration\b|\brecency\b|\btest (?:rules?|choices?)\b|\bcannot be rated\b/i;
const listOf = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
/* Whole phrases of rule language, each rewritten as the plain statement it makes. Each keeps the sentence complete and
   says no more than the original: a limit, a requirement not confirmed, or what kind of requirement it is. */
const CLIENT_PHRASES: [RegExp, string | ((...m: string[]) => string)][] = [
  [/,?\s*leaving (?:both )?(.+?) below (?:their|its|the) (?:pass\/)?(?:level|rating)[- ]?\d thresholds?/gi, (_, x) => `, so ${x} cannot be confirmed from the CV`],
  [/\bthe (\d+)-year alternative threshold\b/gi, (_, n) => `the shorter ${n}-year alternative`],
  [/\bthe (\d+)-year threshold\b/gi, (_, n) => `the required ${n} years`],
  [/\ba reduced tenure threshold\b/gi, "a shorter required time in outside sales"],
  [/\bcannot be rated\b/gi, "cannot be assessed from the CV"],
  [/\ban? (critical|important) criterion\b/gi, (_, k) => `an ${k.toLowerCase()} requirement`],
  [/,?\s*limiting recency evidence for\b/gi, ", which limits the evidence of recent experience in"],
];

/** Client-facing wording for a stored summary, strength or point to clarify: requirement names instead of codes (plain),
    bracketed scoring tags turned into their own plain sentences, known rule phrases rewritten, and any sentence still
    holding scoring language replaced by CLIENT_REVIEW. A display layer only: the stored text is unchanged, and the
    recruiter's view keeps the original. Quotes are never passed through it. */
export function clientWording(text: string, labels: Map<string, string>): string {
  const names = new Set(labels.values());
  const out: string[] = [];
  for (let s of sentences(plain(text, labels))) {
    const added: string[] = [];
    /* A bracketed tag about requirements' scoring: "(X not confirmed, Y not confirmed)" or "(X capped rated 2)". */
    s = s.replace(/\s*\(([^()]+)\)/g, (whole, inner: string) => {
      /* Split on commas, then on "and" only where the parts are not themselves a requirement's name ("licence and MVR"). */
      const parts = inner.split(/,\s*/).flatMap((x) => (names.has(x.trim().replace(/ not confirmed$/, "")) ? [x.trim()] : x.split(/\s+and\s+/).map((y) => y.trim())));
      const notConfirmed = parts.map((p) => p.match(/^(.+?) not confirmed$/)?.[1]);
      if (notConfirmed.every((n) => n && names.has(n))) { added.push(`${listOf(notConfirmed as string[])} ${notConfirmed.length > 1 ? "are" : "is"} not yet confirmed.`); return ""; }
      const rated = inner.trim().match(/^(.+?) (?:capped )?(?:rated|rating) \d$/)?.[1];
      if (rated && names.has(rated)) { added.push(`This affects the assessment of ${rated}.`); return ""; }
      return whole;
    });
    for (const [re, to] of CLIENT_PHRASES) s = s.replace(re, to as string);
    s = s.replace(/\s+([.;,])/g, "$1");
    for (const x of [s, ...added]) { const y = CLIENT_JARGON.test(x) ? CLIENT_REVIEW : x; if (!(y === CLIENT_REVIEW && out[out.length - 1] === CLIENT_REVIEW)) out.push(y); }
  }
  return out.join(" ");
}
