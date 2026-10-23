import { useState } from "react";

export type Theme = "light" | "dark";
const KEY = "ro-portal-theme";

/* index.html sets data-theme before first paint; this hook keeps it in sync and remembers the choice. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() =>
    document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light",
  );
  const setTheme = (t: Theme) => {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem(KEY, t); } catch { /* storage unavailable: theme still applies for this visit */ }
    setThemeState(t);
  };
  return [theme, setTheme];
}
