import type { ReactNode } from "react";
import { fd } from "../lib/dates";

export interface ActivityNote { id: string; label: string; text: string; author: string; date: string; about?: string | null; category?: string | null }
export interface ActivityEntry { id: string; date: string; title: string; notes?: ActivityNote[] }

/** Render only the supplied client-visible activity; adapters retain permissions and source links. */
export function CandidateActivity({ entries, onFeedback, audience = "Visible to authorised users at your company. Not shared with the candidate.", notesUnavailable = false, children }: {
  entries: ActivityEntry[]; onFeedback?: () => void; audience?: string; notesUnavailable?: boolean; children?: ReactNode;
}) {
  const hasNotes = entries.some((entry) => entry.notes?.length);
  return <section className="candidate-activity">
    <div className="activity-head"><h2>Notes and feedback</h2>{onFeedback && !notesUnavailable && <button type="button" className="btn btn-s btn-sm" onClick={onFeedback}>Add interview feedback</button>}</div>
    <p className="activity-audience">{audience}</p>
    {notesUnavailable ? <p className="small muted">Notes are not available on this database yet.</p> : !hasNotes && <p className="small muted">No notes yet. Feedback and decision notes will appear with the activity below.</p>}
    <div className="sec-h activity-heading"><h3>Activity</h3><span className="xs muted">Newest first</span></div>
    {entries.length ? <ol className="activity-list">{entries.map((entry) => <li className="activity-item" key={entry.id}>
      <time className="activity-date" dateTime={entry.date}>{`${fd(entry.date)} ${entry.date.slice(0, 4)}`}</time>
      <div className="activity-content"><p className="activity-title">{entry.title}</p>
        {entry.notes?.map((note) => <article className="activity-note" key={note.id}>
          <div className="activity-note-heading"><b>{note.label}</b>{note.category && <span className="chip c-mute">{note.category}</span>}</div>
          {note.about && <p className="xs muted">{note.about}</p>}
          <p className="activity-note-text">{note.text}</p>
          <p className="xs muted">{`${note.author} · ${fd(note.date)} ${note.date.slice(0, 4)}`}</p>
        </article>)}
      </div>
    </li>)}</ol> : <p className="small muted">No history is available for this candidate.</p>}
    {children}
  </section>;
}
