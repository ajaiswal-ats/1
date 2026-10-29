import { useEffect, useState } from "react";
import { hashPath } from "./candidatesRoute";

export type NavKey = "candidates" | "roles" | "progress" | "help";

/* Hash routes, as in 2h: #candidates, #roles, #progress, #c-{submission}, #role-{role}. */
export function useHashRoute(): string {
  const read = () => hashPath(location.hash);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    let previous = read();
    const restoration = history.scrollRestoration;
    history.scrollRestoration = "manual";
    const onChange = () => { const next=read(); setRoute(next); if(next!==previous && next!=="candidates") window.scrollTo(0, 0); previous=next; };
    window.addEventListener("hashchange", onChange);
    return () => { window.removeEventListener("hashchange", onChange); history.scrollRestoration=restoration; };
  }, []);
  return route;
}

/** Which navigation item a route belongs to. Unknown routes fall back to Candidates, as in 2h. */
export function navFor(route: string): NavKey {
  if (route.startsWith("c-")) return "candidates";
  if (route.startsWith("role-")) return "roles";
  return route === "roles" || route === "progress" || route === "help" ? route : "candidates";
}

/** The Candidates list (not a candidate's own page). Unknown routes show it too. Used to scope the Sample 1 styles. */
export const isCandidatesList = (route: string) => navFor(route) === "candidates" && !route.startsWith("c-");
