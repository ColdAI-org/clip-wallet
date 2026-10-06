/**
 * 1Mask content script (ISOLATED world): relays checked page messages to the background over a port.
 *
 * @module
 */
import { createContentBridge } from "@clip-wallet/1mask/content";
import type {} from "../globals";

export { CONTENT_MATCHES } from "./inpage";

export function startContentBridge(): void {
  createContentBridge({ channel: __CLIP_CHANNEL__ });
}
