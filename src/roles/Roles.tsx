import { useData } from "../data/DataProvider";
import { TODAY, type Stage } from "../data/fixtures";
import { STAGES, roleSummary } from "../domain/candidates";
import { stageColor } from "../progress/shared";
import { StatusChip } from "./StatusChip";

const COLS: Stage[] = [...STAGES, "Declined"];

/* Roles page (2h vRoles and rolesTable): every role with its latest saved stage counts. */
export function Roles() {
  const data = useData();
  return (
    <>
      <div className="pagehead"><div><h1>Roles</h1><p className="lede">Roles Revenue Optics is filling for you.</p></div></div>
      <section className="card pad">
        <div className="ltab-wrap">
          <table className="rtab">
            <thead><tr><th>Role</th><th>Status</th><th className="n">Shared</th>
              {COLS.map((s) => <th key={s} className="n stc"><i className="sw" style={{ background: stageColor(s) }} />{s}</th>)}
              <th className="n">Waiting on you</th><th className="n">Last 7 days</th></tr></thead>
            <tbody>
              {data.roles.map((r) => {
                const x = roleSummary(data, r, TODAY);
                return (
                  <tr key={r.id}>
                    <td><a className="rname" href={`#role-${r.id}`}>{r.title}</a><div className="xs muted">{r.loc}</div></td>
                    <td><StatusChip status={r.status} /></td>
                    <td className="n shared">{x.subs.length}</td>
                    {x.byStage.map((n, i) => <td key={i} className={`n stn${n ? "" : " zero"}`}>{n}</td>)}
                    <td className="n">{x.waiting ? <span className="chip c-warn">{x.waiting}</span> : "0"}</td>
                    <td className="n small">{`${x.shared7} shared · ${x.moved7} moved`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
