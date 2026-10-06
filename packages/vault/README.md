# @clip-wallet/vault

The only Clip Wallet package that touches recovery phrases and private keys. It implements `Vault` from
`@clip-wallet/core` as `ClipVault`: one BIP-39 phrase derives accounts for fourteen network families, everything at
rest is Argon2id + XChaCha20-Poly1305, passkeys can unlock it (WebAuthn PRF), and it signs only payloads registered for
an approval the person gave, each once.

Only a wallet's host may import it: the extension background, the phone's background, Clip Desktop's main process and
the onboarding screen (`pnpm harness` enforces this in the Clip Wallet repo and in kit-built wallets).

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/vault
```

## Example

```ts
import { ClipVault, MemoryStorage, hashSignablePayload } from "@clip-wallet/vault";
import type { ChainContext, ChainModule, DappRequest } from "@clip-wallet/core";

// Host code only. Real hosts pass their own storage (chrome.storage.local, a secure store).
const vault = new ClipVault({ storage: new MemoryStorage(), autoLockMs: 15 * 60_000 });

export async function setUp(password: string) {
  await vault.create(password); // a new 12-word phrase, shown once during onboarding
  return vault.deriveAccount("evm", 0); // { address, publicKey, derivationPath, … }
}

// After the person approved the decoded request:
export async function signApproved(chain: ChainModule, request: DappRequest, ctx: ChainContext, approvalId: string) {
  const payloads = await chain.prepare(request, ctx, approvalId);
  vault.registerApproval(approvalId, payloads.map((p) => hashSignablePayload(p)), 2 * 60_000);
  const signatures = await Promise.all(payloads.map((p) => vault.sign(p))); // each hash signs once
  return chain.finalize(request, signatures, ctx);
}
```

Beyond the core contract: `registerApproval`, `revokeApproval`, `changePassword`, `reset`, `enrollPasskey`,
`unlockWithPasskey`, `listPasskeys`, `removePasskey`, `createPasskeyBackup`, `restorePasskeyBackup`, `listAccounts`,
`addAccount`, `setAccountLabel`, `deriveChange`, `freshChange`, `listChange`, `sealAppData`, `openAppData`, and the
linked-device keys (`syncKeys`, `pairingKey`, `exportToDevice`, `importFromDevice`).

## Documentation

- [Vault](https://coldai.org/clip/docs/architecture/vault.html)
- [Vault cryptography](https://coldai.org/clip/docs/security/vault-crypto.html)
- [Approval-bound signing](https://coldai.org/clip/docs/security/approval-signing.html)
- [API reference](https://coldai.org/clip/docs/reference/api/vault.html)

## Phrase

BIP-39 via `@scure/bip39`, English wordlist, 12 or 24 words only, checksum validated. Input is
normalised (NFKD, lower-case, collapsed whitespace). The BIP-39 passphrase is **not** supported in v1.
`create()` makes a 12-word phrase (`newPhraseWords: 24` to change).

## Derivation

One BIP-39 phrase (12 or 24 words, no passphrase) derives every family. `@scure/bip32` does secp256k1;
SLIP-10 ed25519 is `src/slip10.ts` (official SLIP-10 vectors); BIP32-Ed25519 is `src/bip32ed25519.ts`;
sr25519 is `@scure/sr25519`; the Stark curve is `@scure/starknet`. `i` is the account index.

| Family | Curve | Path (account `i`) | Address | Compatible with |
|---|---|---|---|---|
| evm | secp256k1 | `m/44'/60'/0'/0/i` | EIP-55 | MetaMask, Rabby |
| hedera | secp256k1 | `m/44'/3030'/0'/0/i` | EVM alias | Hiero SDK standard ECDSA |
| solana | ed25519 | `m/44'/501'/i'/0'` | base58 | Phantom, Solflare |
| bitcoin | secp256k1 | `m/84'/c'/0'/0/i` (`m/86'/…` taproot); change `m/84'/c'/0'/1/n` | bech32 / bech32m | Sparrow, BlueWallet |
| sui | ed25519 (SLIP-10) | `m/44'/784'/i'/0'/0'` | `0x` BLAKE2b-256(0x00 ‖ pk) | Sui Wallet/Slush, `@mysten/sui` |
| aptos | ed25519 (SLIP-10) | `m/44'/637'/i'/0'/0'` | `0x` SHA3-256(pk ‖ 0x00) (legacy Ed25519 auth key) | Petra, aptos-ts-sdk |
| near | ed25519 (SLIP-10) | `m/44'/397'/i'` | implicit account = hex(pk) | near-seed-phrase, MyNearWallet (i = 0) |
| stellar | ed25519 (SLIP-10) | `m/44'/148'/i'` | StrKey `G…` | SEP-0005 (official vectors pass) |
| algorand | BIP32-Ed25519, ARC-52 Peikert | `m/44'/283'/i'/0/0` | base32(pk ‖ SHA-512/256 checksum) | Pera Universal Wallet; `algorandScheme: "slip10"` → `m/44'/283'/i'/0'/0'` (Trust Wallet) |
| tezos | ed25519 (SLIP-10) | `m/44'/1729'/i'/0'` | `tz1` base58check(BLAKE2b-160(pk)) | Temple, Kukai, Taquito |
| ton | ed25519 (SLIP-10) | `m/44'/607'/i'` | wallet v5r1, TEP-2 non-bounceable (`UQ…` / `0Q…` testnet) | Tonkeeper BIP-39 import (i = 0); `tonWalletVersion: "v4r2"` → Trust Wallet |
| cardano | BIP32-Ed25519, CIP-3 Icarus | payment `m/1852'/1815'/i'/0/0`, stake `…/i'/2/0` | CIP-19 base address `addr_test…` / `addr…` | Eternl, Lace, Yoroi, cardano-serialization-lib |
| substrate | sr25519 | account 0 = root; `i ≥ 1` = `//(i-1)` | SS58 generic prefix 42 | polkadot.js, Talisman, SubWallet (root) |
| starknet | Stark (grindKey) | `argent-x:m/44'/9004'/0'/0/i` | OpenZeppelin counterfactual address (see below) | Argent X; `starknetScheme: "braavos"` / `"ledger"` |
| cosmos | secp256k1 | `m/44'/118'/0'/0/i` | bech32 of RIPEMD-160(SHA-256(pk)); vault writes `cosmos1…`, modules re-prefix (osmo, dydx, zig) | Keplr, Leap, Cosmostation (chain-registry slip44 118) |
| provenance | secp256k1 | `m/44'/505'/0'/0/i` | bech32 `pb1…` (`tp1…` testnet) | Keplr, Leap (slip44 505) |
| thorchain | secp256k1 | `m/44'/931'/0'/0/i` | bech32 `thor1…` | Keplr, Ctrl (XDEFI), Vultisig (slip44 931) |
| initia | secp256k1 (ethsecp256k1) | `m/44'/60'/0'/0/i` (the EVM key) | bech32 `init1…` of keccak256(pk)[12..] | Initia Wallet, Keplr (slip44 60) |
| tron | secp256k1 | `m/44'/195'/0'/0/i` | base58check `T…` of 0x41 ‖ keccak256(pk)[12..] | TronLink, TronWeb `fromMnemonic` |
| xrpl | secp256k1 | `m/44'/144'/i'/0/0` | classic `r…` (Ripple base58check of RIPEMD-160(SHA-256(pk))) | xrpl.js `Wallet.fromMnemonic` (i = 0), Ledger Live |
| antelope | secp256k1 (K1) | `m/44'/194'/0'/0/i` | the key, `PUB_K1_…` (accounts are names on chain) | TokenPocket; one key for Vaulta, Telos and XPR Network |
| multiversx | ed25519 (SLIP-10) | `m/44'/508'/0'/0'/i'` | bech32 `erd1…` of pk | xPortal, DeFi Wallet, sdk-core `Mnemonic.deriveKey(i)` |
| icp | secp256k1 | `m/44'/223'/0'/0/i` | self-authenticating principal (SHA-224(DER pk) ‖ 0x02) | Plug, dfx `identity import`, `@dfinity/identity-secp256k1` |
| stacks | secp256k1 | `m/44'/5757'/0'/0/i` | c32check `SP…` (`ST…` testnet) | Leather, Xverse, `@stacks/wallet-sdk` |
| fuel | secp256k1 | `m/44'/1179993420'/i'/0/0` | `0x` SHA-256(uncompressed pk) with the fuels-ts checksum | Fuel Wallet, fuels-ts |
| bitcoincash | secp256k1 | `m/44'/145'/0'/0/i` | CashAddr P2PKH `bitcoincash:q…` (`bchtest:q…`) | Electron Cash, Paytaca, Bitcoin.com Wallet |

