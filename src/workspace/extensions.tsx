import { createContext, useContext, type ReactNode } from "react";
import type { DbRole, DbSubmission } from "./data";

/* Optional additions to the database-backed pages. Normal portal modes provide none, so every page renders exactly as
   before. Only the local scoring test (src/scoring/testMode.tsx, development builds only) provides them. Each returns
   null to leave that part of the page unchanged. */
export interface WorkspaceExtension {
  /** Shown in the candidate's Summary tab, after any published summary (or in place of "No summary is currently shared"). */
  summary?(sub: DbSubmission): ReactNode | null;
  /** Replaces the Screening interview tab's content. */
  screening?(sub: DbSubmission): ReactNode | null;
  /** Replaces the actions in the Next step panel. */
  actions?(sub: DbSubmission): ReactNode | null;
  /** True leaves out the Next step panel (and its column), for a view with no actions to offer. */
  hideNextStep?(sub: DbSubmission): boolean;
  /** Replaces the Notes and history tab's content. */
  history?(sub: DbSubmission): ReactNode | null;
  /** Wording for when a submission arrived, where the portal says "Shared" (for example "Added to local test"). */
  added?: { long: string; short: string };
  /** Replaces the note under the Candidates toolbar. */
  candidatesNote?: string;
  /** Shown on the role page, after the role details. */
  role?(role: DbRole): ReactNode | null;
  /** Replaces the Candidates page (the list), for example with a recruiter's assessment list. */
  candidatesPage?(): ReactNode;
  /** Extra pages listed under "Recruiter tools" in the navigation (for example the local CV assessment flow). */
  tools?: { route: string; label: string; render(): ReactNode }[];
}

const Ctx = createContext<WorkspaceExtension | null>(null);
export const WorkspaceExtensionProvider = ({ value, children }: { value: WorkspaceExtension; children: ReactNode }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
export const useWorkspaceExtension = () => useContext(Ctx);
