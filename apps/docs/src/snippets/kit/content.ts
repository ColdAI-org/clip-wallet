// src/entrypoints/content.ts: the 1Mask bridge (ISOLATED world). It adds the page's real origin to every request.
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
