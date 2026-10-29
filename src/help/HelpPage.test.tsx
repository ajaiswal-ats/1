import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {HelpPage,parseHelpHash,helpHash,searchHelp,HELP_TOPICS} from './HelpPage';
import {navFor,isCandidatesList} from '../lib/route';

describe('Help and support',()=>{
 it('routes help separately from Candidates',()=>{expect(navFor('help')).toBe('help');expect(isCandidatesList('help')).toBe(false);});
 it('validates direct topics and encodes help search URLs',()=>{
  expect(parseHelpHash('#help?topic=screening')).toEqual({query:'',topic:'screening'});
  expect(parseHelpHash('#help?topic=unknown&q=%3Cscript%3E')).toEqual({query:'<script>',topic:''});
  const state={query:'stage & role',topic:'stages'};expect(parseHelpHash(helpHash(state))).toEqual(state);
  expect(parseHelpHash('#candidates?q=Taylor')).toEqual({query:'',topic:''});
 });
 it('searches topic titles and answers literally, without evaluating regex or HTML',()=>{
  expect(searchHelp(' SCREENING ').some(t=>t.id==='screening')).toBe(true);
  expect(searchHelp('paused').some(t=>t.id==='move')).toBe(true);
  expect(searchHelp('[.*<script>')).toEqual([]);
  expect(searchHelp('')).toHaveLength(HELP_TOPICS.length);
 });
 it('shows grouped, keyboard-accessible topics and known recruiter details',()=>{
  const html=renderToStaticMarkup(<HelpPage roles={[{title:'Fictional Buyer',recruiterName:'Alex Kim'}]} demo/>);
  expect(html).toContain('<h1>Help and support</h1>');expect(html).toContain('for="hq"');expect(html).toContain('<summary');expect(html).toContain('Alex Kim');expect(html).toContain('Fictional Buyer');
  expect(html).toContain('Interviews and decisions');expect(html).toContain('Account help');
 });
 it('does not copy simulated sending, board actions, sign-in or fabricated support contacts',()=>{
  const html=renderToStaticMarkup(<HelpPage roles={[]}/>);
  expect(html).toContain('<form');expect(html).toContain('id="cTopic"');expect(html).toContain('Related role (optional)');expect(html).toContain('maxLength="1000"');expect(html).toMatch(/disabled=""[^>]*>Send message/);expect(html).not.toContain('mailto:');expect(html).not.toContain('Message sent');expect(html).not.toContain('drag the card');expect(html).not.toContain('Sign-in is simulated');
  expect(html).toContain('In-app messaging is not connected.');expect(html).toContain('Recruiter details are not available in this workspace.');
 });
});
