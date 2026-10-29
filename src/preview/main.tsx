import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans-condensed/500.css";
import "@fontsource/ibm-plex-sans-condensed/600.css";
import "../styles/tokens.css";
import "../styles/shell.css";
import "../styles/candidates.css";
import "../styles/candidate.css";
import "../scoring/scoring.css";
import "./preview.css";
import { PreviewApp } from "./PreviewApp";

/* The read-only assessment preview (vite.preview.config.mjs): a separate static page, not part of the client portal.
   The candidate data is not in this bundle: it is fetched from data/assessments.json, which the export script writes
   next to the built page in the private folder, and which is served only behind the deployment's access protection. */
createRoot(document.getElementById("root")!).render(<StrictMode><PreviewApp /></StrictMode>);
