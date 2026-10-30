import { calculateCv, configProblems } from "../scoring/calculator";
import { gatesOf, inputsOf, type AssessmentRecord } from "../scoring/model";
import { buildVersions } from "../scoring/versions";
import { followUpsFor, screeningSetProblems, type ScreeningSet } from "../scoring/screening";
import type { ScoringConfig } from "../scoring/types";
import type { Inputs, Question } from "./data";

interface ImportSource { config: ScoringConfig; assessment: AssessmentRecord; screeningSet: ScreeningSet }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Owner-side preparation only. The result is a private SQL draft; importing never grants access or publishes content. */
export function prepareImport(source: ImportSource, clientId: string, submissionId: string) {
  if (!uuid.test(clientId) || !uuid.test(submissionId)) throw new Error("Explicit portal client and submission UUIDs are required. Candidates are never matched by name.");
  const { config, assessment: a, screeningSet: set } = source;
  if (!config || !a || a.configId !== config.id || a.configVersion !== config.version) throw new Error("The assessment must name exactly the supplied rubric version.");
  const problems = [...configProblems(config), ...screeningSetProblems(set, config)];
  const { versions, problems: corrections } = buildVersions(config, inputsOf(a), [...(a.builtInCorrections ?? []), ...(a.corrections ?? [])], gatesOf(a));
  problems.push(...corrections);
  const latest = versions[versions.length - 1];
  if (calculateCv(config, latest.gates, latest.inputs).status === "invalid") problems.push("Assessment inputs do not match the rubric.");
  if (a.status && !["valid", "provisional"].includes(a.status)) problems.push("The local assessment is blocked.");
  if (problems.length) throw new Error(`Cannot prepare import: ${problems.join("; ")}`);
  const evidence: Record<string, { quote: string; page: number }[]> = {};
  for (const item of [...a.gates, ...a.criteria]) {
    if (item.evidence.some((q) => q.verified === false)) throw new Error("An evidence quote has not been verified against its source.");
    evidence[item.id] = item.evidence.map(({ quote, page }) => ({ quote, page }));
  }
  const followUps = followUpsFor(a, set);
  const questions: Question[] = [...set.questions.map((q) => ({ id: q.id, text: q.text, use: q.use, answerPoints: q.answerPoints })),
    ...followUps.map((q, i) => ({ id: `follow-up-${i + 1}`, text: q.text, use: "confirms" as const, answerPoints: q.guide.flatMap((g) => g.points) }))];
  const inputs: Inputs = { gates: latest.gates, criteria: latest.inputs };
  return { client_id: clientId, submission_id: submissionId, rubric: config, original_inputs: inputs, inputs,
    evidence, screening_questions: questions, prepared_by: a.producedBy,
    source_record: { assessment: a, screeningSet: set, note: "Imported local baseline; earlier local versions are retained in this source record. Hosted recruiter review starts unreviewed." } };
}
