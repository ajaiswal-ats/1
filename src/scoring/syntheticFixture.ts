/* Synthetic, fictional run inputs for tests only (never imported by the app). No real role, client or candidate. */
import { assessmentFingerprint, gatesOf, inputsOf, INPUT_SCHEMA, stateSha, type Hash, type RunInput } from "./run";
import type { Criterion, ScoringConfig } from "./types";

const crit = (id: string, label: string, importance: Criterion["importance"], weight: number, extra: Partial<Criterion> = {}): Criterion =>
  ({ id, label, importance, weight, max: 3, included: true, anchors: { "1": "one", "2": "two", "3": "three" }, ...extra });

export const syntheticRubric = (version = 1): ScoringConfig => ({
  id: "synthetic-rubric", version, status: "Synthetic", approved: false, frozenAt: "2026-01-01T00:00:00Z",
  role: { id: "role-syn", title: "Synthetic Test Role", client: "Fictional client", loc: "Nowhere", summary: "Synthetic summary.", roleSetupVersion: "synthetic draft", resp: ["Do synthetic things."] },
  gates: [{ id: "G1", label: "Synthetic licence" }, { id: "G2", label: "Synthetic lifting" }], gateExceptions: [],
  criteria: [crit("C1", "Winning synthetic deals", "Critical", 3), crit("C2", "Synthetic margins", "Critical", 3), crit("I1", "Synthetic reporting", "Important", 2),
    crit("N1", "Synthetic extra", "Nice to have", 1, { included: false, exclusionReason: "Synthetic exclusion" })],
  constraints: [{ id: "P1", label: "Location", detail: "Synthetic" }],
  policy: {
    unknown: "exclude", minOverallCoverage: [1, 2], minCriticalCoverage: [1, 2], coverageInclusive: true, cap: { value: 64, triggers: ["zero", "unknown"] },
    rounding: "half-up", capBeforeRounding: true, bandFrom: "rounded", disputed: "no-score",
    bands: [{ min: 80, label: "Strong" }, { min: 65, label: "Good" }, { min: 50, label: "Borderline" }, { min: 0, label: "Weak" }],
    screening: { scaleMin: 1, scaleMax: 5, minCoverage: [3, 4] }, combination: "none",
  },
  testChoices: [],
});

/** Sentinel strings standing in for a candidate's name and contact details: they must never appear in errors or logs. */
export const SENTINELS = { name: "Zqxvname Sentinelperson", email: "zq.sentinel@example.invalid", phone: "+1 555 010 9999" };
/** The extracted text file's content: two pages, with the sentinel identity on page 1. */
export const SYNTHETIC_TEXT = `=== PAGE 1 of 2 ===\n${SENTINELS.name} · ${SENTINELS.email} · ${SENTINELS.phone}\nPage one says Synthetic quote alpha,\nwrapped across lines.\n=== PAGE 2 of 2 ===\nPage two says Synthetic quote beta here, led by ${SENTINELS.name}.\n`;
export const SYNTHETIC_FILES = { cv: "synthetic-cv.pdf", jd: "synthetic-jd.pdf", req: "synthetic-requirements.md", text: "prototype/extracted/syn-a.txt" };

/** A complete, valid run input for one synthetic candidate. `shas` gives each bound file's fingerprint. */
export function syntheticInput(shas: { cv: string; jd: string; req: string; text: string; rubric: string }, hash: Hash, id = "syn-a"): RunInput {
  const input: RunInput = {
    schema: INPUT_SCHEMA, assessmentId: id, submissionId: id,
    role: { id: "role-syn", title: "Synthetic Test Role", loc: "Nowhere", summary: "Synthetic summary.", resp: ["Do synthetic things."] },
    sources: {
      cv: { file: SYNTHETIC_FILES.cv, sha256: shas.cv, recorded: { when: "2026-01-01T00:00:00Z", basis: "Synthetic: recorded before preparation." } },
      jd: { file: SYNTHETIC_FILES.jd, sha256: shas.jd, recorded: { when: "2026-01-01", basis: "Synthetic: dated record, no time of day." } },
      roleRequirements: { file: SYNTHETIC_FILES.req, sha256: shas.req, version: "synthetic draft", recorded: { when: "2026-01-05T00:00:00Z", basis: "Synthetic: first recorded after preparation." } },
      extraction: { file: SYNTHETIC_FILES.text, sha256: shas.text, recorded: { when: "unknown", basis: "Synthetic: no record." }, method: "synthetic", tool: "synthetic tool", toolVersion: "unknown",
        extractedAt: "2026-01-02T00:00:00Z", extractedAtBasis: "Synthetic.", accuracy: "unverified", note: "Synthetic." },
    },
    rubric: { id: "synthetic-rubric", version: 1, sha256: shas.rubric },
    assessment: {
      gates: [{ id: "G1", result: "Unknown", basis: "explicit", evidence: [], explanation: "Not stated." },
        { id: "G2", result: "Pass", basis: "explicit", evidence: [{ quote: "Synthetic quote alpha, wrapped", page: 1 }], explanation: "Synthetic." }],
      criteria: [
        { id: "C1", status: "rated", rating: 3, basis: "explicit", detail: "Full", evidence: [{ quote: "Synthetic quote beta", page: 2 }], explanation: "Synthetic." },
        { id: "C2", status: "rated", rating: 2, basis: "explicit", detail: "Brief", evidence: [{ quote: "Synthetic quote alpha", page: 1 }], explanation: "Synthetic." },
        { id: "I1", status: "unknown", basis: "explicit", detail: null, evidence: [], explanation: "Not stated." },
      ],
      otherResults: [], constraints: [], strengths: ["S"], gaps: ["G"], questions: [{ q: "Synthetic question?", for: "C1" }], manualReview: [], screening: null, consistencyRules: [],
    },
    preparation: { method: "assistant-prepared", actor: "Synthetic preparer", at: "2026-01-03T00:00:00Z", atBasis: "Synthetic." },
    provenanceNotes: ["Synthetic note."],
    clientView: {
      revision: 1, describes: { assessmentFingerprint: "", assessmentVersion: 1, stateSha256: "", rubric: { id: "synthetic-rubric", version: 1, sha256: shas.rubric } },
      content: { summary: "Synthetic summary of the candidate.", strengths: [{ text: "Synthetic strength.", evidence: [{ quote: "Synthetic quote beta", page: 2 }] }], gaps: ["Synthetic gap."],
        statuses: { G1: { status: "separate" }, G2: { status: "needs-review" }, C1: { status: "needs-review" }, C2: { status: "claimed" }, I1: { status: "not-stated" } } },
      statusRule: "Synthetic rule.", preparation: { method: "assistant-prepared", actor: "Synthetic preparer", at: "2026-01-03T00:00:00Z" },
    },
  };
  return bindClientView(input, hash);
}

/** Points the input's client view at its own version-1 state (as the migration does). */
export function bindClientView(input: RunInput, hash: Hash): RunInput {
  const fp = assessmentFingerprint(input, hash);
  return { ...input, clientView: { ...input.clientView, describes: { assessmentFingerprint: fp, assessmentVersion: 1, stateSha256: stateSha(fp, 1, inputsOf(input), gatesOf(input), hash), rubric: input.rubric } } };
}
