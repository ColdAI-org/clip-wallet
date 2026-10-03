export { createBitcoinModule, formatBtc } from "./module.js";
export type { BitcoinModuleOptions } from "./module.js";
export { BITCOIN_NETWORKS, BITCOIN_MAINNET, BITCOIN_TESTNET4, BITCOIN_SIGNET, networkById } from "./networks.js";
export { derivationPath, derivationPathTaproot, ownTaprootAddress, segwitAddress, taprootAddress, taprootOutputKey } from "./keys.js";
export { selectLargestFirst } from "./coinselect.js";
export { BTC_METHODS, normalize } from "./requests.js";
export { bip322Digest, bip322ToSign, bip322ToSpend, bip322MessageHash } from "./message.js";

import { createBitcoinModule } from "./module.js";
/** Default instance (no ordinals index configured: inscribed coins are warned about, not blocked). */
export const bitcoinModule = createBitcoinModule();
