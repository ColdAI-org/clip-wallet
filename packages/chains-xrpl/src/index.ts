export { XRPL_METHODS, type XrplModuleOptions, type XrpSpendable, createXrplModule, normalize } from "./module.js";
export {
  RLUSD_CODE,
  USDC_CODE,
  XRPL_DEVNET,
  XRPL_MAINNET,
  XRPL_NETS,
  XRPL_NETWORKS,
  XRPL_TESTNET,
  type XrplNet,
  type XrplNetSpec,
  currencyName,
  explorerTxUrl,
  fromChainId,
  knownTokens,
  netOf,
  tokenAsset,
  xrpAsset,
} from "./networks.js";
export { addressOfPublicKey, decodeXAddress, encodeXAddress, isClassicAddress } from "./address.js";
export { UnsupportedField, derSignature, serializeObject, signingDigest, signingPayload, txHash } from "./codec.js";
export { ASF, RIPPLE_EPOCH, describeTx } from "./describe.js";
export { XrplRpcError, plainXrplError } from "./rpc.js";

import { createXrplModule } from "./module.js";

/** Default instance. */
export const xrplModule = createXrplModule();
