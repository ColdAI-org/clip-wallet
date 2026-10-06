# @clip-wallet/chains-substrate

Polkadot SDK (Substrate) `ChainModule` for Clip Wallet: Polkadot, Kusama, Westend and Paseo, plus their Asset Hubs.
It decodes and builds extrinsics through runtime metadata and never touches keys. `prepare()` returns the signing
payload for the vault to sign with sr25519, and `finalize()` checks the signature (`@scure/sr25519` `verify` only)
and returns a MultiSignature or the signed extrinsic.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/chains-substrate @clip-wallet/core
```

## Example

```ts
import type { ChainModule } from "@clip-wallet/core";
import { createSubstrateModule, WESTEND } from "@clip-wallet/chains-substrate";

// A wallet's background holds one module per family; it never gives the module a key.
const module: ChainModule = createSubstrateModule();
console.log(module.family, module.derivationPath(0)); // "substrate" ""

const network = WESTEND;
console.log(network.id, network.testnet); // a CAIP-2 id, true

// The flow: decode() → the person approves → prepare() → the vault signs → finalize().
```

## Documentation

- [Chain modules](https://coldai.org/clip/docs/architecture/chain-modules.html)
- [Write a chain module](https://coldai.org/clip/docs/extend/chain-module.html)
- [The Polkadot guide for dapps](https://coldai.org/clip/docs/dapps/polkadot.html)
- [API reference](https://coldai.org/clip/docs/reference/api/chains-substrate.html)

## Why polkadot-api, not @polkadot/api

`@polkadot/api` 17 is 1.15 MB unpacked, and `@polkadot/types` alone is 3.1 MB with rxjs and the util-crypto WASM
stack. That's heavy for an MV3 service worker and needs its own WASM init. This package uses polkadot-api's
low-level, tree-shakeable pieces instead:

- `@polkadot-api/substrate-bindings` 0.21: SCALE codecs, metadata V14–V16 decoding, SS58, storage hashers
- `@polkadot-api/metadata-builders` 0.15: dynamic call, storage and runtime-API codecs from metadata
- `@polkadot-api/merkleize-metadata` 1.3: RFC-0078 metadata digest for `CheckMetadataHash`

They share `@noble/hashes` and `@scure/base` with the rest of the wallet. The package minifies to 128 KB (47 KB gzip).

Byte-exactness was checked offline against `@polkadot/types` 17 with the same Westend Asset Hub metadata. The signing
payload (with and without `CheckMetadataHash`) and the signed extrinsic match `ExtrinsicPayload.toU8a({ method:
true })` and `Extrinsic.addSignature` byte for byte. An end-to-end run against `@clip-wallet/vault` (public "abandon
… about" vector) produced an sr25519 signature that `finalize()` accepted.

## Networks

CAIP-2 (ChainAgnostic namespaces `polkadot/caip2.md`): `polkadot:` + the first 32 hex characters of the genesis
hash. Genesis hashes, SS58 formats, decimals and symbols were read on 2026-10-03 with `chain_getBlockHash(0)` and
`system_properties`.

| network | NetworkId | SS58 | token | testnet |
|---|---|---|---|---|
| Polkadot | `polkadot:91b171bb158e2d3848fa23a9f1c25182` | 0 | DOT (10) | no |
| Kusama | `polkadot:b0a8d493285c2df73290dfb7e61f870f` | 2 | KSM (12) | no |
| Westend | `polkadot:e143f23803ac50e8f6f8e62695d1ce9e` | 42 | WND (12) | yes |
| Paseo | `polkadot:374057be67b355151f271ff70c3db983` | 42 | PAS (10) | yes |
| Polkadot Asset Hub | `polkadot:68d56f15f85d3136970ec16946040bc1` | 0 | DOT | no |
| Kusama Asset Hub | `polkadot:48239ef607d7928874027a43a6768920` | 2 | KSM | no |
| Westend Asset Hub | `polkadot:67f9723393ef76214df0118c34bbbd3d` | 42 | WND | yes |
| Paseo Asset Hub | `polkadot:d6eec26135305a8ad257a20d00335728` | 42 | PAS | yes |

- Paseo's genesis is `0x374057be…` on two independent providers (Dwellir, Stakeworld), and its SS58 format is
  now 42.
- Since the Asset Hub migration, `Staking` and `NominationPools` are on each Asset Hub (Westend/Paseo relay metadata
  no longer has them). The module finds pallets in metadata, so it follows wherever they are.
- Asset keys: native `dot` / `ksm` / `wnd` / `pas`. The relay chain and its Asset Hub share the key because it's
  the same native token. Polkadot Asset Hub assets 1337 (USDC, Circle-issued) → `usdc` and 1984 (USDT) → `usdt`.
  Other assets → `asset:<id>`, with `address` = the asset id. Paseo Asset Hub's test USDC (1337) / USDT (1984)
  share `usdc` / `usdt` (same ids as Polkadot, owner `5Evfk4MM…`, sufficient, PAS pools; read 2026-10-03).
- `fromChainId` also accepts a full `0x` genesis hash (what `SignerPayloadJSON` and injectedWeb3 accounts carry).

## Accounts

The vault derives sr25519 keys from the BIP-39 entropy (substrate-bip39 mini-secret). Account 0 is the root key,
account i ≥ 1 is `//(i-1)`. The vault stores the address with the generic prefix 42. The module always compares by
public key and re-encodes per network (`addressFromPublicKey`). `networksForAddress` matches the SS58 prefix, so a
prefix-0 address matches Polkadot and Polkadot Asset Hub, and 42 matches the testnets.

