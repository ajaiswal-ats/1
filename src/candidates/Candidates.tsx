import type { CSSProperties } from "react";
import { useData } from "../data/DataProvider";
import { TODAY, type Stage } from "../data/fixtures";
import { STAGES, candidateList, countByStage, forRole, people, waitingOnYou } from "../domain/candidates";
import { useCandidatesUi } from "../lib/candidatesUi";
import { Seg, plural, stageColor } from "../progress/shared";
import { CandidateCard } from "./CandidateCard";
import { CandidateTable } from "./CandidateTable";

/* Candidates page (2h vCandidates): Pipeline and List views, role filter and Waiting on you filter. */
export function Candidates() {
  const data = useData();
  const [ui, set] = useCandidatesUi(data.roles.map((r) => r.id));
  const base = forRole(data, ui.role), list = candidateList(data, ui.role, ui.filter, TODAY);
  const n = people(base), waiting = base.filter(waitingOnYou).length;
  const scope = ui.role === "all" ? `${data.roles.length} roles` : data.roles.find((r) => r.id === ui.role)!.title;
  return (
    <>
      <div className="pagehead">
        <div><h1>Candidates</h1><p className="lede">{`${base.length} ${plural(base.length, "submission")} · ${n} ${n === 1 ? "person" : "people"} · ${scope}`}</p></div>
        <Seg label="View" value={ui.view} options={[["pipeline", "Pipeline"], ["list", "List"]]} onChange={(view) => set({ view })} />
      </div>
      <div className="toolbar">
        <label className="sr" htmlFor="roleSel">Role</label>
        <select id="roleSel" className="sel" value={ui.role} onChange={(e) => set({ role: e.target.value })}>
          <option value="all">All roles</option>
          {data.roles.map((r) => <option key={r.id} value={r.id}>{r.title + (r.status !== "Open" ? ` (${r.status.toLowerCase()})` : "")}</option>)}
        </select>
        <button type="button" className="fchip" aria-pressed={ui.filter === "all"} onClick={() => set({ filter: "all" })}>All candidates</button>
        <button type="button" className="fchip wait" aria-pressed={ui.filter === "you"} onClick={() => set({ filter: "you" })}>Waiting on you <span className="ct">{waiting}</span></button>
      </div>
      {ui.view === "pipeline" ? board() : <CandidateTable list={list} />}
    </>
  );

  function board() {
    const cols: Stage[] = ui.showDeclined ? [...STAGES, "Declined"] : STAGES, counts = countByStage(list, cols), declined = countByStage(list, ["Declined"])[0];
    return (
      <>
        <div className={`board ${ui.showDeclined ? "with-dec" : ""}`}>
          {cols.map((s, i) => {
            const cs = list.filter((c) => c.stage === s);
            return (
              <section key={s} className="col" aria-label={s} style={{ "--c": stageColor(s) } as CSSProperties}>
                <div className="col-h"><h2>{s}</h2><span className="ct">{counts[i]}</span></div>
                {cs.length ? cs.map((c) => <CandidateCard key={c.id} c={c} showRole={ui.role === "all"} />)
                  : <div className="col-empty">{`No candidates here${ui.filter !== "all" ? " for this filter" : ""}`}</div>}
              </section>
            );
          })}
        </div>
        <p className="small" style={{ marginTop: 12 }}>
          <button type="button" className="btn-link" id="decTgl" onClick={() => set({ showDeclined: !ui.showDeclined })}>
            {ui.showDeclined ? "Hide declined" : `Show declined (${declined})`}
          </button>
        </p>
      </>
    );
  }
}
