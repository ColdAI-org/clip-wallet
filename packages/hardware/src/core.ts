/**
 * The light half of @clip-wallet/hardware: account records, approval binding and signature checks
 * (HardwareKeyring: registerApproval / acceptSignature), errors, the wire forms for a message bus, the
 * Keystone QR bridge and UR helpers. No device SDKs. The extension's background uses only this; the device
 * signers (LedgerSigner, KeystoneSigner) and their libraries stay in the root entry, which the approval
 * window `import()`s when a hardware account signs.
 */
export * from "./types.js";
export { HARDWARE_CURVE } from "./paths.js";
export { HardwareErrors, ledgerError, type LedgerAppName } from "./errors.js";
export { HardwareApprovals, hashHardwarePayload, MAX_APPROVAL_TTL_MS } from "./approvals.js";
export { HardwareKeyring, type HardwareKeyringOptions, type HardwareStorage } from "./keyring.js";
export { assertVerifies, verifiedSignature } from "./verify.js";
export { toWire, fromWire, signatureToWire, signatureFromWire, type SignatureWire } from "./wire.js";
export { KeystoneBridge, type PendingExchangeView } from "./keystone/bridge.js";
export { urFromJson, urToJson, type UR, type UrJson } from "./keystone/ur.js";
export type { KeystoneExchange, KeystoneQrChannel, KeystoneSync } from "./keystone/signer.js";
export type { LedgerSigner } from "./ledger/signer.js";
export type { KeystoneSigner } from "./keystone/signer.js";
