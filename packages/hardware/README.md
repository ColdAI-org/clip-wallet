# @clip-wallet/hardware

Accounts that live on a hardware wallet. The key never enters the extension: Clip Wallet stores public keys
and paths, a device signs, and every signature is checked against the exact bytes the user approved before it
is used.

- **Ledger** over USB (WebHID): Ethereum, Solana, Bitcoin (Test) and Hedera apps.
- **Keystone** air-gapped over QR codes (BC-UR): EVM, Solana, Bitcoin.

```
background                         this package                         device
----------                         ------------                         ------
module.prepare() -> payloads ----> HardwareKeyring.registerApproval
user approved                      HardwareKeyring.sign(payload)
                                     approval consumed (hash covers raw)
                                     LedgerSigner / KeystoneSigner ----> shows `raw`, user confirms
                                     <------------------------------------ signature
                                     verifies over payload.bytes + account public key
module.finalize(signatures) <----- Signature
```

## API

| export | what |
|---|---|
| `HardwareSigner` | `{ kind, listAccounts(family, start, count, { pathStyle, fingerprint }), sign(payload, { request, decoded, account }) }`, parallel to the vault's `sign()` |
| `HardwareKeyring` | the background's entry point: stores accounts (public data), `registerApproval` / `revokeApproval` / `lock`, `sign(payload, { request, decoded })`, `owns(accountId)` |
| `LedgerSigner` | `new LedgerSigner({ transport?, bitcoinNetwork?, ethResolver?, ethLoadConfig? })` |
| `KeystoneSigner` | `new KeystoneSigner({ channel, storage, bitcoinNetwork? })`, `importSync(ur)`, `syncs()`, `forget(fingerprint)` |
| `KeystoneQrChannel` | what the UI implements: `exchange({ request: AnimatedUr, expect, title, requestContext }) → UR` |
| `@clip-wallet/hardware/qr` | browser-only half for pages: `AnimatedUr`, `UrCollector`, `startQrScanner`, `decodeImageData`, `urToJson` / `urFromJson` (no device SDKs) |
| `HardwareErrors`, `ledgerError` | every failure as a `ClipError` with plain words |
| `decodeXpub`, `deriveChild`, `encodeXpub` | BIP-32 **public** derivation only (Keystone xpubs, Ledger Bitcoin xpubs) |

Account ids are `hw:<kind>:<fingerprint>:<family>:<index>[:ledger-live|:ledger-legacy]`. They never parse as
vault ids (`evm:0`), so a hardware account can't be routed to the vault by mistake. `fingerprint` is the
BIP-32 master fingerprint for Bitcoin (Ledger) and for every Keystone account; the Ledger Ethereum, Solana and
Hedera apps can't report one, so there it is HASH160 of that app's account-0 public key, which still tells
"same seed" from "different seed".

## `SignablePayload.raw`

Devices show and sign the full message, never a bare digest. `@clip-wallet/core` gained an optional
`SignablePayload.raw?: { format, bytes, inputIndex?, chainId? }` (additive; the vault ignores it). The keyring
hashes `raw` into the approval, and each signer checks that `raw` produces `bytes` before the device sees it:

| format | bytes = | Ledger | Keystone |
|---|---|---|---|
| `evm-tx` | keccak256(raw) (unsigned EIP-2718 / legacy RLP) | `signTransaction` with clear-sign resolution | `eth-sign-request` (typedTransaction / transaction) |
| `evm-personal` | EIP-191 hash of raw | `signPersonalMessage` | `eth-sign-request` personalMessage |
| `eip712` | EIP-712 hash of the JSON | `signEIP712Message` (hashed fallback on Nano S) | `eth-sign-request` typedData |
| `solana-tx` | raw | `signTransaction` | `sol-sign-request` Transaction |
| `solana-message` | raw | refused (see below) | `sol-sign-request` Message |
| `psbt` (+ `inputIndex`) | BIP-143 sighash of that input | `signPsbt`, policy `wpkh(@0/**)` | `crypto-psbt` |
| `bitcoin-message` | BIP-137 digest | `signMessage` | not yet |
| `hedera-body` | raw (Ed25519 signs the body) | APDU `0xE0 0x04` | Keystone has no Hedera support |

