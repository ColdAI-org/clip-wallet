/**
 * Background (service worker) for a Clip Wallet extension:
 *
 *   // entrypoints/background.ts
 *   import { defineBackground } from "wxt/utils/define-background";
 *   import { startBackground } from "@clip-wallet/extension-kit/background";
 *   export default defineBackground(() => startBackground());
 *
 * The background owns the vault, the security checks and every approval.
 */
import "../shared/node-globals";

export { startBackground, toEnvelope } from "../background/main";
