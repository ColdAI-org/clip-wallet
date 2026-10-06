export { BCH_METHODS, type BitcoinCashModule, type BitcoinCashModuleOptions, createBitcoinCashModule, normalize, ownScript, plainBchError, scripthash } from "./module.js";
export { BCH_CHIPNET, BCH_MAINNET, BCH_NETS, BCH_NETWORKS, BCH_TESTNET4, type BchNet, type BchNetSpec, bchAsset, cashTokenAsset, explorerTxUrl, netOf } from "./networks.js";
export { type CashPrefix, type DecodedCashAddress, PREFIXES, addressOfScript, decodeCashAddress, encodeCashAddress, lockingBytecodeOf, p2pkhAddress, p2pkhScript } from "./cashaddr.js";
export { type BchTx, DUST, SIGHASH_ALL_FORKID, type TokenData, decodeTx, derSignature, encodeTokenPrefix, encodeTx, estimateSize, p2pkhUnlocking, readOutputField, sighash, txidOf } from "./tx.js";
export { type SourceOutput, parseSourceOutputs, parseTransaction, revive, stringifyExtended } from "./wc.js";
export { MESSAGE_MAGIC, compactSignatureBase64, messageHash } from "./message.js";
export { type Call, type ElectrumOptions, ElectrumError, type SocketFactory, type SocketLike, withElectrum } from "./electrum.js";

import { createBitcoinCashModule } from "./module.js";

/** Default instance (Fulcrum servers over the environment's WebSocket). */
export const bitcoincashModule = createBitcoinCashModule();
