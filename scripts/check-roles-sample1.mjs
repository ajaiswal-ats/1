/* Supplied static Sample 1 and fictional local demo only; block external requests and HTTP writes. */
import {chromium} from 'playwright';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
const out=path.resolve('compare-output/roles-sample1'),b=await chromium.launch();let checks=0;const failures=[],errors=[],blocked=[];const ck=(v,m)=>{assert.ok(v,m);checks++;};const pause=p=>p.waitForTimeout(80);
async function setup(port,width){const ctx=await b.newContext({viewport:{width,height:1000}});await ctx.route('**/*',r=>{if(/^http:\/\/127\.0\.0\.1:(5173|5181)\//.test(r.request().url())&&r.request().method()==='GET')return r.continue();blocked.push({url:r.request().url(),method:r.request().method()});return r.abort();});const p=await ctx.newPage();p.setDefaultTimeout(4000);p.on('pageerror',e=>errors.push(e.message));return {p,ctx,port};}
async function go(s,hash,theme){await s.p.goto(`http://127.0.0.1:${s.port}/${hash}`);await s.p.evaluate(()=>document.fonts.ready);await s.p.evaluate(t=>document.documentElement.dataset.theme=t,theme);await pause(s.p);}
const names=p=>p.locator('tbody tr td:first-child>a').allTextContents();
try{await fs.mkdir(out,{recursive:true});for(const width of [390,760,900,1440])for(const theme of ['light','dark']){
const a=await setup(5173,width),r=await setup(5181,width),label=`${width}-${theme}`;
try{
 for(const s of [a,r])await go(s,'#roles',theme);
 assert.deepEqual(await names(a.p),await names(r.p));checks++;
 const table=a.p.locator('#rolesTable'),ref=r.p.locator('#rolesTable');
 assert.deepEqual(await table.locator('tbody td').allTextContents(),await ref.locator('tbody td').allTextContents());checks++;
 const links=await table.locator('tbody a').evaluateAll(els=>els.map(el=>({text:el.textContent,href:el.getAttribute('href'),label:el.getAttribute('aria-label')})));
 const reference=await ref.locator('tbody a').evaluateAll(els=>els.map(el=>({text:el.textContent,href:el.getAttribute('href'),label:el.getAttribute('aria-label')})));assert.deepEqual(links,reference);checks++;
 for(const pair of [['.rv-table th','.x-table th'],['.rv-name','.x-nm'],['.rv-chip','.x-chip']]){
 const style=loc=>loc.first().evaluate(el=>{const s=getComputedStyle(el);return {font:s.fontFamily,size:s.fontSize,color:s.color,weight:s.fontWeight,background:s.backgroundColor,radius:s.borderRadius};});assert.deepEqual(await style(a.p.locator(pair[0])),await style(r.p.locator(pair[1])));checks++;
 }
 ck(await a.p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overview no page overflow');
 await a.p.screenshot({path:path.join(out,`${label}-roles-app.png`)});await r.p.screenshot({path:path.join(out,`${label}-roles-reference.png`)});
 for(const status of ['Open','On hold','All']){await a.p.getByRole('group',{name:'Role status'}).getByRole('button',{name:new RegExp('^'+status+' ')}).click();await r.p.getByRole('group',{name:'Role status'}).getByRole('button',{name:new RegExp('^'+status+' ')}).click();assert.deepEqual(await names(a.p),await names(r.p));checks++;}
 await a.p.reload();await a.p.locator('#rolesTable').waitFor();ck(await names(a.p).then(n=>n.length===4),'status refresh');await a.p.getByRole('button',{name:'On hold 1',exact:true}).click();await a.p.reload();await a.p.locator('#rolesTable').waitFor();ck(await names(a.p).then(n=>n.length===1&&n[0]==='Regional Sales Manager'),'filtered status survives refresh');await a.p.getByRole('button',{name:'All 4',exact:true}).click();
 // Every positive overview count opens the exact role/stage/waiting scope in Candidates.
 for(const link of links.filter(l=>l.href.startsWith('#candidates'))){await go(a,link.href,theme);const expected=Number(link.text);ck(await a.p.locator('.x-card').count()===expected,`count target ${link.label}`);}
 for(const id of ['isl','rsm']){
  for(const s of [a,r])await go(s,`#role-${id}`,theme);
  assert.deepEqual(await names(a.p),await names(r.p));checks++;
  ck(await a.p.locator('.rv-stage').count()===6,'six working stage links');ck(await a.p.locator('thead th').filter({hasText:/^Role$/}).count()===0,'role column omitted');
  await a.p.screenshot({path:path.join(out,`${label}-${id}-app.png`)});await r.p.screenshot({path:path.join(out,`${label}-${id}-reference.png`)});
  const stageLinks=await a.p.locator('.rv-stage').evaluateAll(els=>els.map(e=>e.getAttribute('href')));
  for(const href of stageLinks){for(const s of [a,r])await go(s,href,theme);assert.deepEqual(await names(a.p),await names(r.p));checks++;ck(await a.p.locator('.rv-showing').innerText()===await r.p.locator('#roleShowing').innerText(),'stage summary matches');}
  // Include declined and removing a stage preserve the current role scope.
  await go(a,`#role-${id}`,theme);await a.p.getByLabel('Include declined',{exact:true}).check();ck(await names(a.p).then(n=>n.length===4),'include declined adds role submissions');await a.p.reload();await a.p.locator('.rv-rolebar').waitFor();ck(await a.p.getByLabel('Include declined',{exact:true}).isChecked(),'role filter survives refresh');
  await a.p.locator('.rv-details summary').first().focus();await a.p.keyboard.press('Enter');ck(await a.p.locator('.rv-details').first().getAttribute('open')!==null,'keyboard expands job description');
  await a.p.locator('.rv-details summary').last().focus();await a.p.keyboard.press('Space');ck(await a.p.locator('.rv-details').last().getAttribute('open')!==null,'keyboard expands requirements');
  await go(a,`#role-${id}?stage=Interview`,theme);const original=a.p.url(),visible=await names(a.p);const candidate=a.p.locator('tbody tr td:first-child>a').first();await candidate.click();await a.p.locator('.crumb').waitFor();await a.p.getByRole('link',{name:'Back to role',exact:false}).click();await a.p.locator('.rv-rolebar').waitFor();ck(a.p.url()===original,'candidate returns to filtered role');assert.deepEqual(await names(a.p),visible);checks++;await a.p.goBack();await a.p.locator('.crumb').waitFor();await a.p.goBack();await a.p.locator('.rv-rolebar').waitFor();ck(a.p.url()===original,'Back returns filtered role without loops');await a.p.goForward();await a.p.locator('.crumb').waitFor();await a.p.goForward();await a.p.locator('.rv-rolebar').waitFor();ck(a.p.url()===original,'Forward restores role return');
  ck(await a.p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'detail no page overflow');
 }
 await go(a,'#role-isl?stage=bogus&dec=true',theme);ck(await a.p.locator('.rv-filterchip').count()===0&&!await a.p.getByLabel('Include declined',{exact:true}).isChecked(),'invalid role filters ignored');
 await go(a,'#roles?status=invalid',theme);ck(await names(a.p).then(n=>n.length===4),'invalid status ignored');
 console.log(`PASS ${label}`);
}catch(e){failures.push(`${label}: ${e.message}`);console.log(`FAIL ${label}: ${e.message}`);}finally{await a.ctx.close();await r.ctx.close();}
}ck(errors.length===0,`browser errors ${errors}`);ck(blocked.every(r=>r.method==='GET'&&r.url.startsWith('https://fonts.googleapis.com/')),'no writes or external calls');await fs.writeFile(path.join(out,'results.json'),JSON.stringify({checks,failures,errors,blocked},null,2));console.log(`${checks} checks; ${failures.length} failed groups`);assert.deepEqual(failures,[]);
}finally{await b.close();}
