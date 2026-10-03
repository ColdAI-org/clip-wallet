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
export { type SignMessageFields, type SignMessageInput, buildFullMessage } from "./message.js";
export * from "./module.js";
export * from "./networks.js";
export { AptosApiError, AptosRest, plainAptosError } from "./rest.js";

import { createAptosModule } from "./module.js";
export const aptosModule = createAptosModule();
