import type { AssessmentRecord, LoadedConfig } from "./model";
import type { InputState } from "./versions";

/* Screening questions for a role (W1): one versioned core set shared by every candidate for that role, plus the
   candidate's own follow-up questions for gaps. The core set is a file in the private scoring folder, recorded with a
   fingerprint; its answer points are proposals that need business review. Nothing here asks, records or rates an answer:
   screening stays "Not assessed" until answers exist. */

/** The starter's seven interview areas ("Cover these areas"), plus essential requirements to confirm. */
export const STARTER_AREAS = ["Knowledge of the role", "Communication", "Ownership and results", "Problem solving",
  "Understanding of the role and why they want to move", "Fit with the client's working conditions", "Salary, joining date and location"] as const;
export const AREAS = [...STARTER_AREAS, "Essential requirement"] as const;

export interface ScreeningQuestion {
  id: string; area: (typeof AREAS)[number]; text: string;
  /** Requirement, skill or practical-point IDs from the assessment rules this question checks (may be empty). */
  checks: string[];
  /** "scored": rated 1 to 5 for the screening score; "confirms": records a practical or essential requirement, no points. */
  use: "scored" | "confirms";
  /** What a good answer covers: proposals, needing business review. */
  answerPoints: string[];
  source: string;
}
export interface ScreeningSet {
  schema: "screening-set/1"; id: string; version: number; title: string; status: "proposed" | "approved"; statusNote: string;
  rules: { id: string; version: number }; basedOn: string[]; scale: string; neverAssess: string; questions: ScreeningQuestion[];
  /** Answer points for requirements that no core question covers, used for candidate follow-ups (proposals). `reviewNote`
      says what the job description or rules leave undefined. */
  requirementPoints?: Record<string, { points: string[]; source: string; reviewNote?: string }>;
  changes?: string;
  /** Added by the loader: the file's fingerprint and any problem (changed since recorded, unreadable). */
  sha256?: string; loadProblems?: string[];
}

/** Problems that keep a core set from being shown for these rules. Coverage follows the starter: every interview area,
    every critical skill, and every essential requirement (which cannot be scored, so must be confirmed). */
export function screeningSetProblems(set: ScreeningSet, config: Pick<LoadedConfig, "id" | "version" | "gates" | "criteria" | "constraints">): string[] {
  const p: string[] = [...(set.loadProblems ?? [])];
  if (set.schema !== "screening-set/1") p.push("the question set is not in the expected format");
  if (!Number.isInteger(set.version) || set.version < 1) p.push("the question set has no version");
  if (set.rules?.id !== config.id || set.rules?.version !== config.version) p.push(`the question set was written for rules ${set.rules?.id} version ${set.rules?.version}, not version ${config.version} of these rules`);
  const known = new Set([...config.gates.map((g) => g.id), ...config.criteria.map((c) => c.id), ...config.constraints.map((c) => c.id)]);
  const ids = new Set<string>();
  for (const q of set.questions ?? []) {
    if (ids.has(q.id)) p.push(`question ${q.id} appears twice`);
    ids.add(q.id);
    if (!q.text?.trim()) p.push(`question ${q.id} has no text`);
    if (!AREAS.includes(q.area)) p.push(`question ${q.id} has an unknown area`);
    if (q.use !== "scored" && q.use !== "confirms") p.push(`question ${q.id} must be scored or confirm a requirement`);
    if (!q.answerPoints?.length) p.push(`question ${q.id} has no answer points`);
    for (const c of q.checks ?? []) if (!known.has(c)) p.push(`question ${q.id} checks ${c}, which is not in these rules`);
    if (q.use === "scored" && (q.checks ?? []).some((c) => config.gates.some((g) => g.id === c) || config.constraints.some((x) => x.id === c))) p.push(`question ${q.id} would score an essential requirement or practical point`);
  }
  const checked = new Set((set.questions ?? []).flatMap((q) => q.checks ?? []));
  for (const [id, r] of Object.entries(set.requirementPoints ?? {})) {
    if (!known.has(id)) p.push(`answer points are given for ${id}, which is not in these rules`);
    if (checked.has(id)) p.push(`answer points for ${id} would compete with the core question that covers it`);
    if (!r.points?.length) p.push(`answer points for ${id} are empty`);
  }
  for (const a of STARTER_AREAS) if (!(set.questions ?? []).some((q) => q.area === a)) p.push(`no question covers "${a}"`);
  for (const c of config.criteria) if (c.included && c.importance === "Critical" && !checked.has(c.id)) p.push(`no question covers the critical skill ${c.id}`);
  for (const g of config.gates) if (!checked.has(g.id)) p.push(`no question confirms the essential requirement ${g.id}`);
  return p;
}

