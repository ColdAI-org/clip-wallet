import "../shared/globals";
import "@fontsource-variable/inter";
import "./browser.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserChrome } from "./BrowserChrome";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserChrome />
  </StrictMode>,
);
