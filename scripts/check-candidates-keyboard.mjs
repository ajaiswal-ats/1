/* Keyboard regressions for audit items 9, 10 and 14. Fictional local demo only.
   All external requests and non-GET HTTP requests are blocked. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const out=path.resolve('compare-output/candidates-keyboard-batch');
const browser=await chromium.launch();
let checks=0;const failures=[],errors=[],blocked=[];
const ck=(ok,message)=>{assert.ok(ok,message);checks++;};
const focused=locator=>locator.evaluate(el=>el===document.activeElement);
async function applyCandidateSearch(p,value){
 await p.locator('#fq').fill(value);
 await p.waitForFunction(q=>Array.from(document.querySelectorAll('.x-resultline .x-fchip')).some(el=>el.textContent.startsWith(`Matching “${q}”`)),value);
}
async function page(width,theme){
 const ctx=await browser.newContext({viewport:{width,height:900}});
 await ctx.addInitScript(()=>{localStorage.clear();sessionStorage.clear();});
 await ctx.route('**/*',r=>{if(r.request().url().startsWith('http://127.0.0.1:')&&r.request().method()==='GET')return r.continue();blocked.push({url:r.request().url(),method:r.request().method()});return r.abort();});
 const p=await ctx.newPage();p.setDefaultTimeout(4000);p.on('pageerror',e=>errors.push(String(e)));
 await p.goto('http://127.0.0.1:5173/#candidates');await p.evaluate(()=>document.fonts.ready);
 if(theme==='dark'){if(width<760)await p.getByRole('button',{name:'Open navigation',exact:true}).click();await p.getByRole('button',{name:'Dark theme',exact:true}).click();if(width<760)await p.keyboard.press('Escape');}
 return {p,ctx,width,theme};
}
async function shot(s,name){await s.p.screenshot({path:path.join(out,`${s.width}-${s.theme}-${name}.png`)});}
async function run(label,width,theme,fn){const s=await page(width,theme);try{await fn(s);console.log(`PASS ${label} ${width}px ${theme}`);}catch(e){failures.push(`${label} ${width}px ${theme}: ${e.message}`);console.log(`FAIL ${failures.at(-1)}`);}finally{await s.ctx.close();}}
async function keyboardMenu(s){
 const {p}=s;
 for(const kind of ['roles','stages']){
  const trigger=p.locator('.x-fbtn').nth(kind==='roles'?0:1);await trigger.focus();await p.keyboard.press('Enter');
  const menu=p.locator('.x-fmenu:visible'),search=menu.getByRole('searchbox',{name:`Search ${kind}`,exact:true});
  ck(await focused(search),`${kind}: opening with Enter focuses search`);
  await p.keyboard.type(kind==='roles'?'Sales':'INTER');
  const before=await search.inputValue();await p.keyboard.press('ArrowLeft');await p.keyboard.type('X');
  ck(await search.inputValue()===before.slice(0,-1)+'X'+before.slice(-1),`${kind}: Left arrow preserves text editing`);
  await p.keyboard.press('ControlOrMeta+A');await p.keyboard.type(kind==='roles'?'Sales':'INTER');
  const value=await search.inputValue(),opts=menu.locator('input[type=checkbox]');
  await p.keyboard.press('ArrowDown');ck(await focused(opts.first()),`${kind}: Down enters visible options`);
  ck(await search.inputValue()===value,`${kind}: Down does not change search text`);
  await p.keyboard.press('Space');ck(await opts.first().isChecked(),`${kind}: Space selects a checkbox`);
  await p.keyboard.press('Space');ck(!await opts.first().isChecked(),`${kind}: Space clears the checkbox`);
  await p.keyboard.press('ArrowUp');ck(await focused(search),`${kind}: Up returns to search`);
  await p.keyboard.press('ArrowUp');ck(await focused(opts.last()),`${kind}: Up wraps to last visible option`);
  await p.keyboard.press('ArrowDown');ck(await focused(search),`${kind}: Down wraps to search`);
  await p.keyboard.press('ControlOrMeta+A');await p.keyboard.type('no-match');await p.keyboard.press('ArrowDown');
  ck(kind==='roles'?await focused(search):await focused(menu.getByLabel('Include declined',{exact:false})),`${kind}: arrows handle no matching options`);
  await p.keyboard.press('Escape');ck(await menu.count()===0,`${kind}: Escape closes menu`);ck(await focused(trigger),`${kind}: Escape returns focus to trigger`);
  await p.keyboard.press('Space');ck(await p.locator('.x-fmenu:visible').count()===1,`${kind}: Space can reopen trigger`);
  await p.locator('.x-fmenu:visible input[type=search]').fill('');await shot(s,`${kind}-search-focus`);await p.keyboard.press('Escape');
 }
}
async function dismiss(s){
 const {p}=s,role=p.locator('.x-fbtn').first(),stage=p.locator('.x-fbtn').nth(1);
 for(const target of [p.locator('#fq'),p.locator('.x-toggle'),p.getByRole('button',{name:'List',exact:true}),p.locator('#fSort'),p.locator('h1')]){
  await role.click();await target.click();ck(await p.locator('.x-fmenu:visible').count()===0,'outside click, including toolbar, dismisses menu');
 }
 await role.click();await stage.click();ck(await p.locator('#filter-stages').isVisible()&&await p.locator('#filter-roles').count()===0,'clicking other trigger switches menus');
 await stage.click();ck(await p.locator('.x-fmenu:visible').count()===0,'clicking the same trigger toggles closed');
 await role.focus();await p.keyboard.press('Enter');await p.keyboard.press('Shift+Tab');
 ck(await p.locator('.x-fmenu:visible').count()===0&&await focused(role),'Shift+Tab out closes without stealing trigger focus');
 await stage.focus();await p.keyboard.press('Enter');
 for(let i=0;i<6;i++)await p.keyboard.press('Tab'); // search → 5 checkboxes → next toolbar control (Clear disabled).
 ck(await p.locator('.x-fmenu:visible').count()===0&&await focused(p.locator('.x-toggle')),'Tab beyond menu closes and preserves next control focus');
 await role.click();await p.locator('#q').focus();ck(await p.locator('.x-fmenu:visible').count()===0,'focus moving to shell closes menu');
 await shot(s,'menu-dismissed');
}
async function chips(s){
 const {p}=s;await applyCandidateSearch(p,'Taylor');
 if(s.width<760){await p.locator('.x-fmore').click();await p.getByRole('dialog').getByLabel('Inside Sales Leader',{exact:false}).check();await p.getByRole('dialog').getByLabel('To review',{exact:false}).check();await p.getByRole('dialog').getByLabel('Include declined',{exact:false}).check();await p.keyboard.press('Escape');}
 else{await p.locator('.x-fbtn').first().click();await p.locator('.x-fmenu:visible').getByLabel('Inside Sales Leader',{exact:false}).check();await p.keyboard.press('Escape');await p.locator('.x-fbtn').nth(1).click();await p.locator('.x-fmenu:visible').getByLabel('To review',{exact:false}).check();await p.locator('.x-fmenu:visible').getByLabel('Include declined',{exact:false}).check();await p.keyboard.press('Escape');}
 await p.locator('.x-toggle').click();
 const buttons=p.locator('.x-fchip button');ck(await buttons.count()===5,'five active chips');
 await buttons.nth(1).focus();await p.keyboard.press('Enter');ck(await focused(buttons.nth(1)), 'removing a middle chip focuses its successor');
 ck((await buttons.nth(1).getAttribute('aria-label')).includes('Stage:'),'middle removal focuses the following stage chip');
 await buttons.first().focus();await p.keyboard.press('Enter');ck(await focused(buttons.first()),'removing first chip focuses following chip');
 ck((await buttons.first().getAttribute('aria-label')).includes('Stage:'),'the following stage chip receives focus');await shot(s,'chip-next-focus');
 await buttons.last().focus();await p.keyboard.press('Space');ck(await focused(buttons.first()),'removing last chip wraps to next remaining chip');
 await p.keyboard.press('Enter');await p.keyboard.press('Enter');ck(await buttons.count()===0&&await focused(p.locator('#fq')),'removing final chip focuses search');
 await p.keyboard.type('Taylor');await p.waitForFunction(()=>Array.from(document.querySelectorAll('.x-fchip')).some(el=>el.textContent.startsWith('Matching “Taylor”')));await p.locator('.x-toggle').click();
 const clear=p.getByRole('button',{name:'Clear all',exact:true});await clear.focus();await p.keyboard.press('Enter');
 ck(await buttons.count()===0&&await focused(p.locator('#fq')),'Clear all returns focus to search');ck(await p.locator('#fq').inputValue()==='','Clear all clears query');
 await p.keyboard.type('not-a-person');await p.getByRole('button',{name:'Clear all filters',exact:true}).focus();await p.keyboard.press('Enter');
 ck(await focused(p.locator('#fq')),'empty-state Clear all filters also focuses search');await shot(s,'clear-search-focus');
}
async function mobile(s){
 const {p}=s;await p.getByRole('button',{name:'Open navigation',exact:true}).click();
 const drawer=p.locator('.side'),first=drawer.locator('a[href]').first(),last=drawer.locator('a[href],button:not(:disabled)').last();
 ck(await focused(first),'navigation drawer focuses first link');ck(await p.locator('.main').evaluate(el=>el.inert),'navigation background remains inert');ck(await p.evaluate(()=>document.body.style.overflow==='hidden'),'navigation scroll lock preserved');
 await p.keyboard.press('Shift+Tab');ck(await focused(last),'navigation reverse Tab trapped');await p.keyboard.press('Tab');ck(await focused(first),'navigation forward Tab trapped');
 await p.keyboard.press('Escape');ck(await focused(p.getByRole('button',{name:'Open navigation',exact:true})),'navigation Escape returns focus');ck(!await p.locator('.main').evaluate(el=>el.inert),'navigation inert restored');
 await p.locator('.x-fmore').click();const sheet=p.getByRole('dialog'),close=sheet.getByRole('button',{name:'Close filters',exact:true}),show=sheet.getByRole('button',{name:/Show \d+ results/});
 ck(await focused(sheet.getByRole('searchbox',{name:'Search roles',exact:true})),'filter sheet initially focuses role search');await p.keyboard.press('Shift+Tab');ck(await focused(close),'reverse Tab from role search reaches Close');await p.keyboard.press('Shift+Tab');ck(await focused(show),'filter sheet reverse Tab trapped');await p.keyboard.press('Tab');ck(await focused(close),'filter sheet forward Tab trapped');
 ck(await p.evaluate(()=>document.body.style.overflow==='hidden'),'filter sheet scroll lock preserved');await p.keyboard.press('Tab');await p.keyboard.type('Sales');ck(await sheet.getByRole('searchbox').inputValue()==='Sales','mobile role search still types normally');
 await shot(s,'mobile-filter-trap');await p.keyboard.press('Escape');ck(await focused(p.locator('.x-fmore')),'filter sheet Escape returns focus');ck(await p.locator('.x-fsheet').count()===0,'filter sheet closes');
}
try{
 await fs.mkdir(out,{recursive:true});
 for(const theme of ['light','dark']){
  await run('desktop keyboard',1440,theme,keyboardMenu);await run('desktop dismissal',1440,theme,dismiss);await run('desktop chips',1440,theme,chips);
  await run('mobile traps',390,theme,mobile);await run('mobile chips',390,theme,chips);
 }
 ck(!blocked.some(r=>r.method!=='GET'),'no HTTP writes attempted');ck(errors.length===0,`no page errors: ${errors.join('; ')}`);
 await fs.writeFile(path.join(out,'results.json'),JSON.stringify({checks,failures,errors},null,2));
 console.log(`${checks} checks passed; ${failures.length} failed groups`);assert.deepEqual(failures,[]);
}finally{await browser.close();}
