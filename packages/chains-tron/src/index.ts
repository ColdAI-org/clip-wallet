export { TRON_METHODS, type TronModuleOptions, type TronStaking, controls, createTronModule, normalize } from "./module.js";
export {
  TRON_MAINNET,
  TRON_NETS,
  TRON_NETWORKS,
  TRON_NILE,
  TRON_SHASTA,
  type TronNet,
  type TronNetSpec,
  chainIdHex,
  explorerTxUrl,
  fromChainId,
  netOf,
  specFor,
  trxAsset,
  usdtAsset,
} from "./networks.js";
export { addressBytes, addressBytesFromPublicKey, encodeAddress, isTronAddress, sameAddress, toBase58, toHex41 } from "./address.js";
export { TRON_MESSAGE_PREFIX, messageHash } from "./message.js";
export { CONTRACT_TYPES, type ContractName, type RawTx, type TronWebTx, bandwidthBytes, encodeRaw, jsonMismatches, parseRaw, refBlockFields, txIdOf } from "./tx.js";
export { SELECTORS, decodeTrc20, encodeTransferCall } from "./abi.js";
export { trc20Asset } from "./describe.js";
export { TronRpc, plainTronError } from "./rpc.js";

import { createTronModule } from "./module.js";

/** Default instance. */
export const tronModule = createTronModule();
