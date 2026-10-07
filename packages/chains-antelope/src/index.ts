export { ANTELOPE_METHODS, type AntelopeModuleOptions, createAntelopeModule, normalize } from "./module.js";
export {
  ANTELOPE_NETS,
  ANTELOPE_NETWORKS,
  JUNGLE4,
  TELOS_MAINNET,
  TELOS_TESTNET,
  VAULTA_MAINNET,
  XPR_MAINNET,
  XPR_TESTNET,
  type AntelopeNet,
  type AntelopeNetSpec,
  type AntelopeToken,
  assetFor,
  caip2Of,
  explorerTxUrl,
  knownTokens,
  netOf,
} from "./networks.js";
export { type Abi, AbiError, TOKEN_ABI, decodeActionData, encodeActionData, isTokenTransfer } from "./abi.js";
export { formatAsset, isAccountName, isPublicKey, nameFromBigInt, nameToBigInt, parseAsset, parsePublicKey, publicKeyString, signatureString } from "./bytes.js";
export { type ActionJson, type TransactionJson, packTransaction, signingDigest, tapos, transactionId, unpackTransaction } from "./transaction.js";
export { AntelopeRpcError, type KeyAccount, clearAbiCache, plainAntelopeError } from "./rpc.js";

import { createAntelopeModule } from "./module.js";

/** Default instance. */
export const antelopeModule = createAntelopeModule();
