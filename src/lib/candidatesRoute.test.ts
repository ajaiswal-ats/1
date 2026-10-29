import { describe, expect, it } from 'vitest';
import { parseCandidatesHash, candidatesHash, safeCandidatesReturn, safeRoleReturn } from './candidatesRoute';
const roles=['isl','pa','rsm'];
describe('Candidates URL context (audit 3 and 4)',()=>{
 it('round trips every control using Sample 1 parameter names',()=>{
  const hash='#candidates?q=Taylor&role=isl,pa&stage=To+review,Interview&wait=1&dec=1&sort=recent&view=list';
  const state=parseCandidatesHash(hash,roles);
  expect(state).toEqual({query:'Taylor',roles:['isl','pa'],stages:['To review','Interview'],waiting:true,declined:true,sort:'recent',view:'list'});
  expect(candidatesHash(state)).toBe(hash);
 });
 it('validates enums, flags and role IDs; deduplicates in option order',()=>{
  expect(parseCandidatesHash('#candidates?role=unknown,pa,isl,pa&stage=Bad,Interview,To+review&wait=true&dec=2&sort=bad&view=bad',roles)).toEqual({query:'',roles:['isl','pa'],stages:['To review','Interview'],waiting:false,declined:false,sort:'waiting',view:'pipeline'});
 });
 it('supports legacy Declined stage links and safely encodes search text',()=>{
  const s=parseCandidatesHash('#candidates?q=%3Cscript%3E%26%23&stage=Declined',roles);
  expect(s.declined).toBe(true);
  expect(parseCandidatesHash(candidatesHash(s),roles)).toEqual(s);
  expect(candidatesHash(s)).not.toContain('dec=1');
 });
 it('omits defaults and ignores foreign routes and malformed query values',()=>{
  expect(candidatesHash(parseCandidatesHash('#roles?q=Taylor',roles))).toBe('#candidates');
  expect(parseCandidatesHash('#candidates?role=%E0%A4%A&stage=no&view=list',roles).roles).toEqual([]);
 });
 it('only accepts a local Candidates return URL',()=>{
  for(const hash of ['https://evil.test','#roles','#c-id?from=x','javascript:alert(1)','#candidates-evil']) expect(safeCandidatesReturn(hash)).toBe('#candidates');
  expect(safeCandidatesReturn('#candidates?q=Taylor&view=list')).toBe('#candidates?q=Taylor&view=list');
 });
});


describe('candidate return to role',()=>{it('accepts only local role targets',()=>{
 expect(safeRoleReturn('#role-isl?stage=Interview')).toBe('#role-isl?stage=Interview');
 for(const v of ['https://evil.test','#roles','#role-evil/path','#role-'])expect(safeRoleReturn(v)).toBeNull();
});});
