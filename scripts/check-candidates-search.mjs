/* Regression checks for audit items 15, 16 and 17. Local fictional demo only.
   Uses a controlled browser clock to test the 220 ms debounce; blocks external requests and HTTP writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const out=path.resolve('compare-output/candidates-search-batch');const browser=await chromium.launch();
let checks=0;const failures=[],errors=[],blocked=[];
const ck=(ok,label)=>{assert.ok(ok,label);checks++;};const focused=loc=>loc.evaluate(el=>el===document.activeElement);
async function setup(width,theme,view){
 const context=await browser.newContext({viewport:{width,height:900}});await context.addInitScript(()=>{localStorage.clear();sessionStorage.clear();});
 await context.route('**/*',r=>{if(r.request().url().startsWith('http://127.0.0.1:')&&r.request().method()==='GET')return r.continue();blocked.push({url:r.request().url(),method:r.request().method()});return r.abort();});
 const p=await context.newPage();p.setDefaultTimeout(4000);p.on('pageerror',e=>errors.push(String(e)));await p.goto('http://127.0.0.1:5173/#candidates');await p.evaluate(()=>document.fonts.ready);
 if(theme==='dark'){if(width===390)await p.getByRole('button',{name:'Open navigation',exact:true}).click();await p.getByRole('button',{name:'Dark theme',exact:true}).click();if(width===390){await p.keyboard.press('Escape');await p.waitForTimeout(250);}}
 if(view==='list')await p.getByRole('button',{name:'List',exact:true}).click();
 await p.clock.install();await p.clock.pauseAt(new Date(Date.now()+1000));
 return {p,context,width,theme,view};
}
async function advance(p,ms){await p.clock.runFor(ms);await new Promise(r=>setTimeout(r,15));}
const count=s=>s.p.locator(s.view==='list'?'tbody tr .x-nm':'.x-card').count();
async function shot(s,name){await s.p.screenshot({path:path.join(out,`${s.width}-${s.theme}-${s.view}-${name}.png`)});}
async function run(name,width,theme,view,fn){const s=await setup(width,theme,view);try{await fn(s);console.log(`PASS ${name} ${width}px ${theme} ${view}`);}catch(e){failures.push(`${name} ${width}px ${theme} ${view}: ${e.message}`);console.log(`FAIL ${failures.at(-1)}`);}finally{await s.context.close();}}
async function wording(s){const {p}=s;await p.locator('.x-toggle').click();ck(await p.locator('.x-resultline').getByRole('button',{name:'Clear',exact:true}).count()===1,'one active filter says Clear');await p.locator('#fq').fill('Taylor');await advance(p,220);ck(await p.locator('.x-resultline').getByRole('button',{name:'Clear all',exact:true}).count()===1,'multiple active filters say Clear all');await shot(s,'multiple-clear');await p.locator('.x-fchip-w button').click();ck(await p.locator('.x-resultline').getByRole('button',{name:'Clear',exact:true}).count()===1,'removing a filter restores singular Clear');await shot(s,'single-clear');}
async function debounce(s){const {p}=s;await p.locator('#fq').fill('Taylor');ck(await p.locator('#fq').inputValue()==='Taylor','draft updates immediately');ck(await count(s)===10,'results do not update immediately');await advance(p,219);ck(await count(s)===10,'results unchanged before 220 ms');await advance(p,1);ck(await count(s)===2,'results apply at 220 ms');await p.locator('#fq').fill('Casey');await advance(p,100);await p.locator('#fq').fill('Priya');await advance(p,219);ck(await count(s)===2,'new typing restarts the delay');await advance(p,1);ck(await count(s)===1,'only latest text applies');ck(await p.locator('.x-showing').innerText().then(t=>t.includes('Showing 1 of 12')),'counts use committed query');}
async function cancellation(s){
 const {p}=s;await p.locator('#fq').fill('Taylor');const clear=p.getByRole('button',{name:'Clear search',exact:true});ck(await clear.count()===1,'accessible inline Clear search exists while pending');ck(await clear.locator('svg').count()===1,'inline clear uses shared icon');
 await p.keyboard.press('Tab');ck(await focused(clear),'inline clear is keyboard reachable');await p.keyboard.press('Enter');ck(await focused(p.locator('#fq')),'inline clear restores search focus');await advance(p,500);ck(await p.locator('#fq').inputValue()===''&&await count(s)===10,'inline clear cancels pending search');
 await p.locator('#fq').fill('Taylor');await advance(p,220);await p.locator('#fq').fill('Priya');await advance(p,100);await p.getByRole('button',{name:'Remove filter: Matching “Taylor”',exact:true}).focus();await p.keyboard.press('Enter');await advance(p,500);ck(await p.locator('#fq').inputValue()===''&&await count(s)===10,'query chip removal cancels pending replacement');ck(await focused(p.locator('#fq')),'last chip removal still focuses search');
 await p.locator('#fq').fill('Taylor');await advance(p,220);await p.locator('.x-toggle').click();await p.locator('#fq').fill('Priya');await p.getByRole('button',{name:'Clear all',exact:true}).focus();await p.keyboard.press('Enter');await advance(p,500);ck(await count(s)===10&&await p.locator('#fq').inputValue()==='','Clear all cancels pending query and clears filters');ck(await focused(p.locator('#fq')),'Clear all preserves focus recovery');
 await p.locator('.x-toggle').click();await p.locator('#fq').fill('Priya');await clear.click();await advance(p,500);ck(await p.locator('.x-toggle').getAttribute('aria-pressed')==='true'&&await count(s)===5,'inline clear preserves other filters');await p.locator('.x-toggle').click();await shot(s,'cleared-focus');
 const returnHash=await p.evaluate(()=>location.hash);await p.locator('#fq').fill('Taylor');await p.evaluate(()=>{location.hash='#roles';});await new Promise(r=>setTimeout(r,20));ck(await p.locator('#fq').count()===0,'navigating unmounts Candidates');await advance(p,500);await p.evaluate(hash=>{location.hash=hash;},returnHash);await new Promise(r=>setTimeout(r,20));ck(await p.locator('#fq').inputValue()===''&&await count(s)===10,'returning to the committed URL discards pending search');
}
async function empty(s){
 const {p}=s;await p.locator('#fq').fill('no-fictional-person');await advance(p,220);ck(await p.locator('.x-empty').getByText('12 submissions are shared with you; the current filters hide all of them.',{exact:true}).count()===1,'empty explanation states the total hidden submissions');const clear=p.getByRole('button',{name:'Clear all filters',exact:true});ck((await clear.getAttribute('class')).includes('x-secondary'),'empty clear action is outlined secondary');ck(await clear.evaluate(el=>getComputedStyle(el).borderTopStyle)==='solid','empty clear action has visible border');await shot(s,'empty-state');await p.locator('#fq').fill('Taylor');await clear.focus();await p.keyboard.press('Enter');await advance(p,500);ck(await count(s)===10&&await p.locator('#fq').inputValue()==='','empty-state Clear cancels pending replacement');ck(await focused(p.locator('#fq')),'empty-state Clear focuses search');
}
try{await fs.mkdir(out,{recursive:true});for(const width of [1440,390])for(const theme of ['light','dark'])for(const view of ['pipeline','list'])for(const [name,fn]of [['wording',wording],['delay',debounce],['cancellation',cancellation],['empty state',empty]])await run(name,width,theme,view,fn);
 ck(!blocked.some(r=>r.method!=='GET'),'no attempted HTTP writes');ck(errors.length===0,`no browser errors: ${errors.join('; ')}`);await fs.writeFile(path.join(out,'results.json'),JSON.stringify({checks,failures,errors},null,2));console.log(`${checks} checks passed; ${failures.length} failed groups`);assert.deepEqual(failures,[]);
}finally{await browser.close();}
