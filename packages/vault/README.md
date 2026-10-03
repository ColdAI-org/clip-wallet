# @clip-wallet/vault

The only package that touches seed phrases and private keys. Implements `Vault` from `@clip-wallet/core`
as `ClipVault`, plus a few additive methods the background script needs.

```ts
import { ClipVault, hashSignablePayload } from "@clip-wallet/vault";

const vault = new ClipVault({ storage: chromeStorageAdapter, autoLockMs: 15 * 60_000 });
await vault.create(password);                 // or importPhrase(phrase, password)
const acct = await vault.deriveAccount("evm", 0);

// background, after the user approves a DecodedRequest:
const payloads = await chain.prepare(request, ctx, approvalId);
vault.registerApproval(approvalId, payloads.map(hashSignablePayload), 2 * 60_000);
const sigs = await Promise.all(payloads.map((p) => vault.sign(p)));
```

Extra (additive) API beyond the core contract: `registerApproval`, `revokeApproval`, `changePassword`,
`reset`, `enrollPasskey`, `unlockWithPasskey`, `listPasskeys`, `removePasskey`, `createPasskeyBackup`,
`deriveAccount(family, index, { bitcoinAddressType })`. No change to `@clip-wallet/core` was needed.

## Phrase

BIP-39 via `@scure/bip39`, English wordlist, 12 or 24 words only, checksum validated. Input is
normalised (NFKD, lower-case, collapsed whitespace). The BIP-39 passphrase is **not** supported in v1.
`create()` makes a 12-word phrase (`newPhraseWords: 24` to change).

## Derivation

`@scure/bip32` for secp256k1; SLIP-10 ed25519 is implemented in `src/slip10.ts` with
`@noble/hashes` HMAC-SHA512 (hardened only) and tested against the official SLIP-10 vectors.

| Family  | Curve     | Path                                  | Compatible with |
|---------|-----------|---------------------------------------|-----------------|
| evm     | secp256k1 | `m/44'/60'/0'/0/i`                    | MetaMask, Rabby |
| hedera  | secp256k1 | `m/44'/3030'/0'/0/i`                  | Hiero/Hedera SDK `toStandardECDSAsecp256k1PrivateKey` |
| solana  | ed25519   | `m/44'/501'/i'/0'`                    | Phantom, Solflare |
| bitcoin | secp256k1 | `m/84'/c'/0'/0/i` (BIP-84, primary)   | Sparrow, BlueWallet, etc. |
| bitcoin | secp256k1 | `m/86'/c'/0'/0/i` (BIP-86, taproot)   | via `{ bitcoinAddressType: "p2tr" }` |

`c` is `0'` on mainnet and `1'` on test networks. **The vault defaults to testnet** (`bitcoinNetwork`
option) per AGENTS.md rule 6.

Bitcoin taproot uses the same account id (`bitcoin:<i>`) as the BIP-84 account. `sign()` chooses the
key from the scheme: `ecdsa-secp256k1` uses the BIP-84 key, `schnorr-secp256k1` uses the BIP-86 key.

### Hedera: why ECDSA at `m/44'/3030'/0'/0/i`

- **ECDSA, not Ed25519.** An ECDSA secp256k1 key has an EVM address alias. Sending to that alias
  auto-creates the Hedera account (HIP-583, "hollow" account until it first signs). That lets the
  wallet show an address before any `0.0.x` id exists, which is what `Account.address` says for Hedera.
  Sources: <https://docs.hedera.com/learn/core-concepts/accounts/auto-account-creation>,
  <https://hips.hedera.com/hip/hip-583>, <https://docs.hedera.com/hedera/core-concepts/keys-and-signatures>.
- **Coin type 3030, not 60.** This matches the Hiero SDK's *standard* ECDSA derivation:
  `Mnemonic.toStandardECDSAsecp256k1PrivateKey(pass, i)` derives `m/44'/3030'/0'/0/i`. The SDK's
  standard Ed25519 path is `m/44'/3030'/0'/0'/i'`. The EVM path is only reachable through
  `toStandardECDSAsecp256k1PrivateKeyCustomDerivationPath`.
  Source: <https://github.com/hiero-ledger/hiero-sdk-js/blob/main/packages/cryptography/src/Mnemonic.js>.
  It also keeps the Hedera account separate from the user's EVM account, so the two can't be linked
  on-chain just by sharing a key.
- **HashPack** doesn't publish its derivation paths (<https://www.hashpack.app/post/hedera-key-types>;
  its help-centre import article wasn't reachable). Whether a phrase imported into HashPack shows the
  same Hedera account as Clip is **unverified**. Check it by hand with a throwaway test phrase before
  saying "HashPack compatible" anywhere.
