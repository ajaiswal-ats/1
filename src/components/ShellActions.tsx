import { MoonIcon, SignOutIcon, HelpIcon } from "./icons";
import { useTheme } from "../lib/theme";

/** Existing theme and sign-out actions, placed in the reference's sidebar footer. */
export function ShellActions({ onSignOut, current, demoExit=false }: { onSignOut?(): void; current?:string; demoExit?:boolean }) {
  const [theme,setTheme]=useTheme();
  return <div className="side-foot"><a href="#help" aria-current={current==="help" ? "page" : undefined}><HelpIcon/>Help and support</a><button type="button" onClick={()=>setTheme(theme==="light" ? "dark" : "light")}><MoonIcon/>{theme==="light" ? "Dark theme" : "Light theme"}</button>{demoExit && <a href="#demo-exit"><SignOutIcon/>Sign out (demo)</a>}{onSignOut && <button type="button" onClick={onSignOut}><SignOutIcon/>Sign out</button>}</div>;
}
