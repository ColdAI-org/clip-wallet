/**
 * @clip-wallet/hardware — accounts that live on a Ledger (WebHID) or a Keystone (QR, air-gapped).
 * No key material ever enters the extension: devices sign, this package checks every signature
 * against the approved bytes and the account's public key.
 *
 * @module
 */
export * from "./types.js";
export { HardwareErrors, ledgerError, type LedgerAppName } from "./errors.js";
export { HardwareApprovals, hashHardwarePayload, MAX_APPROVAL_TTL_MS } from "./approvals.js";
export { HardwareKeyring, type HardwareKeyringOptions, type HardwareStorage } from "./keyring.js";
export { HARDWARE_CURVE, hardwarePath, pathStyles, bitcoinAccountPath, parsePath, formatPath } from "./paths.js";
export { decodeXpub, encodeXpub, deriveChild, derivePublic, fingerprintOf, publicNode, XPUB_VERSIONS, type PublicNode } from "./bip32pub.js";
export { assertVerifies, verifiedSignature, ecdsaSignature, ed25519Signature } from "./verify.js";
export { toWire, fromWire, signatureToWire, signatureFromWire, type SignatureWire } from "./wire.js";
export { evmAddress } from "./evm.js";
export { LedgerSigner, type LedgerSignerOptions } from "./ledger/signer.js";
export { LedgerConnection, webHidTransport, appAndVersion, type TransportFactory } from "./ledger/transport.js";
export { defaultEthResolver, type EthLoadConfig, type EthResolver } from "./ledger/eth.js";
export { HEDERA_MAX_BODY } from "./ledger/hedera.js";
export {
  KeystoneSigner,
  KEYSTONE_ACCOUNT_TYPES,
  type KeystoneExchange,
  type KeystoneKey,
  type KeystoneQrChannel,
  type KeystoneSignerOptions,
  type KeystoneSync,
} from "./keystone/signer.js";
export { KeystoneBridge, type PendingExchangeView } from "./keystone/bridge.js";
export { AnimatedUr, UrCollector, WrongUrType, decodeSingle, UR, DEFAULT_FRAGMENT, urFromJson, urToJson, type ScanProgress, type UrJson } from "./keystone/ur.js";
export { startQrScanner, decodeImageData, type QrScanner, type ScanOptions } from "./qr/scanner.js";
export { requestLedgerAccess, LEDGER_USB_VENDOR_ID } from "./qr/webhid.js";
