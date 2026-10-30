import { MoonIcon, SignOutIcon, ResetIcon } from "./icons";
import {useResetDemo} from "../data/DataProvider";
import { useTheme } from "../lib/theme";

/** Existing theme and sign-out actions, placed in the reference's sidebar footer. */
export function ShellActions({ onSignOut, demoExit=false }: { onSignOut?(): void; current?:string; demoExit?:boolean }) {
  const [theme,setTheme]=useTheme(),reset=useResetDemo();
  return <div className="side-foot"><button type="button" onClick={()=>setTheme(theme==="light" ? "dark" : "light")}><MoonIcon/>{theme==="light" ? "Dark theme" : "Light theme"}</button>{demoExit && <button type="button" onClick={()=>{if(window.confirm("Reset the fictional demo actions in this browser? Real accounts and records are not affected.")){if(reset())location.hash="#candidates";else window.alert("Demo data could not be reset because browser storage is unavailable.");}}}><ResetIcon/>Reset demo</button>}{demoExit && <a href="#demo-exit"><SignOutIcon/>Sign out (demo)</a>}{onSignOut && <button type="button" onClick={onSignOut}><SignOutIcon/>Sign out</button>}</div>;
}
