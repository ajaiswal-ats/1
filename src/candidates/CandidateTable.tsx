import { useData } from "../data/DataProvider";
import { TODAY, type Submission } from "../data/fixtures";
import { interviewLabel, nextStep, otherSubmissions, requirementLine, roleOf, waitingOnYou } from "../domain/candidates";
import { fd } from "../lib/dates";
import { stageColor } from "../progress/shared";

const NEXT_CHIP = { you: "c-warn", sched: "c-info", done: "c-ok", ro: "c-mute" } as const;

/* List view (2h list()). On a role page the Role column is left out and the table sits inside its section (noRole). */
export function CandidateTable({ list, noRole = false }: { list: Submission[]; noRole?: boolean }) {
  const data = useData();
  return (
    <div className={noRole ? "ltab-wrap" : "card ltab-wrap"}>
      <table className="ltab">
        <thead><tr><th>Candidate</th>{!noRole && <th>Role</th>}<th>Stage</th><th>Next step</th><th>Requirements</th><th>Interview</th><th>Shared</th></tr></thead>
        <tbody>
          {list.length ? list.map((c) => {
            const t = nextStep(c, TODAY), [ic, it] = interviewLabel(c), role = roleOf(data, c), others = otherSubmissions(data, c);
            return (
              <tr key={c.id} className={waitingOnYou(c) ? "you" : ""}>
                <td><a className="nm" href={`#c-${c.id}`}>{c.name}</a><div className="xs muted">{c.head}</div></td>
                {!noRole && <td>{role.title}{others.length > 0 && <div className="alsoline">{`Same person · also for ${others.map((x) => roleOf(data, x).title).join(", ")}`}</div>}</td>}
                <td><span className="chip c-stage"><i className="sw" style={{ background: stageColor(c.stage) }} />{c.stage}</span></td>
                <td><span className={`chip ${NEXT_CHIP[t.cls]}`}>{t.short}</span></td>
                <td className="small">{requirementLine(c, role)}</td>
                <td><span className={`chip ${ic}`}>{it}</span></td>
                <td className="small num">{fd(c.shared)}</td>
              </tr>
            );
          }) : <tr><td colSpan={noRole ? 6 : 7} className="muted">No candidates match this filter.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
