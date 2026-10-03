# @clip-wallet/chains-hedera

Hedera `ChainModule` for Clip Wallet. Builds and decodes; never touches keys. `prepare()` returns
`SignablePayload`s for the vault, `finalize()` puts the signatures back and submits.

Built on `@hiero-ledger/sdk` (the current Hiero SDK; `@hashgraph/sdk` is the legacy name, last released
before the move, and `@hashgraph/hedera-wallet-connect` 2.x already peer-depends on `@hiero-ledger/sdk`) and
the mirror node REST API.

## Networks

| id (CAIP-2) | mirror node | explorer |
|---|---|---|
| `hedera:testnet` | https://testnet.mirrornode.hedera.com | https://hashscan.io/testnet |
| `hedera:previewnet` | https://previewnet.mirrornode.hedera.com | https://hashscan.io/previewnet |
| `hedera:mainnet` | https://mainnet-public.mirrornode.hedera.com | https://hashscan.io/mainnet |

Ids match `LEDGER_ID_MAPPINGS` in hedera-wallet-connect. Asset keys: HBAR = `hbar`; Circle's native USDC
(`0.0.456858` mainnet, `0.0.429274` testnet) = `usdc`; other tokens `hts:<tokenId>`.

**Hedera EVM is not here.** `eth_*` requests on `eip155:295` / `eip155:296` / `eip155:297` (JSON-RPC relay) go
through `@clip-wallet/chains-evm`. The key is the same, so the 0x address is the same.

## Accounts: ECDSA keys, EVM alias, auto-creation

Clip Wallet uses ECDSA secp256k1 keys (path `m/44'/60'/0'/0/i`, as the Hedera SDK and HashPack do for ECDSA;
the vault owns derivation). Until an account id exists, the account *is* its EVM alias:

```ts
import { aliasAddress } from "@clip-wallet/chains-hedera";
aliasAddress(compressedPublicKeyHex); // "0x…" = last 20 bytes of keccak256(uncompressed key)
```

There's no "create account" step. The first time someone sends HBAR (or a token) to that 0x address, the network
creates the account (HIP-583 lazy create) with the ECDSA key and the alias. After that,
`GET /api/v1/accounts/{alias}` on the mirror node returns its `0.0.x` id, which the module looks up when
`account.hederaAccountId` is not set. Before that, balances show 0 HBAR, and anything that needs a payer fails with
"Your Hedera account opens when it first receives HBAR."

## Balances and NFTs

