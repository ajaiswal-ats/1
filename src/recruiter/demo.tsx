import { createRoot } from "react-dom/client";
import { useState } from "react";
import "../portalStyles";
import "./recruiter.css";
import { recruiterFixture } from "./fictional";
import { RecruiterWorkspace } from "./RecruiterApp";
import { calculateCv } from "../scoring/calculator";
import { shareProblems, type Gateway } from "./data";

function fictionalGateway(): Gateway {
  let a = recruiterFixture();
  return {
    async account() { return { userId: "fictional-local-reviewer", displayName: "Fictional recruiter" }; },
    async list() { return [{ id: a.id, candidate: a.candidate, client: a.client, role: a.role, revision: a.revision, reviewed: a.reviewed, published: a.published, updatedAt: new Date().toISOString() }]; },
    async get(id) { if (id !== a.id) throw new Error("This fictional assessment does not exist."); return structuredClone(a); },
    async save(before, inputs, review, reason) {
      if (before.revision !== a.revision) throw new Error("The preview changed; reload before saving.");
      if (reason.trim().length < 10 || review.decisionReason.trim().length < 10) throw new Error("Write a reason for the review and decision (at least 10 characters each).");
      if (calculateCv(a.rubric, inputs.gates, inputs.criteria).status === "invalid") throw new Error("The scoring inputs are invalid.");
      for (const item of [...inputs.gates, ...inputs.criteria]) {
        const previous = [...a.inputs.gates, ...a.inputs.criteria].find((x) => x.id === item.id);
        if (JSON.stringify(item) !== JSON.stringify(previous)) {
          const c = review.changes.find((x) => x.id === item.id);
          if (!c || c.evidence.trim().length < 5 || c.reason.trim().length < 5) throw new Error("Each correction needs evidence and a reason.");
        }
      }
      for (const answer of review.screening) if (answer.rating !== null && (!answer.quote.trim() || !answer.answer.includes(answer.quote) || !answer.reason.trim())) throw new Error("A screening rating needs an exact answer quote and a reason.");
      a = { ...a, inputs: structuredClone(inputs), review: structuredClone(review), revision: a.revision + 1, reviewed: true, published: false,
        history: [{ revision: a.revision + 1, kind: "review", reviewer: "Fictional recruiter", reason, at: new Date().toISOString(), changes: structuredClone(review.changes) }, ...a.history] };
    },
    async share() { throw new Error(shareProblems(a).join(" ") || "Sharing is disabled in this local fictional preview."); },
  };
}
function Preview() {
  const [gateway] = useState(fictionalGateway), [open, setOpen] = useState(true);
  return <><div className="rec-preview-note" role="status">Local fictional preview · changes exist only in this tab and disappear on reload · no database connection, AI call or client sharing.</div>{open
    ? <RecruiterWorkspace gateway={gateway} name="Fictional recruiter" signOut={() => setOpen(false)} />
    : <main className="auth rec-auth"><section className="card rec-section"><h1>Preview closed</h1><button className="btn btn-p" onClick={() => setOpen(true)}>Return to fictional workspace</button></section></main>}</>;
}
if (!import.meta.env.DEV) throw new Error("The fictional preview is development-only.");
createRoot(document.getElementById("root")!).render(<Preview />);
