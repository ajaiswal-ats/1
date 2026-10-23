import { useEffect, useState } from "react";

export type NavKey = "candidates" | "roles" | "progress";

/* Hash routes, as in 2h: #candidates, #roles, #progress, #c-{submission}, #role-{role}. */
export function useHashRoute(): string {
  const read = () => location.hash.slice(1) || "candidates";
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => { setRoute(read()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

/** Which navigation item a route belongs to. Unknown routes fall back to Candidates, as in 2h. */
export function navFor(route: string): NavKey {
  if (route.startsWith("c-")) return "candidates";
  if (route.startsWith("role-")) return "roles";
  return route === "roles" || route === "progress" ? route : "candidates";
}
