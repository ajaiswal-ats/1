import { FUNNEL, isSearchStage, stageAudit, type PipelineModel, type ReportData, type ReportRole, type RoleFilter } from "../reporting/metrics";
import { ChartHead, CountingInfo, EmptyBox, Legend, NOT_AVAILABLE, SEARCH_LEGEND, SEARCH_NOT_CONNECTED, Seg, plural, rolesIncludedItem, sharedScopeItem } from "./shared";

type View = "reached" | "now";
const TITLE: Record<View, string> = { reached: "Pipeline progress", now: "Candidates by current stage" };
const HINT: Record<View, string> = { reached: "Everyone who got at least this far.", now: "Where each active candidate is today." };

/* Pipeline (2h locked Option B): horizontal bars. The heading follows the view; the current-stage view says "To review". */
export function Pipeline({ data, filter, role, M, today, view, onView }: {
  data: ReportData; filter: RoleFilter; role: ReportRole | null; M: PipelineModel; today: string; view: View; onView: (v: View) => void;
}) {
  const v = view === "reached" ? M.reached : M.now;
  const label = (s: string) => (view === "now" && s === "Submitted" ? "To review" : s);
  const head = (
    <ChartHead title={TITLE[view]} hint={HINT[view]}>
      <Seg label="Funnel view" value={view} options={[["reached", "Reached so far"], ["now", "In stage now"]]} onChange={onView} />
    </ChartHead>
  );
  const skipped = stageAudit(data, filter, today).filter((x) => x.skipped > 0);
  /* Supabase mode: a decline is credited to the client team or Revenue Optics, from the move that recorded it. */
  const { dec, decBy } = M.closed, by = [decBy.you && `${decBy.you} by your team`, decBy.ro && `${decBy.ro} by Revenue Optics`].filter(Boolean).join(", ");
  const notShown = data.recorded
    ? ` Not shown: ${dec} declined${by ? ` (${by})` : ""}. Not progressed before sharing: ${M.closed.np ?? NOT_AVAILABLE.toLowerCase()}.`
    : ` Not shown: ${dec} declined by you, ${M.closed.np} not progressed before sharing.`;
  const info = (
    <CountingInfo
      items={[
        rolesIncludedItem(role, data),
        ...(data.recorded ? [sharedScopeItem()] : []),
        <><b>Reached so far:</b>{` each candidate counts once, at the furthest stage they have got to, and in every earlier stage. A candidate moved straight past a stage (for example To review to Offer) counts as having reached the skipped stage. Moving a candidate back does not lower this count.${skipped.length ? ` Reached by skipping: ${skipped.map((x) => `${x.stage} ${x.skipped}`).join(", ")}.` : ""}`}</>,
        <><b>In stage now:</b>{` each candidate's latest saved stage, counted once.${notShown}`}</>,
        <><b>Sourced and Screened</b>{data.search ? " are Revenue Optics search steps, shown as counts only." : ` are Revenue Optics search steps. ${SEARCH_NOT_CONNECTED}`}</>,
        <><b>Offer and Hired</b>{` are saved stages, not a record of an offer. Recorded by Revenue Optics: ${M.offers.made} ${plural(M.offers.made, "offer")} made, ${M.offers.acc} accepted.`}</>,
      ]}
      head={["Stage", "Reached so far", "In stage now"]}
      rows={FUNNEL.map((s, i) => [s, M.reached[i] ?? NOT_AVAILABLE, M.now[i] ?? NOT_AVAILABLE])}
    />
  );
  if (!M.recs.length) return <>{head}<EmptyBox>No candidates yet for this selection.</EmptyBox>{info}</>;

  const W = 900, lw = 110, rw = 50, rh = 26, gap = 10, H = FUNNEL.length * (rh + gap), max = Math.max(1, ...v.map((n) => n ?? 0)), sc = (W - lw - rw) / max;
  return (
    <>
      {head}
      <Legend items={SEARCH_LEGEND} />
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={FUNNEL.map((s, i) => label(s) + " " + (v[i] ?? NOT_AVAILABLE.toLowerCase())).join(", ")}>
        {FUNNEL.map((s, i) => {
          const n = v[i], y = i * (rh + gap) + 2, w = n ? Math.max(n * sc, 3) : 0, L = label(s);
          return (
            <g key={s}>
              <text x="0" y={y + rh / 2 + 5} style={{ fontWeight: 600, fontSize: 14, fill: "var(--ink)" }}>{L}</text>
              {w > 0 && <path d={`M${lw},${y} h${w - 4} q4,0 4,4 v${rh - 8} q0,4 -4,4 h${-(w - 4)} z`} fill={isSearchStage(s) ? "var(--seg-grey)" : "var(--s1)"} />}
              <text className={n === null ? "lbl na" : "lbl"} x={lw + w + 8} y={y + rh / 2 + 5} style={n === null ? { fontSize: 14, fill: "var(--ink-3)" } : { fontSize: 14 }}>{n ?? NOT_AVAILABLE}</text>
              <rect className="hit" x="0" y={y - 3} width={W} height={rh + 6} data-tip={L}
                data-tip-text={n === null ? `${NOT_AVAILABLE}: search records are not connected` : `${n} ${plural(n, "candidate")} ${view === "reached" ? "reached this stage" : "in this stage now"}`} />
            </g>
          );
        })}
      </svg>
      {info}
    </>
  );
}