/** One part of a follow-up's answer guide: a core question's points, or a requirement's own points. */
export interface GuidePart { from: { core: string } | { requirement: string }; points: string[]; reviewNote?: string }
export interface FollowUp { text: string; checks: string[]; coreIds: string[]; guide: GuidePart[]; missing: string[] }
/** The candidate's own follow-up questions for gaps (recorded with the assessment). Each gets an answer guide that covers
    everything it checks: for each requirement, the core question that covers it, otherwise that requirement's own answer
    points; a requirement with neither is listed as missing, never filled in. They add to the core set; never replace it. */
export function followUpsFor(record: Pick<AssessmentRecord, "questions">, set: ScreeningSet | null): FollowUp[] {
  return (record.questions ?? []).map((q) => {
    const checks = q.for.split(/,\s*/).map((x) => x.trim()).filter(Boolean);
    const cores = set ? set.questions.filter((c) => c.checks.some((x) => checks.includes(x))) : [];
    const covered = new Set(cores.flatMap((c) => c.checks));
    const guide: GuidePart[] = cores.map((c) => ({ from: { core: c.id }, points: c.answerPoints }));
    const missing: string[] = [];
    for (const id of checks) if (!covered.has(id)) {
      const r = set?.requirementPoints?.[id];
      if (r?.points.length) guide.push({ from: { requirement: id }, points: r.points, ...(r.reviewNote ? { reviewNote: r.reviewNote } : {}) }); else missing.push(id);
    }
    return { text: q.q, checks, coreIds: cores.map((c) => c.id), guide, missing };
  });
}

/** The core set for an assessment's rules, if one is recorded and has no problems. */
export function coreSetFor(sets: ScreeningSet[] | undefined, config: LoadedConfig): { set: ScreeningSet | null; problems: string[] } {
  /* The latest version written for exactly these rules; a set for other rules versions is never used. */
  const mine = (sets ?? []).filter((s) => s.rules?.id === config.id).sort((a, b) => b.version - a.version);
  const pick = mine.find((s) => s.rules.version === config.version) ?? mine[0];
  if (!pick) return { set: null, problems: [] };
  const problems = screeningSetProblems(pick, config);
  return problems.length ? { set: null, problems } : { set: pick, problems: [] };
}

/* ---- W2: answers and draft screening ratings ------------------------------------------------------------------- */
/* A screening record per assessment (private file screening/<assessmentId>.json), append-only: every save of answers,
   every proposal of draft ratings and every recruiter correction is added, never overwritten. `revision` counts the
   entries, so a save based on an older revision is refused (stale). The question-set version and fingerprint are kept
   with the answers. Only scored core questions are rated (1 to 5); confirmation questions and follow-ups never are;
   a question without an answer is "Not answered", never zero. No screening score or combined result is calculated. */

export interface SetRef { id: string; version: number; sha256: string }
export interface AnswerSave { kind: "answers"; revision: number; at: string; by: string; set: SetRef;
  answers: Record<string, string>; followUps: Record<string, { question: string; answer: string }>; excerpt: string;
  /** The core questions the recruiter explicitly linked the call excerpt to. The excerpt answers no other question. */
  excerptFor?: string[] }
export interface ProposedRating { rating: number; quote: string; reason: string }
export interface Proposal { kind: "proposal"; revision: number; at: string; route: string; isAi: boolean; answersRevision: number;
  ratings: Record<string, ProposedRating>; dropped: { questionId: string; problem: string }[] }
export interface RatingCorrection { kind: "correction"; revision: number; at: string; reviewer: string; questionId: string;
  from: number | null; to: number | null; quote: string; reason: string; answersRevision: number }
export type ScreeningEntry = AnswerSave | Proposal | RatingCorrection;
export interface ScreeningRecord { schema: "screening-record/1"; assessmentId: string; entries: (ScreeningEntry | SummaryDraft | SummaryReview | ClaimReview | ClaimDecision)[] }

/** The key of a follow-up: its position and its exact text, so an answer stays with the question it was given for. */
export const followUpKey = (i: number, text: string) => `F${i + 1}:${text}`;

/** Where every scored question stands now: its answer texts, the latest proposal, and the latest recruiter correction. */
export function currentScreening(rec: ScreeningRecord | null | undefined) {
  /* Summary entries (W3) sit in the same record; ratings and answers ignore them. */
  const entries = (rec?.entries ?? []).filter((e): e is ScreeningEntry => e.kind === "answers" || e.kind === "proposal" || e.kind === "correction");
  const answers = [...entries].reverse().find((e): e is AnswerSave => e.kind === "answers") ?? null;
  const proposal = answers ? [...entries].reverse().find((e): e is Proposal => e.kind === "proposal" && e.answersRevision === answers.revision) ?? null : null;
  const corrections = answers ? entries.filter((e): e is RatingCorrection => e.kind === "correction" && e.answersRevision === answers.revision) : [];
  const ratingOf = (qid: string): { rating: number | null; by: "proposal" | "recruiter" | null; quote: string; reason: string; correction?: RatingCorrection } => {
    const c = [...corrections].reverse().find((x) => x.questionId === qid);
    if (c) return { rating: c.to, by: "recruiter", quote: c.quote, reason: c.reason, correction: c };
    const p = proposal?.ratings[qid];
    return p ? { rating: p.rating, by: "proposal", quote: p.quote, reason: p.reason } : { rating: null, by: null, quote: "", reason: "" };
  };
  return { revision: rec?.entries?.length ?? 0, answers, proposal, corrections, ratingOf, history: entries };
}

