import {RecruiterMessageForm} from "./RecruiterMessageForm";
import {Fragment,useEffect,useRef,useState} from 'react';
import {SearchIcon,ChevronIcon,HelpIcon} from '../components/icons';
import {useData} from '../data/DataProvider';
import './help.css';

const GROUPS=[['cand','Candidates'],['dec','Interviews and decisions'],['rep','Reports'],['acct','Account help']] as const;
export const HELP_TOPICS=[
 {id:'review',group:'cand',title:'Reviewing a candidate',body:['Open a candidate from Candidates (By stage or List), or from a role page.','Summary shows the information shared for that role. The Next step panel shows what is waiting and the actions available to you.']},
 {id:'waiting',group:'cand',title:'What “Waiting on you” means',body:['You have a review to make or interview feedback to share.','Amber labels show Review needed or Feedback due. The filter and sidebar count use the existing next-step information.']},
 {id:'reqcheck',group:'cand',title:'Reading the requirement check',body:['Requirements show the available evidence: Supported, Partly supported, Not evidenced or Confirmed not met.','Must-have counts describe evidence for that role. Open the candidate to read the details and sources. Missing evidence is not treated as a confirmed failure.']},
 {id:'resume',group:'cand',title:'Resumes and contact details',body:['Open the candidate’s Resume tab to see the resume information shared in this workspace.','Contact the candidate through your recruiter. If a resume or recording has not been shared, ask your recruiter for it.']},
 {id:'stages',group:'dec',title:'What each stage means',body:['To review: a submission awaiting review. Interview: the interview stage. Offer: the offer stage. Hired: a recorded hire. Declined: declined for this role.','A stage alone does not establish that an interview took place or an offer was accepted. Read the recorded interview and outcome details. Include declined in Candidates to see declined submissions.']},
 {id:'move',group:'dec',title:'Moving a candidate to another stage',body:['Open the candidate’s Next step panel and use an available stage action. Review the confirmation before saving.','Available actions depend on your access, the candidate’s stage and the role’s status. Stage changes are paused while a role is on hold. Board drag-and-drop and card action menus are not available in this workspace.','An interview request is not a booking. Revenue Optics arranges the interview.']},
 {id:'feedback',group:'dec',title:'Sharing interview feedback',body:['When available, choose Share interview feedback in the candidate’s Next step panel and add the required note.','Feedback does not change the stage. The actions shown depend on the recorded interview and your access.']},
 {id:'decline',group:'dec',title:'Declining a candidate',body:['When available, choose Decline in the candidate’s Next step panel and add the required note.','A decline applies to that role only. The same person’s submission for another role is unaffected.']},
 {id:'screening',group:'dec',title:'Recruiter screening and client interviews',body:['Recruiter screening is Revenue Optics’ call. A client interview is a separate event with your team. A screening call does not mean a client interview took place.','The Candidates list shows separate columns for these events. Missing dates stay missing; a feedback date is not used as an interview-held date.']},
 {id:'reports',group:'rep',title:'Hiring progress report',body:['Hiring progress shows pipeline and movement information for the workspace.','Read each chart’s counting notes and date range before comparing totals. Multiple submissions for one person can belong to different roles.']},
 {id:'signin',group:'acct',title:'Sign-in problems and technical faults',body:['In-app technical support messaging is not connected.','If you cannot sign in, follow the access guidance provided with your invitation or contact your Revenue Optics recruiter through your existing channel. For pages that do not load or data that looks wrong, record the page and problem for your team’s support contact. Do not include passwords or access tokens.']},
];
export const searchHelp=(query:string)=>{const q=query.trim().toLowerCase();return HELP_TOPICS.filter(t=>!q||[t.title,...t.body].join(' ').toLowerCase().includes(q));};
export interface HelpLocation {query:string;topic:string}
export function parseHelpHash(hash:string):HelpLocation {
 const q=new URLSearchParams(hash.split('?')[0]==='#help'?hash.split('?').slice(1).join('?'):'');
 const topic=q.get('topic')??'';return {query:q.get('q')??'',topic:HELP_TOPICS.some(t=>t.id===topic)||topic==='about'?topic:''};
}
export function helpHash(state:HelpLocation){const q=new URLSearchParams();if(state.query)q.set('q',state.query);if(state.topic)q.set('topic',state.topic);return '#help'+(q.size?'?'+q.toString():'');}
function Highlight({text,query}:{text:string;query:string}){
 const q=query.trim();if(!q)return <>{text}</>;
 const start=text.toLowerCase().indexOf(q.toLowerCase());
 return start<0?<>{text}</>:<>{text.slice(0,start)}<mark>{text.slice(start,start+q.length)}</mark><Highlight text={text.slice(start+q.length)} query={q}/></>;
}
export function DemoHelp(){const data=useData();return <HelpPage demo roles={data.roles.map(r=>({title:r.title,recruiterName:r.contact}))}/>;}
export function HelpPage({roles,demo=false}:{roles:readonly {title:string;recruiterName:string}[];demo?:boolean}){
 const read=()=>parseHelpHash(typeof location==='undefined'?'#help':location.hash);
 const [state,setState]=useState(read),[draft,setDraft]=useState(state.query),[closed,setClosed]=useState(false);
 const search=useRef<HTMLInputElement>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const cancel=()=>{if(timer.current)clearTimeout(timer.current);timer.current=null;};
 const write=(next:HelpLocation)=>{setState(next);history.replaceState(history.state,'',helpHash(next));};
 useEffect(()=>{const sync=()=>{cancel();const next=read();setState(next);setDraft(next.query);setClosed(false);};window.addEventListener('hashchange',sync);return()=>{cancel();window.removeEventListener('hashchange',sync);};},[]);
 const clear=()=>{cancel();setClosed(false);setDraft('');write({query:'',topic:''});search.current?.focus();};
 const hits=searchHelp(state.query),query=state.query.trim();
 const openId=closed?'':state.topic||(query&&hits.length===1?hits[0].id:'');
 const recruiters=[...new Set(roles.map(r=>r.recruiterName.trim()).filter(Boolean))];
 const topic=(t:{id:string;title:string;body:string[]})=><details key={t.id} className="h-topic" open={openId===t.id}><summary onClick={e=>{e.preventDefault();cancel();setDraft(state.query);setClosed(openId===t.id);write({...state,topic:openId===t.id?'':t.id});}}><span className="h-topic-icon"><HelpIcon/></span><span><Highlight text={t.title} query={query}/></span><ChevronIcon/></summary><div className="h-answer">{t.body.map((text,i)=><p key={i}><Highlight text={text} query={query}/></p>)}</div></details>;
 return <div className="portal-help"><header className="h-head"><h1>Help and support</h1><p>Answers about using this workspace and contacting your recruiter.</p></header>
 <div className="h-search" role="search" aria-label="Search help"><label htmlFor="hq">Search help</label><div><SearchIcon/><input ref={search} id="hq" type="search" autoComplete="off" value={draft} placeholder="For example: decline, interview, stage" aria-describedby="helpCount" onChange={e=>{cancel();const value=e.target.value;setDraft(value);timer.current=setTimeout(()=>{setClosed(false);write({query:value,topic:''});},200);}}/></div><p id="helpCount" role="status">{query?hits.length?`${hits.length} ${hits.length===1?'topic matches':'topics match'} “${query}”`:`No topics match “${query}”`:`${hits.length} topics`}{(draft||query)&&<button className="h-link" onClick={clear}>Clear search</button>}</p></div>
 <div className="h-grid"><section className="h-panel h-topics" aria-label="Help topics">{hits.length?GROUPS.map(([id,label])=>{const topics=hits.filter(t=>t.group===id);return topics.length?<div className="h-group" key={id}><h2>{label}</h2>{topics.map(topic)}</div>:null;}):<div className="h-empty"><h2>No help topics match “{query}”</h2><p>Try a shorter word such as “stage”, “interview” or “decline”.</p><button onClick={clear}>Clear search</button></div>}<div className="h-about">{topic({id:'about',title:demo?'About this demo':'About this workspace',body:demo?['This local demo uses fictional people, companies and roles. Changes stay in this browser. No messages are sent to a recruiter or support team.']:['Information and available actions belong to your workspace. In-app support messaging is not connected.']})}</div></section>
 <aside className="h-side" aria-label="Contact and support"><section className="h-panel"><h2>Contact your recruiter</h2><div className="h-pad">{recruiters.length?recruiters.map(name=><Fragment key={name}><h3>{name}</h3><p>{roles.filter(r=>r.recruiterName.trim()===name).map(r=>r.title).join(' · ')}</p></Fragment>):<p>Recruiter details are not available in this workspace.</p>}<p>For questions about candidates, roles and the hiring process.</p><RecruiterMessageForm roles={roles}/></div></section><section className="h-panel"><h2>Technical support</h2><div className="h-pad"><p>There is no technical support contact configured in this workspace.</p><p>Use your team’s existing support channel for access problems, pages that do not load or incorrect data.</p><a href="#help?topic=signin">Sign-in and technical help</a></div></section></aside></div></div>;
}
