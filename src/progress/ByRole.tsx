import type { CSSProperties } from "react";
import type { Dataset, Role } from "../data/fixtures";
import { fd } from "../lib/dates";
import { ROLE_CHART_STAGES, hiddenRoles, type RoleFilter, type RoleRow, type RoleSort } from "../reporting/metrics";
import { ChartHead, CountingInfo, EmptyBox, Legend, Seg, plural, stageColor, stageText } from "./shared";

const PLOT_H = 200; /* plot height in px */
function ticks(max: number) {
  const step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : 10, top = Math.max(step, Math.ceil(max / step) * step), t: number[] = [];
  for (let v = 0; v <= top; v += step) t.push(v);
  return { top, t };
}
const meta = (r: Role) => `Opened ${fd(r.opened)}${r.status !== "Open" ? " · On hold" : ""}`;
const breakdown = (x: RoleRow) => (x.total ? ROLE_CHART_STAGES.map((s, k) => (x.by[k] ? `${x.by[k]} ${s}` : "")).filter(Boolean).join(" · ") : "None shared yet");

/* Candidates by role (2g): one stacked column per role, current stages from the bottom, total above.
   Stages are readable without colour: legend, counts inside segments at least 18 px tall, and a breakdown under each role. */
export function ByRole({ data, filter, rows, includeOnHold, sort, onIncludeOnHold, onSort }: {
  data: Dataset; filter: RoleFilter; rows: RoleRow[]; includeOnHold: boolean; sort: RoleSort;
  onIncludeOnHold: (v: boolean) => void; onSort: (v: RoleSort) => void;
}) {
  const hidden = hiddenRoles(data, filter, includeOnHold), dec = rows.reduce((a, x) => a + x.dec, 0);
  const head = (
    <ChartHead title="Candidates by role" hint={`${includeOnHold ? "Open and on-hold roles" : "Open roles"}, by each candidate's current stage.`}>
      <div className="hp-ctl">
        <label className="tgl"><input type="checkbox" id="roHold" checked={includeOnHold} onChange={(e) => onIncludeOnHold(e.target.checked)} /> Include on-hold roles</label>
        <Seg label="Sort roles" value={sort} options={[["fewest", "Fewest first"], ["az", "A–Z"]]} onChange={onSort} />
      </div>
    </ChartHead>
  );
  const info = (
    <CountingInfo
      items={[
        <>{`One row per open role${includeOnHold ? " and per on-hold role" : ""}, including roles with no candidates yet. Each candidate shared with you is counted once, at their latest saved stage.`}</>,
        <>{`On-hold roles are left out unless "Include on-hold roles" is ticked. This control affects this chart only.${hidden.length ? ` Not shown now: ${hidden.map((r) => r.title).join(", ")} (on hold).` : ""}`}</>,
        <>{`Also not shown: ${dec} declined by you. Candidates still in Revenue Optics search are not included.`}</>,
        <>Offer and Hired are saved stages, not a record of an offer. No target number of candidates has been set for any role.</>,
      ]}
      head={["Role", ...ROLE_CHART_STAGES, "Total", "Declined"]}
      rows={rows.map((x) => [x.role.title + (x.role.status !== "Open" ? " (on hold)" : ""), ...x.by, x.total, x.dec])}
    />
  );
  if (!rows.length) {
    const one = filter !== "all" ? data.roles.find((r) => r.id === filter) : null;
    const msg = one && one.status !== "Open" ? `${one.title} is on hold. Tick "Include on-hold roles" to show it.` : "No open roles right now.";
    return <>{head}<EmptyBox>{msg}</EmptyBox>{info}</>;
  }

  const { top, t } = ticks(Math.max(1, ...rows.map((x) => x.total))), unit = PLOT_H / top;
  return (
    <>
      {head}
      <Legend className="rc-legend" items={ROLE_CHART_STAGES.map((s) => [s, stageColor(s)])} />
      <div className="rc" style={{ "--rc-n": rows.length } as CSSProperties}>
        <div className="rc-y" aria-hidden="true">{t.map((v) => <span key={v} style={{ bottom: v * unit }}>{v}</span>)}</div>
        <div className="rc-plot" style={{ height: PLOT_H }}>
          {t.map((v) => <i key={v} className="rc-grid" style={{ bottom: v * unit }} />)}
          <div className="rc-cols">
            {rows.map((x) => {
              const segs = ROLE_CHART_STAGES.map((s, k) => ({ s, n: x.by[k] })).filter((o) => o.n);
              return (
                <div key={x.role.id} className="rc-col" role="img"
                  aria-label={`${x.role.title}: ${x.total} ${plural(x.total, "candidate")}${x.total ? " — " + segs.map((o) => `${o.n} ${o.s}`).join(", ") : ""}`}>
                  {x.total > 0 && (
                    <div className="rc-stack" style={{ height: x.total * unit }}>
                      {segs.map((o) => (
                        <div key={o.s} className="rc-seg" style={{ height: o.n * unit, background: stageColor(o.s), color: stageText(o.s) }}
                          data-tip={x.role.title} data-tip-text={`${o.s}: ${o.n} ${plural(o.n, "candidate")}`} data-s={o.s} data-n={o.n}>
                          {o.n * unit >= 18 && <span>{o.n}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="rc-tot" style={{ bottom: x.total * unit + 4 }}>{x.total}</div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rc-x">
          {rows.map((x) => <div key={x.role.id} className="rc-lab"><b>{x.role.title}</b><span className="rc-meta">{meta(x.role)}</span><span className="rc-brk">{breakdown(x)}</span></div>)}
        </div>
      </div>
      {info}
    </>
  );
}
