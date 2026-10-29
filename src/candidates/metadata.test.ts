import {describe,it,expect} from 'vitest';
import {interviewFragments} from './metadata';

describe('Candidates date and time fragments (audit 21 and 24)',()=>{
 it.each([
  ['Scheduled Thu 15 Oct, 10:00–10:45 CT',['Scheduled','Thu 15 Oct,','10:00–10:45 CT'],['Thu 15 Oct,','10:00–10:45 CT']],
  ['Scheduled Thu 15 Oct',['Scheduled','Thu 15 Oct'],['Thu 15 Oct']],
  ['Requested 6 Oct',['Requested','6 Oct'],['Requested 6 Oct']],
  ['Held 6 Oct',['Held','6 Oct'],['Held 6 Oct']],
  ['Held 6 Oct · feedback given',['Held','6 Oct ·','feedback','given'],['Held 6 Oct ·','feedback given']],
  ['Held · feedback given',['Held ·','feedback','given'],['Held ·','feedback given']],
  ['None recorded',['None','recorded'],['None','recorded']],
  ['Not connected yet',['Not','connected','yet'],['Not','connected','yet']],
  ['Cancelled',['Cancelled'],['Cancelled']],
 ] as const)('groups %s without changing its facts',(text,list,board)=>{
  expect(interviewFragments(text)).toEqual(list);
  expect(interviewFragments(text,true)).toEqual(board);
  expect(interviewFragments(text).join(' ')).toBe(text);
 });
 it('preserves unknown metadata verbatim instead of inferring missing dates',()=>{
  expect(interviewFragments('Held')).toEqual(['Held']);
  expect(interviewFragments('Scheduled · date not recorded')).toEqual(['Scheduled · date not recorded']);
  expect(interviewFragments('Held · feedback given').join(' ')).not.toMatch(/\d/);
 });
});
