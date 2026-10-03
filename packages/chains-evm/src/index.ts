export { createEvmModule, derivationPath, addressFromPublicKey } from "./module.js";
export type { EvmModuleOptions } from "./module.js";
export { EVM_NETWORKS, EVM_TESTNETS, EVM_NETWORK_SPECS, HEDERA_EVM_NETWORKS, HEDERA_EVM_SPECS, networkById, specFor, caip2, toNetwork } from "./networks.js";
export type { EvmNetworkSpec } from "./networks.js";
export { CURATED_TOKENS, KNOWN_APPS, looksLikeSpam } from "./tokens.js";
export { KNOWN_FUNCTIONS, lookupSelector } from "./selectors.js";
export { SUPPORTED_METHODS } from "./decode.js";
export { quoteFees } from "./chain.js";

import { createEvmModule } from "./module.js";
/** Default instance. Holds prepared-but-unsigned transactions in memory. */
export const evmModule = createEvmModule();
export { GAS_PRICE_ORACLE, OP_STACK_CHAIN_IDS, isOpStack, l1DataFee } from "./l1fee.js";
