# @clip-wallet/chains-cardano

Cardano `ChainModule` for Clip Wallet. It builds, decodes and assembles transactions but never touches keys:
`prepare()` returns the blake2b-256 body hash (or the CIP-8 `Sig_structure`) for the vault to sign with ed25519, and
`finalize()` turns the signatures into a witness set, a signed transaction or a COSE signature.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/chains-cardano @clip-wallet/core
```

## Example

```ts
import type { ChainModule } from "@clip-wallet/core";
import { createCardanoModule, CARDANO_PREPROD } from "@clip-wallet/chains-cardano";

// A wallet's background holds one module per family; it never gives the module a key.
const module: ChainModule = createCardanoModule();
console.log(module.family, module.derivationPath(0)); // "cardano" "m/1852'/1815'/0'/0/0"

const network = CARDANO_PREPROD;
console.log(network.id, network.testnet); // a CAIP-2 id, true

// The flow: decode() → the person approves → prepare() → the vault signs → finalize().
```

## Documentation

- [Chain modules](https://coldai.org/clip/docs/architecture/chain-modules.html)
- [Write a chain module](https://coldai.org/clip/docs/extend/chain-module.html)
- [The Cardano guide for dapps](https://coldai.org/clip/docs/dapps/cardano.html)
- [API reference](https://coldai.org/clip/docs/reference/api/chains-cardano.html)

## Why no cardano-serialization-lib

The extension's background is an MV3 service worker. `@emurgo/cardano-serialization-lib-browser` 17.0.0 ships a
2.79 MB `.wasm` plus 0.94 MB of JS glue, and `@dcspark/cardano-multiplatform-lib-browser` 6.2.0 is 2.94 MB wasm +
1.58 MB JS (sizes from `npm pack --dry-run`, 2026-10-03). `@cardano-sdk/core` 0.47 pulls lodash and more (4.4 MB
unpacked). A wallet only needs CBOR, blake2b, bech32 and ed25519 verification, so this package has a small CBOR
codec (`src/cbor.ts`) on top of `@noble/hashes`, `@noble/curves` and `@scure/base`, which the other chain packages
already ship. The whole package minifies to 93 KB (35 KB gzip), mostly the shared noble code.

A hand-written decoder is also more correct here: the body hash must be taken over the body's original bytes, and
a signed transaction must be reassembled without re-encoding the body or auxiliary data. `readItem` / `splitArray`
/ `splitMap` keep raw spans for that.

Cross-checked offline against cardano-serialization-lib 15 (nodejs) and cardano-message-signing 1.1: built
transfers, token transfers and delegations parse in CSL with the same transaction hash, every vkey witness
verifies, the fee is at or above `min_fee`, every output is at or above `min_ada_for_output`, and the COSE_Sign1
from `signData` parses and verifies with message-signing. An end-to-end run against `@clip-wallet/vault` (public
"abandon … about" vector) signed a delegation with the payment key plus the stake key (`derivationSubPath: "2/0"`)
and a reward-address `signData`. These checks ran outside the repo, so the tests don't depend on CSL.

## Networks

| network | NetworkId | address network id | Koios |
|---|---|---|---|
| preprod | `cip34:0-1` | 0 (`addr_test`) | https://preprod.koios.rest/api/v1 |
| preview | `cip34:0-2` | 0 (`addr_test`) | https://preview.koios.rest/api/v1 |
| mainnet | `cip34:1-764824073` | 1 (`addr`) | https://api.koios.rest/api/v1 |

- CAIP-2: ChainAgnostic/namespaces has no Cardano namespace. CIP-34 (`cip34:NetworkId-NetworkMagic`, magic and
  genesis hashes from CIP-0034 `registry.json`) is what WalletConnect's Cardano integration uses, so the ids above
  follow it.
- Koios public tier: no API key, 5,000 requests/day and 100 per 10 s per IP, 30 s query timeout. It is CORS
  restricted, so the extension needs host permission for `https://*.koios.rest/*` (see the integration doc).
  Endpoints used: `/tip`, `/cli_protocol_params`, `/address_utxos`, `/utxo_info`, `/account_info`, `/asset_info`,
  `/pool_info`, `/submittx` (raw CBOR, `application/cbor`). Shapes are from `koiosapi.yaml`.
- Asset keys: ADA = `ada`; native assets = `cnt:<policy id><asset name hex>`, with `address` = that unit. There is no
  Circle-issued USDC on Cardano, so nothing shares the `usdc` key.

## Accounts and keys

