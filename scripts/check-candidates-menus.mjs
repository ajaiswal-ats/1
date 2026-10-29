/* Candidates menu regressions: Stage search, Open/On hold groups, and Sample 1 footers.
   Fictional local sessions only; no external requests or HTTP writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const out=path.resolve('compare-output/candidates-menu-batch');
const browser=await chromium.launch();
let checks=0;const errors=[];
const ck=(ok,label)=>{assert.ok(ok,label);checks++;};
async function setup(ref,width,theme){
 const context=await browser.newContext({viewport:{width,height:900}});
 await context.addInitScript(()=>{localStorage.clear();sessionStorage.clear();});
 await context.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')&&r.request().method()==='GET'?r.continue():r.abort());
 const p=await context.newPage();p.setDefaultTimeout(5000);p.on('pageerror',e=>errors.push(String(e)));
 await p.goto(`http://127.0.0.1:${ref?5181:5173}/#candidates`);await p.evaluate(()=>document.fonts.ready);
 if(theme==='dark'){if(width<760)await p.locator(ref?'.x-menu-btn':'.menubtn').click();await p.getByRole('button',{name:'Dark theme',exact:true}).click();if(width<760){await p.keyboard.press('Escape');await p.waitForTimeout(250);}}
 return {p,context,ref,width,theme};
}
async function open(s,kind){
 await s.p.locator(s.width<760?'.x-fmore':s.ref?(kind==='roles'?'#fRole':'#fStage'):'.x-fbtn').nth(s.width<760||s.ref?0:kind==='roles'?0:1).click();
 return s.p.locator(s.width<760?'.x-fsheet':'.x-fmenu:visible');
}
async function shot(s,label){await s.p.screenshot({path:path.join(out,`${s.ref?'reference':'app'}-${s.width}-${s.theme}-${label}.png`)});}
async function verify(s){
 const {p,width}=s;const mobile=width<760;let root=await open(s,'roles');
 const roleRoot=mobile?root.locator('fieldset').first():root;
 ck(await roleRoot.locator('.x-fgrp').allTextContents().then(a=>JSON.stringify(a)===JSON.stringify(['Open','On hold'])),'roles grouped under Open and On hold');
 ck(await roleRoot.getByRole('group',{name:'Open',exact:true}).getByLabel('Inside Sales Leader',{exact:false}).count()===1,'open role belongs to Open group');
 ck(await roleRoot.getByRole('group',{name:'On hold',exact:true}).getByLabel('Regional Sales Manager',{exact:false}).count()===1,'held role belongs to On hold group');
 let clear=root.getByRole('button',{name:'Clear',exact:true});ck(await clear.isDisabled(),'Clear disabled without selections');
 ck(await root.getByRole('button',{name:'Done',exact:true}).count()===0,'no extra Done button');
 if(!mobile)ck(await root.locator('.x-fmf span').innerText()==='Any role','Any role footer');
 await shot(s,'roles-default');
 const roleSearch=root.getByRole('searchbox',{name:'Search roles',exact:true});await roleSearch.fill('Regional');
 ck(await roleRoot.locator('.x-fgrp').allTextContents().then(a=>JSON.stringify(a)===JSON.stringify(['On hold'])),'role search hides empty group');
 ck(await clear.isDisabled(),'search text alone does not enable Clear');
 await roleSearch.fill('no-such-role');ck(await roleRoot.locator('.x-fgrp').count()===0,'no empty headings for unmatched role search');
 await roleSearch.fill('');await root.getByLabel('Inside Sales Leader',{exact:false}).check();await root.getByLabel('Pricing Analyst',{exact:false}).check();
 ck(await clear.isEnabled(),'Clear enabled after role selection');
 if(!mobile)ck(await root.locator('.x-fmf span').innerText()==='2 selected','role selected-count summary');
 await roleSearch.fill('Regional');if(!mobile)ck(await root.locator('.x-fmf span').innerText()==='2 selected','selected summary counts hidden selected roles');
 await shot(s,'roles-selected');await clear.click();ck(await clear.isDisabled(),'role Clear disabled after clearing');
 if(!mobile)ck(await root.locator('.x-fmf span').innerText()==='Any role','role footer resets');
 await roleSearch.fill('');await p.keyboard.press('Escape');root=await open(s,'stages');
 const stageRoot=mobile?root.locator('fieldset').nth(1):root;clear=root.getByRole('button',{name:'Clear',exact:true});
 ck(await clear.isDisabled(),'stage/sheet Clear starts disabled');
 if(!mobile){
  ck(await root.getByRole('searchbox',{name:'Search stages',exact:true}).count()===1,'Stage-menu search exists');
  ck(await root.locator('.x-fmf span').innerText()==='Any stage','Any stage footer');
  const search=root.getByRole('searchbox',{name:'Search stages',exact:true});
  await search.fill('INTER');ck(await stageRoot.locator('.x-fopt .x-ft').allTextContents().then(a=>JSON.stringify(a)===JSON.stringify(['Interview','Include declined'])),'Stage search is case-insensitive and keeps Include declined');
  ck(await p.locator('.x-card').count()===10,'menu search alone does not filter candidates');
  ck(await clear.isDisabled(),'Stage search alone does not enable Clear');
  await shot(s,'stage-search-match');
  await search.fill('not-a-stage');ck(await root.getByText(/No stages match/).count()===1,'Stage search empty state');ck(await root.getByLabel('Include declined',{exact:false}).count()===1,'Include declined remains accessible when no stage matches');
  await shot(s,'stage-search-empty');await search.fill('');
 }else ck(await root.getByRole('searchbox',{name:'Search stages',exact:true}).count()===0,'mobile matches Sample 1 with fixed Stage options');
 await stageRoot.getByLabel('Include declined',{exact:false}).check();ck(await clear.isEnabled(),'Include declined alone enables Clear');
 if(!mobile)ck(await root.locator('.x-fmf span').innerText()==='Any stage','Include declined does not count as a selected live stage');
 await shot(s,'declined-only');
 await stageRoot.getByLabel('To review',{exact:false}).check();await stageRoot.getByLabel('Interview',{exact:false}).check();
 if(!mobile)ck(await root.locator('.x-fmf span').innerText()==='2 selected','stage selected-count summary');
 await shot(s,'stages-selected');await clear.click();ck(await clear.isDisabled(),'Stage Clear disabled after clearing');
 ck(await stageRoot.getByLabel('Include declined',{exact:false}).isChecked()===false,'Stage Clear also clears Include declined');
 ck(await stageRoot.locator('input[type=checkbox]:checked').count()===0,'Stage Clear removes stage selections');
 await p.keyboard.press('Escape');await p.getByRole('button',{name:'List',exact:true}).click();
 ck(await p.locator('tbody tr').count()===10,'clearing restores original ten visible submissions in list');
 return p.locator('tbody tr .x-nm').allTextContents();
}
try{
 await fs.mkdir(out,{recursive:true});
 for(const width of [1440,390])for(const theme of ['light','dark']){
  const app=await setup(false,width,theme),ref=await setup(true,width,theme);
  try{const actual=await verify(app),expected=await verify(ref);assert.deepEqual(actual,expected,'final results match Sample 1');checks++;console.log(`PASS ${width}px ${theme}`);}finally{await app.context.close();await ref.context.close();}
 }
 ck(errors.length===0,`no browser errors: ${errors.join('; ')}`);
 await fs.writeFile(path.join(out,'results.json'),JSON.stringify({checks,errors},null,2));
 console.log(`${checks} menu checks passed. Screenshots: ${out}`);
}finally{await browser.close();}