/** The texts an answer to a core question may be quoted from: its own answer, the answers to its follow-ups, and the call
    excerpt only when the recruiter explicitly linked the excerpt to this question. A general excerpt answers nothing. */
export function answerSources(qid: string, save: Pick<AnswerSave, "answers" | "followUps" | "excerpt" | "excerptFor">, followUps: FollowUp[]): string[] {
  const linked = followUps.map((f, i) => [f, followUpKey(i, f.text)] as const).filter(([f]) => f.coreIds.includes(qid)).map(([, k]) => save.followUps[k]?.answer ?? "");
  const excerpt = (save.excerptFor ?? []).includes(qid) ? save.excerpt ?? "" : "";
  return [save.answers[qid] ?? "", ...linked, excerpt].filter((x) => x.trim());
}
const norm = (t: string) => t.replace(/\s+/g, " ").trim();
/** Whether a quote appears word for word in one of the supplied texts (spaces and line breaks compared loosely). */
export const quotedFrom = (quote: string, texts: string[]) => norm(quote).length >= 3 && texts.some((t) => norm(t).includes(norm(quote)));

/** Checks a proposer's output: only scored core questions with an answer, whole ratings 1 to 5, a word-for-word quote
    from that question's answers, and a short reason. Anything else is dropped and listed, never kept or repaired. */
export function validateProposal(output: unknown, set: ScreeningSet, save: AnswerSave, followUps: FollowUp[]): { ratings: Record<string, ProposedRating>; dropped: Proposal["dropped"] } {
  const ratings: Record<string, ProposedRating> = {}, dropped: Proposal["dropped"] = [];
  const list = output && typeof output === "object" && Array.isArray((output as { ratings?: unknown }).ratings) ? (output as { ratings: unknown[] }).ratings : null;
  if (!list) return { ratings, dropped: [{ questionId: "-", problem: "the proposal is not in the expected format" }] };
  for (const r of list as Record<string, unknown>[]) {
    const qid = String(r?.questionId ?? ""), q = set.questions.find((x) => x.id === qid), drop = (problem: string) => dropped.push({ questionId: qid || "-", problem });
    if (!q) { drop("no such core question"); continue; }
    if (q.use !== "scored") { drop("this question only confirms a requirement and is never rated"); continue; }
    if (ratings[qid]) { drop("rated twice"); continue; }
    const sources = answerSources(qid, save, followUps);
    if (!sources.length) { drop("not answered, so it cannot be rated"); continue; }
    if (!Number.isInteger(r.rating) || (r.rating as number) < 1 || (r.rating as number) > 5) { drop("the rating must be a whole number from 1 to 5"); continue; }
    if (typeof r.quote !== "string" || !quotedFrom(r.quote, sources)) { drop("the quote is not word for word in the answer given"); continue; }
    if (typeof r.reason !== "string" || !r.reason.trim() || r.reason.length > 400) { drop("a short reason is required"); continue; }
    ratings[qid] = { rating: r.rating as number, quote: norm(r.quote as string), reason: (r.reason as string).trim() };
  }
  return { ratings, dropped };
}

/** The proposer's instructions and input: answer points, the scale, what never to rate, and only the supplied answers. */
export function proposalPrompt(set: ScreeningSet, save: AnswerSave, followUps: FollowUp[]) {
  /* Each question carries only its own answers (its answer, its follow-ups' answers, the excerpt if linked to it). */
  const scored = set.questions.filter((q) => q.use === "scored").map((q) => ({ questionId: q.id, question: q.text, answerPoints: q.answerPoints,
    answers: answerSources(q.id, save, followUps) }));
  const system = ["You prepare draft screening ratings for a recruiter to review. They are drafts, not decisions.",
    `Rate each scored question that has an answer from 1 to 5. ${set.scale}`,
    "Use only the answers given with each question. Never invent or assume an answer, and never use one question's answers for another. Skip a question with no answer.",
    "For each rating give one quote copied word for word from that question's answers, and one short plain-English reason saying which answer points it covers.",
    set.neverAssess].join("\n");
  const user = JSON.stringify({ questions: scored });
  const schema = { type: "object", additionalProperties: false, required: ["ratings"], properties: { ratings: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["questionId", "rating", "quote", "reason"], properties: { questionId: { type: "string" }, rating: { type: "integer", minimum: 1, maximum: 5 }, quote: { type: "string" }, reason: { type: "string" } } } } } };
  return { system, user, schema };
}

