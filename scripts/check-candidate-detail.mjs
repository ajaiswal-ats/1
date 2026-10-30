/* Local-only Sample 1 detail regression check. Uses the isolated fictional demo;
   all non-local requests are blocked. Never signs in or writes database records. */
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const APP=process.env.DETAIL_APP_URL||'http://127.0.0.1:5173/demo.html';
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/demo\.html$/.test(APP))throw Error('Use a local isolated demo only');
const out=path.resolve('compare-output/candidate-detail');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch();let checks=0;const errors=[],external=[];
const ck=(name,condition)=>{assert.ok(condition,name);checks++;console.log('PASS',name);};
try{
 for(const width of [390,760,900,1180,1440])for(const theme of ['light','dark']){
  const ctx=await browser.newContext({viewport:{width,height:1000},colorScheme:theme});
  await ctx.route('**/*',route=>{const u=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(u.hostname)||u.protocol==='data:')return route.continue();external.push(u.href);return route.abort();});
  await ctx.addInitScript(t=>localStorage.setItem('ro-portal-theme',t),theme);
  const pg=await ctx.newPage();pg.on('pageerror',e=>errors.push(String(e)));await pg.goto(APP+'#c-pr-isl?from=%23candidates&tab=interview');await pg.getByRole('heading',{name:'Recruiter screening with Revenue Optics',exact:true}).waitFor();await pg.evaluate(()=>document.fonts.ready);
  const tag=`${width}-${theme}`;
  ck(tag+' no horizontal overflow',await pg.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  ck(tag+' recorded facts and truthful recording absence',(await pg.locator('.detail-facts').innerText()).includes('3 weeks')&&(await pg.locator('.tabp').innerText()).includes('Recording unavailable in this demo.')&&await pg.locator('.tabp video,.tabp audio,.tabp [role=slider],.tabp button').count()===0);
  ck(tag+' correct responsive card order',await pg.evaluate(()=>{const a=document.querySelector('.chead').getBoundingClientRect(),b=document.querySelector('.candidate-body').getBoundingClientRect(),r=document.querySelector('.act').getBoundingClientRect();return innerWidth<=1180?a.y<r.y&&r.y<b.y:r.x>a.x&&b.y>a.y;}));
  await pg.screenshot({path:path.join(out,`screening-${tag}.png`),fullPage:true});
  if(width===390||width===1440){
   const ref=await ctx.newPage();await ref.route('**/*',route=>{const u=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(u.hostname)||u.protocol==='data:'?route.continue():route.abort();});await ref.addInitScript(t=>localStorage.setItem('ro-s1-theme',t),theme);await ref.goto('http://127.0.0.1:5181/#c-pr-isl?from=%23candidates&tab=interview');await ref.getByRole('heading',{name:'Recruiter screening with Revenue Optics',exact:true}).waitFor();await ref.evaluate(()=>document.fonts.ready);await ref.screenshot({path:path.join(out,`reference-${tag}.png`),fullPage:true});
   const metrics=(page,selectors)=>page.evaluate(ss=>ss.map(s=>{const e=document.querySelector(s),c=getComputedStyle(e),r=e.getBoundingClientRect();return {font:c.fontFamily,size:c.fontSize,color:c.color,radius:c.borderRadius,width:Math.round(r.width)};}),selectors);
   const actual=await metrics(pg,['.chead h1','.chead','.screening-summary h3']),expected=await metrics(ref,['.x-chead2 h1','.x-chead2','.x-scr-sum h3']);
   ck(tag+' Sample 1 heading typography, card width and radius',actual[0].size===expected[0].size&&actual[0].color===expected[0].color&&actual[0].font===expected[0].font&&actual[1].width===expected[1].width&&actual[1].radius===expected[1].radius&&actual[2].size===expected[2].size);
   fs.writeFileSync(path.join(out,`comparison-${tag}.json`),JSON.stringify({actual,expected},null,2));await ref.close();
  }
  await pg.getByRole('tab',{name:'Recruiter screening',exact:true}).focus();await pg.keyboard.press('ArrowRight');
  ck(tag+' ArrowRight selects and focuses Resume',await pg.getByRole('tab',{name:'Resume',exact:true}).getAttribute('aria-selected')==='true'&&await pg.evaluate(()=>document.activeElement?.id==='detail-tab-resume'));
  await pg.keyboard.press('Home');if(width===390||width===1440)await pg.screenshot({path:path.join(out,`summary-${tag}.png`),fullPage:true});ck(tag+' Home selects Summary',await pg.getByRole('tab',{name:'Summary',exact:true}).getAttribute('aria-selected')==='true');
  ck(tag+' summary groups retain existing evidence',await pg.locator('.requirement-group').count()===2&&(await pg.locator('.tabp').innerText()).includes('Must-haves'));
  await pg.getByRole('tab',{name:'Summary',exact:true}).press('End');ck(tag+' End selects Notes',await pg.getByRole('tab',{name:'Notes and history',exact:true}).getAttribute('aria-selected')==='true');
  await pg.getByRole('tab',{name:'Recruiter screening',exact:true}).click();await pg.reload();ck(tag+' refresh restores screening tab',await pg.getByRole('tab',{name:'Recruiter screening',exact:true}).getAttribute('aria-selected')==='true');
  ck(tag+' stage actions collapsed initially',await pg.locator('.other-stage-actions').getAttribute('open')===null);await pg.locator('.other-stage-actions>summary').focus();await pg.keyboard.press('Enter');ck(tag+' keyboard opens stage actions',await pg.locator('#mv').isVisible());await pg.getByRole('button',{name:'Move to Interview',exact:true}).click();ck(tag+' existing confirmation opens without saving',await pg.locator('#actForm').isVisible()&&await pg.evaluate(()=>localStorage.getItem('ro-portal-demo-actions')===null));await pg.locator('[data-cancel]').click();
  if(width===1440&&theme==='light'){
   await pg.getByRole('link',{name:'Next candidate',exact:true}).click();ck('next retains tab and filtered context',new URLSearchParams(new URL(pg.url()).hash.split('?')[1]).get('from')==='#candidates'&&await pg.getByRole('tab',{name:'Recruiter screening',exact:true}).getAttribute('aria-selected')==='true');
   await pg.goBack();ck('browser back restores original candidate',await pg.getByRole('heading',{name:'Priya Raman',exact:true}).isVisible());
   await pg.getByRole('link',{name:'← Back to candidates',exact:true}).click();await pg.locator('.x-board').waitFor();await pg.locator('.x-card').getByRole('link',{name:'Priya Raman',exact:true}).click();ck('candidate opened from board has list context',(await pg.locator('.detail-sequence').innerText()).includes('of 10'));
   const listHash='#candidates?role=isl&stage=To+review&dec=1&sort=name&view=list';await pg.goto(APP+listHash);await pg.getByRole('link',{name:'Priya Raman',exact:true}).click();ck('list detail uses all selected filters',(await pg.locator('.detail-sequence').innerText()).includes('of 3'));await pg.getByRole('link',{name:'Next candidate',exact:true}).click();await pg.getByRole('link',{name:'← Back to candidates',exact:true}).click();ck('return restores exact list URL',new URL(pg.url()).hash===listHash);
   await pg.goto(APP+'#c-pr-isl?from='+encodeURIComponent('#candidates?q=no-match'));ck('empty context disables both stepping controls',await pg.locator('.detail-arrow:disabled').count()===2);
   await pg.goto(APP+'#c-tb-rsm?from=%23candidates');ck('on-hold permission remains unchanged',await pg.locator('[data-form=interview]').count()===0&&await pg.locator('[data-form=decline]').count()===0);
   await pg.goto(APP+'#c-pr-isl?from=%23candidates');await pg.getByRole('tab',{name:'Summary',exact:true}).waitFor();await pg.evaluate(()=>{localStorage.setItem('sb-auth-sentinel','unchanged');localStorage.setItem('ro-portal-demo-actions',JSON.stringify([{type:'move',sid:'pr-isl',to:'Interview',d:'2026-10-12'}]));});await pg.reload();
   pg.once('dialog',d=>d.dismiss());await pg.getByRole('button',{name:'Reset demo',exact:true}).click();ck('cancel reset retains fictional actions',await pg.evaluate(()=>JSON.parse(localStorage.getItem('ro-portal-demo-actions')).length===1));
   pg.once('dialog',d=>d.accept());await pg.getByRole('button',{name:'Reset demo',exact:true}).click();await pg.locator('.x-board').waitFor();ck('reset clears only demo actions and preserves auth sentinel',await pg.evaluate(()=>localStorage.getItem('ro-portal-demo-actions')==='[]'&&localStorage.getItem('sb-auth-sentinel')==='unchanged'));
  }
  if(width<900){await pg.getByRole('button',{name:'Open navigation',exact:true}).click();ck(tag+' drawer locks background and focuses navigation',await pg.evaluate(()=>document.body.style.overflow==='hidden'&&document.querySelector('.main').inert&&!!document.activeElement?.closest('#side')));await pg.keyboard.press('Shift+Tab');ck(tag+' drawer traps reverse tab',await pg.evaluate(()=>document.activeElement?.textContent.includes('Sign out (demo)')));await pg.keyboard.press('Tab');ck(tag+' drawer wraps forward tab',await pg.evaluate(()=>document.activeElement?.textContent.includes('Candidates')));await pg.keyboard.press('Escape');ck(tag+' Escape restores menu focus and unlocks background',await pg.getByRole('button',{name:'Open navigation',exact:true}).getAttribute('aria-expanded')==='false'&&await pg.evaluate(()=>document.body.style.overflow!=='hidden'&&!document.querySelector('.main').inert&&document.activeElement?.getAttribute('aria-label')==='Open navigation'));}
  await ctx.close();
 }
 ck('no page errors',errors.length===0);ck('no external network requests',external.length===0);console.log(`${checks} checks passed. Screenshots: ${out}`);
}finally{await browser.close();}
