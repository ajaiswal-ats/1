import { useEffect, useState } from "react";
import { useData } from "../data/DataProvider";
import { CURRENT_USER } from "../data/fixtures";
import { roleOf, search } from "../domain/candidates";
import { useTheme, type Theme } from "../lib/theme";
import { SearchIcon } from "./icons";

export function TopBar() {
  const [theme, setTheme] = useTheme();
  const data = useData(), [query, setQuery] = useState(""), [open, setOpen] = useState(false), found = search(data, query);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, []);
  const themeButton = (t: Theme, label: string) => (
    <button type="button" aria-pressed={theme === t} onClick={() => setTheme(t)}>{label}</button>
  );
  return (
    <header className="topbar">
      <div className="top-in">
        <div className="search" role="search">
          <SearchIcon />
          <label htmlFor="q" className="sr">Search candidates and roles</label>
          <input id="q" type="search" placeholder="Search candidates or roles" autoComplete="off" value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }} />
          {/* As in 2h: up to 6 candidates by name and any matching roles; choosing one clears the search. */}
          <div className="spop" id="spop" hidden={!open || !found} onClick={() => { setOpen(false); setQuery(""); }}>
            {found && (found.subs.length || found.roles.length ? <>
              {found.subs.map((c) => <a key={c.id} href={`#c-${c.id}`}><span>{c.name}</span><span className="xs muted">{roleOf(data, c).title}</span></a>)}
              {found.roles.map((r) => <a key={r.id} href={`#role-${r.id}`}><span>{r.title}</span><span className="xs muted">Role</span></a>)}
            </> : <p className="small muted" style={{ margin: "6px 10px" }}>No matches</p>)}
          </div>
        </div>
        <div className="tright">
          <div className="seg theme" role="group" aria-label="Theme">
            {themeButton("light", "Light")}
            {themeButton("dark", "Dark")}
          </div>
          <div className="me">
            <span className="who"><b>{CURRENT_USER.name}</b><span>{CURRENT_USER.title}</span></span>
            <span className="av me-av" aria-hidden="true">{CURRENT_USER.initials}</span>
          </div>
        </div>
      </div>
      <div className="mockline proto">Mockup · fictional data · not connected to Manatal or Fireflies · actions are saved only in this browser</div>
    </header>
  );
}
