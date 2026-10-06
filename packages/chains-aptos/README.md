# @clip-wallet/chains-aptos

The Aptos `ChainModule` for Clip Wallet. It builds, decodes and simulates transactions but never touches keys. `prepare()` returns the signing
message for the vault (ed25519), and `finalize()` returns an `AccountAuthenticator` or submits a `SignedTransaction`.

Built on `@aptos-labs/ts-sdk` 7.3 for BCS types, `generateSigningMessageForTransaction`, `generateSignedTransactionForSimulation` and the
ABI-based payload builder. All network access goes through the context's `fetch` (fullnode REST + indexer GraphQL); the SDK's own client is
not used. It never uses the SDK's `Account`/private-key classes.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/chains-aptos @clip-wallet/core
```

## Example

```ts
import type { ChainModule } from "@clip-wallet/core";
import { createAptosModule, APTOS_TESTNET } from "@clip-wallet/chains-aptos";

// A wallet's background holds one module per family; it never gives the module a key.
const module: ChainModule = createAptosModule();
console.log(module.family, module.derivationPath(0)); // "aptos" "m/44'/637'/0'/0'/0'"

const network = APTOS_TESTNET;
console.log(network.id, network.testnet); // a CAIP-2 id, true

// The flow: decode() → the person approves → prepare() → the vault signs → finalize().
```

## Documentation

- [Chain modules](https://coldai.org/clip/docs/architecture/chain-modules.html)
- [Write a chain module](https://coldai.org/clip/docs/extend/chain-module.html)
- [The Aptos guide for dapps](https://coldai.org/clip/docs/dapps/aptos.html)
- [API reference](https://coldai.org/clip/docs/reference/api/chains-aptos.html)

## Networks

| network | NetworkId (CAIP-2) | AIP-62 chain | chain id | fullnode / indexer |
|---|---|---|---|---|
| testnet | `aptos:2` | `aptos:testnet` | 2 | `https://api.testnet.aptoslabs.com/v1` (`/v1/graphql`) |
| devnet | `aptos:devnet` | `aptos:devnet` | changes on reset (248 on 2026-10-03) | `https://api.devnet.aptoslabs.com/v1` |
| mainnet | `aptos:1` | `aptos:mainnet` | 1 | `https://api.mainnet.aptoslabs.com/v1` |

- CAIP-2: ChainAgnostic `namespaces/aptos/caip2.md` defines `aptos:<chain_id>` (mainnet `aptos:1`, testnet `aptos:2`). Devnet's chain id
  isn't stable, so its NetworkId is `aptos:devnet`, and the chain id is read from `GET /v1` when needed.
- AIP-62 chains: `@aptos-labs/wallet-standard` `APTOS_CHAINS`. Map with `toWalletStandardChain` / `fromChainId`, which accepts either form.
- Chain ids were checked with `GET /v1` on each fullnode. The indexer answers anonymously.
- Asset keys: APT (coin `0x1::aptos_coin::AptosCoin` or its paired fungible asset `0xa`) = `apt`. Circle USDC fungible asset = `usdc`:
  `0xbae2…6f3b` on mainnet and `0x6909…2832` on testnet, both checked with `0x1::fungible_asset::symbol`. Other fungible assets are
  `aptos:<metadata>` and other coins are `aptos:<coin type>`.

## Keys and signing (verified against the SDK source)

- Path: `m/44'/637'/{i}'/0'/0'` (SLIP-10, hardened; ts-sdk `APTOS_HARDENED_REGEX`, Petra). It matches the vault.
- Address: SHA3-256(pubkey ‖ `0x00`), the legacy Ed25519 authentication key (`AuthenticationKey.fromPublicKey(...).derivedAddress()`).
- Transaction signing message: **SHA3-256("APTOS::RawTransaction") ‖ BCS(RawTransaction)**. For fee-payer and multi-agent transactions it is
  SHA3-256("APTOS::RawTransactionWithData") ‖ BCS(RawTransactionWithData). ts-sdk `generateSigningMessage` and `RAW_TRANSACTION_SALT`
  confirm this. Ed25519 signs those bytes directly, with no extra hash. The tests compare against the SDK's own `AccountAuthenticator` and
  `SignedTransaction` bytes.
- `aptos:signMessage` (AIP-62) signs the UTF-8 `fullMessage`: `APTOS`, then `address: …`, `application: …`, `chainId: …` when the dapp asks
  for them, then `message: …` and `nonce: …`, joined by `\n`. AIP-62 fixes the fields but not the layout. This layout follows Trust Wallet's
  AptosProvider and Petra's docs.

## Requests

1Mask sends AIP-62 calls as `{ inputs: [one input] }`:

| method | input | result |
|---|---|---|
| `aptos:signTransaction` | `{ account, transaction (b64 BCS of SimpleTransaction / MultiAgentTransaction), multiAgent, asFeePayer }` | `{ authenticator (b64 BCS AccountAuthenticator), feePayerAddress? }` |
| `aptos:signAndSubmitTransaction` | `{ account, payload: { function, typeArguments, functionArguments }, maxGasAmount?, gasUnitPrice? }` or `{ account, transaction }` | `{ hash }` |
| `aptos:signMessage` | `{ account, message, nonce, address?, application?, chainId? }` | AIP-62 output, `signature` as 0x-hex |

