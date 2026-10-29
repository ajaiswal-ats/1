/* Audit 21, 23, 24: fictional demo and static Sample 1 only. Blocks external requests and all HTTP writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const out=path.resolve('compare-output/candidates-metadata-batch'),browser=await chromium.launch();
let checks=0;const failures=[],errors=[],blocked=[],comparisons=[];
const ck=(ok,label)=>{assert.ok(ok,label);checks++;};
const card=(p,name)=>p.locator('.x-card').filter({has:p.getByRole('link',{name,exact:true})}).first();
async function setup(port,width,theme,view){
 const ctx=await browser.newContext({viewport:{width,height:900}});await ctx.route('**/*',r=>{if(/^http:\/\/127\.0\.0\.1:(5173|5181)\//.test(r.request().url())&&r.request().method()==='GET')return r.continue();blocked.push({url:r.request().url(),method:r.request().method()});return r.abort();});
 const p=await ctx.newPage();p.setDefaultTimeout(4000);p.on('pageerror',e=>errors.push(String(e)));
 await p.goto(`http://127.0.0.1:${port}/#candidates?dec=1&view=${view}`);await p.evaluate(()=>document.fonts.ready);await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);return {p,ctx};
}
async function style(loc){return loc.evaluate(el=>{const s=getComputedStyle(el);return {fontSize:s.fontSize,color:s.color,marginTop:s.marginTop,lineHeight:s.lineHeight,fontVariantNumeric:s.fontVariantNumeric};});}
async function shot(p,name){await p.screenshot({path:path.join(out,name+'.png')});}
await fs.mkdir(out,{recursive:true});
try{for(const width of [1440,390])for(const theme of ['light','dark'])for(const view of ['pipeline','list']){
 const app=await setup(5173,width,theme,view),ref=await setup(5181,width,theme,view),{p}=app,label=`${width}-${theme}-${view}`;
 try{
  if(view==='list'){
   const cells=p.locator('tbody td[data-label="Recruiter screening"],tbody td[data-label="Client interview"],tbody td[data-label="Shared"]');
   ck((await cells.evaluateAll(els=>els.map(el=>getComputedStyle(el).fontSize))).every(v=>v==='13px'),'all metadata cells use 13px');
   for(const missing of ['None shared','None recorded']){
    const a=cells.filter({hasText:missing}).first(),r=ref.p.locator('tbody td').filter({hasText:missing}).first();assert.deepEqual(await style(a),await style(r));checks++;
   }
   const shared=p.locator('[data-label="Shared"]').first(),rShared=ref.p.locator('[data-label="Shared"]').first();assert.deepEqual(await style(shared),await style(rShared));checks++;
   ck(await shared.evaluate(el=>getComputedStyle(el).fontVariantNumeric)==='tabular-nums','Shared dates use tabular numerals');
   ck(await shared.locator('.x-nw').innerText().then(t=>/^\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/.test(t)),'Shared uses short day/month format');
   const scheduled=p.locator('tbody tr').filter({has:p.getByRole('link',{name:'Jordan Ellis',exact:true})});
   assert.deepEqual(await scheduled.locator('[data-label="Client interview"] .x-nw').allTextContents(),['Scheduled','Thu 15 Oct,','10:00–10:45 CT']);checks++;
   const feedback=p.locator('tbody tr').filter({has:p.getByRole('link',{name:'Grace Liu',exact:true})}).locator('[data-label="Client interview"]');
   ck(await feedback.innerText()==='Held · feedback given','legacy feedback does not invent an interview-held date');
   const also=p.locator('.x-also-l').first(),rAlso=ref.p.locator('.x-also-l').first();assert.deepEqual(await style(also),await style(rAlso));checks++;
   comparisons.push({label,metadata:await style(shared),also:await style(also)});
  }else{
   const screening=card(p,'Priya Raman').locator('[data-line="iv"] dt');
   ck(await screening.locator('.sr').innerText()==='Recruiter screening','assistive label identifies recruiter screening');ck(await screening.locator('[aria-hidden="true"]').innerText()==='Screening','compact visual label hidden from accessibility tree');
   assert.deepEqual(await card(p,'Jordan Ellis').locator('[data-line="iv"] dd .x-nw').allTextContents(),['Thu 15 Oct,','10:00–10:45 CT']);checks++;
   assert.deepEqual(await card(p,'Samuel Ortiz').locator('[data-line="iv"] dd .x-nw').allTextContents(),['Requested 6 Oct']);checks++;
   ck((await card(p,'Grace Liu').locator('[data-line="iv"] dd').innerText())==='Held · feedback given','board preserves feedback status without a made-up held date');
   const also=p.locator('.x-card .x-also').first(),rAlso=ref.p.locator('.x-card .x-also').first();assert.deepEqual(await style(also),await style(rAlso));checks++;
   comparisons.push({label,also:await style(also)});
  }
  ck(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow');
  ck(await p.locator('.x-nw').evaluateAll(els=>els.every(el=>getComputedStyle(el).whiteSpace==='nowrap')),'date/time fragments do not split');
  await shot(p,'after-'+label);await shot(ref.p,'reference-'+label);
  if(view==='pipeline'){
   await p.goto('http://127.0.0.1:5173/#candidates?role=rsm');await p.locator('.x-holdtag').first().waitFor();
   const tag=p.locator('.x-holdtag').first(),tip=p.locator('[role="tooltip"]:visible');
   const explanation='Regional Sales Manager is on hold, so stage changes are paused';
   await tag.hover();ck(await tip.innerText()===explanation,'hover displays hold explanation');await shot(p,`hover-${width}-${theme}`);
   ck(await tip.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}),'tooltip stays inside viewport and outside clipped card');
   await tip.hover();ck(await tip.isVisible(),'tooltip stays visible while hovered');await p.mouse.move(1,1);await p.waitForTimeout(180);ck(await tip.count()===0,'hover exit closes tooltip');
   await tag.locator('xpath=ancestor::article').locator('.x-nm').focus();await p.keyboard.press('Tab');await p.keyboard.press('Tab');ck(await tag.evaluate(el=>el===document.activeElement),'Tab reaches hold information');ck(await tip.innerText()===explanation,'keyboard focus displays explanation');
   ck(await tag.getAttribute('aria-describedby')===await tip.getAttribute('id'),'accessible description is connected');await shot(p,`keyboard-${width}-${theme}`);
   await p.keyboard.press('Escape');ck(await tip.count()===0&&await tag.evaluate(el=>el===document.activeElement),'Escape hides tooltip and keeps focus');await p.keyboard.press('Shift+Tab');await p.keyboard.press('Tab');ck(await tip.isVisible(),'keyboard focus can reopen tooltip');
   await p.mouse.move(1,1);ck(await tip.isVisible(),'focus keeps tooltip visible after pointer leaves');await p.keyboard.press('Tab');ck(await tip.count()===0,'focus leaving closes tooltip');
  }
  console.log(`PASS ${label}`);
 }catch(e){failures.push(`${label}: ${e.message}`);console.log(`FAIL ${label}: ${e.message}`);}finally{await app.ctx.close();await ref.ctx.close();}
}ck(errors.length===0,`no browser errors: ${errors}`);ck(blocked.every(r=>r.method==='GET'&&r.url.startsWith('https://fonts.googleapis.com/')),'no writes; only reference font request blocked');await fs.writeFile(path.join(out,'results.json'),JSON.stringify({checks,failures,errors,blocked,comparisons},null,2));console.log(`${checks} checks; ${failures.length} failed groups`);assert.deepEqual(failures,[]);
}finally{await browser.close();}
