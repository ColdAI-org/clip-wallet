/** 1Mask inpage providers (MAIN world) for all 14 families, announced with this wallet's identity. */
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
