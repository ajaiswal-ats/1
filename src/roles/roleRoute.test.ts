import {describe,it,expect} from 'vitest';
import {parseRoleHash,roleHash,roleCandidatesHash,parseRoleStatus} from './roleRoute';
describe('Sample 1 role navigation',()=>{
 it('validates status and stage parameters',()=>{
  expect(parseRoleStatus('#roles?status=On+hold')).toBe('On hold');expect(parseRoleStatus('#roles?status=bad')).toBe('');
  expect(parseRoleHash('#role-isl?stage=bad&dec=true')).toEqual({stage:'',declined:false});
  expect(parseRoleHash('#role-isl?stage=Declined')).toEqual({stage:'Declined',declined:true});
 });
 it('round trips stage and declined links',()=>{expect(parseRoleHash(roleHash('isl',{stage:'Interview',declined:true}))).toEqual({stage:'Interview',declined:true});});
 it('builds independent Candidates scopes for totals, stage and waiting',()=>{
  expect(roleCandidatesHash('isl',{declined:true})).toBe('#candidates?role=isl&dec=1');
  expect(roleCandidatesHash('isl',{stage:'To review'})).toBe('#candidates?role=isl&stage=To+review');
  expect(roleCandidatesHash('isl',{waiting:true})).toBe('#candidates?role=isl&wait=1');
 });
});
