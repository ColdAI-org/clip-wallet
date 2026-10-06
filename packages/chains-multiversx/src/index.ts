export { GatewayError, MultiversXClient, type NetworkConfig, plainMultiversXError } from "./api.js";
export { type Described, type DescribeContext, describeTransaction, maxFee } from "./describe.js";
export * from "./module.js";
export * from "./networks.js";
export { type Call, OPTION_GUARDED, OPTION_HASH_SIGN, type PlainTransaction, type Tx, bytesToSign, parseCall, parseTransaction, plainOf, serializeForSigning, signedPlain } from "./tx.js";

import { createMultiversXModule } from "./module.js";

/** Default instance. */
export const multiversxModule = createMultiversXModule();
