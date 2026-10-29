import {BoardCardControls} from "./BoardCardControls";
import {boardActionHref,type BoardPermissions} from "./boardActions";
import { interviewFragments, missingMetadata } from "./metadata";
import { RoleHoldTag } from "./RoleHoldTag";
import { Fragment, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { CandidatesContextScope, parseCandidatesHash, candidatesHash, rememberCandidates, candidatesScroll, saveCandidatesScroll, candidateHref, hashPath } from "../lib/candidatesRoute";
import type { Stage } from "../data/fixtures";
import { STAGES } from "../domain/candidates";
import { days, fd } from "../lib/dates";
import { Seg, stageColor } from "../progress/shared";
import { SearchIcon, ChevronIcon, SlidersIcon, CheckIcon, CloseIcon } from "../components/icons";

/** Presentation rows only: adapters retain each mode's existing facts and permission-aware next-step derivation. */
export interface CandidateRow {
  id: string; personId: string; name: string; headline: string; location: string;
  roleId: string; stage: Stage; shared: string; requirements: string | null;
  screening: string; interview: string; hasInterview: boolean;
  next: { cls: "you" | "sched" | "ro" | "done"; text: string; since?: string | null; kind?: string } | null;
}
export interface CandidateRole { id: string; title: string; status: string }
export interface ListInitial { view: "pipeline" | "list"; role: string; filter: "all" | "you"; showDeclined: boolean }
const DEFAULT: ListInitial = { view: "pipeline", role: "all", filter: "all", showDeclined: false };
export interface ListFilters { query: string; roles: string[]; stages: Stage[]; declined: boolean; waiting: boolean; sort: string }

export function filterRows(rows: CandidateRow[], f: ListFilters, ignore?: "roles" | "stages" | "waiting" | "declined", roles: readonly CandidateRole[] = []) {
  const q = f.query.trim().toLowerCase();
  const roleTitles = new Map(roles.map(r => [r.id, r.title]));
  // Sample 1: selected stages narrow live submissions; Include declined adds declined submissions alongside them.
  // Search, role and waiting constraints still apply to every submission. A facet count skips only its own constraint.
  return rows.filter(c => (!q || [c.name, c.headline, roleTitles.get(c.roleId) ?? "", c.location].join(" ").toLowerCase().includes(q))
    && (ignore === "roles" || !f.roles.length || f.roles.includes(c.roleId))
    && (c.stage === "Declined"
      ? ignore === "declined" || f.declined || f.stages.includes("Declined")
      : ignore === "stages" || !f.stages.length || f.stages.includes(c.stage))
    && (ignore === "waiting" || !f.waiting || c.next?.cls === "you"));
}
export function sortRows(rows: CandidateRow[], sort: string, today: string) {
  return rows.slice().sort((a,b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "recent" ? b.shared.localeCompare(a.shared)
    : Number(b.next?.cls === "you") - Number(a.next?.cls === "you") || (b.next?.since ? days(b.next.since,today) : 0) - (a.next?.since ? days(a.next.since,today) : 0));
}
const people = (rows: CandidateRow[]) => new Set(rows.map(c => c.personId)).size;
const toggle = <T,>(list: T[], value: T) => list.includes(value) ? list.filter(v => v !== value) : [...list,value];

export function CandidatesView({ rows, roles, today, initial = DEFAULT, onLegacyChange, note, waitingAvailable = true, boardPermissions }: {
  rows: CandidateRow[]; roles: CandidateRole[]; today: string; initial?: ListInitial;
  boardPermissions?(row:CandidateRow):BoardPermissions;
  onLegacyChange?(patch: Partial<ListInitial>): void; note?: string; waitingAvailable?: boolean;
}) {
  const [dragId,setDragId]=useState<string|null>(null);
  const scope=useContext(CandidatesContextScope);
  const [start] = useState(()=>typeof location==='undefined' ? {query:"",roles:initial.role==="all"?[]:[initial.role],stages:[],declined:initial.showDeclined,waiting:initial.filter==="you",sort:"waiting",view:initial.view} : parseCandidatesHash(location.hash,roles.map(r=>r.id)));
  const [view,setView] = useState(start.view), [f,setF] = useState<ListFilters>(start);
  // Write only on user changes or explicit URL navigation. A state effect would overwrite Back/Forward.
  const current=useRef({ ...f,view }); current.current={...f,view};
  const write=(state: typeof current.current)=>{
    const hash=candidatesHash(state);
    history.replaceState(history.state,"",hash);
    rememberCandidates(scope,hash);
  };
  const [menu,setMenu] = useState<"roles" | "stages" | "mobile" | null>(null), [roleQuery,setRoleQuery] = useState(""), [stageQuery,setStageQuery] = useState("");
  const [searchText,setSearchText] = useState(f.query);
  const searchTimer = useRef<number | null>(null), searchVersion = useRef(0);
  const cancelSearch = () => {
    searchVersion.current++;
    if(searchTimer.current!==null) window.clearTimeout(searchTimer.current);
    searchTimer.current=null;
  };
  useEffect(()=>()=>cancelSearch(),[]);
  const roleIds=roles.map(r=>r.id).join(",");
  useLayoutEffect(()=>{
    const sync=()=>{
      if(hashPath(location.hash)!=="candidates") {cancelSearch();return;}
      const state=parseCandidatesHash(location.hash,roleIds.split(","));
      cancelSearch();setSearchText(state.query);setF(state);setView(state.view);current.current=state;
      write(state);
    };
    sync();
    window.addEventListener("hashchange",sync);
    return()=>window.removeEventListener("hashchange",sync);
  },[roleIds,scope]);
  useLayoutEffect(()=>{
    let hash=location.hash, y=0, frame=0;
    const restore=()=>{
      if(hashPath(location.hash)!=="candidates") return;
      hash=location.hash;
      const target=candidatesScroll(scope,hash); y=target;
      window.scrollTo(0,target);
      cancelAnimationFrame(frame);
      // The restored filters may change page height; apply again after React commits them.
      frame=requestAnimationFrame(()=>window.scrollTo(0,target));
    };
    restore();
    const capture=()=>{hash=location.hash;y=window.scrollY;saveCandidatesScroll(scope,hash,y);};
    window.addEventListener("hashchange",restore);window.addEventListener("scroll",capture);document.addEventListener("click",capture,true);
    return()=>{cancelAnimationFrame(frame);saveCandidatesScroll(scope,hash,y);window.removeEventListener("hashchange",restore);window.removeEventListener("scroll",capture);document.removeEventListener("click",capture,true);};
  },[scope]);
  const popup = useRef<HTMLDivElement>(null), returnFocus = useRef<HTMLElement | null>(null), sheet = useRef<HTMLDivElement>(null);
  const filterSearch = useRef<HTMLInputElement>(null), resultBar = useRef<HTMLDivElement>(null), chipFocus = useRef<number | null>(null);
  const displayControls = useRef<HTMLDivElement>(null);
  const measureDisplay = () => {
    const display=displayControls.current, search=filterSearch.current;
    if(display && search) display.classList.toggle("x-wrapped",display.getBoundingClientRect().top > search.getBoundingClientRect().bottom - 4);
  };
  // Like Sample 1, follow actual flex wrapping rather than a fixed viewport or a forced line break.
  useLayoutEffect(measureDisplay);
  useEffect(()=>{
    let mounted=true;
    const measure=()=>{if(mounted) measureDisplay();};
    window.addEventListener("resize",measure);
    void document.fonts.ready.then(measure);
    return()=>{mounted=false;window.removeEventListener("resize",measure);};
  },[]);
  useLayoutEffect(() => {
    if (chipFocus.current === null) return;
    const index = chipFocus.current;
    chipFocus.current = null;
    const buttons = resultBar.current?.querySelectorAll<HTMLButtonElement>(".x-fchip button");
    // Continue forward through the chips, wrapping when the last one was removed.
    (buttons?.length ? buttons[index % buttons.length] : filterSearch.current)?.focus();
  }, [f]);
  const close = () => { setMenu(null); returnFocus.current?.focus(); };
  useEffect(() => {
    if (!menu) return;
    let triggerPointerDown = false;
    const key = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if(e.key === "Escape") { e.preventDefault(); close(); }
      if(menu !== "mobile" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        const inputs = Array.from(popup.current?.querySelectorAll<HTMLInputElement>("input:not(:disabled)") ?? []);
        const index = inputs.indexOf(document.activeElement as HTMLInputElement);
        if(index >= 0) {
          e.preventDefault();
          inputs[(index + (e.key === "ArrowDown" ? 1 : -1) + inputs.length) % inputs.length].focus();
        }
      }
      if(e.key === "Tab" && menu === "mobile") {
        const els = sheet.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input');
        if(!els?.length) return;
        const first=els[0], last=els[els.length-1];
        if(e.shiftKey && document.activeElement===first) { e.preventDefault(); last.focus(); }
        else if(!e.shiftKey && document.activeElement===last) { e.preventDefault(); first.focus(); }
      }
    };
    const click = (e: PointerEvent) => {
      if(menu === "mobile") return;
      triggerPointerDown = Boolean(returnFocus.current?.contains(e.target as Node));
      if(!triggerPointerDown && !popup.current?.contains(e.target as Node)) setMenu(null);
    };
    const focus = (e: FocusEvent) => {
      if(menu === "mobile") return;
      // A pointer click on the current trigger must reach its normal toggle handler.
      const clickingTrigger = triggerPointerDown && returnFocus.current?.contains(e.target as Node);
      triggerPointerDown = false;
      if(!clickingTrigger && !popup.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("keydown",key); document.addEventListener("pointerdown",click); document.addEventListener("focusin",focus);
    const overflow = document.body?.style.overflow;
    if(menu === "mobile") { sheet.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus(); document.body.style.overflow="hidden"; }
    else popup.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    return () => { if(menu === "mobile") document.body.style.overflow=overflow ?? ""; document.removeEventListener("keydown",key); document.removeEventListener("pointerdown",click); document.removeEventListener("focusin",focus); };
  },[menu]);
  const update = (patch: Partial<ListFilters>) => { if(patch.query!==undefined) { cancelSearch(); setSearchText(patch.query); } const next={...current.current,...patch}; current.current=next; setF(next); write(next); onLegacyChange?.({ ...(patch.roles ? {role:patch.roles.length===1 ? patch.roles[0] : "all"} : {}), ...(patch.waiting !== undefined ? {filter:patch.waiting ? "you" : "all"} : {}), ...(patch.declined !== undefined ? {showDeclined:patch.declined} : {}) }); };
  const changeSearch = (query: string) => {
    cancelSearch();
    setSearchText(query);
    const version=searchVersion.current;
    searchTimer.current=window.setTimeout(()=>{
      if(version!==searchVersion.current) return;
      searchTimer.current=null;
      update({query});
    },220);
  };
  const clearSearch = () => { update({query:""}); filterSearch.current?.focus(); };
  const clear = () => { chipFocus.current = 0; update({query:"",roles:[],stages:[],declined:false,waiting:false}); };
  const list = sortRows(filterRows(rows,f,undefined,roles),f.sort,today), waiting = filterRows(rows,f,"waiting",roles).filter(c=>c.next?.cls==="you").length;
  const declinedCount = filterRows(rows,f,"declined",roles).filter(c=>c.stage==="Declined").length;
  const cols = [...STAGES.filter(s=>!f.stages.length || f.stages.includes(s)), ...(f.declined || f.stages.includes("Declined") ? ["Declined" as Stage] : [])];
  const title = (id: string) => roles.find(r=>r.id===id)?.title ?? id;
  const liveStages = f.stages.filter(stage=>stage!=="Declined");
  const includesDeclined = f.declined || f.stages.includes("Declined");
  const activeFilterCount = f.roles.length + liveStages.length + Number(includesDeclined);
  const active = Boolean(f.query || f.roles.length || f.stages.length || f.declined || f.waiting);
  const open = (v: typeof menu, el: HTMLElement) => { returnFocus.current=el; setMenu(menu===v ? null : v); };
  function choices(kind: "roles" | "stages") {
    const query = (kind === "roles" ? roleQuery : menu === "mobile" ? "" : stageQuery).toLowerCase();
    const opts = kind === "roles"
      ? roles.filter(r=>r.title.toLowerCase().includes(query)).map(r=>({id:r.id,label:r.title}))
      : STAGES.filter(stage=>stage.toLowerCase().includes(query)).map(stage=>({id:stage,label:stage}));
    const searchId = `${kind === "roles" ? "role" : "stage"}-search-${menu}`;
    const option = (o: {id:string;label:string}) => <label className="x-fopt" key={o.id}><input type="checkbox" checked={kind==="roles" ? f.roles.includes(o.id) : f.stages.includes(o.id as Stage)} onChange={()=>update(kind==="roles" ? {roles:toggle(f.roles,o.id)} : {stages:toggle(f.stages,o.id as Stage)})}/>{kind==="stages" && <i className="x-sw" style={{background:stageColor(o.id as Stage)}}/>}<span className="x-ft">{o.label}</span><span className="x-fc">{filterRows(rows,f,kind,roles).filter(c=>kind==="roles" ? c.roleId===o.id : c.stage===o.id).length}</span></label>;
    return <>
      {(kind==="roles" || menu!=="mobile") && <div className="x-fms"><SearchIcon/><label className="sr" htmlFor={searchId}>Search {kind}</label><input id={searchId} type="search" placeholder={`Search ${kind}`} value={kind==="roles" ? roleQuery : stageQuery} onChange={e=>kind==="roles" ? setRoleQuery(e.target.value) : setStageQuery(e.target.value)}/></div>}
      {kind==="roles" ? ["Open","On hold"].map(group=>{
        const grouped=opts.filter(o=>(roles.find(r=>r.id===o.id)!.status==="Open")===(group==="Open"));
        if(!grouped.length) return null;
        const groupId=`${menu}-role-group-${group==="Open" ? "open" : "hold"}`;
        return <Fragment key={group}><p className="x-fgrp" id={groupId}>{group}</p><div role="group" aria-labelledby={groupId}>{grouped.map(option)}</div></Fragment>;
      }) : opts.map(option)}
      {!opts.length && <p className="x-fnone">No {kind} match “{query}”.</p>}
      {kind==="stages" && <>
        <div className="x-fsep" />
        <label className={`x-fopt${declinedCount ? "" : " x-zero"}`}>
          <input type="checkbox" checked={f.declined} aria-describedby={`declined-help-${menu}`} onChange={e=>update({declined:e.target.checked})}/>
          <i className="x-sw" style={{background:stageColor("Declined")}}/>
          <span className="x-ft">Include declined</span>
          <span className="x-fc" aria-label={`${declinedCount} declined`}>{declinedCount}</span>
        </label>
        <p className="x-fhint" id={`declined-help-${menu}`}>Declined submissions are hidden unless you include them.</p>
      </>}
    </>;
  }
  function menuFooter(kind: "roles" | "stages") {
    const selected=kind==="roles" ? f.roles.length : f.stages.filter(stage=>stage!=="Declined").length;
    return <div className="x-fmf"><span>{selected ? `${selected} selected` : kind==="roles" ? "Any role" : "Any stage"}</span><button type="button" className="x-linkbtn x-sm" disabled={!selected && !(kind==="stages" && f.declined)} onClick={()=>{
      update(kind==="roles" ? {roles:[]} : {stages:[],declined:false});
      document.getElementById(`${kind==="roles" ? "role" : "stage"}-search-${kind}`)?.focus();
    }}>Clear</button></div>;
  }
  const chips: [string,()=>void][] = [ ...(f.query ? [[`Matching “${f.query}”`,()=>update({query:""})] as [string,()=>void]] : []), ...f.roles.map(id=>[`Role: ${title(id)}`,()=>update({roles:f.roles.filter(v=>v!==id)})] as [string,()=>void]), ...f.stages.map(s=>[`Stage: ${s}`,()=>update({stages:f.stages.filter(v=>v!==s)})] as [string,()=>void]), ...(f.declined ? [["Including declined",()=>update({declined:false})] as [string,()=>void]] : []), ...(f.waiting ? [["Waiting on you",()=>update({waiting:false})] as [string,()=>void]] : []) ];
  return <>
    <div className="x-head"><div><h1>Candidates</h1><p>Candidates Revenue Optics has shared with you. Someone shared for two roles appears once per role, with separate decisions. {rows.length} submissions · {people(rows)} {people(rows)===1 ? "person" : "people"} · {roles.length} roles.</p></div></div>
    <div className="x-ftool" role="search" aria-label="Filter candidates">
      <div className="x-fsearch"><SearchIcon/><label htmlFor="fq" className="sr">Search candidates</label><input ref={filterSearch} id="fq" className="x-input" type="search" placeholder="Name, employer or location" value={searchText} onChange={e=>changeSearch(e.target.value)}/>{searchText && <button type="button" className="x-fqclr" aria-label="Clear search" aria-controls="fq" onClick={clearSearch}><span className="x-ic"><CloseIcon/></span></button>}</div>
      {(["roles","stages"] as const).map(kind=>{
        const selected=kind==="roles" ? f.roles : liveStages;
        const on=selected.length>0 || (kind==="stages" && includesDeclined);
        const value=selected.length===1 ? kind==="roles" ? title(selected[0]) : selected[0]
          : selected.length ? `${selected.length} ${kind}`
          : kind==="stages" && includesDeclined ? f.stages.includes("Declined") ? "Declined" : "All + declined" : "All";
        const label=kind==="roles" ? `Role: ${selected.length ? selected.map(title).join(", ") : "all roles"}`
          : `Stage: ${selected.length ? selected.join(", ") : "all stages"}${includesDeclined ? ", including declined" : ""}`;
        return <div className="x-fdd x-fdesk" key={kind}><button type="button" className={`x-fbtn ${on ? "x-on" : ""}`} aria-label={label} aria-expanded={menu===kind} aria-controls={`filter-${kind}`} onClick={e=>open(kind,e.currentTarget)}><span className="x-fk">{kind==="roles" ? "Role" : "Stage"}:</span><span className="x-fv">{value}</span><ChevronIcon/></button>{menu===kind && <div ref={popup} className="x-fmenu" id={`filter-${kind}`} role="group" aria-label={`Filter ${kind}`}>{choices(kind)}{menuFooter(kind)}</div>}</div>;
      })}
      <button type="button" className="x-fmore" aria-label={`Filters${activeFilterCount ? `, ${activeFilterCount} active` : ""}`} aria-expanded={menu==="mobile"} onClick={e=>open("mobile",e.currentTarget)}><SlidersIcon/>Filters{activeFilterCount>0 && <span className="x-fplus">{activeFilterCount}</span>}</button>
      <button type="button" className="x-toggle" aria-pressed={f.waiting} disabled={!waitingAvailable} aria-disabled={!waitingAvailable} title={!waitingAvailable ? "Not connected yet" : undefined} onClick={()=>update({waiting:!f.waiting})}>{f.waiting && <span className="x-ic"><CheckIcon/></span>}Waiting on you <span className={`x-n${waitingAvailable && waiting===0 ? " x-zero" : ""}`}>{waitingAvailable ? waiting : "—"}</span></button>
      <div ref={displayControls} className="x-disp"><Seg label="View" value={view} options={[["pipeline","By stage"],["list","List"]]} onChange={v=>{setView(v);current.current={...current.current,view:v};write(current.current);onLegacyChange?.({view:v});}}/><div className="x-sort"><label htmlFor="fSort" className="x-muted">Sort</label><select id="fSort" className="x-select" value={f.sort} onChange={e=>update({sort:e.target.value})}><option value="waiting">Waiting on you first</option><option value="recent">Recently shared</option><option value="name">Name A–Z</option></select></div></div>
    </div>
    <div ref={resultBar} className="x-activebar x-resultline">{chips.map(([label,remove],index)=><span className={`x-fchip${label==="Waiting on you" ? " x-fchip-w" : ""}`} key={label}>{label}<button type="button" aria-label={`Remove filter: ${label}`} onClick={()=>{chipFocus.current=index;remove();}}>×</button></span>)}{active && <button type="button" className="x-linkbtn" onClick={clear}>{chips.length===1 ? "Clear" : "Clear all"}</button>}<span className="x-showing" role="status">Showing <b className="x-num">{list.length}</b> of <b className="x-num">{rows.length}</b> submissions · {people(list)} {people(list)===1 ? "person" : "people"}{!active && rows.some(c=>c.stage==="Declined") ? ` · ${rows.filter(c=>c.stage==="Declined").length} declined hidden` : ""}</span></div>
    {note && <p className="xs muted dbnote">{note}</p>}
    {!list.length ? <div className="x-panel x-empty"><b>{rows.length ? "No candidates match these filters" : "No candidates have been shared yet."}</b>{rows.length>0 && <span>{rows.length} submissions are shared with you; the current filters hide all of them.</span>}{active && <button type="button" className="x-btn x-secondary" onClick={clear}>Clear all filters</button>}</div> : view==="pipeline" ? <div className="x-boardscroll"><div className={`x-board${dragId?" x-dragging":""}`} style={{gridTemplateColumns:`repeat(${cols.length},minmax(${cols.length>4 ? 256 : 228}px,360px))`} as CSSProperties}>{cols.map(s=><section className="x-col" key={s} aria-label={s} data-drop={dragId?(rows.some(r=>r.id===dragId)&&boardPermissions?.(rows.find(r=>r.id===dragId)!)?.targets.includes(s)?"ok":"no"):undefined} onDragOver={e=>{const row=rows.find(r=>r.id===dragId);if(row&&boardPermissions?.(row).targets.includes(s)){e.preventDefault();e.dataTransfer.dropEffect="move";}}} onDrop={e=>{const row=rows.find(r=>r.id===dragId);e.preventDefault();if(row&&e.dataTransfer.getData('application/x-portal-candidate')===row.id&&boardPermissions?.(row).targets.includes(s))location.hash=boardActionHref(row.id,s,location.hash);setDragId(null);}}><div className="x-col-h"><h2><i className="x-sw" style={{background:stageColor(s)}}/>{s}</h2><span className="x-ct">{list.filter(c=>c.stage===s).length}</span></div><div className="x-col-b">{list.filter(c=>c.stage===s).map(c=><BoardCard key={c.id} c={c} rows={rows} roles={roles} showRole={f.roles.length!==1} today={today} permissions={boardPermissions?.(c)} onDrag={setDragId} onDragEnd={()=>setDragId(null)}/>)}{!list.some(c=>c.stage===s) && <p className="x-col-empty">None in this view</p>}</div></section>)}</div></div> : <CandidatesTable list={list} rows={rows} roles={roles} today={today}/>}
    {menu==="mobile" && <><div className="x-fscrim" onClick={close}/><div className="x-fsheet" ref={sheet} role="dialog" aria-modal="true" aria-labelledby="filters-title"><div className="x-fsh"><h2 id="filters-title">Filters</h2><button type="button" className="x-iconbtn" onClick={close} aria-label="Close filters"><span className="x-ic"><CloseIcon/></span></button></div><div className="x-fsb"><fieldset><legend>Role</legend>{choices("roles")}</fieldset><fieldset><legend>Stage</legend>{choices("stages")}</fieldset></div><div className="x-fsf"><button type="button" className="x-btn x-secondary" disabled={!f.roles.length && !f.stages.length && !f.declined} onClick={()=>update({roles:[],stages:[],declined:false})}>Clear</button><button type="button" className="x-btn x-primary" onClick={close}>Show {list.length} {list.length===1 ? "result" : "results"}</button></div></div></>}
  </>;
}
function next(c: CandidateRow, today: string) {
  const n=c.next, waited=n?.cls==="you" && n.since ? `${Math.max(0,days(n.since,today))} ${days(n.since,today)===1 ? "day" : "days"}` : null;
  return {text:n?.cls==="you" && n.kind==="review" ? "Review needed" : n?.cls==="you" && n.kind==="feedback" ? "Feedback due" : n?.cls==="sched" ? "Interview scheduled · no portal action due" : n?.text ?? "Not connected yet", waited};
}
function Also({c,rows,roles,list=false,returnHash}:{c:CandidateRow;rows:CandidateRow[];roles:CandidateRole[];list?:boolean;returnHash?:string}) {
  const others=rows.filter(r=>r.personId===c.personId && r.id!==c.id);
  return others.length ? <span className={list ? "x-sub x-also-l" : "x-also"}>Also for {others.map((r,i)=><span key={r.id}>{i>0 ? ", " : ""}<a href={candidateHref(r.id,returnHash)}>{roles.find(v=>v.id===r.roleId)?.title}</a></span>)}</span> : null;
}
function BoardCard({c,rows,roles,showRole,today,permissions,onDrag,onDragEnd}:{c:CandidateRow;rows:CandidateRow[];roles:CandidateRole[];showRole:boolean;today:string;permissions?:BoardPermissions;onDrag(id:string):void;onDragEnd():void}) {
  const role=roles.find(r=>r.id===c.roleId)!, n=next(c,today);
  return <article className="x-card" aria-label={`${c.name}, ${role.title}`}><div className="x-card-top"><a className="x-nm x-stretch" draggable={false} href={candidateHref(c.id)}>{c.name}</a>{permissions&&<BoardCardControls row={c} permissions={permissions} onDrag={onDrag} onDragEnd={onDragEnd}/>}</div><p className="x-hd">{c.headline}</p>{showRole && <p className="x-rl"><span className="x-for">For</span> <span className="x-rl-t">{role.title}</span></p>}{role.status!=="Open" && c.stage!=="Hired" && c.stage!=="Declined" && <RoleHoldTag title={role.title} status={role.status}/>}<Also c={c} rows={rows} roles={roles}/><dl className="x-cfacts"><div data-line="req"><dt>Must-haves</dt><dd>{c.requirements?.replace(" must-haves","") ?? "Not shared"}</dd></div><div data-line="iv"><dt>{c.hasInterview ? "Client interview" : <><span aria-hidden="true">Screening</span><span className="sr">Recruiter screening</span></>}</dt><dd><MetadataParts parts={c.hasInterview ? interviewFragments(c.interview,true) : [c.screening]}/></dd></div></dl><div className={`x-cfoot ${c.next?.cls==="you" ? "x-act" : c.next?.cls==="done" ? "x-done" : ""}`}><span className={`x-next x-${c.next?.cls==="sched" ? "ro" : c.next?.cls ?? "ro"}`}>{n.text}</span>{n.waited && <span className="x-wait">{n.waited}</span>}</div></article>;
}
export function CandidatesTable({list,rows,roles,today,noRole=false,returnHash,sharedLabel="Shared"}:{list:CandidateRow[];rows:CandidateRow[];roles:CandidateRole[];today:string;noRole?:boolean;returnHash?:string;sharedLabel?:string}) {
  return <section className="x-panel"><div className="x-tablewrap x-clwrap"><table className={`x-table x-stack x-ctable${noRole?" x-ctable-norole":""}`}><colgroup>{["cand",...(!noRole?["role"]:[]),"stage","next","req","scr","iv","shared"].map(v=><col key={v} className={`x-c-${v}`}/>)}</colgroup><thead><tr>{["Candidate",...(!noRole?["Role"]:[]),"Stage","Next step","Requirements","Recruiter screening","Client interview",sharedLabel].map(s=><th key={s} scope="col">{s}</th>)}</tr></thead><tbody>{list.map(c=>{const n=next(c,today); return <tr key={c.id}><td className="x-first"><a className="x-nm" href={candidateHref(c.id,returnHash)}>{c.name}</a><span className="x-sub">{c.headline}</span><Also c={c} rows={rows} roles={roles} list returnHash={returnHash}/></td>{!noRole&&<td data-label="Role">{roles.find(r=>r.id===c.roleId)?.title}</td>}<td data-label="Stage"><span className="x-chip x-c-stage"><i className="x-sw" style={{background:stageColor(c.stage)}}/>{c.stage}</span></td><td data-label="Next step"><div className="x-nextcell"><span className={`x-chip x-wrapchip x-c-${c.next?.cls==="you" ? "wait" : c.next?.cls==="done" ? "ok" : "mute"}`}>{n.text}</span>{n.waited && <span className="x-subwait">Waiting {n.waited}</span>}</div></td><td data-label="Requirements"><div className="x-reqcell">{c.requirements?.replace(" must-haves","") ?? "Not shared"}<span className="x-sub">Must-haves</span></div></td><td data-label="Recruiter screening" className={`x-sm${missingMetadata(c.screening) ? " x-muted" : ""}`}>{missingMetadata(c.screening) ? c.screening : <MetadataParts parts={[c.screening]}/>}</td><td data-label="Client interview" className={`x-sm${missingMetadata(c.interview) ? " x-muted" : ""}`}><MetadataParts parts={interviewFragments(c.interview)}/></td><td data-label={sharedLabel} className="x-num x-sm"><MetadataParts parts={[fd(c.shared)]}/></td></tr>;})}</tbody></table></div></section>;
}

function MetadataParts({parts}:{parts:readonly string[]}) {
  return <span className="x-nwg">{parts.map((text,index)=><Fragment key={index}>{index>0 ? " " : ""}<span className="x-nw">{text}</span></Fragment>)}</span>;
}
