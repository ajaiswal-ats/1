import {
  FEW_STAYS, isFew, isSearchStage, stageAudit, waitingForClient, type PipelineModel, type ReportData, type ReportRole, type RoleFilter, type StayStage, type TimeRow,
} from "../reporting/metrics";
import { ChartHead, CountingInfo, EmptyBox, NOT_AVAILABLE, SEARCH_NOT_CONNECTED, Swatch, plural, rolesIncludedItem, sharedScopeItem } from "./shared";

const label = (s: StayStage) => (s === "Submitted" ? "To review" : s); /* client-facing stage names */
const fill = (t: TimeRow) => (isSearchStage(t.s) ? "var(--seg-grey)" : "var(--s1)");
const barBg = (t: TimeRow) => (isFew(t) ? `repeating-linear-gradient(135deg,${fill(t)} 0 5px,color-mix(in srgb,${fill(t)} 45%,var(--surface)) 5px 9px)` : fill(t));
const dayText = (v: number) => `${v} ${plural(v, "day")}`;

/* Time in stage (2h locked Option A): completed stays only, in pipeline order. */
export function TimeInStage({ data, filter, role, M, today }: { data: ReportData; filter: RoleFilter; role: ReportRole | null; M: PipelineModel; today: string }) {
  const T = M.time, sub = T.find((t) => t.s === "Submitted")!, open = T.reduce((a, t) => a + t.open, 0);
  const A = stageAudit(data, filter, today), sk = A.filter((x) => x.skipped > 0), re = A.filter((x) => x.entries > x.entered);
  const head = <ChartHead title="Time in stage" hint="Average days per stage, for completed stays only." />;
  /* Supabase mode: client moves are the client team's, not necessarily the signed-in member's. */
  const yours = data.recorded ? "a decision by your team" : "your decision", sides = data.recorded ? "Revenue Optics, your team" : "Revenue Optics, you";
  const ongoing = open > 0 && <p className="tsa-ongoing">{`${open} ongoing ${open === 1 ? "stay is" : "stays are"} excluded from these averages.`}</p>;
  const info = (
    <CountingInfo
      items={[
        rolesIncludedItem(role, data),
        ...(data.recorded ? [sharedScopeItem()] : []),
        <><b>Average days:</b> calendar days from entering a stage to leaving it, averaged over stays that have ended. The number of stays is shown next to each stage.</>,
        <><b>Stays:</b>{` a stay starts each time a candidate enters a stage and ends at the next saved move, forward or back, including a decline or Hired. A candidate moved back to an earlier stage starts a new stay there, so a candidate can have more than one stay in a stage. A stage a candidate was moved straight past has no stay and no days.${sk.length ? ` Skipped, so not timed: ${sk.map((x) => `${label(x.stage)} ${x.skipped}`).join(", ")}.` : ""}${re.length ? ` Repeat stays: ${re.map((x) => `${label(x.stage)} ${x.entries - x.entered}`).join(", ")}.` : ""}`}</>,
        <><b>Few:</b>{` fewer than ${FEW_STAYS} completed stays. These averages can change a lot with one more candidate.`}</>,
        <><b>Still in a stage:</b>{` ${open} ${open === 1 ? "stay is" : "stays are"} still open and not included in the averages. They are listed in the table below.`}</>,
        <><b>Sourced and Screened</b>{data.search ? " are Revenue Optics search steps (provisional until client visibility is confirmed)." : ` are Revenue Optics search steps. ${SEARCH_NOT_CONNECTED}`}</>,
        <><b>To review</b>{` runs from the day a candidate was shared until the first saved decision.${sub.n ? ` ${sub.byYou} of ${sub.n} completed stays ended with ${yours}.${waitingForClient(sub) ? ` That is why To review shows "Waiting for client decision".` : ` "Waiting for client decision" is shown only when every completed stay ended with ${yours}.`}` : ""} Other stages include steps by ${sides} and the candidate, so no side is assigned.`}</>,
      ]}
      head={["Stage", "Average days", "Completed stays", "Still in stage", "Days so far (avg)"]}
      rows={T.map((t) => (t.available ? [label(t.s), t.avg ?? "–", t.n, t.open, t.openAvg ?? "–"] : [label(t.s), NOT_AVAILABLE, NOT_AVAILABLE, NOT_AVAILABLE, NOT_AVAILABLE]))}
    />
  );
  if (T.every((t) => t.avg == null)) return <>{head}<EmptyBox>No completed stays yet for this selection.</EmptyBox>{ongoing}{info}</>;

  const max = Math.max(...T.map((t) => t.avg || 0));
  return (
    <>
      {head}
      <div className="ts-key">
        <span><Swatch color="var(--seg-grey)" />Revenue Optics search</span><span><Swatch color="var(--s1)" />Shared with you</span><span><Swatch className="ts-swf" />{`Fewer than ${FEW_STAYS} stays`}</span>
      </div>
      <div className="tsa">
        {T.map((t) => (
          <div key={t.s} className="tsa-row" role="img" aria-label={`${label(t.s)}: ${!t.available ? NOT_AVAILABLE.toLowerCase() : t.avg == null ? "no completed stays yet" : `${t.avg} days, ${t.n} completed stays`}`}>
            <div className="tsa-name"><b>{label(t.s)}</b><span>{t.avg == null ? "" : <>{`${t.n} ${plural(t.n, "stay")}${isFew(t) ? " " : ""}`}{isFew(t) && <span className="ts-few">few</span>}</>}</span></div>
            {!t.available ? <div className="ts-none">{NOT_AVAILABLE}</div> : t.avg == null ? <div className="ts-none">No completed stays yet</div> : (
              <div className="tsa-track">
                <div className="tsa-bar" style={{ width: `${max ? (t.avg / max) * 100 : 0}%`, background: barBg(t) }}
                  data-tip={label(t.s)} data-tip-text={`${t.avg} days on average · ${t.n} completed ${plural(t.n, "stay")}${isFew(t) ? " (few)" : ""}`} />
                <span className="tsa-after"><span className="tsa-v">{dayText(t.avg)}</span>{waitingForClient(t) && <span className="tsa-who">Waiting for client decision</span>}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      {ongoing}
      {info}
    </>
  );
}
