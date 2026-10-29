import type {Stage} from '../data/fixtures';
import {safeCandidatesReturn} from '../lib/candidatesRoute';
export interface BoardPermissions {targets:Stage[];reason?:string}
export function readBoardAction(hash:string,targets:readonly Stage[],decline:boolean):{kind:'move';to:Exclude<Stage,'Declined'>}|{kind:'decline'}|null{
 const q=new URLSearchParams(hash.split('?').slice(1).join('?')),move=q.get('move');
 if(move&&move!=='Declined'&&targets.includes(move as Stage))return {kind:'move',to:move as Exclude<Stage,'Declined'>};
 return q.get('action')==='decline'&&decline?{kind:'decline'}:null;
}
export function boardActionHref(id:string,target:Stage,from:string){return `#c-${id}?from=${encodeURIComponent(safeCandidatesReturn(from))}&${target==='Declined'?'action=decline':'move='+encodeURIComponent(target)}`;}