- CIP-1852: payment key `m/1852'/1815'/<i>'/0/0` (the account's key), stake key `m/1852'/1815'/<i>'/2/0`. The vault
  (Icarus master key, CIP-3) stores the base address (`addr_test1q…`) and the payment public key.
- The stake key is used for delegation certificates, reward withdrawals, required signers and `signData` with a
  reward address. Such payloads set core's `SignablePayload.derivationSubPath = "2/0"` (`STAKE_SUBPATH`), and
  `finalize()` checks that the returned `Signature.publicKey` hashes (blake2b-224) to the stake credential in the
  account's address. Payment payloads leave `derivationSubPath` unset.
- `addressFromPublicKey`: 32 bytes (payment key) → enterprise address; 64 bytes (payment ‖ stake) → base address.
- BIP32-Ed25519 signatures verify as plain Ed25519, so `finalize()` verifies with `@noble/curves` `ed25519.verify`.

## Requests

CIP-30 calls come from the 1Mask connector (`packages/1mask/src/inpage/cardano.ts`) with these names. WalletConnect's
Cardano namespace uses the same `cardano_*` names.

| method | params | result |
|---|---|---|
| `cardano_signTx` | `[txHex, partialSign?]` or `{ tx, partialSign }` | witness set CBOR hex (only this wallet's vkey witnesses) |
| `cardano_signData` | `[address (hex or bech32), payloadHex]` | `{ signature: COSE_Sign1 hex, key: COSE_Key hex }` |
| `cardano_signAndSubmitTx` | `{ tx }` (from `buildTransfer` / `buildDelegate`) | `{ txHash }` |

`read(method, params, ctx)` answers the CIP-30 read calls without an approval: `cardano_getNetworkId`,
`cardano_getUtxos` (amount + paginate), `cardano_getCollateral` (deprecated API: pure-ADA UTxOs ≥ 1 ADA, at most 3),
`cardano_getBalance` (CBOR value), `cardano_getUsedAddresses` / `getUnusedAddresses` / `getChangeAddress` /
`getRewardAddresses` (hex), and `cardano_submitTx`. The background needs to wire this read path in (integration doc).

### decode()

- Parses Conway transactions (`[body, witnesses, isValid, aux]`, plus the 3-element Mary form). Inputs and
  collateral are resolved through Koios `/utxo_info`. An input whose payment credential is this account's key is
  "ours". Other key-locked inputs, foreign required signers and certificates or withdrawals for other stake keys
  count as other people's signatures.
- `partialSign: false` and other signatures needed: refused with `PROOF_GENERATION_MESSAGE` (code
  `cardano/proof-generation`), which 1Mask maps to `TxSignError.ProofGeneration`. If nothing needs this wallet's
  signature, it's refused too.
- Described: payments to others ("Send 4 ADA and 2 CLIP to addr_test1vz…"). Outputs back to another funder count as
  their change. Also described: mint/burn ("Creates 1 Clip #1"), certificates (registration and deposit,
  deregistration and refund, pool delegation with the pool ticker from Koios, DRep vote delegation, the combined
  Conway certificates 7–13), reward withdrawals, Plutus/native script use, collateral at risk (total collateral or
  collateral minus return), governance votes and proposals, treasury donation, CIP-20 messages (label 674) and other
  metadata labels, and the TTL. Pool, committee and DRep registration certificates and unknown body keys make the
  request **blind**.
- Balance changes: this wallet's outputs minus its inputs, per asset, with the fee added back because it's shown
  separately. `simulated` is true when every input was resolved. Cardano is deterministic, so the deltas are exact.
- Warnings: an output or body `network_id` for another network → `network-matters` (danger); unresolved inputs →
  `simulation-failed` (caution); blind parts → `blind-signing`.
- `signData`: shows the payload as text (or hex, blind). Payloads that parse as a transaction or a transaction body
  are refused. The address must be this account's base/enterprise address (payment key) or reward address (stake
  key). A script address gives `cardano/address-not-pk` (→ `DataSignError.AddressNotPK`).

### prepare() / finalize()

- signTx: one ed25519 payload of the body hash per key needed (payment, then stake). finalize verifies each
  signature and its key hash, then returns the witness set or (for wallet-built transactions) adds the witnesses
  without touching the body or auxiliary data bytes, submits through Koios, and checks that the returned id equals
  the body hash.
- signData (CIP-8 / CIP-30): `Sig_structure = ["Signature1", protected {1: -8, "address": bytes}, h'', payload]`.
  The result is `COSE_Sign1 = [protected, {"hashed": false}, payload, signature]` and
  `COSE_Key = {1: 1, 3: -8, -1: 6, -2: pubkey}`.

## Balances, NFTs, staking

- `getBalances`: ADA plus fungible native assets from `/address_utxos`. Metadata comes from `/asset_info`:
  Cardano Token Registry (name, ticker, decimals), CIP-68 333 datum (decimals/ticker), or else the asset name.
- `getNfts`: CIP-25 (label 721 in the latest mint transaction; v1 UTF-8 or v2 hex asset-name keys) and CIP-68
  (222/444 user tokens, metadata from Koios `cip68_metadata`, Plutus data decoded). `mediaUrl` is untrusted: only
  https/ipfs/ar URLs (or bare CIDs, turned into `ipfs://`) are kept.
- `getStaking(ctx)`: reward address, registration, delegated pool (id, ticker, name), rewards available, DRep.
- `buildDelegate({ poolId })`: stake registration (with the `stakeAddressDeposit` taken from change) if needed, plus
  a delegation certificate. It needs both payment and stake signatures.

## Rewards, vote delegation, deregistration (stake-swap)

Added for the wallet's staking flow. All three return a `cardano_signAndSubmitTx` request signed with the payment
and stake keys (`STAKE_SUBPATH`), built by the same `buildTx` (coin selection, min-UTxO, fee fixed point); `buildTx`
now takes `withdrawals` (body key 5, counted as an input) and always selects at least one input.

- `buildVoteDelegate({ drep })`: certificate 9 `vote_deleg_cert = (9, stake_credential, drep)` with
  `drep = [2]` (always abstain), `[3]` (always no confidence) or a key/script hash. Needs a registered stake key.
- `buildWithdrawRewards(ctx)`: withdraws exactly Koios `rewards_available` (the ledger requires the full balance).
- `buildDeregister(ctx)`: certificate 8 `unreg_cert = (8, stake_credential, coin)` refunding the deposit Koios
  reports for the account (`account_info.deposit`, else `stakeAddressDeposit`), plus a withdrawal of any rewards in
  the same transaction (an account must be empty to unregister).
- DRep rule: since protocol version 10 (Plomin), withdrawals from a key-hash stake credential fail with
  `ConwayWdrlNotDelegatedToDRep` unless it is already DRep-delegated. The check (`validateWithdrawalsDelegated`) runs
  on the ledger state *before* the transaction's certificates, so a vote delegation in the same transaction does not
  count; zero-amount withdrawals are checked too. The builders refuse with `cardano/needs-vote-delegation`, and the
  wallet sends the vote delegation as an earlier transaction.
- `getStaking` also returns `deposit` and `totalBalance` when Koios has them. `Koios.poolList(maxMargin)` (GET
  `/pool_list` with PostgREST filters, max 1,000 rows) and `Koios.epochRewards()` (GET `/epoch_info`,
  `total_rewards`/`active_stake`) feed pool ranking and the reward-rate estimate.
- `src/plutus.ts`: Plutus data reading (`constrOf`, `plutusAddress`, `addressesIn`, `witnessDatums`, `outputDatum`)
  and `TxOutput.datumHash` / `inlineDatum`, used to verify DEX order datums.

Sources (2026-10-03): cardano-ledger `eras/conway/impl/cddl/data/conway.cddl` (certificates 1, 7–13, `drep`,
`withdrawals`); `eras/conway/impl/src/Cardano/Ledger/Conway/Rules/Ledger.hs` (withdrawals validated and drained
before CERTS; `validateWithdrawalsDelegated`); Koios `/account_info` (`delegated_drep`, `deposit`), `/pool_info`
(`live_saturation`, `live_pledge`), `/pool_list`, `/epoch_info`, checked live on preprod and mainnet.

## buildTransfer

CIP-2 largest-first coin selection. UTxOs holding the requested asset come first, and UTxOs with reference scripts
are skipped. The min-UTxO rule (Babbage/Conway) is `coinsPerUTxOByte × (160 + serialized output size)`. A token
send attaches that minimum ADA, and an ADA send below it is refused. The fee is `txFeePerByte × size + txFeeFixed`,
measured on the final size with placeholder witnesses and iterated to a fixed point. Change keeps every leftover
token. Leftover ADA below the change minimum goes to the fee. Outputs use the post-Alonzo map format, inputs and
certificates are tag-258 sets, and the TTL is tip + 7200 slots. The result is a `cardano_signAndSubmitTx` DappRequest.

## Tests

`pnpm test` (33 tests). Koios is mocked by path. Signatures are fixtures computed once offline with throwaway keys
(`test/signatures.ts`), because tests may only verify.

## Gaps

- `buildDeregister` uses Koios `rewards_available`; if an epoch boundary pays new rewards between building and
  submitting, the ledger rejects the transaction (incomplete withdrawal) and the user retries.
- Change outputs aren't split, so a wallet with very many tokens could exceed `maxValueSize`. Multi-address
  wallets (CIP-1852 change chain `1/n`) aren't scanned: the module uses the account's single base address.
- No Plutus evaluation: script transactions are described from their body, not simulated.
- Byron addresses decode for display but aren't accepted as send targets.

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

Apache-2.0: see [LICENSE](./LICENSE) and [NOTICE](./NOTICE). "Clip Wallet" and "1Mask" are ColdAI trademarks (not licensed).
