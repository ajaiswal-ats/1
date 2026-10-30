import {useEffect,useState} from 'react';
import {filterRows,sortRows,type CandidateRow,type CandidateRole} from './CandidatesView';
import {hashPath,parseCandidatesHash,safeCandidatesReturn,safeRoleReturn} from '../lib/candidatesRoute';
import {parseRoleHash} from '../roles/roleRoute';
export const DETAIL_TABS=[['summary','Summary'],['interview','Recruiter screening'],['resume','Resume'],['notes','Notes and history']] as const;
export type DetailTab=(typeof DETAIL_TABS)[number][0];
export function detailTab(hash:string):DetailTab {const value=new URLSearchParams(hash.split('?').slice(1).join('?')).get('tab');return DETAIL_TABS.find(([k])=>k===value)?.[0]??'summary';}
export function detailSequence(rows:CandidateRow[],roles:CandidateRole[],today:string,from:string|null){
  if(from&&/^#candidates(?:\?|$)/.test(from)){const f=parseCandidatesHash(from,roles.map(r=>r.id));return sortRows(filterRows(rows,f,undefined,roles),f.sort,today);}
  if(safeRoleReturn(from)){const id=hashPath(from!).slice(5),f=parseRoleHash(from!);if(!roles.some(r=>r.id===id))return [];return sortRows(rows.filter(c=>c.roleId===id&&(f.stage?c.stage===f.stage:f.declined||c.stage!=='Declined')),'waiting',today);}
  return [];
}
export function detailHref(id:string,from:string|null,tab:DetailTab){const q=new URLSearchParams();if(from)q.set('from',safeRoleReturn(from)??safeCandidatesReturn(from));if(tab!=='summary')q.set('tab',tab);return `#c-${id}${q.size?'?'+q:''}`;}
export function useDetailLocation(){const read=()=>typeof location==='undefined'?'':location.hash;const [hash,setHash]=useState(read);useEffect(()=>{const sync=()=>setHash(read());window.addEventListener('hashchange',sync);return()=>window.removeEventListener('hashchange',sync);},[]);const from=new URLSearchParams(hash.split('?').slice(1).join('?')).get('from');return {from,tab:detailTab(hash),setTab:(tab:DetailTab)=>{const next=detailHref(hashPath(hash).slice(2),from,tab);history.replaceState(history.state,'',next);setHash(next);}};}
