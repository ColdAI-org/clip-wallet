export {
  COSMOS_METHODS,
  COSMOS_READ_METHODS,
  type CosmosModuleOptions,
  type CosmosReadMethod,
  type StdSignature,
  type WireSignDoc,
  createCosmosModule,
} from "./module.js";
export * from "./networks.js";
export { type StdSignDoc, type AminoMsg, makeAdr36SignDoc, serializeSignDoc, sortedJson } from "./amino.js";
export { type CosmosMsg, fromAmino, fromAny } from "./msgs.js";
export { addressBytes, bech32Address, decodeBech32, isAccountAddress } from "./address.js";
export { plainCosmosError } from "./rest.js";

import { createCosmosModule } from "./module.js";

/** One instance per family (each answers only its own networks). */
export const cosmosModule = createCosmosModule({ family: "cosmos" });
export const provenanceModule = createCosmosModule({ family: "provenance" });
export const thorchainModule = createCosmosModule({ family: "thorchain" });
export const initiaModule = createCosmosModule({ family: "initia" });