## Requests

| method | params | result |
|---|---|---|
| `substrate_signPayload` (injectedWeb3 `signer.signPayload`) | `SignerPayloadJSON` | `{ signature, signedTransaction? }` |
| `substrate_signRaw` (`signer.signRaw`) | `{ address, data, type }` | `{ signature }` |
| `polkadot_signTransaction` (WalletConnect) | `{ address, transactionPayload }` | `{ signature }` |
| `polkadot_signMessage` (WalletConnect) | `{ address, message }` | `{ signature }` |
| `substrate_signAndSubmit` (from `buildTransfer` / `buildStake`) | `{ payload }` | `{ txHash }` |

Signatures are MultiSignature hex: `0x01` (Sr25519, index read from metadata) followed by 64 bytes, as polkadot.js
returns them with `withType: true`.

### decode()

- The payload's account must be this account (by public key, any SS58 prefix), and its genesis hash must be the
  connected network. Version 4 only.
- Metadata (V15 through `Metadata_metadata_at_version`, V14 fallback) is cached per genesis + specVersion. If the
  payload's `specVersion` differs, the runtime at `blockHash` is loaded. If that state is pruned, the request gets a
  caution that it may be rejected.
- The call is decoded with metadata into `Pallet.call(args)` and described in plain language:
  - Balances transfers ("Send 1.5 WND to 5Grw…"), `transfer_all` (caution), `force_transfer` (blind).
  - Asset Hub `Assets.transfer*` with on-chain `Assets.Metadata`, and `approve_transfer` (`unlimited-approval`).
  - Staking bond / bond_extra / unbond / rebond / withdraw_unbonded / nominate / chill / set_payee / payout.
  - NominationPools join / bond_extra (FreeBalance or Rewards) / unbond / withdraw_unbonded / claim_payout /
    claim_payout_other / set_claim_permission.
  - Utility batch / batch_all / force_batch, recursively, with the run semantics shown.
  - `System.remark*`, `Proxy.add_proxy` (danger `approval-for-all`), `Proxy.proxy` (the inner call).
  - Anything else is shown as `Pallet.call(args)` with a caution. Sudo, `System.set_code`/storage and
    `Utility.dispatch_as` are blind and danger.
