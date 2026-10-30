import {describe,it,expect} from 'vitest';
import {resetDemo,DEMO_KEY} from './demoStore';
describe('demo reset isolation',()=>{
 it('clears only fictional action storage and preserves authentication/settings',()=>{const values=new Map([[DEMO_KEY,'[{"old":"action"}]'],['sb-auth-token','private-sentinel'],['ro-theme','dark']]);expect(resetDemo({getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);}})).toBe(true);expect(values.get(DEMO_KEY)).toBe('[]');expect(values.get('sb-auth-token')).toBe('private-sentinel');expect(values.get('ro-theme')).toBe('dark');});
 it('reports unavailable storage without pretending a reset persisted',()=>{expect(resetDemo(undefined)).toBe(false);expect(resetDemo({getItem:()=>null,setItem:()=>{throw Error('blocked');}})).toBe(false);});
});
