# @clip-wallet/chains-near

The NEAR `ChainModule` for Clip Wallet. It builds, decodes and broadcasts NEAR transactions and NEP-413 messages,
and it never touches keys. `prepare()` returns what the vault signs (ed25519): `sha256(borsh(Transaction))` for
transactions and the NEP-413 hash for messages. `finalize()` checks every signature with `ed25519.verify`, puts the
signed transaction together and sends it.

Borsh is written by hand (`src/borsh.ts`), so there are no `near-api-js`, `@near-js/*` or `borsh` dependencies. The
encoder is tested byte for byte against near-api-js' published vector and against transactions encoded
independently with `@near-js/transactions` 2.5.1.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/chains-near @clip-wallet/core
```

## Example

```ts
import type { ChainModule } from "@clip-wallet/core";
import { createNearModule, NEAR_TESTNET } from "@clip-wallet/chains-near";

// A wallet's background holds one module per family; it never gives the module a key.
const module: ChainModule = createNearModule();
console.log(module.family, module.derivationPath(0)); // "near" "m/44'/397'/0'"

const network = NEAR_TESTNET;
console.log(network.id, network.testnet); // a CAIP-2 id, true

// The flow: decode() → the person approves → prepare() → the vault signs → finalize().
```

## Documentation

- [Chain modules](https://coldai.org/clip/docs/architecture/chain-modules.html)
- [Write a chain module](https://coldai.org/clip/docs/extend/chain-module.html)
- [The NEAR guide for dapps](https://coldai.org/clip/docs/dapps/near.html)
- [API reference](https://coldai.org/clip/docs/reference/api/chains-near.html)

## Networks

| network | NetworkId | RPC (first is used) | FastNEAR API | explorer |
|---|---|---|---|---|
| testnet | `near:testnet` | `https://test.rpc.fastnear.com`, `https://rpc.testnet.near.org` | `https://test.api.fastnear.com` | testnet.nearblocks.io |
| mainnet | `near:mainnet` (testnet: false) | `https://free.rpc.fastnear.com`, `https://rpc.mainnet.near.org` | `https://api.fastnear.com` | nearblocks.io |

