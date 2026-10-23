import { useData } from "../data/DataProvider";
import { TODAY } from "../data/fixtures";
import { fd } from "../lib/dates";
import { pipelineModel, roleRows, scheduledCount, weeklyCounts } from "../reporting/metrics";
import { useProgressUi } from "../lib/progressUi";
import { ByRole } from "./ByRole";
import { Pipeline } from "./Pipeline";
import { TimeInStage } from "./TimeInStage";
import { Weekly } from "./Weekly";

/* Hiring progress page (2h). The role selector applies to all four charts. */
export function HiringProgress() {
  const data = useData();
  const [ui, set] = useProgressUi(data.roles.map((r) => r.id));
  const role = ui.role === "all" ? null : data.roles.find((r) => r.id === ui.role) ?? null;
  const M = pipelineModel(data, ui.role, TODAY);
  return (
    <>
      <div className="pagehead">
        <div><h1>Hiring progress</h1><p className="lede">Where candidates are, how long each stage takes, and what moved each week.</p></div>
        <span className="period">Fictional data · prototype</span>
      </div>
      <div className="toolbar rbar">
        <label className="sr" htmlFor="rRole">Role</label>
        <select id="rRole" className="sel" value={ui.role} onChange={(e) => set({ role: e.target.value })}>
          <option value="all">All roles</option>
          {data.roles.map((r) => <option key={r.id} value={r.id}>{r.title + (r.status !== "Open" ? ` (${r.status.toLowerCase()})` : "")}</option>)}
        </select>
        <span className="xs muted rscope">{`As of ${fd(TODAY)} 2026 · counts update when you move a candidate`}</span>
      </div>
      <div className="hp-grid">
        <section className="card pad hp-wide" id="hp-funnel">
          <Pipeline data={data} filter={ui.role} role={role} M={M} today={TODAY} view={ui.pipelineView} onView={(v) => set({ pipelineView: v })} />
        </section>
        <section className="card pad hp-wide" id="hp-roles">
          <ByRole data={data} filter={ui.role} rows={roleRows(data, ui.role, ui.includeOnHold, ui.sort)} includeOnHold={ui.includeOnHold} sort={ui.sort}
            onIncludeOnHold={(v) => set({ includeOnHold: v })} onSort={(v) => set({ sort: v })} />
        </section>
        <section className="card pad" id="hp-time"><TimeInStage data={data} filter={ui.role} role={role} M={M} today={TODAY} /></section>
        <section className="card pad" id="hp-weekly"><Weekly filter={ui.role} weeks={weeklyCounts(data, ui.role)} scheduled={scheduledCount(data, ui.role)} /></section>
      </div>
    </>
  );
}
