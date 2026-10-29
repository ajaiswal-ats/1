import { createContext, useContext, useEffect, useState } from 'react';
import type { Stage } from '../data/fixtures';
import { STAGES } from '../domain/candidates';

export interface CandidatesLocation {
  query:string; roles:string[]; stages:Stage[]; declined:boolean; waiting:boolean;
  sort:string; view:'pipeline'|'list';
}
export const CandidatesContextScope = createContext('demo');
export const hashPath = (hash:string) => hash.replace(/^#/, '').split('?')[0] || 'candidates';
export function parseCandidatesHash(hash:string, validRoles:readonly string[]):CandidatesLocation {
  const q=new URLSearchParams(hashPath(hash)==='candidates' && hash.includes('?') ? hash.slice(hash.indexOf('?')+1) : '');
  const selected=(key:string, valid:readonly string[])=>valid.filter(v=>(q.get(key)??'').split(',').includes(v));
  const stages=selected('stage',[...STAGES,'Declined']) as Stage[];
  return {query:q.get('q')??'',roles:selected('role',validRoles),stages,
    declined:q.get('dec')==='1'||stages.includes('Declined'),waiting:q.get('wait')==='1',
    sort:['waiting','recent','name'].includes(q.get('sort')??'')?q.get('sort')!:'waiting',view:q.get('view')==='list'?'list':'pipeline'};
}
export function candidatesHash(s:CandidatesLocation):string {
  const q=new URLSearchParams();
  if(s.query)q.set('q',s.query);if(s.roles.length)q.set('role',s.roles.join(','));if(s.stages.length)q.set('stage',s.stages.join(','));
  if(s.waiting)q.set('wait','1');if(s.declined&&!s.stages.includes('Declined'))q.set('dec','1');
  if(s.sort!=='waiting')q.set('sort',s.sort);if(s.view!=='pipeline')q.set('view',s.view);
  const text=q.toString().replace(/%2C/g,',');return '#candidates'+(text?'?'+text:'');
}
/** Return targets are local list hashes only; actual role/stage values are validated by the list adapter. */
export const safeCandidatesReturn=(value:string|null|undefined)=>value && /^#candidates(?:\?|$)/.test(value) ? value : '#candidates';
// UI context only. Workspace shells scope it to the existing user/client key.
const memory=new Map<string,string>();
function read(key:string,fallback:string){try{return sessionStorage.getItem(key)??memory.get(key)??fallback;}catch{return memory.get(key)??fallback;}}
function save(key:string,value:string){memory.set(key,value);try{sessionStorage.setItem(key,value);}catch{/* URL navigation still works without storage. */}}
const key=(scope:string)=>`ro-candidates-context:${scope}`;
export function rememberCandidates(scope:string,hash:string){save(key(scope),safeCandidatesReturn(hash));window.dispatchEvent(new Event('candidates-context'));}
export function saveCandidatesScroll(scope:string,hash:string,y:number){save(`${key(scope)}:scroll:${hash}`,String(y));}
export function candidatesScroll(scope:string,hash:string){const y=Number(read(`${key(scope)}:scroll:${hash}`,'0'));return Number.isFinite(y)&&y>=0?y:0;}
export function useCandidatesHref(explicitScope?:string):string {
  const scope=useContext(CandidatesContextScope), activeScope=explicitScope??scope;
  const get=()=>{
    if(typeof location==='undefined')return '#candidates';
    const from=new URLSearchParams(location.hash.split('?').slice(1).join('?')).get('from');
    return from && hashPath(location.hash).startsWith('c-') ? safeCandidatesReturn(from) : safeCandidatesReturn(read(key(activeScope),'#candidates'));
  };
  const [href,setHref]=useState(get);
  useEffect(()=>{const sync=()=>setHref(get());sync();window.addEventListener('hashchange',sync);window.addEventListener('candidates-context',sync);return()=>{window.removeEventListener('hashchange',sync);window.removeEventListener('candidates-context',sync);};},[activeScope]);
  return href;
}
export const safeRoleReturn=(hash:string|null|undefined)=>hash&&/^#role-[a-zA-Z0-9_-]+(?:\?|$)/.test(hash)?hash:null;
export function useCandidateReturn(){const candidates=useCandidatesHref();const get=()=>typeof location==='undefined'?null:safeRoleReturn(new URLSearchParams(location.hash.split('?').slice(1).join('?')).get('from'));const [role,setRole]=useState(get);useEffect(()=>{const sync=()=>setRole(get());window.addEventListener('hashchange',sync);return()=>window.removeEventListener('hashchange',sync);},[]);return {href:role??candidates,label:role?'Back to role':'Back to candidates'};}
export function candidateHref(id:string,returnHash?:string){if(typeof location==='undefined')return `#c-${id}`;return `#c-${id}?from=${encodeURIComponent(safeRoleReturn(returnHash)??safeCandidatesReturn(location.hash))}`;}
