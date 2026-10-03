/** 1Mask content script (ISOLATED world): relays checked page messages to the background over a port. */
import { defineContentScript } from "wxt/utils/define-content-script";
import { createContentBridge } from "@clip-wallet/1mask/content";

export default defineContentScript({
  matches: ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
  runAt: "document_start",
  allFrames: false,
  main() {
    createContentBridge({ channel: __CLIP_CHANNEL__ });
  },
});