/* ---- W3: the screening-call summary --------------------------------------------------------------------------- */
/* A short summary of the call, from the saved answers only: strengths (each with a word-for-word quote), concerns (quotes
   where available), how the candidate communicated (answering the question asked, actions and results; never accent,
   speed, appearance or personality), and four or five plain lines. Unanswered questions are listed by the system, not
   generated, and are not failures. A generated draft is "Draft — recruiter review needed"; a recruiter edits and confirms
   it as a new version. Each version is bound to the exact answers and ratings it describes (stateKey): if either changes,
   it is out of date until reviewed again. No score, recommendation or client publication. */

/** A quote's source is a core question (`questionId`: its answer, linked follow-ups, or the excerpt if linked) or one
    follow-up (`followUp`: its stable key, F<n>:<question>; only that follow-up's answer). */
export interface SummaryContent {
  strengths: { text: string; quote: string; questionId?: string; followUp?: string }[];
  concerns: { text: string; quote?: string; questionId?: string; followUp?: string }[];
  communication: { text: string; quote?: string; questionId?: string; followUp?: string };
  summary: string[];
}
/** `output`: the summariser's own output, kept unchanged for the record. */
export interface SummaryDraft { kind: "summaryDraft"; revision: number; at: string; route: string; isAi: boolean; stateKey: string; content: SummaryContent; dropped: string[]; output?: unknown }
export interface SummaryReview { kind: "summaryReview"; revision: number; at: string; reviewer: string; stateKey: string; content: SummaryContent; basedOnRevision: number }

/** Personal characteristics a call summary must never describe or rely on. */
export const NOT_ASSESSED = /\b(?:accents?|accented|speed of speech|(?:speaks?|spoke|talks?|talked) (?:too )?(?:fast|slow(?:ly)?|quick(?:ly)?)|appearance|looks|dress(?:ed)?|personality|likeable|charisma(?:tic)?|confident|nervous|shy|age|young|older|gender|male|female|nationality|ethnicity|religion|religious|health|disab\w*|pregnan\w*|married|children|family)\b/i;

/** The exact answers and ratings a summary describes: the answers version, and each scored question's rating, who set it
    and its quote. Any change to these makes an earlier summary out of date. */
export function stateKey(rec: ScreeningRecord | null | undefined, set: ScreeningSet): string {
  const st = currentScreening(rec);
  if (!st.answers) return "";
  return JSON.stringify({ answers: st.answers.revision, ratings: set.questions.filter((q) => q.use === "scored").map((q) => { const r = st.ratingOf(q.id); return [q.id, r.rating, r.by, r.quote]; }) });
}

/** Core questions with no answer at all (own answer, follow-up, or linked excerpt): listed as unanswered, never failures. */
export const unansweredQuestions = (set: ScreeningSet, save: AnswerSave, followUps: FollowUp[]) => set.questions.filter((q) => !answerSources(q.id, save, followUps).length);

/** The current summary (the latest generated draft or recruiter review) and whether it still describes the current state. */
export function currentSummary(rec: ScreeningRecord | null | undefined, set: ScreeningSet | null) {
  const entries = rec?.entries ?? [];
  const versions = entries.filter((e): e is SummaryDraft | SummaryReview => e.kind === "summaryDraft" || e.kind === "summaryReview");
  const latest = versions[versions.length - 1] ?? null;
  return { latest, versions, outOfDate: !!latest && !!set && latest.stateKey !== stateKey(rec, set) };
}

/** Answered and total core questions, scored and confirmation-only, from the saved answers (an answer, a follow-up, or
    a linked excerpt). The only source of counts shown with a summary. */
