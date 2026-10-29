import { useEffect, useRef, useState } from "react";
import colourLogo from "../assets/revenue-optics-logo-colour.png";
import whiteLogo from "../assets/revenue-optics-logo.png";
import { MenuIcon } from "./icons";

/* The navigation drawer under 900 px wide (Sample 1 design baseline). The sidebar becomes a drawer opened from the top
   bar's menu button; Escape, the backdrop and following a link close it, and Escape returns focus to the button. At
   900 px and above the button is hidden and nothing changes. Presentation only: no data, route or permission is affected. */
export function useNavDrawer() {
  const [open, setOpen] = useState(false), button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const side = document.getElementById("side"), main = side?.closest(".shell")?.querySelector<HTMLElement>(".main");
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (main) main.inert = true;
    const focusable = () => Array.from(side?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') ?? []);
    focusable()[0]?.focus();
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); }
      if (e.key === "Tab") {
        const items = focusable(), first = items[0], last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    const nav = () => setOpen(false);
    const resize = () => { if (window.innerWidth >= 900) setOpen(false); };
    document.addEventListener("keydown", esc);
    window.addEventListener("hashchange", nav);
    window.addEventListener("resize", resize);
    return () => {
      document.body.style.overflow = overflow;
      if (main) main.inert = false;
      button.current?.focus();
      document.removeEventListener("keydown", esc); window.removeEventListener("hashchange", nav); window.removeEventListener("resize", resize);
    };
  }, [open]);
  return { open, setOpen, button };
}
export type NavDrawer = ReturnType<typeof useNavDrawer>;

/** The menu button and the compact logo shown at the start of the top bar under 900 px. */
export function TopBarStart({ drawer }: { drawer: NavDrawer }) {
  return (
    <>
      <button type="button" ref={drawer.button} className="menubtn" aria-label={drawer.open ? "Close navigation" : "Open navigation"}
        aria-expanded={drawer.open} aria-controls="side" onClick={() => drawer.setOpen(!drawer.open)}><MenuIcon /></button>
      <span className="toplogo"><img className="logo-light" src={colourLogo} alt="Revenue Optics" /><img className="logo-dark" src={whiteLogo} alt="Revenue Optics" /></span>
    </>
  );
}

/** The backdrop behind the open drawer. */
export function NavScrim({ drawer }: { drawer: NavDrawer }) {
  return drawer.open ? <div className="navscrim" aria-hidden="true" onClick={() => drawer.setOpen(false)} /> : null;
}
