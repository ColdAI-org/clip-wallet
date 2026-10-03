export { ClipVault, parseAccountId, type ClipVaultOptions, type DeriveOptions, type PasskeyInfo } from "./vault.js";
export { hashSignablePayload, MAX_APPROVAL_TTL_MS } from "./approvals.js";
export { MemoryStorage, systemClock, type Clock, type VaultStorage } from "./storage.js";
export { DEFAULT_ARGON2, type Argon2Params } from "./crypto.js";
export { passkeyBackup, BACKUP_PRF_INPUT, type PasskeyPrf } from "./passkey.js";
export { derivationPath, CURVE_OF } from "./derive.js";
export { isValidPhrase, normalizePhrase, type PhraseLength } from "./phrase.js";
export {
  defaultAddressOf,
  evmAddress,
  solanaAddress,
  p2wpkhAddress,
  p2trAddress,
  taprootOutputKey,
  type AddressOf,
  type AddressContext,
  type BitcoinNetwork,
  type BitcoinAddressType,
} from "./address.js";
export { VaultErrors } from "./errors.js";
