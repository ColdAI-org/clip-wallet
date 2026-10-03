/**
 * @clip-wallet/1mask/background — the router the extension background uses.
 *
 *   chrome.runtime.onConnect.addListener((port) => {
 *     if (port.name !== PORT_NAME) return;
 *     router.attachPort(port, { senderOrigin: port.sender?.origin });
 *   });
 */
export {
  createOneMaskRouter,
  defaultRouterFamilyForNetwork,
  type AccountLike,
  type DispatchInput,
  type OneMaskRouter,
  type OneMaskRouterOptions,
  type RouterPort,
} from "./router.js";
export { createMemoryPermissionStore, type PermissionStore } from "./permissions.js";
export { BITCOIN_METHODS_ALLOWED, EVM_METHODS, HEDERA_METHODS, SOLANA_METHODS, injectedAllowlist } from "./methods.js";
export { PORT_NAME } from "../shared/protocol.js";
