/* W7: the blank review sheet (synthetic, fictional data only). */
import { describe, expect, it } from "vitest";
import { allowedLevels, blankSheet, DECLARATION, INSTRUCTIONS, SHEET_COLUMNS, type SheetMeta } from "./evaluationPack";
import { syntheticRubric } from "./syntheticFixture";
import type { ScoringConfig } from "./types";

const rubric = (): ScoringConfig => {
  const r = syntheticRubric();
  r.gates[0].testRule = "TEST THRESHOLD: Pass on an explicit statement.";
  r.criteria[1] = { ...r.criteria[1], anchors: { "1": "one", "2": "NOT AVAILABLE in this configuration", "3": "three" }, unavailableLevels: [0, 2] };
  r.criteria[0] = { ...r.criteria[0], recency: true, duration: true };
  r.policy = { ...r.policy, recencyYears: 5, durationYears: 2, referenceDate: "2026-01-01" };
  r.testChoices = [{ id: "T9", choice: "C2 level 2 is unavailable.", specStatus: "Left undecided" }, { id: "T10", choice: "Recency 5 years and duration 2 years.", specStatus: "Proposed in T02" }];
  return r;
};
const meta: SheetMeta = { candidate: "Candidate X", reviewerSlot: "Reviewer 1", cv: { file: "synthetic-cv.pdf", sha256: "c".repeat(64) }, jd: { file: "synthetic-jd.pdf", sha256: "j".repeat(64) },
  roleRequirementsVersion: "synthetic draft", rulesSha256: "r".repeat(64), screeningAnswers: false, generatedAt: "2026-01-01T00:00:00Z" };
const rows = (csv: string) => csv.replace(/^﻿/, "").split("\r\n");
const row = (csv: string, id: string) => rows(csv).find((l) => l.split(",")[1] === id) ?? "";

describe("W7 blank review sheet", () => {
  it("binds the sheet to the rules version, rules fingerprint, JD and CV, and leaves every answer blank", () => {
    const csv = blankSheet(rubric(), meta);
    expect(csv).toContain("Assessment rules,synthetic-rubric version 1 · Synthetic");
    expect(csv).toContain(`Rules fingerprint (SHA-256),${"r".repeat(64)}`);
    expect(csv).toContain(`Job description,synthetic-jd.pdf · SHA-256 ${"j".repeat(64)}`);
    expect(csv).toContain("Reviewer name,\r\n");
    expect(csv).toContain(DECLARATION);
    expect(csv).toContain(`Step 1,"${INSTRUCTIONS[0].replace(/"/g, '""')}"`);
    expect(csv).toContain("Step 5,Write anything unclear or missing in 'Unanswered point'. Do not guess.");
    const at = rows(csv).findIndex((l) => l.startsWith(`${SHEET_COLUMNS[0]},${SHEET_COLUMNS[1]},`));
    expect(rows(csv)[at]).toContain(`"${SHEET_COLUMNS[10]}"`); // a column name with a comma is quoted
    const body = rows(csv).slice(at + 1).filter(Boolean);
    expect(body).toHaveLength(2 + 4 + 5); // two essentials, four criteria (one excluded), five free rows
    for (const l of body) expect(l.endsWith(",,,,,")).toBe(true); // answer, quote, page, point and note are empty
  });
  it("says CV only when no screening answers are recorded, and never asks for a combined recommendation", () => {
    expect(blankSheet(rubric(), meta)).toContain("The CV only: no screening answers are recorded for this candidate.");
    expect(blankSheet(rubric(), meta)).toContain("Combined recommendation,Awaiting agreed rules: do not record one.");
  });
  it("marks unapproved rules, test choices and undefined levels on the row they affect", () => {
    const csv = blankSheet(rubric(), meta);
    expect(row(csv, "G1")).toContain("Draft rules, not approved; uses a test choice that is not agreed");
    expect(row(csv, "C2")).toContain("uses a test choice that is not agreed: T9 (left undecided); level 2 undefined, so it cannot be chosen");
    expect(row(csv, "C2")).toContain("1 / 3 / Not confirmed / Conflicting");
    expect(row(csv, "N1")).toMatch(/^Not rated,N1,.*Excluded from these rules: Synthetic exclusion,Leave blank/);
    expect(row(csv, "C1")).toContain("uses a test choice that is not agreed: T10 (proposed in T02)");
    expect(row(csv, "C1")).toContain("Level 3 also needs the evidence within the last 5 years (to 2026-01-01) and lasting at least 2 years; otherwise rate 2");
    expect(row(csv, "I1")).not.toContain("T10");
    expect(allowedLevels(rubric().criteria[0])).toEqual([1, 2, 3]); // no level-0 anchor in the synthetic rubric
  });
  it("contains nothing from an assessment: only the rules and the source fingerprints", () => {
    const csv = blankSheet(rubric(), meta);
    expect(csv).not.toMatch(/\b(Strong|Borderline|Weak|coverage|capped)\b/); // no result, band or calculation
    expect(csv).not.toMatch(/quote alpha|quote beta|Sentinel/i); // no CV text
  });
});