Network-dependent encodings default to **testnet** (AGENTS.md rule 6): `bitcoinNetwork`, `cardanoNetwork`,
`tonNetwork`. Other families' addresses are network-independent; chain modules re-encode where a network
needs it (e.g. SS58 prefix 0 for Polkadot).

The networks87 rows (SLIP-44 registry plus the wallets named) are cross-checked for "abandon … about" against each
ecosystem's SDK in `test/families87.test.ts`. Antelope's K1 signatures must be canonical (r and s without a needless
high bit or leading zero, Spring/Leap `is_canonical`): `signEcdsaCanonical` retries with an RFC 6979 extra-entropy
counter, as WharfKit bumps its personalisation, so it stays deterministic. Antelope uses SLIP-44 194 on every Antelope
chain (Telos also has 977 registered, but its wallets don't derive from BIP-39); one key can control accounts on all three.

Sources for each row (checked October 2026):

- **Sui:** `DEFAULT_ED25519_DERIVATION_PATH` and the all-hardened path regex in
  <https://github.com/MystenLabs/ts-sdks/blob/main/packages/sui/src/keypairs/ed25519/keypair.ts>; address
  <https://docs.sui.io/concepts/cryptography/transaction-auth/keys-addresses>.
- **Aptos:** `APTOS_HARDENED_REGEX` in
  <https://github.com/aptos-labs/aptos-ts-sdk/blob/main/src/core/crypto/hdKey.ts>; legacy Ed25519
  authentication key (scheme byte 0x00) in `src/core/authenticationKey.ts`. The SingleKey scheme
  (`0x02` suffix) gives a different address; Petra and the SDK default show the legacy one, so we do too.
- **NEAR:** `KEY_DERIVATION_PATH = "m/44'/397'/0'"` in <https://github.com/near/near-seed-phrase/blob/master/index.js>.
  MyNearWallet uses only index 0 (new accounts get a new phrase); `i ≥ 1` is our extension of the same path.
- **Stellar:** <https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0005.md>, StrKey
  <https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0023.md>.
- **Algorand:** see "Algorand" below.
- **Tezos:** `derivationPath = "44'/1729'/0'/0'"` in
  <https://github.com/ecadlabs/taquito/blob/master/packages/taquito-signer/src/in-memory-signer.ts>;
  Temple `m/44'/1729'/${index}'/0'` (<https://github.com/madfish-solutions/templewallet-extension>,
  `src/lib/temple/helpers.ts`); Kukai `44'/1729'/${accountIndex}'/0'` (<https://github.com/kukai-wallet/kukai>,
  `src/app/libraries/hd.ts`).
- **TON:** see "TON" below.
- **Cardano:** <https://github.com/cardano-foundation/CIPs/blob/master/CIP-0003/Icarus.md>,
  <https://github.com/cardano-foundation/CIPs/blob/master/CIP-1852/README.md>,
  <https://github.com/cardano-foundation/CIPs/blob/master/CIP-0019/README.md>, derivation V2 in
  <https://github.com/typed-io/rust-ed25519-bip32/blob/master/src/derivation/v2.rs>.
- **Substrate:** see "Substrate" below.
- **Starknet:** see "Starknet" below.

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

### Algorand

There are three incompatible ways to derive Algorand keys from BIP-39, and one wallet family isn't BIP-39 at all:

- **ARC-52 (default here).** BIP32-Ed25519 with Peikert's amendment (g = 9), root from the BIP-39 seed
  (`k = SHA-512(seed)`, re-hashed while `kL[31] & 0x20`, chain code `SHA-256(0x01 ‖ seed)`), path
  `m/44'/283'/i'/0/0`. This is what **Pera's Universal Wallet** (24-word BIP-39) uses. Sources:
  ARC-52 draft <https://github.com/algorandfoundation/ARCs/pull/239>, reference
  <https://github.com/algorandfoundation/xHD-Wallet-API-ts/blob/main/src/bip32-ed25519.ts>, Pera
  <https://github.com/perawallet/pera-react-native> (`packages/chain-algorand/src/accounts/hd-derivation.ts`,
  Peikert, plus its known-answer vector, which our test reproduces).
