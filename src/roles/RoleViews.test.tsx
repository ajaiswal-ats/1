import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {RolesView,RoleDetailView,type RolePresentation} from './RoleViews';
import {demoCandidateRows} from '../candidates/Candidates';
import {FIXTURE,TODAY} from '../data/fixtures';
import {demoRoles} from './Roles';
const roles=demoRoles(FIXTURE),rows=demoCandidateRows(FIXTURE,TODAY);
describe('Roles reference presentation preserves loaded facts',()=>{
 it('links positive totals/stages/waiting to independent filtered Candidates URLs',()=>{
  const html=renderToStaticMarkup(<RolesView roles={roles}/>);
  expect(html).toContain('href="#candidates?role=isl&amp;dec=1"');expect(html).toContain('href="#candidates?role=isl&amp;stage=To+review"');expect(html).toContain('href="#candidates?role=isl&amp;wait=1"');
  expect(html).toContain('aria-label="Role status"');expect(html).toContain('<span class="rv-zero">0</span>');
 });
 it('does not invent waiting values or contacts when workspace fields are missing',()=>{
  const role:RolePresentation={...roles[0],waiting:null,recruiter:'',contentAvailable:false};
  expect(renderToStaticMarkup(<RolesView roles={[role]}/>)).toContain('Not connected yet');
  const html=renderToStaticMarkup(<RoleDetailView role={role} rows={[]} roles={[]} today={TODAY}/>);
  expect(html).not.toContain('Jamie Scott');expect(html).toContain('requirements are not connected yet');expect(html).toContain('No candidates shared for this role yet');
 });
 it('uses calendar year from the source instead of hardcoding 2026',()=>{
  const html=renderToStaticMarkup(<RoleDetailView role={{...roles[0],opened:'2024-01-03'}} rows={rows} roles={roles} today={TODAY}/>);
  expect(html).toContain('3 Jan 2024');
 });
 it('shows separated requirements tiers and expandable content, and hides declined by default',()=>{
  const html=renderToStaticMarkup(<RoleDetailView role={roles[0]} rows={rows} roles={roles} today={TODAY}/>);
  expect(html).toContain('1 declined hidden');expect(html).toContain('class="rv-panel rv-details"');expect(html).toContain('Must-haves');expect(html).toContain('Preferred');
  expect(html).not.toContain('>Marcus Webb</a>');expect(html).toContain('Recruiter screening');
 });
});
