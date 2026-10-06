/**
 * @clip-wallet/1mask/background — the router the extension background uses.
 *
 *   chrome.runtime.onConnect.addListener((port) => {
 *     if (port.name !== PORT_NAME) return;
 *     router.attachPort(port, { senderOrigin: port.sender?.origin });
 *   });
 *
 * @module
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
export {
  CARDANO_METHODS_ALLOWED,
  SUBSTRATE_METHODS_ALLOWED,
  cardanoSubstrateAllowlist,
  dispatchCardanoSubstrate,
  type CardanoSubstrateRouterHelpers,
} from "./cardano-substrate.js";
export {
  STARKNET_METHODS_ALLOWED,
  TON_METHODS_ALLOWED,
  createStarknetTonDispatch,
  starknetFeltChainId,
  starknetTonAllowlist,
  type StarknetTonHelpers,
  type StarknetTonOptions,
  type TonAddrItem,
} from "./starknet-ton.js";
export { createCallsDispatch, type CallsRouterHelpers } from "./eip5792.js";
export * from "../shared/calls.js";
/* networks87: dispatchers live in router.ts; hosts need the connect and read-only method names. */
export { COSMOS_CONNECT_METHODS, COSMOS_INJECTED, COSMOS_FAMILIES } from "../shared/cosmos.js";
export { TRON_CONNECT_METHODS } from "./tron.js";
export { STACKS_INJECTED } from "../shared/stacks.js";
export { FUEL_CONNECT_METHODS } from "../shared/fuel.js";
import { COSMOS_CONNECT_METHODS as _COSMOS_CONNECT, COSMOS_INJECTED as _COSMOS } from "../shared/cosmos.js";
import { TRON_CONNECT_METHODS as _TRON_CONNECT } from "./tron.js";
import { STACKS_INJECTED as _STACKS } from "../shared/stacks.js";
import { FUEL_CONNECT_METHODS as _FUEL_CONNECT } from "../shared/fuel.js";
/** Methods the host treats as a connect approval (Keplr enable, TIP-1193 accounts, SIP-030 addresses, FuelConnector connect). */
export const N87_CONNECT_METHODS: readonly string[] = [..._COSMOS_CONNECT, ..._TRON_CONNECT, _STACKS.connect, ..._FUEL_CONNECT];
/** Read-only chain calls answered by a chain module without an approval (Keplr sendTx of an already-signed tx, verifyArbitrary). */
export const N87_CHAIN_READ: readonly string[] = [_COSMOS.sendTx, _COSMOS.verifyArbitrary];
