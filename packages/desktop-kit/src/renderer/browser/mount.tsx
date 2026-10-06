import "../shared/globals";
import "@fontsource-variable/inter";
import "@clip-wallet/desktop-kit/browser.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserChrome } from "./BrowserChrome";

/** The built-in browser's toolbar window (src/renderer/browser/main.tsx in a wallet project). */
export function mountBrowserChrome(): void {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserChrome />
    </StrictMode>,
  );
}
