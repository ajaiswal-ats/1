import { useCandidatesHref } from "../lib/candidatesRoute";
import { ShellActions } from "./ShellActions";
import logo from "../assets/revenue-optics-logo.png";
import { useData } from "../data/DataProvider";
import { CLIENT } from "../data/fixtures";
import { waitingOnYou } from "../domain/candidates";
import type { NavKey } from "../lib/route";
import { BriefIcon, ChartIcon, PeopleIcon } from "./icons";

export function Sidebar({ current }: { current: NavKey }) {
  const candidatesHref=useCandidatesHref();
  const data = useData(), waiting = data.subs.filter(waitingOnYou).length;
  const here = (k: NavKey) => (current === k ? { "aria-current": "page" as const } : {});
  return (
    <aside className="side" id="side" aria-label="Main navigation">
      <div className="sbrand"><span className="lg"><img alt="Revenue Optics" src={logo} /></span></div>
      <div className="client">
        <b>{CLIENT.name}</b>
        <span>{`${CLIENT.note} · ${data.roles.length} roles with Revenue Optics`}</span>
      </div>
      <nav className="nav" id="nav">
        <a href={candidatesHref} {...here("candidates")}>
          <PeopleIcon />Candidates
          {waiting > 0 && <span className="ct" aria-label={`${waiting} waiting on you`}>{waiting}</span>}
        </a>
        <a href="#roles" {...here("roles")}><BriefIcon />Roles</a>
        <div className="grp">Reports</div>
        <a href="#progress" {...here("progress")}><ChartIcon />Hiring progress</a>
      </nav>
      <ShellActions current={current} demoExit />
    </aside>
  );
}