- A Hedera alias the user created from a MetaMask key (`m/44'/60'/...`) is **not** Clip's Hedera
  account; Clip derives that key only for the `evm` family. If users report a "missing" Hedera balance,
  this is the likely cause. A per-account path override is an open question.

## Addresses

The vault computes `Account.address` itself with small pure helpers in `src/address.ts`:
- EIP-55 keccak checksum for EVM and the Hedera EVM alias
- base58 for Solana
- bech32 P2WPKH and bech32m P2TR via `@scure/base`

That is about 60 lines, smaller than threading chain modules into the vault. It also keeps rule 2 intact
(chain modules never import the vault, and the vault never imports chain modules). To delegate to chain
modules instead, inject `addressOf(family, publicKey, ctx)` in `ClipVaultOptions`.

## Encryption at rest

```
password --Argon2id--> KEK ─wrap─┐
                                 ├─> VEK (random 32 B) ──XChaCha20-Poly1305──> blob (BIP-39 entropy)
passkey PRF --HKDF-SHA256--> PWK ─wrap─┘   (optional, one per enrolled passkey)
```

- **KDF:** Argon2id via `hash-wasm`. Default `memoryKiB = 65536` (64 MiB), `iterations = 3`,
  `parallelism = 1`, 16-byte random salt, 32-byte output.
  - The memory and iterations match RFC 9106 §4's second recommended option (64 MiB, t=3). Parallelism
    is 1 because hash-wasm's WASM build is single-threaded, so p=4 would cost us the same wall-clock time.
  - This is well above the OWASP minimum (19 MiB, t=2, p=1).
  - It measured roughly 150–200 ms per derivation in Node on an Apple-silicon laptop. Expect roughly 0.3–1.5 s in an
    extension page on slower hardware, which is acceptable for unlock.
  - Parameters are stored with the record, so they can be raised later; the next `changePassword`
    re-wraps with the current defaults.
  - Stored parameters are bounds-checked (≤ 1 GiB, ≤ 64 iterations, p ≤ 4), so a tampered record
    can't hang the extension.
  - Passwords are NFKC-normalised before hashing. The minimum length is 8 (`minPasswordLength`).
- **Cipher:** XChaCha20-Poly1305 (`@noble/ciphers`) with random 24-byte nonces. Each box uses its own
  AAD (`clip-vault/v1/pw-wrap`, `.../blob`, `.../passkey-wrap/<credentialId>`), so a box can't be moved
  into a different slot.
- **Storage:** an injected `{ get, set, remove }` with string values. The app wraps
  `chrome.storage.local`; tests use `MemoryStorage`. Only ciphertext and public metadata (salts, KDF
  parameters, credential ids) are stored.
- **In memory while unlocked:** only the 64-byte BIP-39 seed. KEK, VEK and entropy are wiped right after
  use. Derived private keys are wiped after each sign or derive call, and `lock()` wipes the seed and
  clears all approvals.
  - Zeroisation is best-effort: JavaScript can't guarantee the GC or JIT left no copies, and
    `revealPhrase()` necessarily returns an immutable string.
- **Auto-lock:** default 15 minutes of inactivity (`autoLockMs`); `deriveAccount` and `sign` count as
  activity. It uses an injected `Clock` timer *and* a lazy check on every call, because an MV3 service
  worker can be suspended and miss timers. A service-worker restart also wipes memory, which locks the
  vault.

## Approval binding

- `registerApproval(approvalId, payloadHashes, ttlMs)` must be called by the background **only after**
  the user approves the `DecodedRequest`.
- Compute each hash with `hashSignablePayload(payload)`. It is
  SHA-256(domain ‖ accountId ‖ scheme ‖ bytes ‖ taprootTweak), each field length-prefixed. That is
  stricter than hashing the bytes alone: an approval for `evm:0` can't be replayed on `evm:1` or under
  another scheme.
- `sign()` refuses unless all of these hold:
  - the approval is live (TTL is capped at 10 minutes)
  - the payload hash is listed and unused
  - the account's curve matches the scheme
  - schnorr is only used for `bitcoin:*`
- Every hash is single-use. An approval covering N payloads (for example a multi-input PSBT) allows
  exactly N signatures, then disappears.
- Curve and payload checks run before the approval is consumed, so a malformed request doesn't burn it.

## Signing

- `ecdsa-secp256k1`: 32-byte digest, RFC 6979, low-S enforced. Returns 64-byte r‖s and `recovery`
  (0 or 1). EVM `v` = 27 + recovery, or EIP-155.
