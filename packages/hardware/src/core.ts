/**
 * The light half of @clip-wallet/hardware for a background that loads device code on demand: account
 * records, approval binding, routing (HardwareKeyring), errors, the Keystone QR bridge and UR helpers.
 * The device signers (LedgerSigner, KeystoneSigner) and their libraries stay in the root entry, which a
 * host can `import()` when a device is first used.
 */
export * from "./types.js";
export { HardwareErrors, ledgerError, type LedgerAppName } from "./errors.js";
export { HardwareApprovals, hashHardwarePayload, MAX_APPROVAL_TTL_MS } from "./approvals.js";
export { HardwareKeyring, type HardwareKeyringOptions, type HardwareStorage } from "./keyring.js";
export { assertVerifies } from "./verify.js";
export { KeystoneBridge, type PendingExchangeView } from "./keystone/bridge.js";
export { urFromJson, urToJson, type UR, type UrJson } from "./keystone/ur.js";
export type { KeystoneExchange, KeystoneQrChannel, KeystoneSync } from "./keystone/signer.js";
export type { LedgerSigner } from "./ledger/signer.js";
export type { KeystoneSigner } from "./keystone/signer.js";
