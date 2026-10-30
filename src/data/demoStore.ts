/* Demo changes saved in this browser: a list of client actions, shared by every open tab of the portal.
   Each save reads the latest list first and appends to it, so a tab never overwrites what another tab saved. */
import { isPermitted, replay, validationError, type DemoAction } from "../domain/actions";
import type { Dataset } from "./fixtures";

export const DEMO_KEY = "ro-portal-demo-actions";

type Store = Pick<Storage, "getItem" | "setItem">;

/** The saved list, or null if storage cannot be read. Unreadable or malformed saved data gives an empty or shorter list. */
export function loadSaved(store: Store | undefined): unknown[] | null {
  try {
    const raw = store?.getItem(DEMO_KEY);
    if (raw == null) return store ? [] : null;
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return e instanceof SyntaxError ? [] : null;
  }
}

/** This tab's view of the demo changes: the last saved list it has seen, plus its own actions that could not be
    written (for example when storage is full). Shown together, in that order. */
export interface DemoState {
  stored: unknown[];
  /** Saved for this visit only, because writing to storage failed. */
  unsaved: DemoAction[];
}

export const shown = (s: DemoState): unknown[] => [...s.stored, ...s.unsaved];

/** Saves one action on top of the latest saved list and this tab's unsaved actions. The action is checked against the
    data as it is with all of them applied. If the write succeeds, the unsaved actions are written with it; if it fails,
    the action joins them, so every action stays applied for this visit. Saved entries already there are kept as they are. */
export function saveAction(store: Store | undefined, base: Dataset, a: DemoAction, state: DemoState): { saved: boolean; state: DemoState } {
  const stored = loadSaved(store) ?? state.stored, current = { stored, unsaved: state.unsaved };
  if (!isPermitted(replay(base, shown(current)).data, a) || validationError(a)) return { saved: false, state: current };
  const next = [...shown(current), a];
  try {
    if (!store) throw new Error("no storage");
    store.setItem(DEMO_KEY, JSON.stringify(next));
    return { saved: true, state: { stored: next, unsaved: [] } };
  } catch {
    return { saved: true, state: { stored, unsaved: [...state.unsaved, a] } };
  }
}

/** The state after another tab saved: its latest saved list, keeping this tab's unsaved actions. */
export const refresh = (store: Store | undefined, state: DemoState): DemoState => ({ stored: loadSaved(store) ?? state.stored, unsaved: state.unsaved });

/** Reset only the fictional action log; never touch auth sessions or unrelated browser settings. */
export function resetDemo(store:Store|undefined):boolean {
  try {if(!store)return false;store.setItem(DEMO_KEY,'[]');return true;} catch{return false;}
}
