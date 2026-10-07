// src/entrypoints/inpage.content.ts: 1Mask's providers for every family (MAIN world), under your identity.
import { defineContentScript } from "wxt/utils/define-content-script";
import { CONTENT_MATCHES, installInpage } from "@clip-wallet/extension-kit/inpage";

export default defineContentScript({
  matches: CONTENT_MATCHES,
  runAt: "document_start",
  world: "MAIN",
  main() {
    installInpage();
  },
});
