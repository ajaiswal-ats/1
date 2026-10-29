/* Local-only visual/interaction review. Needs the demo server at 5173 and Sample 1 at 5181.
   All external requests are blocked. Never signs in, writes to an API, or moves a candidate. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
const out = path.resolve("compare-output/sample1-review");
await fs.mkdir(out,{recursive:true});
const browser = await chromium.launch();
const errors=[], external=[];
let checks=0;
const check=(ok,label)=>{assert.ok(ok,label);checks++;};
async function page(url,width=1440,height=1000) {
 const p=await browser.newPage({viewport:{width,height}});
 p.on("pageerror",e=>errors.push(e.message));
 await p.route("**/*",r=>{const u=r.request().url(); if(u.startsWith("http://127.0.0.1:")) return r.continue(); external.push(u); return r.abort();});
 await p.goto(url); await p.evaluate(()=>document.fonts.ready); return p;
}
async function shot(p,name,fullPage=true) {await p.screenshot({path:path.join(out,name+".png"),fullPage});}
try {
 const a=await page("http://127.0.0.1:5173/#candidates"), r=await page("http://127.0.0.1:5181/#candidates");
 check(await a.locator(".x-card").count()===10,"ten visible submissions");
 await a.locator("#fq").fill("Taylor");
 check(await a.locator(".x-card").count()===2,"search keeps both submissions for the same person");
 await a.getByRole("button",{name:/Role: All/}).click();
 await a.locator(".x-fmenu").getByLabel("Inside Sales Leader",{exact:false}).check();
 await a.getByRole("button",{name:"Done",exact:true}).click();
 check(await a.locator(".x-card").count()===1,"role and search intersect");
 check(await a.locator(".x-toggle .x-n").innerText()==="1","waiting badge follows other filters");
 await a.locator(".x-toggle").click(); check(await a.locator(".x-card").count()===1,"waiting filter count matches results");
 await a.getByRole("button",{name:"Clear all",exact:true}).click();
 await a.getByRole("button",{name:/Stage: All/}).click();
 await a.locator(".x-fmenu").getByLabel("Include declined",{exact:true}).check();
 await a.getByRole("button",{name:"Done",exact:true}).click();
 check(await a.locator(".x-card").count()===12,"include declined in board");
 await a.getByRole("button",{name:"List",exact:true}).click(); check(await a.locator("tbody tr").count()===12,"same filter in list");
 await a.getByRole("button",{name:"Clear all",exact:true}).click(); check(await a.locator("tbody tr").count()===10,"declined hidden consistently in list");
 await a.locator("#fSort").selectOption("name"); check((await a.locator("tbody tr").first().innerText()).includes("Aisha Bello"),"name sort");
 await a.locator("#fq").fill("not-a-candidate"); check(await a.getByText("No candidates match these filters",{exact:true}).count()===1,"empty filter state");
 await a.getByRole("button",{name:"Clear all filters",exact:true}).click(); await a.locator("#fSort").selectOption("waiting");
 for(const width of [1280,1440,1920,390]) {
  await a.setViewportSize({width,height:width===390?844:1000}); await r.setViewportSize({width,height:width===390?844:1000});
  await a.waitForTimeout(250); await r.waitForTimeout(250); // Let drawer transforms finish after crossing the breakpoint.
  for(const [view,label] of [["pipeline","board"],["list","list"]]) {
   await a.getByRole("button",{name:view==="pipeline"?"By stage":"List",exact:true}).click();
   await r.locator(`[data-view="${view}"]`).click();
   check(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label} has no page overflow at ${width}`);
   await shot(a,`after-${label}-${width}`); await shot(r,`reference-${label}-${width}`);
   if(width===1440||width===390) {await shot(a,`after-${label}-${width}-viewport`,false);await shot(r,`reference-${label}-${width}-viewport`,false);}
  }
 }
 await a.getByRole("button",{name:/Filters/}).click();
 check(await a.getByRole("dialog").isVisible(),"mobile filter sheet opens");
 await a.getByRole("dialog").getByLabel("To review",{exact:false}).check();
 await shot(a,"mobile-filters"); await a.keyboard.press("Escape");
 check(await a.locator(".x-fmore").evaluate(el=>el===document.activeElement),"filter sheet returns keyboard focus");
 check(await a.locator("tbody tr").count()===4,"mobile stage filter applies");
 await a.getByRole("button",{name:"Clear all",exact:true}).click();
 await a.getByRole("button",{name:"Open navigation",exact:true}).click();
 check(await a.locator(".main").evaluate(el=>el.inert),"drawer makes background inert");
 await a.waitForTimeout(250); await shot(a,"mobile-navigation",false);
 await a.keyboard.press("Shift+Tab"); check(await a.getByRole("button",{name:"Dark theme",exact:true}).evaluate(el=>el===document.activeElement),"drawer traps reverse Tab");
 await a.keyboard.press("Escape"); check(await a.getByRole("button",{name:"Open navigation",exact:true}).evaluate(el=>el===document.activeElement),"drawer returns focus");
 await a.setViewportSize({width:1440,height:1000}); await a.waitForTimeout(250);
 await a.getByRole("button",{name:"Dark theme",exact:true}).click(); await a.getByRole("button",{name:"By stage",exact:true}).click(); await shot(a,"after-dark-desktop");
 check(await a.evaluate(()=>getComputedStyle(document.querySelector(".x-card")).backgroundColor)==="rgb(22, 27, 39)","dark card surface");
 await a.getByRole("button",{name:"Light theme",exact:true}).click();
 // Candidates CSS must not alter the content of the other pages.
 for(const route of ["roles","progress","role-isl","c-tb-isl"]) {
  await a.evaluate(route=>location.hash=route,route); await a.waitForTimeout(100);
  const changes=await a.evaluate(()=>{
   const props=["font-family","font-size","font-weight","line-height","color","background-color","padding","margin","border","grid-template-columns"];
   const nodes=Array.from(document.querySelectorAll("#page, #page *"));
   const styles=()=>nodes.map(el=>props.map(key=>getComputedStyle(el).getPropertyValue(key)).join("|"));
   const before=styles(),sheet=document.querySelector('style[data-vite-dev-id$="/styles/sample1.css"]');
   if(!sheet) throw Error("Sample 1 stylesheet missing"); sheet.media="not all"; const baseline=styles(); sheet.media="";
   return before.filter((s,i)=>s!==baseline[i]).length;
  });
  check(changes===0,`no content style leakage on ${route}`);
 }
 check(errors.length===0,`no browser errors: ${errors.join(", ")}`);
 const report={checks,app:"http://127.0.0.1:5173/#candidates",reference:"http://127.0.0.1:5181/#candidates",errors,externalBlocked:external,notes:["Candidate facts retained. Legacy feedback dates are not relabelled as interview dates.","No board drag/move menus, help, simulated sign-in, reset, or Supabase global search added.","Existing candidate-page actions and permissions retained; additional filters use component state."]};
 await fs.writeFile(path.join(out,"review.json"),JSON.stringify(report,null,2));
 // A standalone comparison document with screenshots embedded, so it opens without any server.
 const names=[['Desktop board','board',1440],['Mobile board','board',390],['Desktop list','list',1440],['Mobile list','list',390]];
 let html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Candidates — local design review</title><style>body{margin:24px;background:#f4f6fb;color:#272727;font:15px system-ui}h1{font-size:26px}section{margin:30px 0}.pair{display:flex;gap:16px;align-items:start}.pair figure{flex:1;margin:0;min-width:0}.pair img{width:100%;border:1px solid #c6cddd;border-radius:8px}figcaption{margin-bottom:8px;font-weight:600}.mobile{max-width:820px}.links a{margin-right:20px}</style><h1>Shared shell and Candidates — review</h1><p>Reference on the left; updated app on the right. Fictional local data. Desktop 1440px; mobile 390px.</p><p>Actions remain on candidate pages. Drag/move menus, help, demo reset/sign-in and database global search are omitted. Feedback dates are not presented as interview dates.</p>';
 for(const [label,view,w] of names) {
  html+=`<section><h2>${label}</h2><div class="pair ${w===390?'mobile':''}">`;
  for(const prefix of ['reference','after']) {const data=await fs.readFile(path.join(out,`${prefix}-${view}-${w}.png`));html+=`<figure><figcaption>${prefix==='reference'?'Reference':'Updated app'}</figcaption><img src="data:image/png;base64,${data.toString('base64')}"></figure>`;}
  html+='</div></section>';
 }
 html+=`<p>${checks} browser checks passed. See review.json for the verification scope.</p>`;
 await fs.writeFile(path.join(out,"comparison.html"),html);
 for (const width of [1440,390]) {
  const mobile=width===390, size=mobile?390:720;
  const pair=await browser.newPage({viewport:{width:size*2+48,height:mobile?900:570}});
  const images=await Promise.all(["reference","after"].map(async prefix=>`data:image/png;base64,${(await fs.readFile(path.join(out,`${prefix}-board-${width}-viewport.png`))).toString("base64")}`));
  await pair.setContent(`<style>body{margin:16px;background:#f4f6fb;font:14px system-ui}.grid{display:flex;gap:16px}figure{margin:0;width:${size}px}figcaption{font-weight:600;margin-bottom:8px}img{display:block;width:100%;border:1px solid #c6cddd}</style><div class="grid"><figure><figcaption>Reference · ${width}px</figcaption><img src="${images[0]}"></figure><figure><figcaption>Updated app · ${width}px</figcaption><img src="${images[1]}"></figure></div>`);
  await pair.screenshot({path:path.join(out,`${mobile?"mobile":"desktop"}-comparison.png`),fullPage:true});
  await pair.close();
 }

 console.log(`${checks} browser checks passed. Comparison: ${out}/comparison.html`);
} finally {await browser.close();}