- `schnorr-secp256k1`: BIP-340 with fresh aux randomness. `options.taprootTweak` is the **script-tree
  merkle root** (32 bytes), or an **empty array** for a BIP-86 key-path-only spend.
  - The vault applies the BIP-341 TapTweak.
  - `Signature.publicKey` is the x-only key that verifies the signature: the output key when tweaked,
    the internal key otherwise.
- `ed25519`: RFC 8032 over the message bytes.

## Passkey unlock (WebAuthn PRF)

- `enrollPasskey(password, prf)` re-authenticates with the password to reach the VEK. It then picks a
  random 32-byte `prfInput` and calls `prf.enroll(prfInput)`. The VEK is wrapped under
  HKDF-SHA256(prfOutput, salt, `"clip-wallet/vault/passkey-wrap/v1"`).
- `unlockWithPasskey(prf, credentialId?)` calls `prf.evaluate(credentialId, prfInput)` and unwraps the
  VEK. The password path keeps working, and a password change doesn't break passkeys because they wrap
  the VEK, not the KEK.
- The app implements `PasskeyPrf` with `navigator.credentials` (see the doc comment in
  `src/passkey.ts`). The spec's `enroll()` and `evaluate(credentialId)` signatures gained a `prfInput`
  argument. Implementations that ignore it still type-check, provided they use the same value for both
  calls.
- **If PRF is unsupported, the app must fall back to the password.** "Unsupported" covers three cases:
  - `getClientExtensionResults().prf` is missing
  - `prf.enabled` is false
  - neither the create nor a follow-up get returns `results.first`

  In those cases the app must not offer passkey unlock; `enroll` should throw. A passkey is never the
  only way in: the password and the recovery phrase always remain.
- **Phase 2 backup:** `passkeyBackup.encrypt(phrase, prfOutput)` / `.decrypt(blob, prfOutput)` produce
  and read an opaque blob: `"CLPB"` ‖ 0x01 ‖ salt ‖ nonce ‖ XChaCha20-Poly1305(entropy), with the
  header as AAD. `vault.createPasskeyBackup(password, prfOutput)` makes one without the phrase leaving
  the vault. Use `BACKUP_PRF_INPUT` as the PRF `eval.first` for backups. Nothing here makes network
  calls.

### Can a Chrome MV3 extension page be a WebAuthn RP? (note for the app agent)

Yes, from an **extension page**, not from the service worker.
- **Own origin as rpId:** extension pages can use their own `chrome-extension://<id>` origin as the
  rpId. No host permission is needed.
- **Web domain as rpId:** since Chrome 122 they can also claim a web domain's RP ID (up to eTLD+1) that
  they hold host permissions for. They can't claim another extension's id or a public suffix.
  `clientDataJSON.origin` stays `chrome-extension://<id>`.
  Source: Chromium announcement on public-webauthn,
  <https://lists.w3.org/Archives/Public/public-webauthn/2023Dec/0078.html>.
- **Popup closes:** the passkey dialog takes focus and **closes the action popup**, for both create and
  get (<https://issuetracker.google.com/issues/378966968>). A fix is reportedly in Chrome 133, but that
  isn't verified because the bug needs a login. Run WebAuthn in a full tab or a `chrome.windows.create`
  popup window, then message the result to the background.
- **Service worker:** it has no document, so it can't call `navigator.credentials` (our reading; not
  explicitly documented). Offscreen documents have no WebAuthn reason and aren't focusable, so don't
  rely on them.
- **PRF inside extension pages:** not documented separately; it should behave as on the web, but needs
  testing. Some password-manager extensions intercept WebAuthn and can report PRF support without
  returning results, which is one more reason for the fallback.
- **PRF availability** (per <https://www.corbado.com/blog/passkeys-prf-webauthn>):
  - Google Password Manager passkeys support PRF, including on Android.
  - iCloud Keychain needs macOS 15+ with Chrome 132+ or Safari 18+, or iOS 18.4+ (earlier iOS 18
    releases had bugs).
  - Windows Hello only since the Feb 2026 Windows 11 update, with Chrome/Edge 147+.
  - Security keys depend on hmac-secret support.
- **Firefox:** 150+ lets extensions use the rpId of domains in `host_permissions`, with a stable
  `moz-extension://` origin
  (<https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Use_the_web_authn_api>).
- **Safari:** not researched.

## Tests

`pnpm --filter @clip-wallet/vault test`:
- all 24 official BIP-39 English vectors
- BIP-32 vector 1
- SLIP-10 ed25519 vectors 1 and 2
- address KATs for the public "abandon ×11 about" phrase:
  - EVM, BIP-84 and BIP-86
  - Solana, cross-checked against `micro-key-producer` and `ed25519-hd-key`
- vault behaviour tests

Tests use public test vectors only.
