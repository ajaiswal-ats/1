/* W7 evaluation pack: the blank review sheet each recruiter fills in independently for one candidate. It is built only from
   the frozen assessment rules and the bound source fingerprints, so both reviewers work from the same JD and the same rules
   version, and it never contains the AI's assessment, another reviewer's answers or any CV text. Unapproved and undefined
   rules are marked on the row they affect. The sheet is CSV (UTF-8 with a byte-order mark, so spreadsheet programs show
   the dashes correctly). Nothing here reads or changes a record. */
import type { ScoringConfig } from "./types";

export const SHEET_SCHEMA = "evaluation-sheet/1";
export const SHEET_COLUMNS = ["Section", "ID", "Requirement", "Importance", "Rule status", "Allowed answers", "What each answer means",
  "Your answer", "Supporting quote (exact words from the CV)", "Page", "Unanswered point (what is missing, or what you would ask)", "Reason or note"] as const;
export const ESSENTIAL_ANSWERS = ["Met", "Not met", "Not confirmed"];
export const NOT_CONFIRMED = "Not confirmed", CONFLICTING = "Conflicting";
export const DECLARATION = "I completed this sheet from the CV and the JD only, before seeing the AI's assessment or the other reviewer's answers.";
const OTHER_ROWS = 5;
/** Short instructions at the top of every sheet. */
export const INSTRUCTIONS = [
  "Work on your own. Use only the CV, the JD and the assessment rules on this sheet. Do not open the scoring tool or the other reviewer's sheet until you have finished.",
  "For each essential requirement, choose Met, Not met or Not confirmed, following the rule in 'What each answer means'.",
  "For each skill, choose a rating from 'Allowed answers', using the level descriptions.",
  "Copy the CV words that support each answer into 'Supporting quote', word for word, with the page number.",
  "Write anything unclear or missing in 'Unanswered point'. Do not guess.",
  "Never assess accent, speed of speech, appearance, personality or protected details.",
  "When you have finished, fill in your name, the date and the declaration (type Yes), and save the file.",
];

export interface SheetMeta {
  candidate: string;
  reviewerSlot: string;
  cv: { file: string; sha256: string };
  jd: { file: string; sha256: string };
  roleRequirementsVersion: string;
  rulesSha256: string;
  /** Whether real screening answers are recorded for this candidate. */
  screeningAnswers: boolean;
  generatedAt: string;
}

/** The ratings a reviewer may give a criterion: its levels minus those the rules leave unavailable or undefined. */
export function allowedLevels(c: ScoringConfig["criteria"][number]): number[] {
  return Array.from({ length: c.max + 1 }, (_, n) => n).filter((n) => {
    const a = c.anchors[String(n) as "0"];
    return a !== undefined && !(c.unavailableLevels ?? []).includes(n) && !/not defined|not available/i.test(a);
  });
}

/** What is unapproved or undefined about one requirement, in plain words. */
function ruleStatus(config: ScoringConfig, id: string, testRule = "", undefinedLevels: string[] = [], extra: string[] = []): string {
  const choices = (config.testChoices ?? []).filter((t) => new RegExp(`\\b${id}\\b`).test(t.choice)).map((t) => `${t.id} (${t.specStatus[0].toLowerCase()}${t.specStatus.slice(1)})`);
  const parts = [config.approved ? "Approved rules" : "Draft rules, not approved"], ids = [...new Set([...choices, ...extra])];
  if (/TEST (THRESHOLD|CHOICE)/.test(testRule) || ids.length) parts.push(`uses a test choice that is not agreed${ids.length ? `: ${ids.join("; ")}` : ""}`);
  if (undefinedLevels.length) parts.push(`level ${undefinedLevels.join(" and ")} undefined, so it cannot be chosen`);
  return parts.join("; ");
}

/** The test choice that sets the level-3 recency and duration thresholds, if the rules record one. */
const timingChoice = (config: ScoringConfig) => { const t = (config.testChoices ?? []).find((x) => /recency/i.test(x.choice)); return t ? `${t.id} (${t.specStatus[0].toLowerCase()}${t.specStatus.slice(1)})` : null; };

