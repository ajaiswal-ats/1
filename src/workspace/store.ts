/* Workspace data state for the Supabase portal, without React. It follows the signed-in account: a different user or client,
   or no account, drops the loaded data at once (before anything new loads), and answers for an earlier account are ignored. */
import type { Workspace } from "./data";

export interface AccountKey { userId: string; clientId: string }
export type WorkspaceState =
  | { status: "idle" }
  | { status: "loading"; key: string }
  | { status: "ready"; key: string; ws: Workspace }
  | { status: "error"; key: string };

export const keyOf = (a: AccountKey) => `${a.userId}:${a.clientId}`;

export interface WorkspaceController {
  getState(): WorkspaceState;
  subscribe(listener: () => void): () => void;
  /** Called on every change of the signed-in account (null: signed out, or no active membership). */
  sync(account: AccountKey | null): void;
  retry(): void;
  /** Reloads for the current account (after a saved change or a conflict), keeping what is shown until the answer arrives. */
  refresh(): void;
}

export function createWorkspaceController(load: (clientId: string) => Promise<Workspace>): WorkspaceController {
  let state: WorkspaceState = { status: "idle" }, generation = 0, current: AccountKey | null = null;
  const listeners = new Set<() => void>();
  const set = (s: WorkspaceState) => { state = s; listeners.forEach((l) => l()); };
  const start = async (a: AccountKey, keep = false) => {
    const mine = ++generation, key = keyOf(a);
    if (!keep || state.status !== "ready" || state.key !== key) set({ status: "loading", key });
    try {
      const ws = await load(a.clientId);
      if (mine === generation) set(ws.clientId === a.clientId ? { status: "ready", key, ws } : { status: "error", key });
    } catch {
      if (mine === generation) set({ status: "error", key });
    }
  };
  return {
    getState: () => state,
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
    sync(a) {
      if (!a) { current = null; generation++; if (state.status !== "idle") set({ status: "idle" }); return; }
      if (current && keyOf(current) === keyOf(a) && state.status !== "idle") return;
      current = a;
      void start(a);
    },
    retry() { if (state.status === "error" && current) void start(current); },
    refresh() { if (current && state.status !== "idle") void start(current, true); },
  };
}
