# @clip-wallet/chains-hedera

Hedera `ChainModule` for Clip Wallet. Builds and decodes; never touches keys. `prepare()` returns
`SignablePayload`s for the vault, `finalize()` puts the signatures back and submits.

No Hedera SDK at runtime: a small hand-written protobuf codec for the HAPI messages the wallet reads and builds
(`src/proto/`), gRPC-Web submission straight to the consensus nodes' proxies (`src/submit.ts`), and the mirror node
REST API. `@hiero-ledger/sdk` and `@hiero-ledger/proto` are devDependencies only: the tests use them to prove that
every transaction this package builds is byte-identical to the SDK's (see "Protobuf codec" below). This removed
about 2.3 MB from the extension's background script and the SDK's React Native build quirks from mobile.

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

`decode()` parses the TransactionList with the codec and describes, in plain words:
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

Unfrozen transactions (HIP-745) are frozen once by the module (payer = the signer, a transaction id with the
SDK's 3–8 s backdating, 5 random nodes of the network, the type's default max fee if none is set; every other
body field kept byte-for-byte) and cached per request id, so decode, prepare and finalize all see the same bytes.

## Signing

A frozen transaction holds one `SignedTransaction` per node. Each one has its own `bodyBytes`, which differ in
`nodeAccountID`. Hedera ECDSA signs **keccak256(bodyBytes)** and stores the 64-byte r‖s under
`ECDSA_secp256k1` in that body's SignatureMap, keyed by the compressed public key. So:

- `prepare()` returns one `SignablePayload` per node body: `scheme: "ecdsa-secp256k1"`, `bytes` = the 32-byte
  digest. If the key already signed (its compressed key is a `pubKeyPrefix` in a SignatureMap), there's nothing
  to sign, like the SDK's `signWith`.
- `finalize()` checks every signature against its body with `@noble/curves` (order doesn't matter, and a wrong
  key is refused before anything is sent), appends a `SignaturePair { pubKeyPrefix, ECDSA_secp256k1 }` to each
  body's SignatureMap and submits. For `hedera_signTransaction` / `hedera_signMessage` it returns the base64
  `SignatureMap` instead. Messages are prefixed exactly like hedera-wallet-connect:
  `"\x19Hedera Signed Message:\n" + length + message`.

### Submitting (gRPC-Web, no SDK)

Native Hedera transactions only go in through HAPI on the consensus nodes; the JSON-RPC relay (Hashio) takes
EVM transactions only, and the mirror node is read-only. The nodes sit behind gRPC-Web proxies (Envoy) that the
SDK's own browser client uses. A unary gRPC-Web call is a single `fetch`, so `submitTransaction`
(`src/submit.ts`) does it directly:

- `POST https://<proxy>/proto.<Service>/<rpc>` with `content-type: application/grpc-web+proto` and
  `x-grpc-web: 1`; body = one frame (`0x00`, 4-byte big-endian length, `Transaction { signedTransactionBytes = 5 }`).
  Service and rpc per transaction type come from `services/*_service.proto` (e.g. `CryptoService/cryptoTransfer`,
  `TokenService/associateTokens`, `SmartContractService/contractCallMethod`, `ScheduleService/createSchedule`).
- The response is a data frame (`TransactionResponse { nodeTransactionPrecheckCode = 1 }`) plus a trailer frame
  (`grpc-status`). `OK` → `{ nodeId, transactionHash: hex(sha384(signedTransactionBytes)), transactionId }`, the
  SDK's `TransactionResponse.toJSON()`. `BUSY`, `PLATFORM_TRANSACTION_NOT_CREATED`, `PLATFORM_NOT_ACTIVE`,
  `UNKNOWN`, `INVALID_NODE_ACCOUNT` and network errors try the next node of the transaction (same retry set as
  the SDK); any other precheck code is a plain-language `ClipError`.
- Proxies (`GRPC_WEB_NODES` in `src/networks.ts`): the SDK's browser address book (hiero-sdk-js v2.89.1,
  `src/constants/ClientConstants.js`). The mirror node's `/api/v1/network/nodes` has a `grpc_proxy_endpoint`
  field (HIP-1046) but it is null on every network today, so the list is static. They answer CORS, so the
  extension needs no host permission.
- `LIVE=1 pnpm test` sends an *unsigned* transfer to three testnet nodes; each refuses it at precheck with
  `INVALID_SIGNATURE` (nothing can execute, no fee), which proves the request, framing and decoding end to end.

Submission is injectable: `createHederaModule({ submit })`, `submit(signedTransactionList, ledger, ctx)`. The
default posts through `ctx.fetch`, so it works the same in the extension's service worker, pages and React
Native.

## Builders

All of them return a `DappRequest` that goes through the normal approval path. They are frozen for 5 random nodes
(each is one more digest for the vault to sign, and the spares are submit retries):

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

Lean helpers for other packages (no SDK needed): `TransferDraft`, `associateDraft`, `contractCallDraft`,
`tokenAllowanceDraft`, `hbarAllowanceDraft`, then `freezeNew(draft, payer, ctx)` → TransactionList bytes →
`requestFor(bytes, payer, ctx)`. `freezeNew` still accepts an unfrozen Hiero SDK transaction (read through its own
`toBytes()`), so existing callers keep compiling; `parseTransaction(bytes)` + `transactionIdString(...)` replace
`Transaction.fromBytes(...).transactionId`.

