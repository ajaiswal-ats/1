import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CandidatesView, filterRows, sortRows, type CandidateRow, type ListFilters } from "./CandidatesView";

const row = (id:string, roleId:string, stage:CandidateRow["stage"], next:CandidateRow["next"]): CandidateRow => ({id,roleId,stage,next,personId:id,name:id,headline:"Buyer · Example Co",location:"Nagpur",shared:"2026-10-10",requirements:null,screening:"None shared",interview:"None recorded",hasInterview:false});
const rows=[row("Alex","r1","To review",{cls:"you",text:"Your review",since:"2026-10-08"}),row("Casey","r2","Interview",{cls:"ro",text:"Not recorded"}),row("Declined","r1","Declined",{cls:"ro",text:"No action needed"}),row("Same person","r3","To review",null)];
const filters:ListFilters={query:"",roles:[],stages:[],declined:false,waiting:false,sort:"waiting"};

describe("Candidates read-only filtering",()=>{
  it("hides declined consistently until explicitly included or selected",()=>{
    expect(filterRows(rows,filters).map(c=>c.id)).toEqual(["Alex","Casey","Same person"]);
    expect(filterRows(rows,{...filters,declined:true})).toHaveLength(4);
    expect(filterRows(rows,{...filters,stages:["Declined"]}).map(c=>c.id)).toEqual(["Declined"]);
  });
  it("combines roles, stages, employer/location search and existing waiting derivation",()=>{
    expect(filterRows(rows,{...filters,roles:["r1","r2"],stages:["To review","Interview"],query:"example",waiting:true}).map(c=>c.id)).toEqual(["Alex"]);
    expect(filterRows(rows,{...filters,query:"nagpur"})).toHaveLength(3);
    expect(filterRows(rows,{...filters,query:"unknown"})).toEqual([]);
    expect(filterRows(rows,{...filters,waiting:true})).not.toContain(rows[3]);
  });
  it("faceted counts ignore only their own filter and preserve the remaining scope",()=>{
    const f={...filters,roles:["r2"],waiting:true};
    expect(filterRows(rows,f)).toHaveLength(0);
    expect(filterRows(rows,f,"waiting").filter(c=>c.next?.cls==="you")).toHaveLength(0);
    expect(filterRows(rows,f,"roles").map(c=>c.id)).toEqual(["Alex"]);
    expect(filterRows(rows,filters,"stages")).toHaveLength(3);
  });
  it("sorts without mutating source facts or changing submission identity",()=>{
    const source=structuredClone(rows), recent={...rows[1],shared:"2026-10-11"};
    expect(sortRows([rows[0],recent],"recent","2026-10-12")[0].id).toBe("Casey");
    expect(sortRows(rows,"waiting","2026-10-12")[0].id).toBe("Alex");
    expect(rows).toEqual(source);
  });
});

const roles = [
  { id:"r1", title:"Inside Sales Leader", status:"Open" },
  { id:"r2", title:"Pricing Analyst", status:"Open" },
  { id:"r3", title:"Field Sales Representative", status:"On hold" },
];
const ids = (f: ListFilters, source = rows) => filterRows(source, f, undefined, roles).map(c=>c.id);

