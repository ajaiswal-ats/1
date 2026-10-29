/* Audit 18–20: compare the supplied local Sample 1 with fictional demo data.
   External requests and every HTTP write are blocked. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const out=path.resolve('compare-output/candidates-responsive-batch');
const before=process.argv.includes('--before');
const browser=await chromium.launch();const failures=[],errors=[],blocked=[],comparisons=[];let checks=0;
const ck=(value,label)=>{checks++;if(!value)failures.push(label);};
async function setup(port){const context=await browser.newContext({viewport:{width:1440,height:900}});await context.route('**/*',r=>{if(/^http:\/\/127\.0\.0\.1:(5173|5181)\//.test(r.request().url())&&r.request().method()==='GET')return r.continue();blocked.push({url:r.request().url(),method:r.request().method()});return r.abort();});const p=await context.newPage();p.setDefaultTimeout(4000);p.on('pageerror',e=>errors.push(String(e)));return {p,context,port};}
async function metrics(p,ref){return p.evaluate(ref=>{
 const $=s=>document.querySelector(s),page=$(ref?'.x-page':'.pg-cands'),display=$('.x-disp'),show=$('.x-showing'),sort=$('#fSort'),trigger=$(ref?'.x-menu-btn':'.menubtn'),side=$(ref?'.x-side':'.side');
 const s=el=>getComputedStyle(el),rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
 return {padding:[s(page).paddingTop,s(page).paddingRight,s(page).paddingBottom,s(page).paddingLeft],page:rect(page),menu:s(trigger).display!=='none',side:rect(side),sidePosition:s(side).position,display:rect(display),search:rect($('#fq')),divider:s(display).borderLeftWidth,leftPadding:s(display).paddingLeft,sort:rect(sort),sortFont:s(sort).fontSize,sortPadding:[s(sort).paddingTop,s(sort).paddingRight],count:{font:s(show).fontFamily,size:s(show).fontSize,lineHeight:s(show).lineHeight,weight:s(show.querySelector('b')).fontWeight,numerals:[...show.querySelectorAll('b')].map(b=>s(b).fontVariantNumeric),whiteSpace:s(show).whiteSpace,wordBreak:s(show).wordBreak,rect:rect(show),text:show.textContent.replace(/\s+/g,' ').trim(),breaks:show.querySelectorAll('br').length},overflow:document.documentElement.scrollWidth>innerWidth,sortOverflow:sort.getBoundingClientRect().right>innerWidth,toolbarOverflow:display.scrollWidth>display.clientWidth+1};
 },ref);}
