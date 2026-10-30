/* Explicit public fictional demo. No AuthRoot, Supabase client, or workspace session is loaded. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./portalStyles";
import { App } from "./App";
import { DataProvider } from "./data/DataProvider";
import { ToastProvider } from "./components/Toast";

createRoot(document.getElementById("root")!).render(
  <StrictMode><DataProvider><ToastProvider><App /></ToastProvider></DataProvider></StrictMode>,
);