- Roles: sender, secondary signer (multi-agent) or fee payer (`asFeePayer`). In the fee-payer case, the fee-payer slot is set to this account
  before signing, as the SDK does. Anything else is refused ("doesn't need your signature"). The transaction's chain id must match the
  network.
- Payload requests are built here. The entry function's ABI comes from `GET /accounts/{addr}/module/{module}`, and
  `generateTransactionPayloadWithABI` encodes the arguments (`{ $bytes: "0x…" }` means `vector<u8>`). Then: sequence number,
  `/estimate_gas_price`, an estimating simulation (max gas = 1.5 × used, at least 2000), and a 10-minute expiry. The built transaction is
  cached per request id, so the transaction shown is the one signed and sent.

### decode()

- Entry functions: APT/coin/fungible-asset transfers (`0x1::aptos_account::transfer`, `transfer_coins`, `transfer_fungible_assets`,
  `0x1::coin::transfer`, `0x1::primary_fungible_store::transfer`) become "Send 1.5 APT to 0xb0b0…b0b0". Delegation-pool
  `add_stake`/`unlock`/`withdraw` become "Stake … APT" and so on. Other functions get a title from the function name ("Swap exact input on
  app.example") and lines with `module::function` and type arguments. Scripts and encrypted payloads are **blind**. Multisig payloads are
  described as a shared-account transaction.
- Simulation: `POST /v1/transactions/simulate` with the SDK's zero-signature simulation transaction. Balance changes come from
  `fungible_asset::Withdraw`/`Deposit` events. Each store's owner and metadata come from the write set (`FungibleStore`, `ObjectCore`). If
  the ObjectCore isn't in the write set, the store is matched against my primary store, SHA3-256(owner ‖ metadata ‖ `0xFC`). Legacy
  `coin::CoinWithdraw`/`CoinDeposit` events are read too. Fee = gas used × unit price. A failed `vm_status` becomes a plain danger warning.
  If simulation can't run, the fee shown is max gas × price, with a caution.
- When someone else pays the fee (a sponsor or the 0x0 placeholder, or I'm a secondary signer), it's marked `fee.sponsored`.

## Balances, collectibles, buildTransfer

- APT: `GET /accounts/{a}/balance/0x1::aptos_coin::AptosCoin` (coin + fungible asset; 404 means 0). Other assets: indexer
  `current_fungible_asset_balances`, with metadata from the indexer or from `Metadata`/`CoinInfo` resources.
- NFTs: indexer `current_token_ownerships_v2` (Digital Asset standard). Image URIs become `mediaUrl` (untrusted). JSON metadata URIs aren't
  fetched.
- `buildTransfer`: APT through `aptos_account::transfer`, fungible assets through `primary_fungible_store::transfer<Metadata>`, coins through
  `aptos_account::transfer_coins<T>`. The result is an `aptos:signAndSubmitTransaction` DappRequest carrying the built BCS.

## Wallet-built DeFi payloads (`src/defi.ts`)

Used by `@clip-wallet/features` (Aptos delegated staking, Hyperion swaps). Payloads use the wire form `aptos:signAndSubmitTransaction`
accepts, so this module fetches the ABI, encodes, simulates and builds them like any dapp payload.

- `delegationPayload("add_stake" | "unlock" | "withdraw", pool, amount)`: `0x1::delegation_pool::<action>(pool_address, amount)`.
  `MIN_DELEGATION_OCTAS` = 1,000,000,000 (10 APT, `MIN_COINS_ON_SHARES_POOL` in `aptos-framework/sources/delegation_pool.move`, checked 2026-10-03).
- `encodeEntryPayload(payload, abi)` runs the same SDK ABI encoder offline. `decodeEntryPayload(bytes)`, `bcsU64`, `bcsAddress` and
  `bcsAddressVector` read the BCS back (for checks and tests).
- Fix: `describe.ts` now reads the arguments of payloads this module built itself (typed `U64`/`AccountAddress`, not only deserialized
  `EntryFunctionBytes`). Before, a wallet-built `add_stake` was titled "Stake APT" without the amount.

## Tests

`pnpm test`: REST and indexer are mocked. Signatures are fixtures (`test/signatures.ts`), computed offline by the public "abandon … about"
account at `m/44'/637'/0'/0'/0'`. That is the vault's address `0xeb66…d3bf`. The tests only verify. `primaryStoreAddress` is checked against
a store observed on testnet. `LIVE=1 pnpm test` adds read-only testnet/devnet checks (balances, NFTs, a simulated transfer).

## Gaps

- `aptos:signIn` (AIP-116), `aptos:changeNetwork` and `aptos:openInMobileApp` aren't exposed. `aptos:signTransaction` is version 1.0.0 (no
  v1.1 payload input).
- Only legacy Ed25519 accounts. No SingleKey/MultiKey/keyless senders or rotated authentication keys.
- No WalletConnect Aptos methods: Reown has no published Aptos namespace spec.
- Script payloads are blind. Argument values of arbitrary entry functions aren't decoded (that would need an ABI fetch per decode).
- `aptos:network` reports chain id 0 for devnet.

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

Apache-2.0: see [LICENSE](./LICENSE) and [NOTICE](./NOTICE). "Clip Wallet" and "1Mask" are ColdAI trademarks (not licensed).
