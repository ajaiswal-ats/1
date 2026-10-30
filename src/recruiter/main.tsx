import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../portalStyles";
import "./recruiter.css";
import { RecruiterApp } from "./RecruiterApp";

createRoot(document.getElementById("root")!).render(<StrictMode><RecruiterApp /></StrictMode>);
