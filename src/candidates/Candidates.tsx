import {permitted} from "../domain/actions";
import { useData } from "../data/DataProvider";
import { TODAY } from "../data/fixtures";
import { nextStep, requirementLine, roleOf } from "../domain/candidates";
import { useCandidatesUi } from "../lib/candidatesUi";
import { fd, fdw } from "../lib/dates";
import { CandidatesView, type CandidateRow } from "./CandidatesView";

export function Candidates() {
  const data=useData(), [ui,set]=useCandidatesUi(data.roles.map(r=>r.id));
  const rows=demoCandidateRows(data,TODAY);
  return <CandidatesView rows={rows} roles={data.roles} today={TODAY} initial={ui} onLegacyChange={set} boardPermissions={row=>{const c=data.subs.find(s=>s.id===row.id)!;const p=permitted(data,c);return {targets:[...p.moveTo,...(p.decline?["Declined" as const]:[])],reason:data.roles.find(r=>r.id===c.role)!.status!=="Open"?"This role is on hold, so stage changes are paused.":"Stage changes are not available from this stage."};}}/>;
}

export function demoCandidateRows(data: import("../data/fixtures").Dataset,today:string):CandidateRow[]{
  return data.subs.map(c=>{
    const t=nextStep(c,today), iv=c.client;
    // The legacy feedback date is not an interview-held date. Do not relabel it.
    const interview=iv.status==="none" ? "None recorded" : iv.status==="feedback" ? "Held · feedback given" : iv.status==="scheduled" ? `Scheduled ${fdw(iv.date!)}${iv.time ? `, ${iv.time}` : ""}` : `${iv.status==="held" ? "Held" : "Requested"} ${fd(iv.date!)}`;
    return {id:c.id,personId:c.pid,name:c.name,headline:c.head,location:c.loc,roleId:c.role,stage:c.stage,shared:c.shared,requirements:requirementLine(c,roleOf(data,c)),screening:c.iv ? fd(c.iv.date) : "None shared",interview,hasInterview:iv.status!=="none",next:{cls:t.cls,text:t.short,kind:c.next.kind,since:c.next.since}};
  });
}
