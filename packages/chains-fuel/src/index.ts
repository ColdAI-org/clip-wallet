export { FUEL_METHODS, type FuelModuleOptions, createFuelModule, fuelCompactSignature, normalize, plainFuelError } from "./module.js";
export {
  BASE_ASSET_ID,
  FUEL_MAINNET,
  FUEL_NETS,
  FUEL_NETWORKS,
  FUEL_TESTNET,
  type FuelNet,
  type FuelNetSpec,
  type FuelToken,
  assetFor,
  connectorNetwork,
  curatedToken,
  ethAsset,
  explorerTxUrl,
  fuelNetOf,
  specFor,
} from "./networks.js";
export { addressBytesFromPublicKey, fuelAddressFromPublicKey, isFuelAddress, toChecksum } from "./address.js";
export { type FuelMessage, MESSAGE_PREFIX, fuelMessageOf, hashMessage } from "./message.js";
export {
  type Input,
  type Output,
  type ScriptTx,
  type TransactionRequestJson,
  RETURN_ZERO_SCRIPT,
  encodeScriptTx,
  parseTransactionRequest,
  toTransactionRequestJson,
  transactionId,
} from "./tx.js";
export { gasToFee, maxGas, minGas, requiredMaxFee } from "./fee.js";

import { createFuelModule } from "./module.js";

/** Default instance. */
export const fuelModule = createFuelModule();
