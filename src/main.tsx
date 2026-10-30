import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./portalStyles";
import { App } from "./App";
import { ToastProvider } from "./components/Toast";
import { DataProvider } from "./data/DataProvider";
import { readPortalConfig } from "./auth/config";

/* Demo mode (the default) is the reviewed fictional workspace, unchanged. The Supabase portal is a separate tree, loaded
   only when .env.local selects it; it never renders the demo's data, even if its configuration is wrong. */
const root = createRoot(document.getElementById("root")!), config = readPortalConfig(import.meta.env);
/* The local scoring test (vite.scoring.config.mjs only): development builds only. In a production build import.meta.env.DEV
   is false, so this branch and its code are removed, and the mode is refused by readPortalConfig like any unknown mode. */
if (import.meta.env.DEV && import.meta.env.VITE_PORTAL_MODE === "scoring-test") {
  void import("./scoring/testMode").then(({ ScoringTestRoot }) => root.render(<StrictMode><ScoringTestRoot /></StrictMode>));
} else if (config.mode === "demo") {
  root.render(
    <StrictMode>
      <DataProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </DataProvider>
    </StrictMode>,
  );
} else {
  void import("./auth/AuthRoot").then(({ AuthRoot }) => root.render(<StrictMode><AuthRoot config={config} /></StrictMode>));
}
