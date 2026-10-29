import {useData} from "../data/DataProvider";
import {TODAY,type Dataset} from "../data/fixtures";
import {roleSummary} from "../domain/candidates";
import {RolesView,type RolePresentation} from "./RoleViews";
export function demoRoles(data:Dataset):RolePresentation[]{return data.roles.map(r=>{const x=roleSummary(data,r,TODAY);return {id:r.id,title:r.title,status:r.status,location:r.loc,opened:r.opened,recruiter:r.contact,shared:x.subs.length,byStage:x.byStage,waiting:x.waiting,shared7:x.shared7,moved7:x.moved7,summary:r.summary,holdNote:r.holdNote,responsibilities:r.resp,jobDescription:r.jd,requirementsLabel:r.reqVer,requirements:r.req.map(([text,tier])=>({text,tier:tier==='must'?'must':'preferred'})),contentAvailable:true};});}
export function Roles(){const data=useData();return <RolesView roles={demoRoles(data)}/>;}
