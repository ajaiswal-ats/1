import type { CandidateFilter, RoleChoice } from "../domain/candidates";
import { usePersisted } from "./persisted";

/* Candidates page controls, remembered between visits (2h S.ui: view, role, filter, showDec). */
export interface CandidatesUi {
  view: "pipeline" | "list";
  role: RoleChoice;
  filter: CandidateFilter;
  showDeclined: boolean;
}

const CANDIDATES_KEY = "ro-portal-candidates";

export const useCandidatesUi = (validRoles: string[]) =>
  usePersisted<CandidatesUi>(CANDIDATES_KEY, { view: "pipeline", role: "all", filter: "all", showDeclined: false },
    (v) => ({ ...v, role: v.role !== "all" && !validRoles.includes(v.role) ? "all" : v.role, filter: v.filter === "you" ? "you" : "all" }));

/** Opens Candidates on one role with no other filter, as 2h's role links do (data-role): saved before navigating there. */
export function openCandidatesFor(role: RoleChoice) {
  try {
    const v = JSON.parse(localStorage.getItem(CANDIDATES_KEY) || "{}");
    localStorage.setItem(CANDIDATES_KEY, JSON.stringify({ ...v, role, filter: "all" }));
  } catch { /* storage unavailable: Candidates opens with its current filters */ }
}
