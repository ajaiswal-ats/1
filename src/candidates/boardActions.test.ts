import {describe,it,expect} from 'vitest';
import {readBoardAction,boardActionHref} from './boardActions';
describe('board action routing',()=>{
 it('accepts only permitted stages and permitted decline',()=>{
  expect(readBoardAction('#c-a?move=Interview',['Interview'],false)).toEqual({kind:'move',to:'Interview'});
  expect(readBoardAction('#c-a?move=Hired',['Interview'],false)).toBeNull();
  expect(readBoardAction('#c-a?action=decline',[],false)).toBeNull();
  expect(readBoardAction('#c-a?action=decline',[],true)).toEqual({kind:'decline'});
  expect(readBoardAction('#c-a?move=bad',['Interview'],true)).toBeNull();
  expect(readBoardAction('#c-a?move=Declined',['Declined'],true)).toBeNull();
 });
 it('carries a validated list context and never saves a stage from a link',()=>{
  expect(boardActionHref('a','Interview','#candidates?role=isl')).toBe('#c-a?from=%23candidates%3Frole%3Disl&move=Interview');
  expect(boardActionHref('a','Declined','https://evil.test')).toBe('#c-a?from=%23candidates&action=decline');
 });
});