- `getBalances`: HBAR, plus every associated fungible HTS token (zero balances included, because "added to your
  account" is visible state on Hedera). Symbol, name and decimals come from `/api/v1/tokens/{id}`.
- `getNfts`: `/api/v1/accounts/{id}/nfts`. The metadata URI is resolved as HIP-412 JSON (ipfs:// through a
  configurable gateway, or https). `mediaUrl` is untrusted: render it only through the sandboxed media proxy.
  Other schemes (data:, javascript:, hcs://) are ignored.
- `getAccountState`: associations, auto-association slots (`-1` = unlimited, HIP-904), used and free slots,
  staking (node/account, declineReward, pending reward).

## Dapp requests (Hedera WalletConnect, HIP-820 / hedera-wallet-connect 2.1.3)

| method | params | result |
|---|---|---|
| `hedera_signAndExecuteTransaction` | `{ signerAccountId, transactionList }` | `TransactionResponseJSON` |
| `hedera_executeTransaction` | `{ transactionList }` (already signed) | `TransactionResponseJSON` |
| `hedera_signTransaction` | `{ signerAccountId, transactionBody }` (base64 `TransactionBody`) | `{ signatureMap }` |
| `hedera_signMessage` | `{ signerAccountId, message }` | `{ signatureMap }` |
| `hedera_signAndExecuteQuery` | `{ signerAccountId, query }` | decoded only, see gaps |
| `hedera_getNodeAddresses` | none | `{ nodes }` |

`signerAccountId` is CAIP-10 (`hedera:testnet:0.0.123`). A network or account mismatch is refused.

`decode()` parses with `Transaction.fromBytes` and describes, in plain words:
TransferTransaction (HBAR / token / NFT, approved-allowance legs, hooks), TokenAssociate / Dissociate,
AccountAllowanceApprove (unlimited or above supply → `unlimited-approval` danger; NFT all-serials →
`approval-for-all` danger), AccountAllowanceDelete, ContractExecute (bundled selector table, ERC-20/721 args
decoded when the contract is an HTS token; unknown selector → blind), AccountUpdate (staking, rewards, token slots,
memo; key change or hooks → blind + danger), ScheduleCreate (inner transaction), ScheduleSign (inner transaction
read from `/api/v1/schedules/{id}`), TopicMessageSubmit, AccountDelete (blind). Anything else → blind.

**SaucerSwap** (`src/saucerswap.ts`): calls to the documented routers (testnet V1 `0.0.19264`, V2 `0.0.1414040`;
mainnet V1 `0.0.3045981`, V2 `0.0.3949434`) are decoded with amounts: "Swap 100 HBAR for at least 25 SAUCE on
SaucerSwap", "Swap up to 9 SAUCE for 2 HBAR on SaucerSwap". V1 = the Uniswap V2 router ABI with "ETH" meaning HBAR
(payable amount); V2 = the original Uniswap V3 SwapRouter shapes **with `deadline`** (`exactInput(Single)`,
`exactOutput(Single)`), plus the SaucerSwap app's `multicall([swap, refundETH()])` and
`multicall([swap → router, unwrapWHBAR(min, recipient)])`. WHBAR is shown as HBAR; multi-hop routes get a
"Route: USDC → HBAR → SAUCE" line. If the final recipient isn't you → `new-recipient` danger. Any other
multicall content falls back to the selector table. Sources: deployments
<https://docs.saucerswap.finance/developerx/contract-deployments>, ABIs from
`saucerswaplabs/saucerswap-periphery` (IUniswapV2Router01/02.sol) and `saucerswaplabs/saucerswaplabs-v2-periphery`
(ISwapRouter.sol, IPeripheryPayments.sol); tests encode calls with viem from those ABIs. The selector table also
gained the V2 (with-deadline) signatures; the earlier `exactInput((bytes,address,uint256,uint256))` entries are
SwapRouter02 shapes that SaucerSwap does not use.

The fee is the transaction's max fee in HBAR ("Network fee: up to 2 HBAR"). It's only shown when this account
pays. For token transfers the recipient's association and free auto-association slots are checked. If the token
can't land, it says: "0.0.1234 hasn't added the SAUCE token yet, so this transfer will fail and the fee is still
charged." `hedera_signTransaction` carries a `network-matters` caution: the dapp submits it, and Hedera signatures
aren't bound to one network.

Unfrozen transactions (HIP-745) are frozen once by the module (payer = the signer, nodes from the SDK's built-in
list) and cached per request id, so decode, prepare and finalize all see the same bytes.

## Signing

A frozen transaction holds one `SignedTransaction` per node. Each one has its own `bodyBytes`, which differ in
`nodeAccountID`. Hedera ECDSA signs **keccak256(bodyBytes)** and stores the 64-byte r‖s under
`ECDSA_secp256k1` in that body's SignatureMap, keyed by the compressed public key. So:

- `prepare()` returns one `SignablePayload` per node body: `scheme: "ecdsa-secp256k1"`, `bytes` = the 32-byte
  digest. Bodies are collected with the SDK's `signWith` on a throwaway copy, so no key is involved.
- `finalize()` checks every signature against its body (order doesn't matter, and a wrong key is refused before
  anything is sent). It attaches them with `signWith`, then submits through the SDK client. For
  `hedera_signTransaction` / `hedera_signMessage` it returns the base64 `proto.SignatureMap` instead.
  Messages are prefixed exactly like hedera-wallet-connect: `"\x19Hedera Signed Message:\n" + length + message`.

Submission is injectable: `createHederaModule({ submit })`. By default it uses `Client.forName(ledger)`.

## Builders

All of them return a `DappRequest` that goes through the normal approval path:

- `buildTransfer({ asset, to, amount })`: HBAR, or an HTS token with `addTokenTransferWithDecimals`. `to` can be
  `0.0.x` (checksum ok) or `0x…`. An unknown 0x address uses the alias, so the account gets created on arrival.
- `buildNftTransfer`, `buildAssociate(tokenId | tokenIds)`, `buildDissociate`
- `buildStakeUpdate({ nodeId } | { accountId } | { stop: true }, ctx, declineReward?)`
- `buildScheduleSign(scheduleId)`
- `buildAtomicSwap({ give, get, counterparty, schedule? })` for Secure Trade: one TransferTransaction holds both
  legs, so both happen or neither does.
  1. **Direct**: returns the internal method `clip_hedera_signTransactionBytes` (1Mask must never expose it to
     dapps). After approval, `finalize` returns `{ transactionList }`, signed by us and not submitted. Send it to
     the counterparty. Their wallet decodes it ("Trade 5 SAUCE for 10 HBAR with 0.0.1001"), adds their signature
     via `hedera_signAndExecuteTransaction`, and submits. Valid for 180 s.
  2. **Scheduled** (`schedule: { expiresAt?, memo? }`): a ScheduleCreate wrapping the transfer. Our signature on the
     create counts toward the inner transfer. The counterparty approves later with `buildScheduleSign(id)`, and
     their wallet reads the inner transfer from the mirror node. The network runs it as soon as the last signature
     arrives. `expiresAt` needs long-term schedules (HIP-423).

## Tests

`pnpm test`: transaction fixtures are built with the SDK inside the tests, the mirror node is mocked, and an
ephemeral random secp256k1 key stands in for the vault. `LIVE=1 pnpm test` adds a read-only testnet mirror check.
No funds needed.

## Gaps

- `hedera_signAndExecuteQuery`: decoded, but `prepare` refuses. Since AccountBalanceQuery was removed, all
  queries need a payment transaction signed inside the SDK's execute loop, which doesn't fit prepare/finalize yet.
- No pre-execution simulation (Hedera has no dry run for native transactions). Contract calls could use the mirror
  node's `/api/v1/contracts/call` later.
- ContractExecute args are decoded for ERC-20/721-style calls and SaucerSwap swaps. Other DEXes and SaucerSwap
  liquidity calls show the function only. Balance changes for exact-out swaps use the maximum input.
- `decode` reads private SDK fields for token/NFT transfer legs (`_tokenTransfers`, `_nftTransfers`, needed for
  `isApproved`/hooks) and for the scheduled inner transaction (`_scheduledTransaction`, `_expirationTime`).
  Re-check them when bumping the SDK.
