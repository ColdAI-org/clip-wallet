# @clip-wallet/chains-sui

The Sui `ChainModule` for Clip Wallet. It builds, decodes and dry-runs transactions but never touches keys. `prepare()` returns the 32-byte digest the
vault signs (ed25519), and `finalize()` serializes the signature, then executes the transaction or returns it.

Built on `@mysten/sui` 2.33 for BCS, `TransactionDataBuilder`, `Transaction.build` and the GraphQL client used to resolve transactions, plus
`@noble/hashes` (blake2b) and `@noble/curves` (ed25519 verification only). It never imports `@mysten/sui/keypairs/*`.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/chains-sui @clip-wallet/core
```

## Example

```ts
import type { ChainModule } from "@clip-wallet/core";
import { createSuiModule, SUI_TESTNET } from "@clip-wallet/chains-sui";

// A wallet's background holds one module per family; it never gives the module a key.
const module: ChainModule = createSuiModule();
console.log(module.family, module.derivationPath(0)); // "sui" "m/44'/784'/0'/0'/0'"

const network = SUI_TESTNET;
console.log(network.id, network.testnet); // a CAIP-2 id, true

// The flow: decode() → the person approves → prepare() → the vault signs → finalize().
```

## Documentation

- [Chain modules](https://coldai.org/clip/docs/architecture/chain-modules.html)
- [Write a chain module](https://coldai.org/clip/docs/extend/chain-module.html)
- [The Sui guide for dapps](https://coldai.org/clip/docs/dapps/sui.html)
- [API reference](https://coldai.org/clip/docs/reference/api/chains-sui.html)

## Networks

| network | NetworkId = Wallet Standard chain | RPC (GraphQL) |
|---|---|---|
| testnet | `sui:testnet` | `https://graphql.testnet.sui.io/graphql` |
| devnet | `sui:devnet` | `https://graphql.devnet.sui.io/graphql` |
| mainnet | `sui:mainnet` | `https://graphql.mainnet.sui.io/graphql` |

- CAIP-2: ChainAgnostic `namespaces/sui/caip2.md` defines `^sui:(mainnet|testnet|devnet)$`. The Wallet Standard ids are the same strings
  (`@mysten/wallet-standard` `SUI_CHAINS`), and WalletConnect uses them too.
- **JSON-RPC is gone from the public fullnodes.** Every method on `fullnode.{testnet,devnet,mainnet}.sui.io` answers `-32601 "JSON-RPC on public
  fullnodes has been deprecated"`. Checked 2026-10-03; Sui docs give the shutoff as the week of 2026-07-27. So this module speaks **GraphQL
  RPC**: hand-written queries (`src/graphql.ts`) for balances, coin metadata, owned objects, simulation and execution, plus the SDK's
  `SuiGraphQLClient` (with the context's `fetch`) to resolve transactions. The chain identifiers in `src/networks.ts` were read with
  `{ chainIdentifier }`.
- Asset keys: SUI = `sui`. Circle USDC = `usdc`: `0xdba3…900e7::usdc::USDC` on mainnet and `0xa1ec…7e29::usdc::USDC` on testnet, both checked with
  `coinMetadata` (6 decimals). Other coins are `sui:<coin type>`.

## Keys and signing (verified against the SDK source)

- Path: `m/44'/784'/{i}'/0'/0'` (SLIP-10, all hardened). This is `@mysten/sui` `DEFAULT_ED25519_DERIVATION_PATH` with the account index, and
  it matches the vault.
- Address: `0x` + BLAKE2b-256(`0x00` ‖ pubkey).
- Transaction: the ed25519 signature covers **BLAKE2b-256(intent ‖ BCS(TransactionData))**, where the intent is `[0,0,0]` (scope
  TransactionData, version V0, app Sui). See `Keypair.signWithIntent` in `@mysten/sui/cryptography`. So the `SignablePayload` bytes are that
  32-byte digest.
- Personal message: BLAKE2b-256(`[3,0,0]` ‖ BCS(vector<u8> message)).
- Serialized signature: base64(`0x00` ‖ sig(64) ‖ pubkey(32)). The tests compare it byte for byte with the SDK's offline output.

## Requests

| method | params | result |
|---|---|---|
| `sui:signTransaction` | `{ inputs: [{ account, transaction, chain }] }` | `{ bytes, signature }` |
| `sui:signAndExecuteTransaction` | same | `{ bytes, signature, digest, effects }` (effects = BCS, base64) |
| `sui:signPersonalMessage` | `{ inputs: [{ account, message (b64), chain? }] }` | `{ bytes, signature }` |
| `sui_signTransaction` (WalletConnect) | `{ transaction, address }` | `{ signature, transactionBytes }` |
| `sui_signAndExecuteTransaction` | `{ transaction, address }` | `{ digest }` |
| `sui_signPersonalMessage` | `{ message (text), address }` | `{ signature }` |

Method and result shapes come from `@mysten/wallet-standard` 0.21 (`sui:signTransaction` and `sui:signAndExecuteTransaction` 2.0.0,
`sui:signPersonalMessage` 1.1.0) and the Reown "Sui RPC reference". `transaction` is either base64 BCS `TransactionData` (used as is) or the
Wallet Standard's `transaction.toJSON()`. The JSON is resolved and built once over GraphQL (`setSenderIfNotSet(me)`; gas selection and address
balances are handled by the SDK). The resulting bytes are cached per request id, so decode, prepare and finalize all see the same bytes. The
sender must be this account, and the input `chain` must match the request's network.

