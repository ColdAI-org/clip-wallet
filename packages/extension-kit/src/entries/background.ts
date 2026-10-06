/**
 * Background (service worker) for a Clip Wallet extension:
 *
 *   // entrypoints/background.ts
 *   import { defineBackground } from "wxt/utils/define-background";
 *   import { startBackground } from "@clip-wallet/extension-kit/background";
 *   export default defineBackground({ type: { firefox: "module" }, main: () => startBackground() });
 *
 * (Firefox: an ES-module event page, so the background stays under addons-linter's 5 MB parse limit.)
 *
 * The background owns the vault, the security checks and every approval.
 *
 * @module
 */
import "../shared/node-globals";

export { startBackground, toEnvelope } from "../background/main";