Without `raw`, EVM and Bitcoin requests are refused ("We can't send this … to your hardware wallet in a form it can
show you"). Solana works without `raw` (the bytes are the message) and Hedera Ed25519 too.

## Derivation paths

Standard paths are byte-for-byte the vault's (`packages/vault/src/derive.ts`), so the same recovery phrase on a
device shows the same accounts. The tests check this: the Ledger recordings for the public test phrase give
`0x9858EfFD…aEda94`, `HAgk14Jp…DKpqk` and `tb1q6rz28…pvkl`, the same addresses `packages/vault/test/vectors.test.ts`
expects.

| family | standard (= vault) | also offered | notes |
|---|---|---|---|
| evm | `m/44'/60'/0'/0/i` | `ledger-live` `m/44'/60'/i'/0/0`, `ledger-legacy` `m/44'/60'/0'/i` | Ledger Live and MEW layouts, from Ledger Live's `derivation.ts` (ethM, default BIP-44 template) |
| solana | `m/44'/501'/i'/0'` | `ledger-live` `m/44'/501'/i'` | Ledger Live's `solanaSub`; its account 0 can also be `m/44'/501'` (`solanaMain`), not offered |
| bitcoin | `m/84'/c'/0'/0/i` (c = 1 on test networks) | `ledger-live` `m/84'/c'/i'/0/0` | one address per account; taproot not yet |
| hedera | — | Ledger only: `m/44'/3030'/0'/0'/i'` **Ed25519** | the vault's Hedera accounts are **ECDSA** at `m/44'/3030'/0'/0/i`. The Ledger Hedera app has no ECDSA keys, so a Ledger Hedera account is a different account from the vault's for the same phrase (it's the Hiero SDK's standard Ed25519 path) |

Ledger Live layouts appear only in Advanced mode ("Use Ledger Live's accounts").

## Ledger

- Transport: `@ledgerhq/hw-transport-webhid`. `navigator.hid.requestDevice()` needs a click in an extension
  page; afterwards the background service worker reopens the granted device with `getDevices()`
  (`TransportWebHID.openConnected()`), which Chrome allows in extension service workers
  (<https://developer.chrome.com/docs/extensions/how-to/web-platform/webhid>).
- Every command first asks the device which app is open (`GET_APP_AND_VERSION`, CLA `0xB0`), so "open the
  wrong app" and "on the dashboard" become "Open the Ethereum app on your Ledger". Before signing it re-reads
  the account's public key silently; another Ledger or another passphrase fails as "wrong device".
- Ethereum (`@ledgerhq/hw-app-eth`): `signTransaction(path, rlp, resolution)` where resolution comes from
  `ledgerService.resolveTransaction` (Ledger's CAL, for token tickers and plugin selectors; on failure we pass
  `null` and the device falls back to raw fields or asks for blind signing). `signPersonalMessage`,
  `signEIP712Message` (falls back to `signEIP712HashedMessage` when the app answers INS-not-supported).
  The Ethereum app 1.22 refuses EIP-712 that it can't clear-sign unless "Blind signing" is on; we map
  `0x6a80` to that instruction. `ethLoadConfig: { calServiceURL: null }` keeps EIP-712 offline.
- Solana (`@ledgerhq/hw-app-solana`): `signTransaction`. The app's `signOffchainMessage` signs Solana's
  off-chain envelope (`\xffsolana offchain` header), not the raw bytes Wallet Standard `signMessage`/`signIn`
  promise dapps, so Ledger Solana message signing is refused with a plain message.
- Bitcoin (`ledger-bitcoin` 0.3, the client of app-bitcoin-new 2.x): default wallet policy
  `wpkh(@0/**)` with `[fingerprint/84'/c'/0']xpub` (no registration needed). We add `PSBT_IN_BIP32_DERIVATION`
  for the account's inputs so the app knows they're its own. One device signing answers all of an approval's
  per-input payloads. `signMessage` for BIP-137.
- Hedera: our own APDUs, verified against the app source (LedgerHQ/app-hedera 1.9.2: `src/hedera.c`,
  `get_public_key.c`, `sign_transaction.c`): `INS 0x02` public key and `INS 0x04` sign, both taking a 4-byte
  little-endian key index; the body must fit one APDU (≤ 251 bytes). We don't use `@ledgerhq/hw-app-hedera` 1.7.0:
  its `signTransaction` always sends index 0 and its `getPublicKey` sends a BIP-32 path where the app expects
  an index. There is no `@hashgraph/hedera-ledger` or Zondax Hedera package on npm (checked 2026-10-03).

## Keystone

- `@keystonehq/keystone-sdk` 0.12 (loaded lazily; it registers every chain's UR types on import) over
  `@ngraveio/bc-ur` (BCR-2020-005 Uniform Resources, fountain-coded animated QR:
  <https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-005-ur.md>).
- Account sync: the user scans the device's "Connect Software Wallet" code: `crypto-multi-accounts`,
  `crypto-hdkey` (e.g. the MetaMask export, an account-level key with chain code) or `crypto-account`. We keep
  public keys, chain codes, paths and the master fingerprint. Addresses below an exported key are derived with
  our BIP-32 public derivation (`src/bip32pub.ts`, tested against the official BIP-32 vectors).
- Signing: `eth-sign-request` (with chain id, path, fingerprint), `sol-sign-request`, `crypto-psbt`; answers
  `eth-signature`, `sol-signature`, signed `crypto-psbt`. The request id must come back unchanged.
- Camera: `BarcodeDetector` where the browser has it, else `jsqr` 1.4 (pure JS) on canvas frames
  (<https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API>: not on Chrome for Windows/Linux or
  Firefox). The camera needs a page that can show the permission prompt (tab or approval window).

## Browser build notes

- Ledger and Keystone libraries use Node's `Buffer` as a global: the extension must install a `buffer`
  polyfill before loading this package (see the integration doc).
- `@keystonehq/bc-ur-registry-eth` imports `hdkey`, which `require`s Node's `crypto` and `stream` for code paths we
  never call: alias both to an empty module in the bundler. With that, `esbuild --platform=browser` bundles the
  package (≈3 MB minified, biggest parts viem, @noble/curves, @bitcoinerlab/miniscript from ledger-bitcoin, the
  Keystone SDK). `@clip-wallet/hardware/qr` alone is ≈360 KB.

## Tests and fixtures (no device, no keys)

`pnpm --filter @clip-wallet/hardware test`

- `test/fixtures/ledger-*.apdus`: APDU sessions (`@ledgerhq/hw-transport-mocker` RecordStore format) recorded
  by driving this package's `LedgerSigner` against the real Ledger apps running in Speculos
  (`ghcr.io/ledgerhq/speculos@sha256:028d1e36…`, Nano S Plus), built from LedgerHQ/app-ethereum `5a48940` (1.22.5),
  app-solana `22d6c9b` (1.15.2), app-bitcoin-new `dab93a1` (Bitcoin Test 2.5.1), app-hedera `9e2a37b` (1.9.2),
  seeded with the public BIP-39 test vector ("abandon … about"). The replayer fails a test if any APDU we send
  differs by a byte. The recorder and the app builds live outside the repo (rule: signing happens offline);
  the requests they signed are `test/inputs.ts`. `accounts.json` holds the public keys those sessions returned.
- Three Ledger error tests use hand-written two-line exchanges with documented status words (locked `0x5515`,
  dashboard "BOLOS"); they're marked as such.
- Keystone: UR strings from Keystone's own test suites (KeystoneHQ/keystone-sdk-base `cda9c6e`:
  EthSignRequest, EthSignature, SolSignature, CryptoHDKey tests; KeystoneHQ/ur-registry `bd8f408`: CryptoPSBT and
  CryptoMultiAccounts tests). Their `crypto-hdkey` vector happens to be the test phrase's `m/44'/60'/0'` key, so
  the test checks a Keystone sync yields the same EVM accounts as the Ledger and the vault. End-to-end Keystone
  tests answer with the signatures the Ledger sessions produced for the same phrase and payloads, encoded by
  the Keystone registry classes.

## Not done yet

- Taproot (`tr(@0/**)` on Ledger; `schnorr-secp256k1` payloads are refused). Also see the integration doc: the
  Phase 1 vault and chains-bitcoin disagree about the taproot key and tweak.
- Bitcoin messages on Keystone (`btc-sign-request`), Solana messages on Ledger (app limitation).
- Hedera on Keystone (no Keystone support). Hedera on Ledger needs chains-hedera to accept Ed25519 accounts.
- Real-device runs: everything is tested against Speculos recordings and Keystone's vectors only.