const cell = (v: string | number) => { const s = String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const line = (cells: (string | number)[]) => cells.map(cell).join(",");

/** The blank sheet for one candidate and one reviewer, as CSV text. */
export function blankSheet(config: ScoringConfig, meta: SheetMeta): string {
  const header: [string, string][] = [
    ["Sheet", `${SHEET_SCHEMA} · W7 evaluation pack`],
    ["Candidate", meta.candidate],
    ["Reviewer slot", meta.reviewerSlot],
    ["Reviewer name", ""],
    ["Date completed", ""],
    ["Declaration (type Yes)", ""],
    ["Declaration text", DECLARATION],
    ["Assessment rules", `${config.id} version ${config.version} · ${config.status}`],
    ["Rules fingerprint (SHA-256)", meta.rulesSha256],
    ["Job description", `${meta.jd.file} · SHA-256 ${meta.jd.sha256}`],
    ["Role requirements", meta.roleRequirementsVersion],
    ["CV", `${meta.cv.file} · SHA-256 ${meta.cv.sha256}`],
    ["What to assess", meta.screeningAnswers ? "The CV, and the recorded screening answers for this candidate." : "The CV only: no screening answers are recorded for this candidate."],
    ["Combined recommendation", "Awaiting agreed rules: do not record one."],
    ...INSTRUCTIONS.map((t, i): [string, string] => [`Step ${i + 1}`, t]),
    ["Answers", `Use only the answers listed in 'Allowed answers'. ${NOT_CONFIRMED} means the CV does not show it either way; it is never a zero or a fail. ${CONFLICTING} means the CV contradicts itself. In the rule text, Pass means Met and Unknown means Not confirmed.`],
    ["Generated", meta.generatedAt],
  ];
  const rows: string[][] = [];
  for (const g of config.gates) rows.push(["Essential requirement", g.id, g.label, "Essential", ruleStatus(config, g.id, g.testRule), ESSENTIAL_ANSWERS.join(" / "), g.testRule ?? "", "", "", "", "", ""]);
  for (const c of config.criteria) {
    const undefinedLevels = Object.entries(c.anchors).filter(([n, a]) => a && (/not defined|not available/i.test(a) || (c.unavailableLevels ?? []).includes(Number(n)))).map(([n]) => n);
    const p = config.policy, needs = [c.recency && `within the last ${p.recencyYears} years (to ${p.referenceDate})`, c.duration && `lasting at least ${p.durationYears} years`].filter(Boolean);
    const timing = needs.length ? [`Level 3 also needs the evidence ${needs.join(" and ")}; otherwise rate 2`] : [];
    const guide = Object.entries(c.anchors).map(([n, a]) => `${n}: ${a}`).concat(timing, c.note ? [`Note: ${c.note}`] : [], c.testRule ? [`Rule: ${c.testRule}`] : []).join(" | ");
    rows.push(c.included
      ? ["Skill rating", c.id, c.label, c.importance, ruleStatus(config, c.id, c.testRule, undefinedLevels, needs.length && timingChoice(config) ? [timingChoice(config)!] : []), [...allowedLevels(c), NOT_CONFIRMED, CONFLICTING].join(" / "), guide, "", "", "", "", ""]
      : ["Not rated", c.id, c.label, c.importance, `Excluded from these rules: ${c.exclusionReason ?? "no reason recorded"}`, "Leave blank", guide, "", "", "", "", ""]);
  }
  for (let n = 1; n <= OTHER_ROWS; n++) rows.push(["Other unanswered point", `OTHER-${n}`, "", "", "", "Free text", "Anything else the CV leaves open for this role", "", "", "", "", ""]);
  return "﻿" + [...header.map(line), "", line([...SHEET_COLUMNS]), ...rows.map(line)].join("\r\n") + "\r\n";
}
