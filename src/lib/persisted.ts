import { useState } from "react";

/* Page controls remembered in this browser between visits, as 2h does with its saved state. */
export function usePersisted<T extends object>(key: string, defaults: T, validate: (v: T) => T = (v) => v): [T, (change: Partial<T>) => void] {
  const [value, setValue] = useState<T>(() => {
    try { return validate({ ...defaults, ...JSON.parse(localStorage.getItem(key) || "{}") }); } catch { return defaults; }
  });
  const update = (change: Partial<T>) => setValue((prev) => {
    const next = { ...prev, ...change };
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage unavailable: the choice applies for this visit */ }
    return next;
  });
  return [value, update];
}
