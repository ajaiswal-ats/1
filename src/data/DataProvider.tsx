import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { replay, type DemoAction } from "../domain/actions";
import { DEMO_KEY, loadSaved, refresh, saveAction, shown, type DemoState } from "./demoStore";
import { FIXTURE, type Dataset } from "./fixtures";

export { DEMO_KEY } from "./demoStore";

/* The one dataset every page reads, so the sidebar, Candidates, the candidate page and the reports always agree.
   Demo changes are kept as a list of actions in this browser and replayed onto a copy of the fictional base data,
   so they survive reloads and the base data is never changed. Other open tabs' saves are picked up as they happen.
   Nothing is sent anywhere. */
const storage = () => { try { return globalThis.localStorage; } catch { return undefined; } };

interface DataContextValue { data: Dataset; act: (a: DemoAction) => boolean }
const DataContext = createContext<DataContextValue>({ data: FIXTURE, act: () => false });

export function DataProvider({ data: base = FIXTURE, children }: { data?: Dataset; children: ReactNode }) {
  const [state, setState] = useState<DemoState>(() => ({ stored: loadSaved(storage()) ?? [], unsaved: [] }));
  const { data } = useMemo(() => replay(base, shown(state)), [base, state]);

  /* Another tab saved (or the site's data was cleared): show the latest saved list. */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === DEMO_KEY || e.key === null) setState((s) => refresh(storage(), s)); };
    addEventListener("storage", onStorage);
    return () => removeEventListener("storage", onStorage);
  }, []);

  /** Saves an action if it is permitted with every tab's saved actions (and this tab's unsaved ones) applied.
      Returns whether it was saved; if storage cannot be written, it is kept for this visit. */
  const act = (a: DemoAction) => {
    const r = saveAction(storage(), base, a, state);
    setState(r.state);
    return r.saved;
  };
  return <DataContext.Provider value={{ data, act }}>{children}</DataContext.Provider>;
}

export const useData = () => useContext(DataContext).data;
export const useAct = () => useContext(DataContext).act;
