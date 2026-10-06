export { STACKS_METHODS, type StacksModule, type StacksModuleOptions, type StacksOp, addressOn, buildParts, createStacksModule, normalize, postConditionFrom } from "./module.js";
export {
  STACKS_MAINNET,
  STACKS_NETS,
  STACKS_NETWORKS,
  STACKS_TESTNET,
  type StacksNetName,
  type StacksNetSpec,
  type StacksToken,
  explorerTxUrl,
  knownToken,
  netOf,
  stxAsset,
  tokenAsset,
} from "./networks.js";
export { CLARITY_NAME, CONTRACT_NAME, addressOfKey, c32address, c32decode, c32encode, parseAddress, parseAssetId, parseContractId } from "./c32.js";
export { type CV, cvFrom, cvText, deserializeCV, serializeCV } from "./clarity.js";
export {
  type PostCondition,
  type StacksTx,
  deserializePostCondition,
  deserializeTx,
  initialSighash,
  originPresignDigest,
  serializePostCondition,
  serializeTx,
  txidOf,
  withOriginSignature,
} from "./tx.js";
export { MESSAGE_PREFIX, messageHash, structuredHash } from "./message.js";
export { plainStacksError } from "./api.js";
export { sip10Transfer } from "./describe.js";

import { createStacksModule } from "./module.js";

/** Default instance. Holds transactions built from a dapp's params between decode and finalize, in memory. */
export const stacksModule = createStacksModule();
