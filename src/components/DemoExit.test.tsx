import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {DemoExit} from './DemoExit';

describe('demo sign out',()=>{
 it('offers an explicit demo return, without simulated credentials or reset',()=>{
  const html=renderToStaticMarkup(<DemoExit/>);
  expect(html).toContain('You’ve left the demo');expect(html).toContain('Open demo');
  expect(html).toContain('href="#candidates"');expect(html).not.toContain('password');expect(html).not.toContain('<form');
  expect(html).toContain('Your demo data has not been reset.');
 });
});
