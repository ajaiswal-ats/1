/* Regression checks for audit items 1, 2 and 6 only.
   Uses fresh, isolated fictional demo sessions. Blocks every external request and all non-GET HTTP requests.
   Requires local demo app (5173) and supplied Sample 1 reference (5181). Writes screenshots only to compare-output/. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const OUT=path.resolve("compare-output/items-1-2-6");
const browser=await chromium.launch();
const errors=[], blocked=[];
const mobileDarkOnly=process.argv.includes("--mobile-dark-only");
const variants=mobileDarkOnly ? [[390,"dark"]] : [[1440,"light"],[1440,"dark"],[390,"light"],[390,"dark"]];
let checks=0;
const check=(condition,message)=>{assert.ok(condition,message);checks++;};
const cases=[
 {name:"default"},
 {name:"review",stages:["To review"]},
 {name:"review-plus-declined",stages:["To review"],declined:true,expected:6},
 {name:"interview-plus-declined",stages:["Interview"],declined:true,expected:6},
 {name:"multiple-stages",stages:["To review","Offer"],declined:true},
 {name:"role-title",query:"Inside Sales Leader",expected:3},
 {name:"role-title-with-declined",query:"  INSIDE SALES LEADER  ",declined:true,expected:4},
 {name:"all-filters",query:"Inside Sales Leader",roles:["Inside Sales Leader"],stages:["To review"],declined:true,waiting:true,expected:2},
 {name:"empty-intersection",query:"Inside Sales Leader",roles:["Inside Sales Leader"],stages:["Interview"],declined:true,waiting:true,expected:0},
 {name:"declined-only-match",query:"Inside Sales Leader",roles:["Inside Sales Leader"],stages:["Offer"],declined:true,expected:1},
 {name:"different-role",query:"Inside Sales Leader",roles:["Pricing Analyst"],declined:true,expected:0},
 {name:"multiple-roles",roles:["Inside Sales Leader","Pricing Analyst"],stages:["To review","Interview"],declined:true},
 {name:"person-search",query:"Taylor",roles:["Inside Sales Leader","Regional Sales Manager"],stages:["To review","Interview"],declined:true,waiting:true,expected:2},
 {name:"employer-search",query:"Midwest Bearings",stages:["Interview"],declined:true,expected:1},
 {name:"location-search",query:"Chicago",declined:true},
 {name:"waiting-all-stages",declined:true,waiting:true,expected:5},
 {name:"empty-search",query:"not-a-fictional-candidate",roles:["Inside Sales Leader"],stages:["To review"],declined:true,waiting:true,expected:0},
];
async function makePage(ref,width) {
 const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:1});
 await context.addInitScript(()=>{localStorage.clear();sessionStorage.clear();});
 const p=await context.newPage();p.setDefaultTimeout(5000);
 p.on("pageerror",error=>errors.push(String(error)));
 await p.route("**/*",r=>{
  const req=r.request();
  if(req.url().startsWith("http://127.0.0.1:") && req.method()==="GET")return r.continue();
  blocked.push({url:req.url(),method:req.method()});return r.abort();
 });
 return {p,context,ref,url:`http://127.0.0.1:${ref?5181:5173}/#candidates`};
}
async function openFilter(s,width,kind) {
 if(width<=760){await s.p.locator(".x-fmore").click();return s.p.locator(".x-fsheet");}
 await s.p.locator(s.ref?(kind==="roles"?"#fRole":"#fStage"):".x-fbtn").nth(s.ref?0:kind==="roles"?0:1).click();
 return s.p.locator(".x-fmenu:visible");
}
async function apply(s,width,theme,view,c) {
 const p=s.p;await p.goto(s.url);await p.reload();await p.evaluate(()=>document.fonts.ready);
 if(theme==="dark"){
  if(width<=760)await p.locator(s.ref?".x-menu-btn":".menubtn").click();
  await p.getByRole("button",{name:"Dark theme",exact:true}).click();
  if(width<=760){await p.keyboard.press("Escape");await p.waitForTimeout(250);}
 }
 if(c.query){await p.locator("#fq").fill(c.query);await p.waitForFunction(q=>Array.from(document.querySelectorAll('.x-resultline .x-fchip')).some(el=>el.textContent.startsWith(`Matching “${q}”`)),c.query);}
 if(c.roles?.length){const root=await openFilter(s,width,"roles");for(const role of c.roles)await root.getByLabel(role,{exact:false}).check();await p.keyboard.press("Escape");}
 if(c.stages?.length||c.declined){const root=await openFilter(s,width,"stages");for(const stage of c.stages??[])await root.getByLabel(stage,{exact:false}).check();if(c.declined)await root.getByLabel("Include declined",{exact:false}).check();await p.keyboard.press("Escape");}
 if(c.waiting)await p.locator(".x-toggle").click();
 if(view==="list")await p.getByRole("button",{name:"List",exact:true}).click();
 const text=await p.locator(".x-showing").innerText();
 const names=await p.locator(view==="list"?"tbody tr .x-nm":".x-card .x-nm").allTextContents();
 const root=await openFilter(s,width,"stages");
 const stageRoot=width<=760 ? root.locator("fieldset").nth(1) : root;
 const options=await stageRoot.locator('input[type="checkbox"]').count();
 check(options===5,`${c.name}: one control for declined (four live stages + Include declined), got ${options}`);
 const dec=root.getByLabel("Include declined",{exact:false});
 const label=dec.locator("..");
 const count=await label.locator(".x-fc").innerText();
 check(await root.getByText("Declined submissions are hidden unless you include them.",{exact:true}).count()===1,`${c.name}: declined explanation present`);
 if(!s.ref && ["review-plus-declined","all-filters","empty-intersection"].includes(c.name)){
  await p.screenshot({path:path.join(OUT,`${width}-${theme}-${view}-${c.name}-filters.png`)});
 }
 await p.keyboard.press("Escape");
 const badge=await p.locator(".x-toggle .x-n").innerText();
 const empty=await p.locator(".x-empty").count();
 if(!s.ref && ["review-plus-declined","all-filters","empty-intersection"].includes(c.name)){
  await p.screenshot({path:path.join(OUT,`${width}-${theme}-${view}-${c.name}.png`),fullPage:true});
 }
 return {text,names,count,badge,empty};
}
try {
 await fs.mkdir(OUT,{recursive:true});
 for(const [width,theme] of variants){
  const app=await makePage(false,width),ref=await makePage(true,width);
  try{
   for(const view of ["pipeline","list"])for(const c of cases){
    const actual=await apply(app,width,theme,view,c),expected=await apply(ref,width,theme,view,c);
    assert.deepEqual(actual.names,expected.names,`${width}/${theme}/${view}/${c.name}: candidates match Sample 1`);checks++;
    assert.equal(actual.count,expected.count,`${c.name}: Include declined count matches Sample 1`);checks++;
    assert.equal(actual.badge,expected.badge,`${c.name}: Waiting on you count matches Sample 1`);checks++;
    assert.equal(actual.empty,expected.empty,`${c.name}: empty state matches Sample 1`);checks++;
    if(c.expected!==undefined){check(actual.names.length===c.expected,`${c.name}: expected ${c.expected} results`);}
    if(c.waiting)check(Number(actual.badge)===actual.names.length,`${c.name}: waiting badge equals filtered results`);
    check(await app.p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${c.name}: no page overflow at ${width}`);
   }
   console.log(`PASS ${width}px ${theme}: ${cases.length} scenarios in board and list`);
  }finally{await app.context.close();await ref.context.close();}
 }
 check(errors.length===0,`no browser errors: ${errors.join("; ")}`);
 check(!blocked.some(r=>r.method!=="GET"),"no attempted HTTP writes");
 await fs.writeFile(path.join(OUT,mobileDarkOnly?"results-mobile-dark.json":"results.json"),JSON.stringify({checks,scenarios:cases.length*2*variants.length,errors,blocked},null,2));
 console.log(`${checks} checks passed; ${cases.length*2*variants.length} app scenarios compared with Sample 1. Screenshots: ${OUT}`);
}finally{await browser.close();}
