import type { RoleFilter, RoleSort } from "../reporting/metrics";
import { usePersisted } from "./persisted";

/* Hiring progress controls, remembered between visits. */
export interface ProgressUi {
  role: RoleFilter;
  pipelineView: "reached" | "now";
  includeOnHold: boolean;
  sort: RoleSort;
}

export const useProgressUi = (validRoles: string[]) =>
  usePersisted<ProgressUi>("ro-portal-progress", { role: "all", pipelineView: "reached", includeOnHold: false, sort: "fewest" },
    (v) => (v.role !== "all" && !validRoles.includes(v.role) ? { ...v, role: "all" } : v));
