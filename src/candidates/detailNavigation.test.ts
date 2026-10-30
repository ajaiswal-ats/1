import {describe,it,expect} from 'vitest';
import {detailSequence,detailHref,detailTab} from './detailNavigation';
import {demoCandidateRows} from './Candidates';
import {FIXTURE,TODAY} from '../data/fixtures';
import {filterRows,sortRows} from './CandidatesView';
import {parseCandidatesHash} from '../lib/candidatesRoute';

describe('candidate detail list context',()=>{
  const rows=demoCandidateRows(FIXTURE,TODAY), roles=FIXTURE.roles;
  for(const from of ['#candidates?role=isl&sort=name&view=list','#candidates?q=pricing&dec=1&sort=recent','#candidates?stage=Interview&wait=1','#candidates?role=gone&stage=bad&sort=bad','#candidates?q=no-such-person']){
    it(`uses existing filtering and sorting for ${from}`,()=>expect(detailSequence(rows,roles,TODAY,from)).toEqual(sortRows(filterRows(rows,parseCandidatesHash(from,roles.map(r=>r.id)),undefined,roles),parseCandidatesHash(from,roles.map(r=>r.id)).sort,TODAY)));
  }
  it('has no fabricated sequence for direct or unsafe links',()=>{expect(detailSequence(rows,roles,TODAY,null)).toEqual([]);expect(detailSequence(rows,roles,TODAY,'https://evil.example')).toEqual([]);});
  it('restores the role list including declined, without other roles',()=>{const list=detailSequence(rows,roles,TODAY,'#role-isl?dec=1');expect(list.length).toBe(rows.filter(r=>r.roleId==='isl').length);expect(list.every(r=>r.roleId==='isl')).toBe(true);});
  it('role stage selection remains exact even when Include declined is set',()=>{const list=detailSequence(rows,roles,TODAY,'#role-isl?stage=Interview&dec=1');expect(list.length).toBeGreaterThan(0);expect(list.every(r=>r.stage==='Interview')).toBe(true);});
  it('preserves the exact return context and selected tab',()=>{const from='#candidates?q=pricing&dec=1&view=list';const q=new URLSearchParams(detailHref('en-pa',from,'interview').split('?')[1]);expect(q.get('from')).toBe(from);expect(q.get('tab')).toBe('interview');});
  it('validates tab values',()=>{expect(detailTab('#c-a?tab=interview')).toBe('interview');expect(detailTab('#c-a?tab=unsafe')).toBe('summary');});
});
