import {useData} from "../data/DataProvider";
import {TODAY} from "../data/fixtures";
import {demoCandidateRows} from "../candidates/Candidates";
import {demoRoles} from "./Roles";
import {RoleDetailView} from "./RoleViews";
export function RolePage({id}:{id:string}){const data=useData(),role=demoRoles(data).find(r=>r.id===id);return role?<RoleDetailView role={role} rows={demoCandidateRows(data,TODAY)} roles={data.roles} today={TODAY}/>:<p>Role not found.</p>;}