async function load(s,width,theme,view,hash='#candidates'){
 await s.p.setViewportSize({width,height:900});await s.p.goto(`http://127.0.0.1:${s.port}/${hash}`);await s.p.evaluate(()=>document.fonts.ready);
 await s.p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 if(view==='list'&&!hash.includes('view=list'))await s.p.getByRole('button',{name:'List',exact:true}).click();
 await s.p.waitForTimeout(230);
}
const a=await setup(5173),r=await setup(5181);
try{await fs.mkdir(out,{recursive:true});for(const width of (before?[390,761,900,1440]:[390,760,761,899,900,901,1024,1440]))for(const theme of (before?['light']:['light','dark']))for(const view of (before?['pipeline']:['pipeline','list'])){
 await load(a,width,theme,view);await load(r,width,theme,view);
 const actual=await metrics(a.p,false),expected=await metrics(r.p,true),label=`${width}/${theme}/${view}`;
 comparisons.push({label,actual,expected});
 ck(JSON.stringify(actual.padding)===JSON.stringify(expected.padding),`${label}: Candidates padding`);
 ck(actual.menu===expected.menu,`${label}: sidebar breakpoint`);
 ck(Math.abs(actual.page.x-expected.page.x)<1,`${label}: sidebar/page column`);
 for(const field of ['font','size','lineHeight','weight','numerals','whiteSpace','wordBreak','text'])ck(JSON.stringify(actual.count[field])===JSON.stringify(expected.count[field]),`${label}: result count ${field}`);
 ck(actual.count.breaks===0,`${label}: no hardcoded line breaks`);
 ck(Math.abs(actual.count.rect.height-expected.count.rect.height)<1,`${label}: natural count wrapping`);
 ck(actual.divider===expected.divider&&actual.leftPadding===expected.leftPadding,`${label}: wrapped display divider/padding`);
 ck(Math.abs(actual.sort.width-expected.sort.width)<1,`${label}: Sort width (actual ${actual.sort.width}, reference ${expected.sort.width})`);
 ck(actual.sort.height===expected.sort.height&&actual.sortFont===expected.sortFont&&JSON.stringify(actual.sortPadding)===JSON.stringify(expected.sortPadding),`${label}: Sort size/typography`);
 ck(!actual.overflow&&!actual.sortOverflow&&!actual.toolbarOverflow,`${label}: no page or toolbar overflow`);
 const prefix=before?'before':'after';
 await a.p.screenshot({path:path.join(out,`${prefix}-${width}-${theme}-${view}.png`)});if(!before)await r.p.screenshot({path:path.join(out,`reference-${width}-${theme}-${view}.png`)});
 console.log(`CHECK ${label}`);
}
 // Reflow with changing labels, not only initial viewport sizes.
 for(const width of [761,900,1024,1440]){await load(a,width,'light','pipeline','#candidates?role=isl&stage=Interview&dec=1');const m=await metrics(a.p,false);const wrapped=m.display.y>m.search.y+m.search.height-4;ck(!wrapped||(m.divider==='0px'&&m.leftPadding==='0px'),`${width}: selected labels remove divider when wrapped`);}
 // Resize the same mounted toolbar in both directions; URL/filter state must survive.
 await load(a,1440,'light','pipeline');
 await a.p.locator('.x-fbtn').first().click();await a.p.locator('.x-fmenu:visible').getByLabel('Inside Sales Leader',{exact:false}).check();await a.p.keyboard.press('Escape');
 const selectedURL=a.p.url();
 for(const width of [1024,761,899,900,1440]){await a.p.setViewportSize({width,height:900});await a.p.waitForTimeout(230);const m=await metrics(a.p,false),wrapped=m.display.y>m.search.y+m.search.height-4;ck(m.divider===(wrapped?'0px':'1px')&&m.leftPadding===(wrapped?'0px':'14px'),`${width}: live reflow updates divider and padding`);ck(a.p.url()===selectedURL,`${width}: resizing preserves URL filters`);}
 // Real keyboard focus trapping and scroll locking on either side of the boundary.
 if(!before)for(const width of [390,760,761,899]){await load(a,width,'light','pipeline');const p=a.p;await p.getByRole('button',{name:'Open navigation',exact:true}).click();ck(await p.locator('.main').evaluate(el=>el.inert),'drawer makes background inert');ck(await p.evaluate(()=>document.body.style.overflow)==='hidden','drawer locks scroll');await p.keyboard.press('Shift+Tab');ck(await p.getByRole('button',{name:'Dark theme',exact:true}).evaluate(el=>el===document.activeElement),'drawer traps reverse Tab');await p.keyboard.press('Tab');ck(await p.locator('#nav a').first().evaluate(el=>el===document.activeElement),'drawer traps forward Tab');await p.keyboard.press('Escape');ck(await p.evaluate(()=>document.body.style.overflow)!=='hidden','Escape unlocks scroll');ck(await p.getByRole('button',{name:'Open navigation',exact:true}).evaluate(el=>el===document.activeElement),'Escape restores trigger focus');await p.getByRole('button',{name:'Open navigation',exact:true}).click();await p.setViewportSize({width:900,height:900});await p.waitForTimeout(230);ck(await p.evaluate(()=>document.body.style.overflow)!=='hidden'&&!await p.locator('.main').evaluate(el=>el.inert),'crossing 900 closes drawer and releases lock');await p.keyboard.press('Escape');}
 ck(errors.length===0,'no browser errors');ck(blocked.every(r=>r.method==='GET'&&r.url.startsWith('https://fonts.googleapis.com/')),'only the reference external font request was blocked; no writes');
 const result={checks,failures,errors,blocked,comparisons};await fs.writeFile(path.join(out,before?'before.json':'results.json'),JSON.stringify(result,null,2));console.log(`${checks} checks; ${failures.length} failures`);console.log(failures.slice(0,25).join('\n'));if(!before)assert.deepEqual(failures,[]);
}finally{await a.context.close();await r.context.close();await browser.close();}