- **SLIP-10, `algorandScheme: "slip10"`.** `m/44'/283'/i'/0'/0'`, as Trust Wallet / wallet-core
  (<https://github.com/trustwallet/wallet-core/blob/master/registry.json>).
- **Ledger** (not supported): `m/44'/283'/i'/0/0` with Ledger's own BIP32-Ed25519 root (HMAC "ed25519 seed",
  g = 32), per <https://github.com/LedgerHQ/app-algorand/blob/main/app/src/crypto.c> and Speculos
  `os_bip32.c`. Same path string as ARC-52, **different keys**.
- **Pera/Defly legacy accounts use the 25-word Algorand mnemonic, which is not BIP-39.** It encodes a raw
  Ed25519 seed with its own checksum and cannot be imported as a Clip phrase. Users must move funds, or
  a future "import Algorand 25-word key" flow would add a standalone (non-HD) key.

Because ARC-52 keys are extended keys, `Account.curve` is `"bip32-ed25519"` for Algorand (ARC-52) and
signatures use the extended-key signer. They still verify as plain Ed25519 (`algosdk.verifyBytes`).

### TON

- Path `m/44'/607'/i'` SLIP-10: `TON_DERIVATION_PATH = "m/44'/607'/0'"` in Tonkeeper's BIP-39 import
  (<https://github.com/tonkeeper/tonkeeper-web>, `packages/core/src/service/mnemonicService.ts`) and
  wallet-core's registry. Account `i ≥ 1` extends it.
- Address: wallet **v5r1** (Tonkeeper's `defaultWalletVersion`). The v5r1 `wallet_id` depends on the network
  (global id −239 mainnet, −3 testnet; `@ton/ton` `WalletV5R1WalletId.ts`), so the testnet address differs
  from the mainnet one. `tonWalletVersion: "v4r2"` gives Trust Wallet's address (wallet-core
  `rust/chains/tw_ton/src/entry.rs`: "Currently, we use the V4R2 wallet") on mainnet. On testnet the v4r2
  subwallet id is bound to the network (standard id XOR global id, `tonV4R2WalletId`), since v4r2 signs no network
  and a testnet transfer could otherwise be replayed on mainnet. Addresses are computed from the
  pinned code-cell hashes (`TON_V5R1_CODE_HASH`, `TON_V4R2_CODE_HASH`) and checked against `@ton/ton`.
- **A phrase made in Tonkeeper or Wallet (Telegram) is usually a native 24-word TON mnemonic, not BIP-39.**
  It derives keys with PBKDF2 over its own seed and will either fail the BIP-39 checksum or import a
  *different* account. Only BIP-39 phrases (from Trust Wallet, Ledger-style backups, or Clip) map to the
  same TON account. TON-native mnemonics need their own import path and aren't supported.
- Ledger TON uses `m/44'/607'/{net}'/{chain}'/i'/0'` (<https://github.com/ton-community/ton-ledger-ts>), so its
  accounts differ too.

### Substrate

- Mini-secret: substrate-bip39, `PBKDF2-HMAC-SHA512(password = entropy, salt = "mnemonic", 2048)`, first
  32 bytes (<https://github.com/paritytech/substrate-bip39/blob/master/src/lib.rs>). This is why the vault
  now keeps the BIP-39 **entropy** in memory alongside the seed while unlocked; Cardano needs it too. Both
  are wiped on lock.
- sr25519 keys come from `@scure/sr25519` `secretFromSeed` (Ed25519 expansion mode, as sp-core) and
  `HDKD.secretHard`. Junction chain codes are encoded as polkadot.js `DeriveJunction` does: numbers
  little-endian, padded to 32 bytes.
- **Account mapping.** Account 0 is the root key (no junction), which is what every Substrate wallet shows
  when a phrase is imported. Account `i ≥ 1` is `//(i-1)`: `//0`, `//1`, … This follows Talisman
  (`apps/extension/src/core/domains/accounts/helpers.ts`, root then first unused `//n` from 0) and
  polkadot.js extension "derive" (`nextDerivationPath.ts`, first child `//0`). **SubWallet** numbers its
  children `//1`, `//2`, … (`derive/info/solo.ts`), so its second account is our account 2. `Account.derivationPath`
  holds the junction (`""` for the root).
- `Account.address` is the generic SS58 prefix 42. Chain modules re-encode (Polkadot 0, Kusama 2).
- Signing context is `"substrate"` (the `@scure/sr25519` constant).

### Starknet

The brief assumed EIP-2645. In fact the two big wallets don't use it:

| `starknetScheme` | Seed of the BIP-32 tree | Path | Who |
|---|---|---|---|
| `"argent-x"` (default) | the **Ethereum private key** at `m/44'/60'/0'/0/0` (32 bytes as BIP-32 seed) | `m/44'/9004'/0'/0/i` | Argent X / Ready (<https://github.com/argentlabs/argent-x>, `packages/extension/src/shared/signer`) |
| `"braavos"` | the BIP-39 seed | `m/44'/9004'/0'/0/i` | Braavos (Braavos team post, <https://community.starknet.io/t/account-keys-and-addresses-derivation-standard/1230>) |
| `"ledger"` | the BIP-39 seed | EIP-2645 `m/2645'/1195502025'/1148870696'/0'/0'/i` | Ledger Starknet app (<https://github.com/LedgerHQ/app-starknet>) |

All three then apply StarkWare's `grindKey` (`@scure/starknet`). Our tests reproduce Argent X's own repo
vector (`packages/extension/test/keyDerivation.test.ts`), a third-party Braavos-style vector for the test
phrase, and the derivations with `ethers` (the library Argent X uses). Ledger's on-device grinding is not
verified against hardware.

`Account.publicKey` is the 32-byte Stark key (x-coordinate). The account *address* depends on the account
contract class. By default the vault computes the **OpenZeppelin** counterfactual address
(constructor `public_key`, salt = public key, deployer 0) for `STARKNET_OZ_ACCOUNT_CLASS_HASH` (OZ v0.17.0,
as in the starknet.js `create_account` guide). Override with `starknetAccountClassHash`. To show an Argent
or Braavos account address, chains-starknet should provide `addressOf` (the existing injection point),
because those constructors take different calldata.

## Addresses

The vault computes `Account.address` itself with small pure helpers: `src/address.ts` (Phase 1) and
`src/encodings.ts` (Phase 2: Sui, Aptos, NEAR, Stellar, Algorand, Tezos, TON v5r1/v4r2 state-init hashing,
Cardano CIP-19, SS58, Starknet contract address). Each is checked in the tests against the family's
official SDK. It keeps rule 2 intact (chain modules never import the vault, and the vault never imports
chain modules). To delegate to chain modules instead, inject `addressOf(family, publicKey, ctx)` in
`ClipVaultOptions`; `ctx` carries the networks, the TON version, the Starknet class hash and, for Cardano,
the stake key.

## Accounts, labels and encrypted metadata

- `listAccounts(families?)` returns the stored account indexes per family, with labels. A family with
  nothing stored lists account 0.
- `addAccount(family, label?)` adds the next index (one above the highest).
- `setAccountLabel(family, index, label)` sets a label; `""` clears it. Labels are NFC-normalised, have
  control characters stripped, and are capped at 64 characters.
- The list is stored as `VaultRecord.meta`, XChaCha20-Poly1305 under
  `HKDF-SHA256(seed, "clip-wallet/vault/meta", "clip-wallet/vault/meta-key/v1")` with AAD
  `clip-vault/v1/meta`. It is tied to the seed, not the password, so `changePassword` and passkeys leave it
  alone. It needs an unlocked vault, and tampering reads as `vault/corrupt`.

## Bitcoin change addresses

- Vault Bitcoin accounts are address indexes of BIP-84 account `0'` (Phase 1 layout: `m/84'/c'/0'/0/i`).
  Change uses that account node's internal chain: **`m/84'/c'/0'/1/n`** (`m/86'/c'/0'/1/n` for taproot).
  This is the standard BIP-84 change chain, so Sparrow and other wallets find the coins on restore.
- `freshChange("bitcoin", accountIndex)` hands out the next never-used `n`. The counter is global and
  persisted, so two vault accounts never share a change address. It records which account received `n`.
- `deriveChange("bitcoin", accountIndex, n)` derives a specific change address and records it the same way.
- `listChange("bitcoin", accountIndex)` returns the change addresses already handed out to that account.
- All three return `ChildAddress` `{ address, publicKey, derivationPath, derivationSubPath: "1/n" }`.
- `sign()` with `derivationSubPath: "1/n"` signs with that change key, but **only** if `n` was handed out to
  that account. Any other Bitcoin sub-path is refused.
- packages/chains-bitcoin:
  - `buildPsbt` sends change to the lowest handed-out change address with no history, so cancelled sends
    don't widen the BIP-44 gap. Failing that it uses `ctx.freshChangeAddress()`, and with neither the
    primary address (v1).
  - It finds and spends coins on `ctx.changeAddresses`, sets `derivationSubPath` on those inputs, and
    counts change addresses in balances.
- **Gap limit.** Indexes handed out for transfers the user cancels can still leave gaps. Reusing unused
  addresses keeps this small, but a restore tool with gap limit 20 could miss coins after 20+ consecutive
  unused handouts.

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
- **In memory while unlocked:** only the 64-byte BIP-39 seed and the BIP-39 entropy (Cardano's CIP-3 master key and Substrate's mini-secret are derived from the entropy, not the seed).
  KEK, VEK and the decrypted blob are wiped right after use. Derived private keys are wiped after each sign
  or derive call, and `lock()` wipes the seed and entropy and clears all approvals.
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
  SHA-256(domain ‖ accountId ‖ scheme ‖ bytes ‖ taprootTweak [‖ derivationSubPath]), each field
  length-prefixed. That is stricter than hashing the bytes alone: an approval for `evm:0` can't be replayed
  on `evm:1`, under another scheme, or with another sub-path (e.g. the Cardano stake key instead of the
  payment key).
  - `derivationSubPath` is appended only when present, so hashes of payloads without one are unchanged
    from Phase 1.
- `sign()` refuses unless all of these hold:
  - the approval is live (TTL is capped at 10 minutes)
  - the payload hash is listed and unused
  - the scheme is allowed for the account's family (`FAMILY_SCHEMES`: e.g. substrate → sr25519 only,
    starknet → stark-ecdsa only, schnorr → bitcoin only)
  - any `derivationSubPath` is valid for the family (Bitcoin `1/n` handed out to this account; Cardano
    `0/n`, `1/n`, `2/0`; nothing for other families)
- Every hash is single-use. An approval covering N payloads (for example a multi-input PSBT) allows
  exactly N signatures, then disappears.
- Curve and payload checks run before the approval is consumed, so a malformed request doesn't burn it.

## Signing

- `ecdsa-secp256k1`: 32-byte digest, RFC 6979, low-S enforced. Returns 64-byte r‖s and `recovery`
  (0 or 1). EVM `v` = 27 + recovery, or EIP-155.
- `schnorr-secp256k1`: BIP-340 with fresh aux randomness. `options.taprootTweak` is the **script-tree
  merkle root** (32 bytes), or an **empty array** for a BIP-86 key-path-only spend.
  - The vault applies the BIP-341 TapTweak.
  - Bitcoin schnorr payloads are always signed with the BIP-86 key m/86'/c'/0'/0/i, which `deriveAccount`
    returns as `Account.taprootPublicKey` on every Bitcoin account (chain modules build bc1p scripts from it).
  - `Signature.publicKey` is the x-only key that verifies the signature: the output key when tweaked,
    the internal key otherwise.
- `ed25519`: RFC 8032 over the message bytes. For Cardano and Algorand (ARC-52), the extended key is used:
  scalar `kL`, nonce `SHA-512(kR ‖ M)`. Signatures match cardano-serialization-lib and the xHD reference
  byte for byte and verify as plain Ed25519.
- `sr25519`: Schnorrkel with signing context `"substrate"`, fresh nonce randomness (`@scure/sr25519`).
- `stark-ecdsa`: Stark-curve ECDSA (RFC 6979) over the message hash the chain module computed: at most 32
  big-endian bytes, value below 2^251 (checked before the approval is consumed). Returns r ‖ s (64 bytes) and
  `recovery`; `publicKey` is the 32-byte Stark key.

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

`pnpm --filter @clip-wallet/vault test` (138 tests). Phase 2 adds `test/families.test.ts` (37) and
`test/vault-phase2.test.ts` (22).

Phase 2 cross-checks against independent implementations (devDependencies only):

| Family | Independent implementation | Published vectors |
|---|---|---|
| sui | `@mysten/sui` `Ed25519Keypair.deriveKeypair`, identical signature | — |
| aptos | `@aptos-labs/ts-sdk` `Account.fromDerivationPath`, `verifySignature` | — |
| near | `near-seed-phrase` `parseSeedPhrase` | — |
| stellar | `@stellar/stellar-base` StrKey, `Keypair.verify` | SEP-0005 test 5 (accounts 0–2, public and secret) |
| algorand | `@algorandfoundation/xhd-wallet-api` `keyGen` + `rawSign`, `algosdk` `encodeAddress` + `verifyBytes`; `micro-key-producer` for SLIP-10 | Pera Universal Wallet conformance vector |
| tezos | `@taquito/signer` `InMemorySigner.fromMnemonic`, identical signed bytes | — |
| ton | `@ton/crypto` `deriveEd25519Path` + `signVerify`, `@ton/ton` `WalletContractV5R1` / `V4` (mainnet and testnet) | — |
| cardano | `@emurgo/cardano-serialization-lib-nodejs` (keys, base addresses, identical signature) | CIP-3 Icarus vector; Keystone root and `addr1qy8ac7…` for the test phrase |
| substrate | `@polkadot/keyring` `addFromUri` (root, `//0`, `//1`), `sr25519Verify` (wasm schnorrkel) | sp-core dev phrase root and `//Alice`; substrate-bip39 mini-secret |
| starknet | `ethers` HDNodeWallet + `starknet.js` `grindKey`, `calculateContractAddressFromHash`, `verify` | Argent X repo vector (indexes 5, 7) and `grindKey` vector; third-party Braavos-style key |

Phase 1 vectors (unchanged):
- all 24 official BIP-39 English vectors
- BIP-32 vector 1
- SLIP-10 ed25519 vectors 1 and 2
- address KATs for the public "abandon ×11 about" phrase:
  - EVM, BIP-84 and BIP-86
  - Solana, cross-checked against `micro-key-producer` and `ed25519-hd-key`
- vault behaviour tests

Tests use public test vectors only.

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

Apache-2.0: see [LICENSE](./LICENSE) and [NOTICE](./NOTICE). "Clip Wallet" and "1Mask" are ColdAI trademarks (not licensed).
