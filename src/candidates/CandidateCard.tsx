import { useData } from "../data/DataProvider";
import { TODAY, type Submission } from "../data/fixtures";
import { initials, interviewLabel, nextStep, otherSubmissions, requirementLine, roleOf } from "../domain/candidates";
import { CheckIcon, VideoIcon } from "../components/icons";

/* A pipeline card (2h card()). Opens the candidate's page for this role. */
export function CandidateCard({ c, showRole }: { c: Submission; showRole: boolean }) {
  const data = useData(), t = nextStep(c, TODAY), role = roleOf(data, c), [, iv] = interviewLabel(c), others = otherSubmissions(data, c);
  return (
    <a className={`ccard ${t.cls}`} href={`#c-${c.id}`}>
      <span className="av" aria-hidden="true">{initials(c.name)}</span>
      <div className="b">
        <div className="nm">{c.name}</div>
        <div className="hd">{c.head}</div>
        {showRole && <div className="rl">{role.title}</div>}
        {others.length > 0 && <div className="also2">{`Same person · also for ${others.map((x) => roleOf(data, x).title).join(", ")}`}</div>}
        <div className="meta"><span><CheckIcon />{requirementLine(c, role)}</span><span><VideoIcon />{iv}</span></div>
        <div className={`nextbar ${t.cls}`}><span>{t.short}</span></div>
      </div>
    </a>
  );
}