### decode()

- Programmable transactions are read with `TransactionDataBuilder.fromBytes`. Move calls are listed as `package::module::function`. Also
  covered: SplitCoins from gas, TransferObjects with their recipients, staking (`0x3::sui_system::request_add_stake` →
  "Stake 2 SUI" with the validator, `request_withdraw_stake` → "Unstake SUI"), and Publish/Upgrade (caution). Coin plumbing the SDK emits
  for `coinWithBalance` and address balances (`0x2::coin::redeem_funds`, `send_funds`, …) isn't shown as an app action.
- The dry run is GraphQL `simulateTransaction(transaction: { bcs: { value } })`. It gives `balanceChanges` (owner, coin type, amount) and
  `gasEffects.gasSummary`. Fee = computation + storage − rebate. My SUI change has the fee taken out, because the fee is shown on its own
  line. The title uses the recipient's simulated credit ("Send 1.5 SUI to 0xb0b0…b0b0"). A failed dry run adds a danger
  `simulation-failed` warning with a plain reason. If the dry run can't run at all, the request is still described from the PTB, with the
  budget as the fee and a caution.
- Sponsored transactions (gas owner ≠ sender) get `fee.sponsored`, "Paid by …" and an info note. `signTransaction` works for them.
  `signAndExecute` is refused because only the sponsor-aware app can submit with both signatures.
- Personal messages: text is shown. Anything else is shown as hex and marked blind.

## Balances, collectibles, stakes, buildTransfer

- `getBalances`: `address.balances` (coin objects plus address balance, summed per coin type), SUI first, with `coinMetadata`.
- `getNfts`: owned objects whose type has a **Display** (`contents.display.output` with `name`/`image_url`). Coins, `StakedSui` and objects
  without a Display are skipped. `mediaUrl` keeps only https/ipfs/ar URLs and stays untrusted.
- `getStakes(ctx)` (extra, not in `ChainModule`): `0x3::staking_pool::StakedSui` objects with principal, pool and activation epoch.
- `buildTransfer`: `Transaction` + `coinWithBalance({ type, balance })` + `transferObjects`, built over GraphQL. Shortfalls become
  "You don't have enough …". The result is a `sui:signAndExecuteTransaction` DappRequest with the built bytes.

## Wallet-built DeFi transactions (`src/defi.ts`)

Used by `@clip-wallet/features` (Sui staking, Aftermath swaps). Pure building and parsing with `@mysten/sui`: no keys, no network.
Each builder returns Wallet Standard transaction JSON, which `sui:signAndExecuteTransaction` resolves and builds as above.

- `buildStakeTransaction({ sender, validator, amount })`: `SplitCoins(gas, amount)` then `0x3::sui_system::request_add_stake(0x5, coin,
  validator)`. Under 1 SUI is refused (`staking_pool.move` `MIN_STAKING_THRESHOLD = 1_000_000_000`).
- `buildUnstakeTransaction({ sender, stakedSuiId })`: `0x3::sui_system::request_withdraw_stake(0x5, StakedSui)`. Principal and rewards
  come straight back to the sender (`sui_system.move` transfers the withdrawn balance to `ctx.sender()`).
- 0x5 goes in as a resolved shared reference (initial shared version 1, mutable), so no lookup is needed for it.
- `transactionFromKind(kindB64, sender)`: an aggregator's base64 `TransactionKind` → transaction JSON with this sender (gas left to the module).
- `inspectTransaction(source, kind?)`, `pureU64Of`, `pureAddressOf`, `normalizeCoinType`: read a transaction back for checks.
- Sources (2026-10-03): `MystenLabs/sui` `crates/sui-framework/packages/sui-system/sources/{sui_system,staking_pool}.move`.
- `describe.ts` already titles these "Stake 2 SUI" / "Unstake SUI"; `test/defi.test.ts` builds one offline and decodes it.

## Tests

`pnpm test`: GraphQL is mocked per operation name. Signatures are fixtures (`test/signatures.ts`), computed offline by the public
"abandon … about" account at `m/44'/784'/0'/0'/0'`. That is the same address the vault derives (`0x5e93…61f1`). The tests only verify.
`LIVE=1 pnpm test` adds read-only testnet checks: balances, NFTs and stakes of a public account, plus building and dry-running a transfer.

## Gaps

- Legacy `sui:signTransactionBlock` / `sui:signAndExecuteTransactionBlock` (Wallet Standard v1) aren't exposed. Current dapp-kit uses the 2.0.0 features.
- No zkLogin/multisig senders. The account is a plain ed25519 key.
- WalletConnect `sui_signPersonalMessage` treats the message as UTF-8 text. Reown's reference doesn't specify an encoding.
- `getNfts` scans at most 4 pages (200 objects) by default (`nftPages`). Kiosk-held items aren't listed.
- Validator names aren't resolved in `decode()` (the address is shown). The features Stake screen shows names from the validator set.

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

Apache-2.0: see [LICENSE](./LICENSE) and [NOTICE](./NOTICE). "Clip Wallet" and "1Mask" are ColdAI trademarks (not licensed).
