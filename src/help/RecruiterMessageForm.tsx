import {useState} from 'react';

/** Editable UI only until a delivery service is connected. Drafts are never persisted or sent. */
export function RecruiterMessageForm({roles}:{roles:readonly {title:string}[]}){
 const [topic,setTopic]=useState(''),[role,setRole]=useState(''),[message,setMessage]=useState('');
 return <form className="h-contact-form" aria-label="Message your recruiter" onSubmit={e=>e.preventDefault()}>
  <div className="h-field"><label htmlFor="cTopic">Topic</label><select id="cTopic" value={topic} onChange={e=>setTopic(e.target.value)}><option value="">Choose a topic</option>{['A candidate','A role','The hiring process','Hiring progress report'].map(t=><option key={t}>{t}</option>)}</select></div>
  <div className="h-field"><label htmlFor="cRole">Related role (optional)</label><select id="cRole" value={role} onChange={e=>setRole(e.target.value)}><option value="">None</option>{[...new Set(roles.map(r=>r.title))].map(title=><option key={title}>{title}</option>)}</select></div>
  <div className="h-field"><label htmlFor="cMsg">Message</label><textarea id="cMsg" maxLength={1000} value={message} onChange={e=>setMessage(e.target.value)} aria-describedby="cMsgCount sendNote"/><div id="cMsgCount">{message.length} / 1000</div></div>
  <div className="h-sendrow"><button type="submit" disabled aria-describedby="sendNote">Send message</button><span id="sendNote">In-app messaging is not connected.</span></div>
  <p className="h-draft-note">Draft only. Nothing is sent or saved; leaving this page discards your message.</p>
 </form>;
}
