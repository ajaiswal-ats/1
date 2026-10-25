import { useData } from "../data/DataProvider";
import { TODAY } from "../data/fixtures";
import { WEEKS, fd } from "../lib/dates";
import { pipelineModel, roleRows, scheduledCount, weeklyCounts, type ReportData } from "../reporting/metrics";
import { useProgressUi } from "../lib/progressUi";
import { ByRole } from "./ByRole";
import { Pipeline } from "./Pipeline";
import { TimeInStage } from "./TimeInStage";
import { Weekly } from "./Weekly";

/* Hiring progress page (2h). The role selector applies to all four charts. */
export function HiringProgress() {
  return <ProgressView data={useData()} today={TODAY} weeks={WEEKS} period="Fictional data · prototype" asOf={`As of ${fd(TODAY)} 2026 · counts update when you move a candidate`} />;
}

/** The page itself, for the demo (above) and for Supabase mode (rows from the workspace snapshot, the UTC date and the
    6 weeks before it). */
export function ProgressView({ data, today, weeks, period, asOf }: { data: ReportData; today: string; weeks: [string, string][]; period: string; asOf: string }) {
  const [ui, set] = useProgressUi(data.roles.map((r) => r.id));
  const role = ui.role === "all" ? null : data.roles.find((r) => r.id === ui.role) ?? null;
  const M = pipelineModel(data, ui.role, today);
  return (
    <>
      <div className="pagehead">
        <div><h1>Hiring progress</h1><p className="lede">Where candidates are, how long each stage takes, and what moved each week.</p></div>
        <span className="period">{period}</span>
      </div>
      <div className="toolbar rbar">
        <label className="sr" htmlFor="rRole">Role</label>
        <select id="rRole" className="sel" value={ui.role} onChange={(e) => set({ role: e.target.value })}>
          <option value="all">All roles</option>
          {data.roles.map((r) => <option key={r.id} value={r.id}>{r.title + (r.status !== "Open" ? ` (${r.status.toLowerCase()})` : "")}</option>)}
        </select>
        <span className="xs muted rscope">{asOf}</span>
      </div>
      <div className="hp-grid">
        <section className="card pad hp-wide" id="hp-funnel">
          <Pipeline data={data} filter={ui.role} role={role} M={M} today={today} view={ui.pipelineView} onView={(v) => set({ pipelineView: v })} />
        </section>
        <section className="card pad hp-wide" id="hp-roles">
          <ByRole data={data} filter={ui.role} rows={roleRows(data, ui.role, ui.includeOnHold, ui.sort)} includeOnHold={ui.includeOnHold} sort={ui.sort}
            onIncludeOnHold={(v) => set({ includeOnHold: v })} onSort={(v) => set({ sort: v })} />
        </section>
        <section className="card pad" id="hp-time"><TimeInStage data={data} filter={ui.role} role={role} M={M} today={today} /></section>
        <section className="card pad" id="hp-weekly"><Weekly filter={ui.role} weeks={weeklyCounts(data, ui.role, weeks)} scheduled={scheduledCount(data, ui.role)} recorded={data.recorded} /></section>
      </div>
    </>
  );
}
