import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {RequirementGroups,type RequirementPresentation} from './RequirementGroups';
describe('requirement presentation',()=>{
 it('groups all existing evidence by tier with accurate independent counts',()=>{const rows:RequirementPresentation[]=[{id:'a',tier:'must',text:'Existing must',status:'Supported',statusClass:'c-ok',evidence:'Original evidence',source:'Source: Resume'},{id:'b',tier:'preferred',text:'Existing preferred',status:'Supported',statusClass:'c-ok',evidence:'Original preferred evidence'},{id:'c',tier:'must',text:'Another must',status:'Not evidenced',statusClass:'c-mute',evidence:'Not mentioned.'}];const h=renderToStaticMarkup(<RequirementGroups rows={rows}/>);expect(h).toContain('Must-haves <span class="muted num">(2)</span>');expect(h).toContain('Preferred <span class="muted num">(1)</span>');expect(h.match(/1 supported/g)).toHaveLength(2);expect(h).toContain('1 not evidenced');for(const row of rows){expect(h).toContain(row.text);expect(h).toContain(row.evidence);}expect(h.match(/class="src"/g)).toHaveLength(1);});
 it('omits empty tiers without fabricating requirements',()=>expect(renderToStaticMarkup(<RequirementGroups rows={[]}/>)).toBe(''));
});