export function answerTotals(set: ScreeningSet, save: AnswerSave, followUps: FollowUp[]) {
  const of = (use: ScreeningQuestion["use"]) => { const qs = set.questions.filter((q) => q.use === use); return { answered: qs.filter((q) => answerSources(q.id, save, followUps).length).length, total: qs.length }; };
  return { scored: of("scored"), confirms: of("confirms") };
}
const NUMBERS: Record<string, number> = { no: 0, none: 0, zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
/* "Three scored questions were not answered", "all nine questions were answered", "every question was answered". */
const N = "all|every|no|none|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\d+", N2 = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\d+";
const KIND = "(?:(scored|confirmation(?:-only)?|core|screening)\\s+)?", STATE = "(not (?:yet )?answered|unanswered|answered)";
/* Either order: "three scored questions were not answered", or "answered all nine questions". */
const COUNT_CLAIM = new RegExp(`\\b(${N})\\b(?:\\s+of\\s+the)?(?:\\s+(?:${N2}))?\\s+${KIND}questions?\\b[^.;]*?\\b${STATE}\\b|\\b${STATE}\\s+(?:the\\s+)?(${N})\\b(?:\\s+(?:${N2}))?\\s+${KIND}questions?\\b`, "i");
/** A count of answered or unanswered questions in prose, checked against the saved answers: null when there is none or it
    is accurate, otherwise what is wrong. */
export function countClaimProblem(text: string, totals: ReturnType<typeof answerTotals>): string | null {
  const x = text.match(COUNT_CLAIM); if (!x) return null;
  const m = x[1] !== undefined ? [x[0], x[1], x[2], x[3]] : [x[0], x[5], x[6], x[4]]; // [count, kind, state] in either order
  const kind = /^scored/i.test(m[2] ?? "") ? "scored" : /^confirmation/i.test(m[2] ?? "") ? "confirms" : "all", unanswered = /not|unanswered/i.test(m[3]);
  const t = kind === "all" ? { answered: totals.scored.answered + totals.confirms.answered, total: totals.scored.total + totals.confirms.total } : totals[kind];
  const actual = unanswered ? t.total - t.answered : t.answered, word = m[1].toLowerCase();
  const claimed = word === "all" || word === "every" ? t.total : NUMBERS[word] ?? Number(word);
  return claimed === actual ? null : `says ${claimed} ${kind === "all" ? "" : `${kind === "scored" ? "scored" : "confirmation-only"} `}question${claimed === 1 ? "" : "s"} ${claimed === 1 ? "was" : "were"} ${unanswered ? "not answered" : "answered"}, but the saved answers show ${actual}`;
}

/** Checks summary content against the saved answers. Generated content ("draft"): invalid items are dropped and listed,
    and any count of answered or unanswered questions is removed (counts come only from the saved answers). A
    recruiter's content ("review"): any problem, including a count that contradicts the saved answers, is returned and
    nothing is saved. Quotes must be word for word from the source they name; nothing may describe personal
    characteristics. */
export function checkSummary(raw: unknown, set: ScreeningSet, save: AnswerSave, followUps: FollowUp[], mode: "draft" | "review" = "draft"): { content: SummaryContent; problems: string[] } {
  const problems: string[] = [], c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>, totals = answerTotals(set, save, followUps);
  const text = (x: unknown, max = 300) => (typeof x === "string" && x.trim() && x.length <= max ? x.trim() : null);
  const personal = (t: string, where: string) => { if (NOT_ASSESSED.test(t)) { problems.push(`${where} describes a personal characteristic, which is never assessed`); return true; } return false; };
  const counted = (t: string, where: string) => {
    if (mode === "draft") { if (COUNT_CLAIM.test(t)) { problems.push(`${where} states a count of answered or unanswered questions; counts are shown from the saved answers`); return true; } return false; }
    const p = countClaimProblem(t, totals); if (p) { problems.push(`${where} ${p}`); return true; } return false;
  };
  const fkeys = followUps.map((f, i) => followUpKey(i, f.text));
  /** The source a quote must come from: one core question's answers, or one follow-up's answer. */
  const sourceOk = (item: Record<string, unknown>, where: string, required: boolean) => {
    const { questionId: qid, followUp: fk, quote } = item;
    if (fk !== undefined && fk !== "") {
      const i = fkeys.indexOf(String(fk));
      if (i < 0) { problems.push(`${where} must name a core question or one of this candidate's follow-ups`); return false; }
      const answer = save.followUps[String(fk)]?.answer ?? "";
      if (!answer.trim()) { problems.push(`${where}: follow-up ${i + 1} was not answered, so nothing can be quoted from it`); return false; }
      if (!quote && !required) return true;
      if (typeof quote !== "string" || !quotedFrom(quote, [answer])) { problems.push(`${where}: the quote is not word for word in the answer to follow-up ${i + 1}`); return false; }
      return true;
    }
    const q = set.questions.find((x) => x.id === qid);
    if (!q) { if (required || quote) problems.push(`${where} must name a core question or one of this candidate's follow-ups`); return !required && !quote; }
    const sources = answerSources(q.id, save, followUps);
    if (!sources.length) { problems.push(`${where}: ${q.id} was not answered, so nothing can be quoted from it`); return false; }
    if (!quote && !required) return true;
    if (typeof quote !== "string" || !quotedFrom(quote, sources)) { problems.push(`${where}: the quote is not word for word in the answer to ${q.id}`); return false; }
    return true;
  };
  const ref = (x: Record<string, unknown>) => (x.followUp ? { followUp: String(x.followUp) } : x.questionId ? { questionId: String(x.questionId) } : {});
  const clean = (q: unknown) => String(q).replace(/\s+/g, " ").trim();
  const strengths: SummaryContent["strengths"] = [];
  for (const [i, s] of (Array.isArray(c.strengths) ? c.strengths : []).entries()) {
    const t = text(s?.text), where = `strength ${i + 1}`;
    if (!t) { problems.push(`${where} has no text`); continue; }
    if (personal(t, where) || counted(t, where) || !sourceOk(s, where, true)) continue;
    strengths.push({ text: t, quote: clean(s.quote), ...ref(s) });
  }
  const concerns: SummaryContent["concerns"] = [];
  for (const [i, s] of (Array.isArray(c.concerns) ? c.concerns : []).entries()) {
    const t = text(s?.text), where = `concern ${i + 1}`;
    if (!t) { problems.push(`${where} has no text`); continue; }
    if (personal(t, where) || counted(t, where) || !sourceOk(s, where, false)) continue;
    concerns.push({ text: t, ...(s.quote ? { quote: clean(s.quote) } : {}), ...ref(s) });
  }
  const cm = (c.communication ?? {}) as Record<string, unknown>, ct = text(cm.text, 400);
  let communication: SummaryContent["communication"] = { text: "" };
  if (!ct) problems.push("the communication note has no text");
  else if (!personal(ct, "the communication note") && !counted(ct, "the communication note") && sourceOk(cm, "the communication note", false))
    communication = { text: ct, ...(cm.quote ? { quote: clean(cm.quote), ...ref(cm) } : {}) };
  let summary: string[] = [];
  const raws = Array.isArray(c.summary) ? c.summary.map((x) => text(x, 220)) : [];
  if (raws.length < 4 || raws.length > 5 || raws.some((x) => !x)) problems.push("the summary must be four or five short lines");
  else {
    /* A generated draft loses only the lines that state counts; a recruiter's summary with a wrong count is refused. */
    const kept = (raws as string[]).filter((l, i) => !personal(l, `summary line ${i + 1}`) && !counted(l, `summary line ${i + 1}`));
    if (mode === "draft" ? kept.length === raws.length || kept.length >= 3 : kept.length === raws.length) summary = kept;
  }
  return { content: { strengths, concerns, communication, summary }, problems };
}

/** The summariser's instructions and input: only the saved answers and the current ratings, question by question. */
export function summaryPrompt(set: ScreeningSet, rec: ScreeningRecord, followUps: FollowUp[]) {
  const st = currentScreening(rec), save = st.answers!;
  const questions = set.questions.map((q) => ({ questionId: q.id, question: q.text, use: q.use, answerPoints: q.answerPoints, answers: answerSources(q.id, save, followUps),
    rating: q.use === "scored" ? st.ratingOf(q.id).rating : null }));
  const system = ["You write a short draft summary of a screening call for a recruiter to review. It is a draft, not a decision, and not a score.",
    "Use only the answers given here. Never invent or assume an answer. A question with no answers is not a failure: do not mention it as a weakness.",
    "Strengths: each with one quote copied word for word from one answer, naming its source: questionId for a core question, or followUp (the reference given) for a follow-up answer.",
    "Concerns: thin answers or open gaps, with a word-for-word quote where there is one.",
    "Communication: only whether the candidate answered the questions asked and explained their actions and results.",
    set.neverAssess,
    "Summary: four or five short plain-English lines: who the candidate is, what was strong, what is a risk, what to check next.",
    "Do not state how many questions were or were not answered: those counts are shown separately from the saved answers."].join("\n");
  /* Every saved follow-up answer, linked to a core question or not, with its stable reference. */
  const fups = followUps.map((f, i) => ({ followUp: followUpKey(i, f.text), question: f.text, answer: save.followUps[followUpKey(i, f.text)]?.answer ?? "", addsDetailTo: f.coreIds })).filter((f) => f.answer.trim());
  const user = JSON.stringify({ questions, followUps: fups });
  const item = (required: string[]) => ({ type: "object", additionalProperties: false, required, properties: { text: { type: "string" }, quote: { type: "string" }, questionId: { type: "string" }, followUp: { type: "string" } } });
  const schema = { type: "object", additionalProperties: false, required: ["strengths", "concerns", "communication", "summary"], properties: {
    strengths: { type: "array", items: item(["text", "quote"]) }, concerns: { type: "array", items: item(["text"]) }, communication: item(["text"]),
    summary: { type: "array", minItems: 4, maxItems: 5, items: { type: "string" } } } };
  return { system, user, schema };
}

/* ---- W4: CV claims against the saved screening evidence ------------------------------------------------------- */
/* Proposed differences between what the CV assessment records and what the candidate said in the call. Each names one
   requirement from the assessment rules, its current CV state, the CV quote (one of that requirement's recorded evidence
   quotes, with its page; or none when the CV does not state it), a word-for-word quote from one answered question or
   follow-up, and a short explanation. A "correction" proposes a valid new state under the rules; a "conflict" proposes
   none (the evidence is unclear). Nothing changes until a recruiter accepts or dismisses each one with a reason; an
   accepted correction becomes an ordinary CV correction (source "screening call"), so the existing calculator rescores
   it and the existing safeguards mark the client summary out of date. An unanswered question is never evidence. */

export interface CvRequirement { id: string; kind: "gate" | "criterion"; max?: number; unavailable?: number[]; evidence: { quote: string; page: number }[]; state: InputState }
export interface ClaimItem {
  id: string; requirementId: string; cvState: InputState; cvQuote: string | null; cvPage: number | null;
  callQuote: string; callSource: { questionId?: string; followUp?: string }; explanation: string;
  proposal: { type: "correction"; next: InputState } | { type: "conflict" };
}
export interface ClaimReview { kind: "claimReview"; revision: number; at: string; route: string; isAi: boolean; answersRevision: number; items: ClaimItem[]; dropped: string[]; output?: unknown }
export interface ClaimDecision { kind: "claimDecision"; revision: number; at: string; reviewer: string; claimReviewRevision: number; itemId: string; decision: "accepted" | "dismissed"; reason: string; correctionVersion: number | null }

/** The CV assessment's requirements as they stand now (after any recruiter corrections), with their recorded evidence. */
export function cvRequirements(config: Pick<LoadedConfig, "gates" | "criteria">, record: Pick<AssessmentRecord, "gates" | "criteria">, latest: { gates: { id: string; result: "Pass" | "Fail" | "Unknown" }[]; inputs: { id: string; status: string; rating?: number }[] }): CvRequirement[] {
  return [
    ...config.gates.map((g) => ({ id: g.id, kind: "gate" as const, evidence: (record.gates.find((x) => x.id === g.id)?.evidence ?? []).map((e) => ({ quote: e.quote, page: e.page })),
      state: { status: "gate" as const, result: latest.gates.find((x) => x.id === g.id)?.result ?? "Unknown" } })),
    ...config.criteria.filter((c) => c.included).map((c) => { const i = latest.inputs.find((x) => x.id === c.id);
      return { id: c.id, kind: "criterion" as const, max: c.max, unavailable: c.unavailableLevels ?? [], evidence: (record.criteria.find((x) => x.id === c.id)?.evidence ?? []).map((e) => ({ quote: e.quote, page: e.page })),
        state: (i?.status === "rated" ? { status: "rated", rating: i.rating! } : { status: i?.status === "disputed" ? "disputed" : "unknown" }) as InputState }; }),
  ];
}
const sameState = (a: InputState, b: InputState) => JSON.stringify(a) === JSON.stringify(b);
/** Whether a proposed skill value would raise the CV-only score: a higher rating, or an unconfirmed (or conflicting) skill
    becoming rated. Call evidence never does this: it stays with the screening. Essential requirements are not affected. */
export const raisesSkill = (r: Pick<CvRequirement, "kind">, current: InputState, next: InputState) =>
  r.kind === "criterion" && next.status === "rated" && (current.status !== "rated" || next.rating > current.rating);
export const UPWARD = "call evidence cannot raise a CV skill rating or make an unconfirmed skill rated; it stays with the screening answers";
export const CV_QUOTE_NEEDED = "the CV records evidence for this requirement, so the proposal must cite one of its exact quotes";
/** Whether a proposed state is valid for this requirement under the rules (not a conflict state: that is a conflict). */
function validNext(r: CvRequirement, next: unknown): next is InputState {
  const n = next as Record<string, unknown>;
  if (!n || typeof n !== "object") return false;
  if (r.kind === "gate") return n.status === "gate" && ["Pass", "Fail", "Unknown"].includes(String(n.result));
  if (n.status === "unknown") return true;
  return n.status === "rated" && Number.isInteger(n.rating) && (n.rating as number) >= 0 && (n.rating as number) <= (r.max ?? 3) && !(r.unavailable ?? []).includes(n.rating as number);
}

/** Checks proposed differences: the requirement, the CV quote and page from the record, a word-for-word quote from one
    answered question or follow-up, a short explanation, and a valid new state (correction) or none (conflict). Invalid
    items are dropped and listed, never repaired. */
export function checkClaims(raw: unknown, set: ScreeningSet, save: AnswerSave, followUps: FollowUp[], reqs: CvRequirement[]): { items: ClaimItem[]; dropped: string[] } {
  const dropped: string[] = [], items: ClaimItem[] = [], fkeys = followUps.map((f, i) => followUpKey(i, f.text));
  const list = raw && typeof raw === "object" && Array.isArray((raw as { claims?: unknown }).claims) ? (raw as { claims: Record<string, unknown>[] }).claims : null;
  if (!list) return { items, dropped: ["the proposal is not in the expected format"] };
  for (const [i, c] of list.entries()) {
    const where = `proposal ${i + 1}`, r = reqs.find((x) => x.id === c?.requirementId);
    if (!r) { dropped.push(`${where} does not name a requirement in these rules`); continue; }
    /* The call evidence: one answered question or follow-up, quoted word for word. */
    const fk = c.followUp ? String(c.followUp) : null, q = c.questionId ? set.questions.find((x) => x.id === c.questionId) : null;
    const sources = fk ? (fkeys.includes(fk) && save.followUps[fk]?.answer?.trim() ? [save.followUps[fk].answer] : []) : q ? answerSources(q.id, save, followUps) : [];
    if (!fk && !q) { dropped.push(`${where} does not name a core question or follow-up`); continue; }
    if (!sources.length) { dropped.push(`${where}: the question it cites was not answered, so it is not evidence`); continue; }
    if (typeof c.callQuote !== "string" || !quotedFrom(c.callQuote, sources)) { dropped.push(`${where}: the call quote is not word for word in the answer it cites`); continue; }
    /* The CV claim: one of the requirement's recorded evidence quotes (its page comes from the record), or none. */
    const cvq = c.cvQuote ? r.evidence.find((e) => e.quote.replace(/\s+/g, " ").trim() === String(c.cvQuote).replace(/\s+/g, " ").trim()) : null;
    if (c.cvQuote && !cvq) { dropped.push(`${where}: the CV quote is not one of this requirement's recorded quotes`); continue; }
    /* An omitted quote is not absent evidence: where the CV records evidence, the proposal must cite it. */
    if (!c.cvQuote && r.evidence.length) { dropped.push(`${where}: ${CV_QUOTE_NEEDED}`); continue; }
    const ex = typeof c.explanation === "string" && c.explanation.trim() && c.explanation.length <= 300 ? c.explanation.trim() : null;
    if (!ex) { dropped.push(`${where} needs a short explanation`); continue; }
    if (NOT_ASSESSED.test(ex)) { dropped.push(`${where} describes a personal characteristic, which is never assessed`); continue; }
    let proposal: ClaimItem["proposal"];
    if (c.type === "conflict") proposal = { type: "conflict" };
    else if (c.type === "correction") {
      if (!validNext(r, c.next)) { dropped.push(`${where}: the proposed value is not valid for this requirement under the rules`); continue; }
      if (sameState(c.next as InputState, r.state)) { dropped.push(`${where}: the proposed value is the same as the CV assessment's`); continue; }
      if (raisesSkill(r, r.state, c.next as InputState)) { dropped.push(`${where}: ${UPWARD}`); continue; }
      proposal = { type: "correction", next: c.next as InputState };
    } else { dropped.push(`${where} must be a correction or a conflict`); continue; }
    items.push({ id: `C${items.length + 1}`, requirementId: r.id, cvState: r.state, cvQuote: cvq?.quote ?? null, cvPage: cvq?.page ?? null,
      callQuote: String(c.callQuote).replace(/\s+/g, " ").trim(), callSource: fk ? { followUp: fk } : { questionId: q!.id }, explanation: ex, proposal });
  }
  return { items, dropped };
}

/** The current CV-claim review (latest), its items, and each item's decision. */
export function currentClaims(rec: ScreeningRecord | null | undefined) {
  const entries = rec?.entries ?? [];
  const review = [...entries].reverse().find((e): e is ClaimReview => e.kind === "claimReview") ?? null;
  const decisions = entries.filter((e): e is ClaimDecision => e.kind === "claimDecision");
  const decisionOf = (r: ClaimReview, itemId: string) => decisions.find((d) => d.claimReviewRevision === r.revision && d.itemId === itemId) ?? null;
  return { review, decisions, decisionOf };
}

/** The instructions and input for proposing CV-claim differences: the CV assessment's requirements, their states and
    recorded quotes, and the saved answers (core questions and follow-ups). */
export function claimsPrompt(set: ScreeningSet, save: AnswerSave, followUps: FollowUp[], reqs: CvRequirement[], labels: Map<string, string>, rules: Record<string, unknown>) {
  const system = ["You compare a CV assessment with what the candidate said in a screening call, for a recruiter to review. Nothing you propose changes anything by itself.",
    "Use only the answers given. A question with no answer is not evidence, not a contradiction and not a zero.",
    "For each difference, name the requirement, quote the CV evidence exactly (or give none if the CV does not state it), quote the answer word for word and name its source (questionId, or followUp with the reference given), and explain briefly in plain English.",
    "Propose a correction only when the answer clearly supports a value that the assessment rules allow. When the evidence is unclear or points both ways, propose a conflict with no value.",
    set.neverAssess].join("\n");
  const user = JSON.stringify({ rules, requirements: reqs.map((r) => ({ requirementId: r.id, name: labels.get(r.id) ?? r.id, kind: r.kind, current: r.state, cvQuotes: r.evidence })),
    answers: set.questions.map((q) => ({ questionId: q.id, question: q.text, answers: answerSources(q.id, save, followUps) })).filter((x) => x.answers.length),
    followUps: followUps.map((f, i) => ({ followUp: followUpKey(i, f.text), question: f.text, answer: save.followUps[followUpKey(i, f.text)]?.answer ?? "" })).filter((f) => f.answer.trim()) });
  const state = { type: "object", properties: { status: { type: "string" }, result: { type: "string" }, rating: { type: "integer" } }, required: ["status"] };
  const schema = { type: "object", additionalProperties: false, required: ["claims"], properties: { claims: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["requirementId", "type", "callQuote", "explanation"], properties: { requirementId: { type: "string" }, type: { type: "string", enum: ["correction", "conflict"] }, next: state,
      cvQuote: { type: "string" }, callQuote: { type: "string" }, questionId: { type: "string" }, followUp: { type: "string" }, explanation: { type: "string" } } } } } };
  return { system, user, schema };
}