## Protobuf codec

`src/proto/wire.ts` is the protobuf wire format (varint, zigzag, length-delimited, packed). `src/proto/hapi.ts`
encodes/decodes exactly these messages, with field numbers from
[hashgraph/hedera-protobufs **v0.77.2**](https://github.com/hashgraph/hedera-protobufs/tree/v0.77.2):

| file | messages |
|---|---|
| `sdk/transaction_list.proto` | TransactionList |
| `services/transaction.proto` | Transaction, TransactionBody (header fields 1–6 and every `data` case number) |
| `services/transaction_contents.proto` | SignedTransaction |
| `services/basic_types.proto` | AccountID, TokenID, ContractID, ScheduleID, TopicID, TransactionID, AccountAmount, TransferList, NftTransfer, TokenTransferList, Key (presence only), SignaturePair, SignatureMap |
| `services/timestamp.proto`, `services/duration.proto` | Timestamp, Duration |
| `services/crypto_transfer.proto` | CryptoTransferTransactionBody (HBAR/token/NFT legs, `is_approval`, expected decimals, hook presence) |
| `services/token_associate.proto`, `services/token_dissociate.proto` | Token(Dis)associateTransactionBody |
| `services/crypto_approve_allowance.proto`, `services/crypto_delete_allowance.proto` | CryptoApproveAllowance (Crypto/Token/NftAllowance), CryptoDeleteAllowance |
| `services/crypto_update.proto` | CryptoUpdateTransactionBody (staking, decline_reward, memo, auto-association slots, key/hook/delegation presence) |
| `services/contract_call.proto` | ContractCallTransactionBody (gas, amount, functionParameters) |
| `services/schedulable_transaction_body.proto`, `services/schedule_create.proto`, `services/schedule_sign.proto` | SchedulableTransactionBody (every case number), ScheduleCreate, ScheduleSign |
| `services/consensus_submit_message.proto`, `services/crypto_delete.proto` | ConsensusSubmitMessage, CryptoDelete (read only) |
| `services/transaction_response.proto`, `services/response_code.proto`, `services/query.proto` | TransactionResponse, the precheck codes we act on, Query case names |

Writers follow protobufjs' generated encoders, which the SDK uses: ascending field numbers, and a field is written
whenever it is set, even to 0/false/"" (e.g. `TransactionID.scheduled = false`, `memo = ""`, an empty `TransferList`).
Unknown fields are skipped when reading; when the wallet freezes a dapp's unfrozen body it only adds header
fields 1–4 and keeps the rest as received.

## Tests

`pnpm test`: transaction fixtures are built with the SDK inside the tests (devDependency), the mirror node is
mocked, and precomputed signatures stand in for the vault. `test/codec.test.ts` cross-checks the codec against
the SDK:

- every builder (HBAR to 0.0.x and to a new EVM alias, HTS with decimals, NFT, (dis)associate, stake to node /
  account / stop / decline, Secure Trade direct with HBAR/token/NFT legs, Secure Trade scheduled with memo and
  expiry, ScheduleSign) and every draft (contract call with/without payable, token and HBAR allowances) is
  rebuilt with the SDK for the same transaction id and nodes and must be **byte-identical**;
- HIP-745 freezing of an unfrozen SDK transaction equals the SDK's `freeze()`;
- signing: attaching fixture signatures equals the SDK's `signWith` bytes, for one and for two signers;
- reading: header, transfer, allowance, contract, account-update and schedule fields equal the SDK's decoding,
  re-encoding a frozen list is the identity, and every TransactionBody / SchedulableTransactionBody / Query case
  number and every gRPC service/rpc name matches the generated `@hiero-ledger/proto` code;
- HIP-15 checksums and EVM aliases equal the SDK's on mainnet/testnet/previewnet;
- gRPC-Web: request URL, headers and frame equal the SDK's WebChannel, BUSY moves to the next node, and the
  response's `transactionHash` equals the SDK's `getTransactionHashPerNode()`;
- a guard that nothing under `src/` imports `@hiero-ledger/*` or `@hashgraph/*`.

`LIVE=1 pnpm test` adds a read-only testnet mirror check and the unsigned gRPC-Web precheck probe. No funds needed.

## Gaps

- `hedera_signAndExecuteQuery`: decoded, but `prepare` refuses. Since AccountBalanceQuery was removed, all
  queries need a payment transaction signed inside the SDK's execute loop, which doesn't fit prepare/finalize yet.
- No pre-execution simulation (Hedera has no dry run for native transactions). Contract calls could use the mirror
  node's `/api/v1/contracts/call` later.
- ContractExecute args are decoded for ERC-20/721-style calls and SaucerSwap swaps. Other DEXes and SaucerSwap
  liquidity calls show the function only. Balance changes for exact-out swaps use the maximum input.
- The codec covers the messages above. A dapp transaction of another type is still shown (blind, with its type
  name) and can still be signed and submitted, but nothing inside it is read.
- When hedera-protobufs adds fields to the messages we build, re-run the codec tests against a newer SDK; new
  `data` cases need a line in `BODY_NAMES` / `SCHEDULABLE_TO_BODY` (hapi.ts) and, to submit, in `RPC` (submit.ts).
- The gRPC-Web proxy list is static (see above). If a proxy moves, that node is skipped and the next one is tried.
