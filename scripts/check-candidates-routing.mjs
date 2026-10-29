/* Local fictional demo only. Blocks external requests and all HTTP writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const base='http://127.0.0.1:5173/',out=path.resolve('compare-output/candidates-routing-batch');
const browser=await chromium.launch();let checks=0;const failures=[],errors=[],blocked=[];
const ck=(v,label)=>{assert.ok(v,label);checks++;};
const settle=p=>p.waitForTimeout(280);
const names=p=>p.locator('.x-card .x-nm,tbody tr .x-nm').allTextContents();
async function snap(p){return {names:await names(p),query:await p.locator('#fq').inputValue(),summary:await p.locator('.x-showing').innerText(),chips:await p.locator('.x-fchip').allTextContents(),sort:await p.locator('#fSort').inputValue(),view:await p.getByRole('button',{name:'List',exact:true}).getAttribute('aria-pressed')};}
await fs.mkdir(out,{recursive:true});
try{for(const width of [1440,390])for(const theme of ['light','dark']){
 const context=await browser.newContext({viewport:{width,height:650}});
 await context.route('**/*',r=>{if(r.request().url().startsWith(base)&&r.request().method()==='GET')return r.continue();blocked.push(r.request().url());return r.abort();});
 const p=await context.newPage();p.setDefaultTimeout(5000);p.on('pageerror',e=>errors.push(String(e)));
 try{
  await p.goto(base+'#candidates?q=Taylor&role=isl,pa&stage=To+review,Interview&wait=1&dec=1&sort=recent&view=list');await p.locator('#fq').waitFor();
  ck(await p.locator('#fq').inputValue()==='Taylor','direct URL restores search');
  ck(await p.locator('#fSort').inputValue()==='recent','direct URL restores sort');
  ck(await p.locator('.x-toggle').getAttribute('aria-pressed')==='true','direct URL restores Waiting on you');
  ck(await p.locator('.x-fchip').count()===7,'direct URL restores roles, stages, declined and query chips');
  const before=await snap(p);await p.reload();await p.locator('#fq').waitFor();assert.deepEqual(await snap(p),before);checks++;
  if(theme==='dark'){if(width===390)await p.getByRole('button',{name:'Open navigation',exact:true}).click();await p.getByRole('button',{name:'Dark theme',exact:true}).click();if(width===390)await p.keyboard.press('Escape');}
  await p.screenshot({path:path.join(out,`${width}-${theme}-direct.png`),fullPage:true});
  // Empty result direct links survive refresh in both views.
  for(const view of ['pipeline','list']){await p.goto(base+`#candidates?q=no-fictional-person&role=isl&stage=Offer&wait=1&dec=1&view=${view}`);await settle(p);ck(await p.locator('.x-empty').count()===1,`${view} direct empty results`);const s=await snap(p);await p.reload();await p.locator('#fq').waitFor();assert.deepEqual(await snap(p),s);checks++;}
  // Invalid values cannot activate unknown filters, views, sort or booleans.
  await p.goto(base+'#candidates?role=not-real&stage=bogus&wait=true&dec=yes&view=evil&sort=evil');await settle(p);
  ck(await names(p).then(n=>n.length===10),'invalid values ignored');ck(await p.locator('.x-fchip').count()===0,'invalid filters leave no chips');
  // A committed search is shared by refresh and a new tab; pending text is never persisted.
  await p.locator('#fq').fill('Taylor');await settle(p);ck(new URLSearchParams(p.url().split('?')[1]).get('q')==='Taylor','committed debounce updates URL');ck((await names(p)).length===2,'committed search results');
  const committed=p.url();const tab=await context.newPage();await tab.goto(committed);await tab.locator('#fq').waitFor();assert.deepEqual(await names(tab),await names(p));checks++;await tab.close();
  await p.locator('#fq').fill('Priya');await p.reload();await p.locator('#fq').waitFor();await settle(p);ck(await p.locator('#fq').inputValue()==='Taylor','refresh drops pending debounce');
  // Distinct list URLs are ordinary history entries; edits replace, never push/loop.
  await p.goto(base+'#candidates?q=Priya&view=list');await settle(p);await p.locator('#fq').fill('Casey');await p.goBack();await settle(p);ck(await p.locator('#fq').inputValue()==='Taylor','Back cancels pending debounce');ck(p.url()===committed,'Back does not rewrite restored URL');await p.goForward();await settle(p);ck(await p.locator('#fq').inputValue()==='Priya','Forward restores next entry');
  // Open a candidate at a real scroll position, then use Back/Forward, breadcrumb and sidebar.
  await p.goto(base+'#candidates?sort=name&view=list&dec=1');await settle(p);await p.locator('tbody tr .x-nm').last().scrollIntoViewIfNeeded();const y=await p.evaluate(()=>scrollY);const listURL=p.url(),listing=await names(p);ck(y>0,'list has a nonzero scroll position');
  await p.locator('tbody tr .x-nm').last().click();await p.locator('.crumb').waitFor();ck(p.url().includes('?from='),'candidate carries return context');ck(await p.locator('.crumb').getByRole('link',{name:'Back to candidates',exact:false}).count()===1,'candidate ID resolves with from query');
  const candidateURL=p.url();
  const directCandidate=await context.newPage();await directCandidate.goto(candidateURL);await directCandidate.locator('.crumb').waitFor();ck(await directCandidate.locator('.crumb a').first().getAttribute('href')===listURL.slice(base.length),'fresh candidate tab carries its return URL');await directCandidate.locator('.crumb a').first().click();await directCandidate.locator('#fq').waitFor();assert.deepEqual(await names(directCandidate),listing);checks++;await directCandidate.close();
  await p.goBack();await p.locator('#fq').waitFor();await settle(p);ck(p.url()===listURL,'Back returns exact list URL');ck(Math.abs(await p.evaluate(()=>scrollY)-y)<3,'Back restores scroll');assert.deepEqual(await names(p),listing);checks++;
  await p.goForward();await p.locator('.crumb').waitFor();ck(p.url()===candidateURL,'Forward returns candidate without loop');await p.reload();await p.locator('.crumb').waitFor();await p.locator('.crumb a').first().click();await p.locator('#fq').waitFor();await settle(p);ck(p.url()===listURL,'breadcrumb restores URL after detail refresh');ck(Math.abs(await p.evaluate(()=>scrollY)-y)<3,'breadcrumb restores scroll after detail refresh');
  await p.screenshot({path:path.join(out,`${width}-${theme}-returned.png`)});
  await p.evaluate(()=>{location.hash='#roles';});await settle(p);if(width===390)await p.getByRole('button',{name:'Open navigation',exact:true}).click();await p.locator('#nav a').filter({hasText:'Candidates'}).click();await p.locator('#fq').waitFor();await settle(p);ck(p.url()===listURL,'sidebar restores last context');ck(Math.abs(await p.evaluate(()=>scrollY)-y)<3,'sidebar restores scroll');
  await p.goto(base+'#candidates?dec=1&sort=recent&view=list');await settle(p);await p.evaluate(()=>scrollTo(0,0));await p.waitForTimeout(30);await p.goBack();await settle(p);
  ck(p.url()===listURL,'Back between list entries restores URL');ck(Math.abs(await p.evaluate(()=>scrollY)-y)<3,'Back between list entries restores that entry scroll');
  // Every control writes the same URL schema, without adding history entries.
  await p.goto(base+'#candidates');await settle(p);const historyLength=await p.evaluate(()=>history.length);
  await p.locator('#fq').fill('Sales');await settle(p);
  const open=async kind=>{if(width===390){await p.locator('.x-fmore').click();return p.locator('.x-fsheet');}await p.locator('.x-fbtn').nth(kind==='roles'?0:1).click();return p.locator('.x-fmenu:visible');};
  let menu=await open('roles');await menu.getByLabel('Inside Sales Leader',{exact:false}).check();await menu.getByLabel('Regional Sales Manager',{exact:false}).check();await p.keyboard.press('Escape');
  menu=await open('stages');await menu.getByLabel('To review',{exact:false}).check();await menu.getByLabel('Interview',{exact:false}).check();await menu.getByLabel('Include declined',{exact:false}).check();await p.keyboard.press('Escape');
  await p.locator('.x-toggle').click();await p.locator('#fSort').selectOption('name');await p.getByRole('button',{name:'List',exact:true}).click();
  const params=new URLSearchParams(p.url().split('?')[1]);
  for(const [key,value] of Object.entries({q:'Sales',role:'isl,rsm',stage:'To review,Interview',wait:'1',dec:'1',sort:'name',view:'list'}))ck(params.get(key)===value,`${key} control writes URL`);
  ck(await p.evaluate(()=>history.length)===historyLength,'filter updates replace current history entry');
  const filtered=await snap(p),filteredURL=p.url();await p.reload();await p.locator('#fq').waitFor();assert.deepEqual(await snap(p),filtered);checks++;
  // A candidate opened during pending typing returns to committed filters in both views.
  for(const view of ['pipeline','list']){
   await p.goto(filteredURL.replace('view=list',`view=${view}`));await settle(p);const committedURL=p.url(),shown=await names(p);ck(shown.length>0,'filtered candidate link available');
   await p.locator('#fq').fill('uncommitted-fictional-query');const link=p.locator('.x-card .x-nm,tbody tr .x-nm').first();await link.focus();await p.keyboard.press('Enter');await p.locator('.crumb').waitFor();await settle(p);
   await p.locator('.crumb a').first().click();await p.locator('#fq').waitFor();await settle(p);ck(p.url()===committedURL,`${view} return discards pending query`);assert.deepEqual(await names(p),shown);checks++;ck(await p.locator('#fq').inputValue()==='Sales',`${view} return restores committed search`);
  }
  await p.goto(base+'#c-tb-isl?from='+encodeURIComponent('https://invalid.example/'));await p.locator('.crumb').waitFor();ck(await p.locator('.crumb a').first().getAttribute('href')==='#candidates','invalid return URL cannot navigate outside list');
  // Preserve the existing role-page entry point when URL state replaces legacy storage.
  await p.goto(base+'#role-isl');await p.getByRole('link',{name:'Open in Candidates',exact:true}).click();await p.locator('#fq').waitFor();await settle(p);
  ck(new URLSearchParams(p.url().split('?')[1]).get('role')==='isl','role-page link still scopes Candidates');
  ck(await p.locator('.x-fchip').filter({hasText:'Inside Sales Leader'}).count()===1,'role-page scope is visible');
  console.log(`PASS ${width} ${theme}`);
 }catch(e){failures.push(`${width} ${theme}: ${e.stack}`);console.log(`FAIL ${width} ${theme}: ${e.message}`);}finally{await context.close();}
}ck(errors.length===0,`no browser errors: ${errors}`);ck(blocked.length===0,'no external requests or writes');await fs.writeFile(path.join(out,'results.json'),JSON.stringify({checks,failures,errors,blocked},null,2));console.log(`${checks} checks; ${failures.length} failed groups`);assert.deepEqual(failures,[]);
}finally{await browser.close();}