describe("audit items 1, 2 and 6", () => {
  it("adds declined submissions alongside the selected live stages", () => {
    expect(ids({...filters, stages:["To review"], declined:true})).toEqual(["Alex","Declined","Same person"]);
    expect(ids({...filters, stages:["Interview"], declined:true})).toEqual(["Casey","Declined"]);
    expect(ids({...filters, stages:["To review","Interview"], declined:true})).toHaveLength(4);
  });
  it("matches role titles case-insensitively without requiring a selected role", () => {
    expect(ids({...filters,query:"  INSIDE SALES LEADER  "})).toEqual(["Alex"]);
    expect(ids({...filters,query:"sales leader",declined:true})).toEqual(["Alex","Declined"]);
    expect(ids({...filters,query:"Pricing Analyst"})).toEqual(["Casey"]);
    expect(ids({...filters,query:"unknown role"})).toEqual([]);
  });
  it("keeps search, role, stage and waiting constraints when declined is included", () => {
    const f={...filters,query:"Inside Sales Leader",roles:["r1"],stages:["To review" as const],declined:true};
    expect(ids(f)).toEqual(["Alex","Declined"]);
    expect(ids({...f,waiting:true})).toEqual(["Alex"]);
    expect(ids({...f,roles:["r2"]})).toEqual([]);
    expect(ids({...f,stages:["Interview"]})).toEqual(["Declined"]);
    expect(ids({...f,stages:["Interview"],waiting:true})).toEqual([]);
    expect(ids({...f,declined:false})).toEqual(["Alex"]);
  });
  it("counts Include declined independently of its toggle but respects the other filters", () => {
    const count = (f:ListFilters) => filterRows(rows,f,"declined",roles).filter(c=>c.stage==="Declined").length;
    expect(count({...filters,stages:["Interview"]})).toBe(1);
    expect(count({...filters,stages:["Interview"],declined:true})).toBe(1);
    expect(count({...filters,query:"Inside Sales Leader",roles:["r1"],stages:["Interview"]})).toBe(1);
    expect(count({...filters,roles:["r2"]})).toBe(0);
    expect(count({...filters,waiting:true})).toBe(0);
    expect(count({...filters,query:"not present"})).toBe(0);
  });
  it("does not inflate waiting counts with non-waiting declined submissions", () => {
    const scoped={...filters,query:"Inside Sales Leader",roles:["r1"],stages:["Interview" as const],declined:true,waiting:true};
    expect(filterRows(rows,scoped,"waiting",roles).filter(c=>c.next?.cls==="you")).toEqual([]);
  });
  it.each(["pipeline","list"] as const)("shows declined consistently in initial %s view", view => {
    const html=renderToStaticMarkup(<CandidatesView rows={rows} roles={roles} today="2026-10-12" initial={{view,role:"all",filter:"all",showDeclined:true}}/>);
    expect(html).toContain('href="#c-Declined"');
    expect(html).toContain('Showing <b class="x-num">4</b> of <b class="x-num">4</b>');
  });
});

describe("filtered empty-state explanation", () => {
  it.each(["pipeline","list"] as const)("uses the loaded submission total and outlined reset action in %s", view => {
    const html=renderToStaticMarkup(<CandidatesView rows={rows} roles={[...roles,{id:"empty",title:"No submissions",status:"Open"}]} today="2026-10-12" initial={{view,role:"empty",filter:"all",showDeclined:false}}/>);
    expect(html).toContain("4 submissions are shared with you; the current filters hide all of them.");
    expect(html).toContain('class="x-btn x-secondary">Clear all filters</button>');
  });
});

describe('audit items 21, 23 and 24',()=>{
 const render=(view:'pipeline'|'list',source:CandidateRow[]=rows)=>renderToStaticMarkup(<CandidatesView rows={source} roles={roles} today="2026-10-12" initial={{view,role:'all',filter:'all',showDeclined:true}}/>);
 it('explains hold status through an accessible, focusable tooltip without adding an action',()=>{
  const html=render('pipeline');
  expect(html).toMatch(/class="x-holdtag"[^>]*tabindex="0"[^>]*aria-describedby="[^"]+"/);
  expect(html).toContain('role="tooltip"');
  expect(html).toContain('Field Sales Representative is on hold, so stage changes are paused');
 });
 it('keeps Screening compact visually and calls it Recruiter screening to assistive technology',()=>{
  expect(render('pipeline')).toContain('<span aria-hidden="true">Screening</span><span class="sr">Recruiter screening</span>');
 });
 it('groups scheduled date and timezone fragments and retains a feedback status without inventing a held date',()=>{
  const scheduled={...rows[0],hasInterview:true,interview:'Scheduled Thu 15 Oct, 10:00–10:45 CT'};
  const feedback={...rows[1],hasInterview:true,interview:'Held · feedback given'};
  const board=render('pipeline',[scheduled,feedback]),list=render('list',[scheduled,feedback]);
  for(const html of [board,list]){
   expect(html).toContain('<span class="x-nw">Thu 15 Oct,</span>');
   expect(html).toContain('<span class="x-nw">10:00–10:45 CT</span>');
   expect(html).not.toContain('Held 10 Oct');
  }
  expect(board).not.toContain('Scheduled Thu');
 });
 it('uses the small metadata style, muted absent facts and tabular Shared dates',()=>{
  const html=render('list');
  expect(html).toContain('data-label="Recruiter screening" class="x-sm x-muted">None shared');
  expect(html).toContain('data-label="Client interview" class="x-sm x-muted"');
  expect(html).toContain('data-label="Shared" class="x-num x-sm"><span class="x-nwg"><span class="x-nw">10 Oct</span>');
 });
 it('uses separate board and list Also for spacing while retaining submission links',()=>{
  const source=[rows[0],{...rows[1],personId:rows[0].personId}];
  expect(render('pipeline',source)).toContain('class="x-also">Also for ');
  expect(render('list',source)).toContain('class="x-sub x-also-l">Also for ');
  expect(render('list',source)).toContain('href="#c-Casey">Pricing Analyst</a>');
 });
});
