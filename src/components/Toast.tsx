import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

/* Short status message at the bottom of the page, as in 2h (shown for 3.6 seconds). */
const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null), timer = useRef<number | undefined>(undefined);
  const show = useCallback((m: string) => {
    setMessage(m);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 3600);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast" id="toast" role="status" hidden={!message}>{message}</div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
