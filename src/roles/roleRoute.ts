import {useEffect,useState} from 'react';
import {STAGES} from '../domain/candidates';
import type {Stage} from '../data/fixtures';
import {candidatesHash} from '../lib/candidatesRoute';
export const ROLE_STAGES:Stage[]=[...STAGES,'Declined'];
export interface RoleFilters {stage:Stage|'';declined:boolean}
const query=(hash:string)=>new URLSearchParams(hash.includes('?')?hash.slice(hash.indexOf('?')+1):'');
export const parseRoleStatus=(hash:string)=>{const v=query(hash).get('status');return v==='Open'||v==='On hold'?v:'';};
export function parseRoleHash(hash:string):RoleFilters{const q=query(hash),stage=q.get('stage')??'';const valid=ROLE_STAGES.includes(stage as Stage)?stage as Stage:'';return {stage:valid,declined:q.get('dec')==='1'||valid==='Declined'};}
export function roleHash(id:string,f:RoleFilters){const q=new URLSearchParams();if(f.stage)q.set('stage',f.stage);if(f.declined&&f.stage!=='Declined')q.set('dec','1');return `#role-${id}`+(q.size?'?'+q:'');}
export function roleCandidatesHash(id:string,f:{stage?:Stage|'';declined?:boolean;waiting?:boolean}={}){return candidatesHash({query:'',roles:[id],stages:f.stage?[f.stage]:[],declined:!!f.declined,waiting:!!f.waiting,sort:'waiting',view:'pipeline'});}
/** A query change does not remount the existing hash route; role views subscribe explicitly. */
export function useRoleLocation(){const read=()=>typeof location==='undefined'?'':location.hash;const [hash,set]=useState(read);useEffect(()=>{const sync=()=>set(read());window.addEventListener('hashchange',sync);return()=>window.removeEventListener('hashchange',sync);},[]);return [hash,(next:string)=>{history.replaceState(history.state,'',next);set(next);}] as const;}