ChainAgnostic/namespaces has no `near` namespace yet. `near:<networkId>` is the chain id that WalletConnect uses for
NEAR (wallet-selector's wallet-connect module), so Clip Wallet uses it too. All endpoints answered `status` with the
expected `chain_id` and genesis hash when they were checked.

Assets: NEAR has the key `near` and 24 decimals. Circle's native USDC has the key `usdc` on mainnet
(`17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`) and on testnet
(`3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`). On both networks `ft_metadata` returns USDC
with 6 decimals. Every other NEP-141 token has the key `nep141:<contract>`.

## Accounts and keys

- `curve: "ed25519"`, `derivationPath(i) = m/44'/397'/i'` (SLIP-10, every level hardened). This is
  `near-seed-phrase`'s `KEY_DERIVATION_PATH` at index 0, which MyNearWallet, Meteor and near-cli use, and the vault
  uses the same path. The fixture key derived from "abandon … about" was cross-checked against
  `near-seed-phrase.parseSeedPhrase`. Ledger's NEAR app uses `44'/397'/0'/0'/1'` instead, so a Ledger account
  won't match.
- `addressFromPublicKey` returns the implicit account id: the lowercase hex of the 32-byte public key.
- `isAddress` accepts:
  - named accounts that follow the nomicon rules (2–64 characters, `[a-z0-9]` separated by `-`, `_` or `.`)
  - implicit accounts (64 hex characters)
  - ETH-implicit accounts (`0x` followed by 40 lowercase hex characters, NEP-518)

  All three can receive NEAR. Clip's own accounts are the implicit one plus any named accounts that hold this key.
- `networksForAddress`: `*.near` → mainnet, `*.testnet` → testnet, anything else → both.
- `listAccountIds(ctx)`: returns `[implicit, ...named]`, where the named accounts come from FastNEAR
  `GET /v0/public_key/ed25519:<b58>` (full-access keys), with duplicates removed. If FastNEAR is down, it returns just
  the implicit account.
- Every method works for whatever account is in `ctx.account.address`, so the coordinator can pass a named account
  there. A request's `signerId` can be any account where this key is an access key. decode and prepare check that
  with `view_access_key`:
  - no key on the account → `near/not-your-account` ("This NEAR account isn't controlled by this wallet's key.")
  - the account doesn't exist → `near/account-not-found`
  - a function-call key whose receiver, methods or deposit don't allow the transaction → `near/limited-key`

## Requests (`NEAR_METHODS`)

| method | params | result |
|---|---|---|
| `near_signAndSendTransaction` | `{ signerId?, receiverId, actions: NearActionJson[] }` | send_tx result (FinalExecutionOutcome JSON) |
| `near_signAndSendTransactions` | `{ transactions: { signerId?, receiverId, actions }[] }` | `FinalExecutionOutcome[]` (sent in order) |
| `near_signMessage` (NEP-413) | `{ message, recipient, nonce (32 bytes: base64 / number[] / Buffer JSON), callbackUrl?, state?, accountId? }` | `{ accountId, publicKey: "ed25519:<b58>", signature: <base64>, state? }` |
| `near_signTransaction` (WalletConnect) | `{ transaction: borsh Transaction bytes }` | borsh SignedTransaction bytes. Not sent. |
| `near_signTransactions` (WalletConnect) | `{ transactions: bytes[] }` | `bytes[]`. Not sent. |
| `near_signIn` (WalletConnect) | `{ permission: { receiverId, methodNames }, accounts: [{ accountId, publicKey }] }` | `null`. For each account, AddKey of a function-call key (allowance 0.25 NEAR, configurable) is sent. |
| `near_signOut` (WalletConnect) | `{ accounts: [{ accountId, publicKey }] }` | `null`. DeleteKey of each app key is sent. |

`signerId` defaults to `ctx.account.address`.

WalletConnect methods follow `@near-wallet-selector/wallet-connect` 10.1.4 (`WC_METHODS`) and the Reown NEAR RPC
reference:

- Byte params arrive as a Node Buffer JSON (`{type:"Buffer",data}`), as a JSON-serialised Uint8Array
  (`{"0":..}`, which is what wallet-selector's `tx.encode()` turns into) or as `number[]`.
- Results come back in the same shape: Buffer JSON for Buffer JSON input, otherwise `number[]`, which
  wallet-selector's `getSignatureData` accepts.
- Transactions must use this wallet's public key (otherwise `near/wrong-account`). Only TransactionV0 is read.
- wallet-selector currently disables `near_signMessage` over WalletConnect. If it arrives, it is handled the same
  way, plus its `accountId` param.
- `near_getAccounts` doesn't sign anything, so it's for the connector to answer, not this module.

`NearActionJson` accepts both shapes in use:

1. wallet-selector `InternalAction`: `{ type: "Transfer" | "FunctionCall" | "AddKey" | "DeleteKey" | "DeleteAccount" | "Stake" | "CreateAccount" | "DeployContract", params }`.
   For FunctionCall, `args` is an object (JSON-encoded) or bytes, or you can pass `argsBase64`. DeployContract
   takes `code` or `codeBase64`.
2. near-api-js / `@near-js/transactions` `Action` objects as JSON (`{ enum: "transfer", transfer: { deposit } }`,
   `functionCall`, `addKey` with `{ ed25519Key: { keyType, data } }` public keys, `fullAccess` / `functionCall`
   permissions, `deployGlobalContract`, `useGlobalContract`, …). Integers can be decimal strings, `"5n"` or safe
   numbers.

`signedDelegate` (relaying a meta transaction) and unknown kinds decode as **blind**. prepare refuses them with
`near/unsupported-action`.

### Transactions, prepare and finalize

- Borsh `TransactionV0` = signerId, publicKey (u8 0 + 32 bytes), nonce u64, receiverId, blockHash [32], actions.
- Action tags follow nearcore `Action`: CreateAccount 0, DeployContract 1, FunctionCall 2, Transfer 3, Stake 4,
  AddKey 5, DeleteKey 6, DeleteAccount 7, Delegate 8, DeployGlobalContract 9, UseGlobalContract 10. Tags 11 and up
  (DeterministicStateInit, gas keys, DelegateV2, …) decode as `Unknown`, which makes the request blind.
- SignedTransaction = tx || 0x00 || 64-byte signature.
- **prepare** reads the access-key nonce (`view_access_key`) and uses nonce + 1. In a batch, each signer's nonce
  goes up by one per transaction. It takes the latest final block hash, encodes the transactions and returns
  `sha256` of each.
- **The built bytes are cached by `request.id`** inside the module instance. `finalize` has no approval id, so it
  takes the transactions from the cache instead of rebuilding them, and the result can't drift. If the cache entry
  is missing, or was already used, finalize throws `near/not-prepared` and nothing is sent.
- **finalize** checks the signatures, then sends with `send_tx` (`wait_until: "EXECUTED_OPTIMISTIC"`). RPC errors
  become plain `ClipError`s (`plainNearError`: NotEnoughBalance, LackBalanceForState, InvalidNonce, Expired,
  AccountDoesNotExist, InvalidAccessKeyError, NotEnoughAllowance, FunctionCallError, timeouts).
- If an outcome comes back with `status.Failure`:
  - requests from the wallet itself (`origin: "clip-wallet"`) throw `near/tx-failed` in plain words
  - dapps get the outcome, like other NEAR wallets return it, and the rest of a batch isn't sent

### decode()

Titles and lines are in plain language. The fee is `estimated gas × gas_price`, shown in NEAR as an asset amount:
"about" for simple actions, "up to" when there are function calls (prepaid gas, and unused gas is refunded).

- Transfer → "Send 1.5 NEAR to bob.testnet". A named recipient that doesn't exist gets a caution `new-recipient`
  warning.
- NEP-141 `ft_transfer` / `ft_transfer_call` → "Send 2.5 USDC to bob.testnet", using `ft_metadata` (cached).
  `storage_deposit` → "Register bob with …", and it goes into "Also" when it sits next to a transfer. A USDC or NEAR
  look-alike gets a danger `known-scam` warning.
- NEP-171 `nft_transfer(_call)`, wNEAR `near_deposit` / `near_withdraw`.
- Staking pools (`*.poolv1.near`, `*.pool.near`, `*.pool.f863973.m0`): "Stake 50 NEAR with kiln", "Unstake 20 NEAR
  from kiln", "Withdraw your unstaked NEAR from kiln", with the line "Unstaked NEAR can be withdrawn after about 4
  epochs (roughly 1–2 days)". The pool contract has `NUM_EPOCHS_TO_UNLOCK = 4`, and an epoch is 43,200 blocks, which
  came to about 7 hours on mainnet when measured.
- Other calls → "Call add_message on guest-book.testnet" with pretty-printed JSON arguments (truncated), the
  attached deposit and gas. Arguments that aren't JSON → blind.
- Warnings:
  - AddKey FullAccess → danger `account-takeover`
  - AddKey function-call → lines for receiver, methods and fee allowance. No allowance limit → caution
    `unlimited-approval`.
  - DeleteKey of this wallet's own key → danger `account-takeover`
  - DeleteAccount → danger `account-closure` ("…sends everything left to <beneficiary>")
  - DeployContract / UseGlobalContract → danger `account-takeover` ("Replaces the code on your account")
  - Delegate / unknown → danger `blind-signing`
- `near_signMessage`:
  - title "Sign in to <recipient>" when the recipient is the requesting host (or a parent domain of it)
  - otherwise "Sign a message for <host>" with `domain-mismatch`: danger for a domain, caution when the recipient is
    a NEAR account id
  - lines show the message, recipient, account, nonce and callback URL
  - named accounts must hold this key as a full-access key (NEP-413)

## Balances, NFTs, staking

- `getBalances`:
  - NEAR is reported as **spendable**: `view_account.amount` minus what storage locks
    (`storage_usage × 1e19` yocto/byte, from `storage_amount_per_byte` in `EXPERIMENTAL_protocol_config`).
  - Accounts within the NEP-448 zero-balance limit (770 bytes or less) lock nothing.
  - Validator stake (`locked`) isn't counted. `getNearBalance(ctx)` gives `{ total, storageReserved, available, staked }`.
  - FTs come from FastNEAR `GET /v1/account/{id}/ft`. Zero balances and tokens whose `ft_metadata` can't be read
    are left out, and look-alikes are marked `spam`.
- `getNfts`:
  - Collections come from FastNEAR `GET /v1/account/{id}/nft`, tokens from `nft_tokens_for_owner` (NEP-181) and
    the collection name and `base_uri` from `nft_metadata` (NEP-177). Standard `"nep171"`.
  - `media` is resolved against `base_uri`. A bare CID with no `base_uri`, or an `ipfs://` URL, goes through the
    gateway. Only https/ar URLs are kept. `mediaUrl` is untrusted: render it through the sandboxed proxy.
  - Attributes come from `extra.attributes` when it's JSON.
- `staking`:
  - `getPositions(ctx)`: pools come from FastNEAR `GET /v1/account/{id}/staking` plus `options.stakingPools`. Each
    is read with the pool's `get_account` (staked, unstaked, can_withdraw). Unstaked NEAR goes in `withdrawable` if
    it can be withdrawn and in `unstaking` otherwise. Positions with only rounding dust are skipped.
  - `buildStake` → `deposit_and_stake` with deposit = amount. `buildUnstake` → `unstake {amount}`.
    `buildWithdraw` → `withdraw_all`; with an `amount`, `buildWithdraw` → `withdraw {amount}`, and without one
    `buildUnstake` → `unstake_all`. All of them use 125 Tgas (MyNearWallet's 5 × `STAKING_GAS_BASE` of 25 Tgas) and
    return a `near_signAndSendTransaction` DappRequest (`origin: "clip-wallet"`, `via: "injected"`) to the pool.
  - The validator must look like a pool (factory suffix) or be listed in `options.stakingPools`.
- `buildTransfer({ asset, to, amount, signerId? })`:
  - Native NEAR → a Transfer.
  - A NEP-141 token → `ft_transfer` (1 yocto, 30 Tgas). If `storage_balance_of(to)` is `null`, a `storage_deposit
    { account_id: to, registration_only: true }` paying `storage_balance_bounds.min` (0.00125 NEAR for testnet USDC)
    goes first in the same transaction.
  - Plain errors: bad address, self-transfer, amount, wrong network (`.testnet` on mainnet and vice versa),
    a named account that doesn't exist, not enough NEAR or tokens.

## Ref Finance swaps (`src/ref.ts`)

Helpers for wallet-built swaps on Ref Finance (now branded Rhea), used by `@clip-wallet/features` (`RefFinanceSwap`):

- `REF_CONTRACTS`: mainnet `v2.ref-finance.near`, testnet `ref-finance-101.testnet` (ref-sdk `src/constant.ts`; the
  exchange's `metadata` view on 2026-10-03: version 1.9.20 / 1.9.19, state `Running`, `wnear_id` `wrap.near` /
  `wrap.testnet`).
- `refSwapTransactions(plan, signerId)` builds, in order: `storage_deposit {account_id, registration_only: true}`
  with the output token when the account isn't registered, then one transaction to the input token:
  [`storage_deposit` with wrap.near if needed, `near_deposit` (10 Tgas, the amount) when selling NEAR], then
  `ft_transfer_call {receiver_id: <exchange>, amount, msg}` (1 yocto, 300 Tgas). `msg` is
  `{force: 0, actions: [{pool_id, token_in, token_out, amount_in?, min_amount_out}]}`, plus `skip_unwrap_near: false`
  when the output is native NEAR (the exchange unwraps and sends NEAR) or `true` when the output is the wNEAR token.
  This is the "instant swap" of ref-ui `src/services/swap.ts` (`swapFromServer`) and ref-sdk
  `src/v1-swap/instantSwap.ts`; the account doesn't need to be registered with the exchange.
- `checkRefRoute(actions, tokenIn, tokenOut, amountIn)` refuses a route unless every route starts with `tokenIn` and an
  `amount_in`, hops connect, every route ends in `tokenOut` with a positive `min_amount_out`, and the inputs add up to
  the amount. It returns the guaranteed output (sum of the routes' minimums). `refSwapTransactions` runs it too.
- decode(): an `ft_transfer_call` to this network's exchange whose message parses (`parseRefSwapMsg`) and passes
  `checkRefRoute` is described as "Swap 1 USDC for at least 1.194 NEAR" with lines "You get at least", "Exchange" and
  "Route", and balance changes −input / +minimum output (NEAR when it's unwrapped). Any other receiver keeps the
  plain "Send … to …" description. Wrapping NEAR next to another action now goes in "Also", like registration.
- Max prepaid gas per transaction is 1 PGas on both networks (`EXPERIMENTAL_protocol_config`
  `limit_config.max_total_prepaid_gas`, 2026-10-03), so wrap + swap (≤ 340 Tgas) fit in one transaction.

## Known gaps

- TransactionV1 (with nonce mode / gas keys) isn't decoded, and actions with tags 11 and up are blind. Building a
  Delegate (meta transaction) from JSON isn't supported.
- There's no simulation, because NEAR has no dry-run RPC. `simulated` is always false, and the fee is an upper-bound
  estimate.
- Prepared transactions live in memory in the module instance. If the background restarts between prepare and
  finalize, the request has to be approved again.
- The look-alike check covers USDC and NEAR/wNEAR only. There's no external token list.
- Ledger's NEAR derivation path isn't supported.

## Sources

- NEP-413 signMessage: https://github.com/near/NEPs/blob/master/neps/nep-0413.md
- NEP-448 zero-balance accounts: https://github.com/near/NEPs/blob/master/neps/nep-0448.md
- NEP-518 ETH-implicit accounts: https://github.com/near/NEPs/blob/master/neps/nep-0518.md
- NEP-141 / NEP-145 / NEP-148 (FT, storage, metadata), NEP-171 / NEP-177 / NEP-181 (NFT): https://nomicon.io/Standards
- Account id rules: https://nomicon.io/DataStructures/Account
- nearcore `Action` enum: https://github.com/near/nearcore/blob/master/core/primitives/src/action/mod.rs
- nearcore `TransactionV0` / `V1`: https://github.com/near/nearcore/blob/master/core/primitives/src/transaction.rs
- nearcore `AccessKeyPermission`: https://github.com/near/nearcore/blob/master/core/primitives-core/src/account.rs
- nearcore zero-balance limit (770): https://github.com/near/nearcore/blob/master/runtime/runtime/src/verifier.rs
- @near-js/transactions 2.5.1 borsh SCHEMA (npm `@near-js/transactions`): https://github.com/near/near-api-js
- near-api-js test vectors (signed transfer hex, NEP-413 hash and signatures): https://github.com/near/near-api-js/blob/master/test/unit/signers/key_pair_signer.test.ts
- wallet-selector core types and NEP-413 payload: https://github.com/near/wallet-selector/tree/main/packages/core/src/lib
- wallet-selector WalletConnect module (WC_METHODS, params): https://github.com/near/wallet-selector/tree/main/packages/wallet-connect
- Reown NEAR RPC reference: https://docs.reown.com/advanced/multichain/rpc-reference/near-rpc
- NEAR RPC `send_tx` / `wait_until`: https://docs.near.org/api/rpc/transactions
- RPC providers: https://docs.near.org/api/rpc/providers
- FastNEAR API: https://github.com/fastnear/fastnear-api-server-rs
- Staking pool contract (methods, NUM_EPOCHS_TO_UNLOCK): https://github.com/near/core-contracts/blob/master/staking-pool/src/lib.rs
- Ref Finance contracts and instant swap: https://github.com/ref-finance/ref-sdk (src/constant.ts, src/v1-swap/instantSwap.ts) and https://github.com/ref-finance/ref-ui (src/services/swap.ts, smartRouterFromServer.ts)
- MyNearWallet staking gas and access-key allowance: https://github.com/mynearwallet/my-near-wallet/blob/master/packages/frontend/src/config/environmentDefaults/mainnet.ts
- near-seed-phrase derivation path: https://www.npmjs.com/package/near-seed-phrase
- Circle USDC addresses: https://developers.circle.com/stablecoins/usdc-contract-addresses
- ChainAgnostic namespaces (no `near` entry): https://github.com/ChainAgnostic/namespaces

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

Apache-2.0: see [LICENSE](./LICENSE) and [NOTICE](./NOTICE). "Clip Wallet" and "1Mask" are ColdAI trademarks (not licensed).
