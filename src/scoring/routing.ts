import type { CvResult } from "./calculator";

/* Routing exactly as Akansha's starter specifies it, from the CV (resume) score alone, with the must-haves first:
   - "If a must-have fails, the candidate stops here, whatever the score." / "A Fail stops the candidate unless the client
     allows an exception."
   - "A candidate with 65 or more goes to screening. A candidate with 50 to 64 is screened only to check the gaps."
   - "Ask about any Unknown in the call."
   Nothing else is decided here: the starter gives no routing below 50 or without a score, no formula for turning 1-5
   screening ratings into a score out of 100, and no rule for combining the two scores. Those stay undecided.
   Akansha, 28 October 2026: "We can do separate scoring for now. We will look at combined scoring later—want to ensure we
   get the individual scores right." The CV and screening assessments are shown separately; combining them is deferred,
   not a blocker. */

export const SEPARATE = "The CV and screening assessments are scored separately. Combined scoring is deferred (Akansha, 28 October 2026): it is not needed to record a decision.";
export const SCREENING_SCORE_PENDING = "Overall screening score: not calculated yet. No agreed rule turns the 1–5 ratings into an overall score.";

export interface StarterRouting { text: string; specified: boolean; askInCall: string[] }

export function starterRouting(r: CvResult): StarterRouting {
  const askInCall = r.unknownGates;
  if (r.status === "stopped") return { specified: true, askInCall, text: "Stops here: an essential requirement is not met, whatever the score. A recruiter checks it; the client may allow an exception." };
  if (r.status !== "scored" || r.score === null) return { specified: false, askInCall, text: "No routing: there is no CV score, and the starter gives no routing without one. Missing information is not a zero; a recruiter decides the next step." };
  if (r.score >= 65) return { specified: true, askInCall, text: "Goes to screening (the starter: a CV score of 65 or more)." };
  if (r.score >= 50) return { specified: true, askInCall, text: "Screened only to check the gaps (the starter: a CV score of 50 to 64)." };
  return { specified: false, askInCall, text: "No routing: the starter does not say what happens below 50 (band: weak). A recruiter decides the next step." };
}
