import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CandidateActivity } from "./CandidateActivity";

describe("candidate activity", () => {
  it("shows feedback once beneath its linked event without claiming delivery", () => {
    const h = renderToStaticMarkup(<CandidateActivity entries={[{ id: "e1", date: "2026-10-12", title: "You shared interview feedback", notes: [{ id: "n1", label: "Interview feedback", text: "Useful example of coaching.", author: "You", date: "2026-10-12", about: "First interview" }] }]} />);
    expect(h.match(/Useful example of coaching\./g)).toHaveLength(1);
    expect(h).toContain("Notes and feedback");
    expect(h).toContain("Visible to authorised users at your company");
    expect(h).toContain("Not shared with the candidate");
    expect(h).toContain("12 Oct 2026");
    expect(h).not.toContain("notified");
    expect(h).not.toContain("<details");
  });
  it("shows an honest empty state and only offers an action when supplied", () => {
    const render = (onFeedback?: () => void) => renderToStaticMarkup(<CandidateActivity entries={[]} onFeedback={onFeedback} />);
    expect(render()).toContain("No history is available for this candidate.");
    expect(render()).not.toContain("<button");
    expect(render(() => {})).toContain("Add interview feedback");
  });
});
