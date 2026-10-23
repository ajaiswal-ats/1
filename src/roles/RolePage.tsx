import { CandidateTable } from "../candidates/CandidateTable";
import { useData } from "../data/DataProvider";
import { TODAY, type Stage } from "../data/fixtures";
import { STAGES, roleSummary, waitingOnYou } from "../domain/candidates";
import { fd } from "../lib/dates";
import { openCandidatesFor } from "../lib/candidatesUi";
import { stageColor } from "../progress/shared";
import { StatusChip } from "./StatusChip";

const COLS: Stage[] = [...STAGES, "Declined"];

/* Role page (2h vRole): details, stage tiles that open Candidates on this role, requirements, and the role's candidates. */
export function RolePage({ id }: { id: string }) {
  const data = useData(), r = data.roles.find((x) => x.id === id);
  if (!r) return <p>Role not found.</p>;
  const x = roleSummary(data, r, TODAY), open = () => openCandidatesFor(r.id);
  const list = x.subs.slice().sort((a, b) => Number(waitingOnYou(b)) - Number(waitingOnYou(a)));
  return (
    <>
      <nav className="crumb"><a href="#roles">← Roles</a></nav>
      {r.holdNote && <div className="banner warn">{r.holdNote}</div>}
      <div className="card pad">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}><h1>{r.title}</h1><StatusChip status={r.status} /></div>
        <p className="lede">{r.summary}</p>
        <dl className="rmeta">
          <div><dt>Location</dt><dd>{r.loc}</dd></div><div><dt>Opened</dt><dd>{`${fd(r.opened)} 2026`}</dd></div>
          <div><dt>Recruiter</dt><dd>{`${r.contact}, Revenue Optics`}</dd></div><div><dt>Requirements</dt><dd>{r.reqVer}</dd></div>
        </dl>
        <div className="funnel">
          <a className="ftile total" href="#candidates" data-role={r.id} onClick={open}><div className="n num">{x.subs.length}</div><div className="l">Shared with you</div></a>
          {COLS.map((s, i) => (
            <a key={s} className="ftile" href="#candidates" data-role={r.id} onClick={open} style={{ boxShadow: `inset 0 3px 0 ${stageColor(s)}` }}>
              <div className="n num">{x.byStage[i]}</div><div className="l">{s}</div>
            </a>
          ))}
        </div>
        <div className="rd">
          <div><h2>What the role involves</h2><ul className="rd-ul" style={{ paddingLeft: 18 }}>{r.resp.map((t) => <li key={t}>{t}</li>)}</ul>
            <details className="jd"><summary>Read the full job description</summary><p>{r.jd}</p></details></div>
          <div className="box"><h2>Requirements</h2><p className="xs muted" style={{ margin: "2px 0 6px" }}>{r.reqVer}</p>
            <ul className="reqlist">{r.req.map((q) => <li key={q[0]}><span>{q[0]}</span><span className={`chip ${q[1] === "must" ? "c-stage" : "c-mute"}`}>{q[1] === "must" ? "Must-have" : "Preferred"}</span></li>)}</ul></div>
        </div>
      </div>
      <section className="card pad" style={{ marginTop: 18 }}>
        <div className="sec-h"><h2>Candidates for this role</h2><a href="#candidates" data-role={r.id} className="small" onClick={open}>Open in Candidates</a></div>
        <CandidateTable list={list} noRole />
      </section>
    </>
  );
}