- Fee: `TransactionPaymentApi_query_info` on the extrinsic with a zero signature. Tip, mortality ("Valid for about
  6 minutes") and immortality ("Never expires") are shown.
- `CheckMetadataHash`: with `mode: 1`, the payload's `metadataHash` is compared with the RFC-0078 digest of the
  metadata Clip Wallet fetched itself (`merkleizeMetadata(…, { decimals, tokenSymbol })`). A match shows "Metadata
  check: On". A mismatch is a danger warning: the network would reject the transaction, or the app described the
  network wrongly.
- `signRaw`: text is shown, binary is hex and blind. The data is always signed wrapped in `<Bytes>…</Bytes>` (never
  double-wrapped), as the polkadot.js extension does, so a raw signature can't be replayed as a transaction.

### Signing payload

`call ‖ extra ‖ additionalSigned`, each extension in metadata order, hashed with blake2b-256 if longer than 256
bytes:

- `CheckMortality`: era / block hash (genesis if immortal)
- `CheckNonce`: compact
- `ChargeTransactionPayment`: compact tip
- `ChargeAssetTxPayment`: tip + `Option<assetId>`, where the payload's `assetId` is the inner value per
  polkadot.js `Option.toHex`
- `SkipCheckIfFeeless`: the wrapped type
- `CheckMetadataHash`: mode u8 / `Option<[u8;32]>`
- `CheckSpecVersion` / `CheckTxVersion`: u32
- `CheckGenesis`: hash

Empty extensions (AuthorizeCall, CheckWeight, StorageWeightReclaim, EthSetOrigin, …) encode nothing. An unknown
extension of `Option` type encodes None and a `bool` encodes false (Paseo Asset Hub's AsPgas, AsDotnsGateway and
RestrictOrigins). Any other unknown type is refused (`substrate/unknown-extension`) rather than guessed.

The extrinsic is `compact(len) ‖ 0x84 ‖ MultiAddress::Id(0x00 ‖ pubkey) ‖ MultiSignature ‖ extra ‖ call`.

## Balances, NFTs, staking

- `getBalances`: `System.Account.data.free` (native), plus `Assets.Account` for curated asset ids and
  `createSubstrateModule({ assetIds: { [networkId]: [...] } })`. Asset accounts are keyed by asset first, so they
  can't be listed per account without an indexer.
- `getNfts`: `Nfts.Account` and `Uniques.Account` (prefix scan by account with `state_getKeysPaged`), plus item
  metadata (`ItemMetadataOf` / `InstanceMetadataOf`). The metadata is JSON, a URL or a CID; off-chain JSON is fetched
  through an IPFS gateway. `mediaUrl` is untrusted.
- `getStaking(ctx)`: nomination-pool membership (`PoolMembers`). Bonded balance comes from
  `NominationPoolsApi.points_to_balance`, pending rewards from `pending_rewards`, and unbonding chunks from
  `Staking.CurrentEra` (withdrawable when the era has passed).
- `buildStake`: join / bondExtra / bondRewards / unbond (points via `NominationPoolsApi.balance_to_points`) / withdraw
  / claim. It builds a `SignerPayloadJSON` from the finalized head (mortal era of 64 blocks),
  `system_accountNextIndex`, and the runtime version, with mode 0.
- `buildTransfer`: `Balances.transfer_keep_alive`, or `Assets.transfer_keep_alive` when `asset.address` is an asset
  id. An address formatted for another network (prefix not this network's and not 42) is refused.

## Helpers for wallet features (staking, swaps)

Added for `@clip-wallet/features` (`staking/polkadot.ts`, `swap/assethub.ts`). Reads only; every transaction
still goes through the approval path.

- `module.buildCall({ pallet, call, args }, ctx)`: a `substrate_signAndSubmit` request for any call in live
  metadata, built like `buildTransfer` (finalized head, mortal era, next nonce, mode 0). decode() describes it.
- `connect(ctx)` → `{ rpc, rt, spec, me }`; `storageEntries` (keys paged + `state_queryStorageAt`), `constantOf`,
  `spendableNative` (free − max(frozen − reserved, ED)), `activeEra`, `poolUnbondingEras`, `erasToText`.
- XCM Locations for `AssetConversion`: `nativeLocation()` = `{ parents: 1, interior: Here }`,
  `assetLocation(id)` = `{ parents: 0, interior: X2[PalletInstance(50), GeneralIndex(id)] }`, `locationAsset`.
  Both forms are how `AssetConversion.Pools` keys pools on Westend / Paseo / Polkadot Asset Hub (read live).
- decode() now describes `AssetConversion.swap_exact_tokens_for_tokens` / `swap_tokens_for_exact_tokens`
  ("Swap 2 WND for at least 0.97 USDC", balance changes, a caution if `send_to` isn't you). Foreign-asset paths
  stay `Pallet.call(args)` with a caution.
- `Enum` is re-exported so packages without polkadot-api can build call args.
- Fixed: `runtimeCall` sent the args as bytes (serialised as a JSON object, which nodes reject); it now sends 0x
  hex. `getStaking` counts unbonding from `Staking.ActiveEra` (staking-async's `current_era()` returns the active
  era; `CurrentEra` can be one ahead).

Staking facts checked on 2026-10-03 (live RPC, read-only):

| Asset Hub | spec | era | pool unbonding | MinJoinBond | ED |
|---|---|---|---|---|---|
| Polkadot | statemint 2005000 | 24 h | 2 eras (≈2 days): `AreNominatorsSlashable` false → `NominatorFastUnbondDuration` 2 (`BondingDuration` 28) | 1 DOT | 0.01 DOT |
| Kusama | statemine 2003002 | 6 h | per the same rule | | |
| Westend | westmint 1025001 | 6 h | 2 eras (≈12 h) | 0.1 WND | 0.001 WND |
| Paseo | asset-hub-paseo 2005002 | 6 h | 28 eras (≈7 days), nominators slashable | 0 | 0.01 PAS |

Era length was measured from `Staking.ActiveEra.start` at historical blocks. The unbonding rule is
`nomination-pools/src/adapter.rs` (`bonding_duration()` → `nominator_bonding_duration()`) and
`staking-async/src/pallet/impls.rs` (BondingDuration if `AreNominatorsSlashable`, else
`NominatorFastUnbondDuration`) in paritytech/polkadot-sdk master. Swap pools: Westend Asset Hub has 111
AssetConversion pools (community test tokens), Paseo Asset Hub 21 including PAS/USDC (1337) and PAS/USDT (1984).

## Tests

`pnpm test` (29 tests) runs against real Westend Asset Hub metadata V15 (`test/fixtures`, gzipped, specVersion
1025001), with RPC, storage and runtime-API answers encoded through the same metadata. sr25519 signatures are
fixtures computed once offline with a throwaway key (`test/signatures.ts`).

## Gaps

- No transaction v5 (general transactions), and no ethereum (`AccountId20`) or ecdsa/ed25519 accounts.
- Direct staking (bond / nominate) decodes but isn't built; only nomination pools are.
- Foreign assets (XCM `Location` ids) and XCM transfers show as `Pallet.call(args)`.
- No dry-run simulation (`DryRunApi`), so balance changes come from the call alone.
- Metadata is fetched from the network on first use (300–700 KB). Shipping known metadata with the extension
  (`provideRuntime`) would save that round trip.

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

See [LICENSE](./LICENSE).
