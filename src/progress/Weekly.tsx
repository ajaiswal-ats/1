import { useLayoutEffect, useRef } from "react";
import { WEEKS, fd } from "../lib/dates";
import { TREND_MIN, weeklyTrend, type RoleFilter, type TrendPart, type WeekRow } from "../reporting/metrics";
import { ChartHead, CountingInfo, EmptyBox, Legend } from "./shared";

const SERIES = { shared: ["Submitted", "var(--s1)"], held: ["Interviews held", "var(--s2)"] } as const;

/* Weekly movement (2h locked Option A): grouped columns per week, with the computed trend line. */
export function Weekly({ filter, weeks, scheduled }: { filter: RoleFilter; weeks: WeekRow[]; scheduled: number }) {
  const T = weeklyTrend(weeks), plot = useRef<HTMLDivElement>(null);
  const describe = (x: TrendPart, n: string) => `${n}: ${x.last} in the latest 3 weeks vs ${x.prev} in the 3 before${x.ok ? "" : ` (fewer than ${TREND_MIN} in total, so no trend is stated)`}`;
  const empty = weeks.every((w) => !w.shared && !w.held);

  /* As in 2h: if a week label is too wide for its column, set the labels vertically. */
  useLayoutEffect(() => {
    const box = plot.current; if (!box) return;
    const fit = () => {
      box.classList.remove("wk-rot");
      if ([...box.querySelectorAll<HTMLElement>(".wka-lab")].some((l) => l.scrollWidth > l.clientWidth + 1)) box.classList.add("wk-rot");
    };
    fit();
    addEventListener("resize", fit);
    document.fonts?.ready.then(fit);
    return () => removeEventListener("resize", fit);
  });

  const head = <ChartHead title="Weekly movement" hint="Each week, Monday to Sunday." />;
  const info = (
    <CountingInfo
      items={[
        <><b>Weeks</b>{` run Monday to Sunday. Shown: the last 6 full weeks, ${fd(WEEKS[0][0])} – ${fd(WEEKS[5][1])}. The current week is added once it ends.`}</>,
        <><b>Submitted:</b> candidates Revenue Optics shared with you, counted in the week of the shared date. A person shared for two roles counts twice.</>,
        <><b>Interviews held:</b>{` client interviews recorded as held, counted in the week they took place. Interviews still scheduled are not counted${scheduled ? ` (${scheduled} scheduled right now)` : ""}. Revenue Optics screening calls are not included.`}</>,
        <><b>Roles included:</b>{` ${filter === "all" ? "every role" : "the selected role"}, including roles that are on hold now, because these weeks have already happened. (Candidates by role still shows open roles by default.)`}</>,
        <>A week with nothing recorded shows 0.</>,
        ...(T ? [<><b>Trend line:</b>{` compares the latest 3 full weeks with the 3 before. ${describe(T.s, "Submitted")}. ${describe(T.h, "Interviews held")}. It describes direction only; no target is implied.`}</>] : []),
      ]}
      head={["Week starting", SERIES.shared[0], SERIES.held[0]]}
      rows={weeks.map((w) => [fd(w.a), w.shared, w.held])}
    />
  );
  if (empty) return <>{head}<EmptyBox>No submissions or interviews held in these 6 weeks.</EmptyBox>{info}</>;

  const max = Math.max(1, ...weeks.map((w) => Math.max(w.shared, w.held)));
  const col = (w: WeekRow, k: keyof typeof SERIES) => {
    const v = w[k];
    return (
      <div className="wka-c">
        <span className={"wka-v" + (v ? "" : " zero")}>{v}</span>
        <i style={{ height: `${(v / max) * 100}%`, background: SERIES[k][1] }} data-tip={`Week of ${fd(w.a)}`} data-tip-text={`${SERIES[k][0]}: ${v}`} />
      </div>
    );
  };
  return (
    <>
      {head}
      {T?.text && <p className="wk-trend"><span className="wk-trend-k">Latest 3 weeks vs the 3 before</span><span className="wk-trend-t">{T.text}</span></p>}
      <Legend items={[[SERIES.shared[0], SERIES.shared[1]], [SERIES.held[0], SERIES.held[1]]]} />
      <div className="wka" ref={plot} role="img" aria-label={weeks.map((w) => `Week of ${fd(w.a)}: ${SERIES.shared[0]} ${w.shared}, ${SERIES.held[0]} ${w.held}`).join("; ")}>
        {weeks.map((w) => (
          <div key={w.a} className="wka-wk">
            <div className="wka-plot">{col(w, "shared")}{col(w, "held")}</div>
            <div className="wka-lab">{fd(w.a)}</div>
          </div>
        ))}
      </div>
      <div className="wka-x">Week starting</div>
      {info}
    </>
  );
}
