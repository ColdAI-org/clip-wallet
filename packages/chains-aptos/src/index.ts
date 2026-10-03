export {
  type Described,
  type Role,
  type SimTx,
  assetFor,
  assetInfo,
  balanceEffects,
  clearAssetCache,
  describeTransaction,
  entryFunctionOf,
  functionId,
  primaryStoreAddress,
  simulate,
  transferOf,
} from "./describe.js";
export {
  DELEGATION_POOL_MODULE,
  type DecodedEntry,
  type DelegationAction,
  type EntryAbi,
  MIN_DELEGATION_OCTAS,
  bcsAddress,
  bcsAddressVector,
  bcsU64,
  decodeEntryPayload,
  delegationPayload,
  encodeEntryPayload,
} from "./defi.js";
export { type SignMessageFields, type SignMessageInput, buildFullMessage } from "./message.js";
export * from "./module.js";
export * from "./networks.js";
export { AptosApiError, AptosRest, plainAptosError } from "./rest.js";

import { createAptosModule } from "./module.js";
export const aptosModule = createAptosModule();
