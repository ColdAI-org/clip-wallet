/** 1Mask content script (ISOLATED world): relays checked page messages to the background. */
import { defineContentScript } from "wxt/utils/define-content-script";
import { CONTENT_MATCHES, startContentBridge } from "@clip-wallet/extension-kit/content";

export default defineContentScript({
  matches: CONTENT_MATCHES,
  runAt: "document_start",
  allFrames: false,
  main() {
    startContentBridge();
  },
});
