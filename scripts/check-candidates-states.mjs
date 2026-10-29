/* Regression checks for audit items 11, 12 and 13. Fictional local data only.
   Blocks external requests and all non-GET HTTP requests. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const out=path.resolve('compare-output/candidates-states-batch');
const browser=await chromium.launch();let checks=0;const failures=[],errors=[],blocked=[];
const ck=(ok,label)=>{assert.ok(ok,label);checks++;};
const focused=loc=>loc.evaluate(el=>el===document.activeElement);
async function applyCandidateSearch(p,value){
 await p.locator('#fq').fill(value);
 await p.waitForFunction(q=>Array.from(document.querySelectorAll('.x-resultline .x-fchip')).some(el=>el.textContent.startsWith(`Matching “${q}”`)),value);
}
async function setup(width,theme){
 const context=await browser.newContext({viewport:{width,height:900}});await context.addInitScript(()=>{localStorage.clear();sessionStorage.clear();});
 await context.route('**/*',r=>{if(r.request().url().startsWith('http://127.0.0.1:')&&r.request().method()==='GET')return r.continue();blocked.push({method:r.request().method(),url:r.request().url()});return r.abort();});
 const p=await context.newPage();p.setDefaultTimeout(4000);p.on('pageerror',e=>errors.push(String(e)));await p.goto('http://127.0.0.1:5173/#candidates');await p.evaluate(()=>document.fonts.ready);
 if(theme==='dark'){if(width===390)await p.getByRole('button',{name:'Open navigation',exact:true}).click();await p.getByRole('button',{name:'Dark theme',exact:true}).click();if(width===390)await p.keyboard.press('Escape');}
 return {p,context,width,theme};
}
async function run(name,width,theme,fn){const s=await setup(width,theme);try{await fn(s);console.log(`PASS ${name} ${width}px ${theme}`);}catch(e){failures.push(`${name} ${width}px ${theme}: ${e.message}`);console.log(`FAIL ${failures.at(-1)}`);}finally{await s.context.close();}}
async function shot(s,name){await s.p.screenshot({path:path.join(out,`${s.width}-${s.theme}-${name}.png`)});}
async function menu(s,kind){await s.p.locator(s.width===390?'.x-fmore':'.x-fbtn').nth(s.width===390||kind==='roles'?0:1).click();return s.p.locator(s.width===390?'.x-fsheet':'.x-fmenu:visible');}
async function summaries(s){
 const {p,width}=s;let root=await menu(s,'roles');
 await root.getByLabel('Inside Sales Leader',{exact:false}).check();await root.getByLabel('Pricing Analyst',{exact:false}).check();await p.keyboard.press('Escape');
 ck((await p.locator('.x-fbtn').first().locator('.x-fv').textContent())==='2 roles','role trigger says 2 roles');
 root=await menu(s,'stages');await root.getByLabel('To review',{exact:false}).check();await root.getByLabel('Interview',{exact:false}).check();await root.getByLabel('Include declined',{exact:false}).check();await shot(s,'multiple-filters-open');await p.keyboard.press('Escape');
 const stage=p.locator('.x-fbtn').nth(1);ck(await stage.locator('.x-fv').textContent()==='2 stages','stage trigger says 2 stages');
 ck((await stage.getAttribute('aria-label')).includes('including declined'),'Stage accessible summary includes declined');
 if(width===390){ck(await p.locator('.x-fmore .x-fplus').innerText()==='5','mobile count includes two roles, two stages and declined');ck(await p.locator('.x-fmore').getAttribute('aria-label')==='Filters, 5 active','mobile active-count accessible label');}
 await shot(s,'multiple-filter-summaries');await p.getByRole('button',{name:'Clear all',exact:true}).click();root=await menu(s,'stages');await root.getByLabel('Include declined',{exact:false}).check();await p.keyboard.press('Escape');
 ck(await stage.locator('.x-fv').textContent()==='All + declined','declined-only summary is All + declined');ck((await stage.getAttribute('class')).includes('x-on'),'declined alone activates Stage styling');
 if(width===390)ck(await p.locator('.x-fmore .x-fplus').innerText()==='1','declined alone counts once on mobile');
 await shot(s,'declined-only-summary');
}
async function mobile(s){
 const {p}=s;await p.locator('.x-fmore').focus();await p.keyboard.press('Enter');const root=p.getByRole('dialog'),search=root.getByRole('searchbox',{name:'Search roles',exact:true}),close=root.getByRole('button',{name:'Close filters',exact:true});
 ck(await focused(search),'mobile open focuses role search');ck(await close.locator('svg').count()===1,'Close uses existing SVG icon system');ck(await root.getByRole('button',{name:'Clear',exact:true}).isDisabled(),'Clear disabled with no facet selections');
 const show=root.getByRole('button',{name:'Show 10 results',exact:true});await shot(s,'mobile-open-focus');
 await p.keyboard.press('Shift+Tab');ck(await focused(close),'Shift+Tab from search reaches Close');await p.keyboard.press('Shift+Tab');ck(await focused(show),'reverse Tab wraps to Show');await p.keyboard.press('Tab');ck(await focused(close),'forward Tab wraps to Close');await p.keyboard.press('Tab');ck(await focused(search),'Tab returns to role search');
 ck(await p.evaluate(()=>document.body.style.overflow==='hidden'),'mobile sheet scroll lock remains active');
 await p.keyboard.type('Leader');await root.getByLabel('Inside Sales Leader',{exact:false}).check();await root.getByLabel('To review',{exact:false}).check();ck(await root.getByRole('button',{name:'Show 2 results',exact:true}).count()===1,'plural Show 2 results');await shot(s,'mobile-two-results');
 await p.keyboard.press('Escape');ck(await focused(p.locator('.x-fmore')),'Escape returns focus to Filters');
 await p.getByRole('button',{name:'Clear all',exact:true}).click();await applyCandidateSearch(p,'Taylor');await p.locator('.x-fmore').click();await root.getByLabel('Inside Sales Leader',{exact:false}).check();await root.getByLabel('To review',{exact:false}).check();
 ck(await root.getByRole('button',{name:'Show 1 result',exact:true}).count()===1,'singular Show 1 result');await shot(s,'mobile-one-result');
 await root.getByRole('button',{name:'Clear',exact:true}).click();ck(await root.getByRole('button',{name:'Clear',exact:true}).isDisabled(),'Clear disables after clearing');ck(await root.getByRole('button',{name:'Show 2 results',exact:true}).count()===1,'Clear preserves the external search');
 await close.focus();await p.keyboard.press('Enter');ck(await focused(p.locator('.x-fmore')),'Close icon returns focus to Filters');
}
async function waiting(s){
 const {p,theme}=s,button=p.locator('.x-toggle'),badge=p.locator('.x-toggle .x-n');
 for(const view of ['By stage','List']){
  await p.getByRole('button',{name:view,exact:true}).click();await applyCandidateSearch(p,'Jordan');
  ck(await badge.innerText()==='0','zero waiting count under other filters');ck((await badge.getAttribute('class')).includes('x-zero'),'zero badge has grey class');
  ck(await badge.evaluate(el=>getComputedStyle(el).backgroundColor)===(theme==='dark'?'rgb(35, 42, 55)':'rgb(238, 240, 244)'),'zero badge uses muted background');ck(await button.isEnabled(),'zero waiting remains selectable');
  await button.focus();await p.keyboard.press('Space');ck(await button.getAttribute('aria-pressed')==='true','Space selects zero waiting filter');ck(await button.locator('svg').count()===1,'selected waiting checkmark');
  ck(await p.locator('.x-empty').count()===1,'zero waiting gives an honest empty state');const chip=p.locator('.x-fchip-w');ck(await chip.count()===1,'waiting chip has amber class');
  ck(await chip.evaluate(el=>getComputedStyle(el).backgroundColor)===(theme==='dark'?'rgb(58, 42, 11)':'rgb(255, 241, 211)'),'waiting chip uses amber background');
  await shot(s,`${view==='List'?'list':'board'}-zero-waiting`);
  await chip.getByRole('button',{name:'Remove filter: Waiting on you',exact:true}).focus();await p.keyboard.press('Enter');ck(await button.getAttribute('aria-pressed')==='false','waiting chip is removable');ck(await button.locator('svg').count()===0,'unselected waiting has no checkmark');
  ck(await p.locator(view==='List'?'tbody tr':'.x-card').count()===1,'removing waiting restores search result');
  await applyCandidateSearch(p,'Taylor');await button.click();ck(await badge.innerText()==='2','nonzero waiting count preserved');ck(await p.locator('.x-fchip-w').count()===1,'nonzero waiting also gets amber chip');await shot(s,`${view==='List'?'list':'board'}-active-waiting`);await button.click();
 }
}
try{await fs.mkdir(out,{recursive:true});for(const width of [1440,390])for(const theme of ['light','dark']){await run('summaries',width,theme,summaries);if(width===390)await run('mobile controls',width,theme,mobile);await run('waiting states',width,theme,waiting);}
 ck(errors.length===0,`no page errors: ${errors.join('; ')}`);ck(!blocked.some(r=>r.method!=='GET'),'no attempted HTTP writes');await fs.writeFile(path.join(out,'results.json'),JSON.stringify({checks,failures,errors},null,2));console.log(`${checks} checks passed; ${failures.length} failed groups`);assert.deepEqual(failures,[]);
}finally{await browser.close();}
