# @clip-wallet/chains-tezos

Tezos `ChainModule` for Clip Wallet. It builds, simulates, decodes and broadcasts. It never touches keys:
`prepare()` returns the 32 bytes the vault signs with ed25519, and `finalize()` checks the signature, assembles
and injects.

Forging is local with `@taquito/local-forging` 25 (protocol `PsUshuai9…`, active on mainnet and shadownet in
Oct 2026). Five forge results (XTZ send, reveal + send, FA2 transfer, delegation, stake) were checked byte for byte
against the node's `POST …/helpers/forge/operations` on shadownet and are kept as test vectors. No Taquito signer
packages are used. Base58check, blake2b and address maths come from `@scure/base` / `@noble/hashes`.

## Accounts

- Curve ed25519 (tz1). `derivationPath(i)` = `m/44'/1729'/i'/0'` (SLIP-44 coin type 1729, all hardened). Temple
  uses this path (`getDerivationPath` in templewallet-extension). Kukai and Umami default to the same template.
- `addressFromPublicKey`: tz1 = b58check(`06a19f` ‖ blake2b-160(pubkey)). `encodePublicKey(pub)` returns `edpk…`.
- Vector: the public "abandon … about" BIP-39 account at `m/44'/1729'/0'/0'` is
  `tz1VQA4RP4fLjEEMW2FR4pE9kAg5abb5h5GL` / `edpku4US3ZykcZifjzSGFCmFr3zRgCKndE82estE4irj4d5oqDNDvf`. That is also the
  WalletConnect `tezos_getAccounts` example.
- `isAddress` accepts tz1, tz2, tz3, tz4 and KT1 with a valid checksum. Destinations may be KT1.

## Networks

| network | NetworkId (CAIP-2) | RPC | indexer | explorer |
|---|---|---|---|---|
| Shadownet (testnet) | `tezos:NetXsqzbfFenSTS` | rpc.shadownet.teztnets.com, rpc.tzkt.io/shadownet | api.shadownet.tzkt.io | shadownet.tzkt.io |
| Mainnet | `tezos:NetXdQprcVkpaWU` | rpc.tzbeta.net, rpc.tzkt.io/mainnet | api.tzkt.io | tzkt.io |

- CAIP-2 reference = the full base58 chain id (`Net…`, 15 characters), per the ChainAgnostic tezos namespace.
  Each id was checked with `GET /chains/main/chain_id`.
- **Ghostnet is retired.** It's gone from teztnets.json, and its RPC and TzKT API no longer answer. teztnets.com
  points app testing to Shadownet. Protocol testnets such as ushuaianet are short-lived and not listed.
  `fromChainId` also accepts `tezos:mainnet` / `tezos:shadownet`, which some WalletConnect dapps send.
- Beacon: `beaconNetworkType(id)` → `"mainnet" | "shadownet"`. `fromBeaconNetwork({ type, rpcUrl? })` maps
  mainnet/shadownet, plus `custom` when the rpcUrl is one of ours. Ghostnet maps to `undefined`.
- Assets: XTZ key `xtz`, 6 decimals (mutez). Circle has no USDC on Tezos L1, so there is no `usdc` key. Tether's own
  USDt (FA2 `KT1XnTn74bUtxHfDtBmm2bGZAQfhPbvKWR8o`, token 0) uses `usdt`, the same key chains-evm uses. Every other
  token is `fa:<KT1>:<tokenId>` (FA1.2 tokens use id 0).

## Methods (`TEZOS_METHODS`)

| method | params | result |
|---|---|---|
| `tezos_getAccounts` | `{}` | `[{ algo: "ed25519", address: "tz1…", pubkey: "edpk…" }]` (also `accountsResult(account)`). No signature: `prepare` returns `[]`. |
| `tezos_send` | `{ account?: string, operations: PartialTezosOperation[] }` | `{ operationHash: "o…" }` (Beacon calls it `transactionHash`) |
| `tezos_sign` | `{ account?: string, payload: string /*hex*/, signingType?: "raw" \| "operation" \| "micheline" }` | `{ signature: "edsig…" }` |

`account` (or Beacon's `sourceAddress`) must be the connected account. Operations use Beacon / WalletConnect
operation JSON. Each one is checked first: its kind, `source` (if given, it must be you), the destination address,
and that amounts are numbers.

### tezos_send: how the operation is built

1. Supported operation kinds, all forgeable locally: `transaction`, `delegation`, `origination`, `reveal`. Also
   accepted but shown blind: `register_global_constant`, `increase_paid_storage`, `transfer_ticket`,
   `set_deposits_limit`, `update_consensus_key`, `update_companion_key`, `smart_rollup_originate`,
   `smart_rollup_add_messages`, `smart_rollup_execute_outbox_message`, `dal_publish_commitment`. Anything else (for
   example consensus operations or ballots) is refused.
2. **Reveal.** If `…/contracts/{addr}/manager_key` is `null`, a reveal of your `edpk` is added at the start of the batch. The
   approval says: "First transaction from this account: it also publishes your account's public key (a one-time
   step)." A dapp-supplied reveal is dropped when the account is already revealed.
3. The builder fills in `source`, the counter (`…/counter` + 1 per operation) and the branch (`head~2` hash).
4. **Simulation.** It calls `POST /chains/main/blocks/head/helpers/scripts/simulate_operation` with
   `{ operation: { branch, contents, signature: <zero sig> }, chain_id }`, fee 0, gas ⌊1 040 000 / n⌋ per operation
   (the block limit is 1 040 000 on both networks) and storage 60 000. Results, internal operations included:
   - gas_limit = ⌈milligas / 1000⌉ + 100
   - storage_limit = paid_storage_size_diff + 257 per allocated account or originated contract, + 20 when above 0
5. **Fee** (octez minimal fee, defaults confirmed with `GET /chains/main/mempool/filter`):
   100 mutez + 1 mutez/byte + 0.1 mutez/gas per operation. Each operation pays for its own bytes, and the first also
   pays for the branch and signature. The size depends on the fee, so this repeats until the numbers stop changing.
   A fee or limit from the dapp is kept when it's higher.
6. The operation is forged locally, with a parse round-trip check.

**Determinism.** `decode()` builds the operation and caches it by `request.id`. `prepare()` signs exactly that build
if it is less than `reuseMs` old (default 120 s) and records the approvalId. Otherwise it rebuilds first.
`finalize()` uses the prepared build: `forged ‖ sig64` goes to `POST /injection/operation?chain=main` as a JSON hex
string, and the result is `{ operationHash }`, the node's answer or b58check(`o`, blake2b(signed)). If finalize has
no prepared build, it fails with a plain `tezos/expired` error. The cache lives in the module instance, so use one
instance per wallet.

**What the vault signs.** `bytes = blake2b-256(0x03 ‖ forged)`, with 0x03 as the generic-operation watermark
(octez key-management docs). The signature is plain ed25519 over those 32 bytes.

**Simulation failures.** `decode()` returns a `simulation-failed` danger with a plain message, and `prepare()` throws
`ClipError(…, "tezos/simulation-failed")`. Injection errors become `tezos/send-failed`. The mapped error ids are
`script_rejected` (it quotes the FAILWITH string), `empty_implicit_contract`, `balance_too_low` /
`subtraction_underflow`, `cannot_pay_storage_fee`, counter in the past/future, gas/storage exhausted or too high,
unregistered delegate, delegate unchanged, stake without delegate, baker refusing external staking, bad
parameter / no such entrypoint, non-existing contract, fee too low, invalid signature, and outdated branch. The
captured shadownet responses are in `test/sim-fixtures.ts`.

### decode() titles

- Plain transaction: "Send 5 XTZ to tz1c…ioGP". To a KT1, the TzKT alias is used when there is one.
- FA2 `transfer` (TZIP-12 Micheline list): "Send 3 USDt to …", with symbol and decimals from TzKT `/v1/tokens`. A
  transfer from someone else's account shows as "Move … from A to B".
- FA1.2 `transfer` (TZIP-7 `Pair from (Pair to value)`): same as FA2.
- FA1.2 `approve`: `unlimited-approval` is **danger** when the amount is ≥ 2^128 or ≥ total supply ("Let X spend all
  your …"), **caution** otherwise. Approve 0 shows as removing the permission.
- FA2 `update_operators`: `add_operator` is a **danger** `approval-for-all` ("Lets <operator> move your
  <collection> tokens…"). `remove_operator` is described.
- Any other entrypoint: "Call <entrypoint> on <alias or KT1…>", with the amount and a shortened, readable
  parameter preview. Michelson addresses in bytes form are decoded.
- Staking pseudo-operations (a transaction to yourself with entrypoint `stake` / `unstake` / `finalize_unstake`):
  "Stake 50 XTZ with <baker>", "Unstake 20 XTZ from <baker>", "Withdraw your unstaked XTZ". A delegation +
  stake batch is titled as the stake.
- Delegation: "Delegate to <TzKT alias>" or "Stop delegating".
- Origination: "Create a smart contract (with X XTZ)", with a caution that the code is unchecked.
- Other operation kinds are `blind: true`, with a danger `blind-signing` warning.
- Fees: a "Network fee" line in XTZ, plus "Storage: up to X XTZ" (storage_limit × 250 mutez). `fee.amount` is baker
  fees + maximum storage burn. A fee above 1 XTZ adds a `high-fee` caution.
- `balanceChanges`: XTZ sent to others and origination balances, plus FA tokens moving out of or into your account.
  The fee is kept separate, and staking moves aren't counted as a loss.

### tezos_sign

Beacon and TZIP-10 hash the payload bytes with blake2b-256 and sign that with ed25519. The prepared payload is
`blake2b-256(payloadBytes)`, and the result is `edsig…`. The payload is hex. A `raw` payload that isn't hex is
signed as its UTF-8 bytes.

- **micheline** (it must start with 05): a packed string (`05 01 <u32 length> <utf8>`, Beacon's and Taquito's sign-in
  form) is shown as text. "Tezos Signed Message: <dapp url> <time> <statement>" shows as "Sign in to <host>". If that
  host, or any URL in the text, isn't the requesting origin, there is a `domain-mismatch` danger. Packed data that
  isn't a string (for example a TZIP-17 permit) is blind, with `permit` + `blind-signing` dangers.
- **operation** (it must start with 03): it is parsed with local-forging and refused if unreadable, or if any
  `source` isn't you. A readable operation is described (title "Sign an operation for <host>: …"), but it is always
  `blind: true` with a danger `blind-signing` warning. The dapp gets an operation it can inject whenever it wants,
  with a fee and counter Clip Wallet didn't choose and couldn't simulate. With blind signing off by default, this
  is blocked unless the user turns blind signing on.
- **raw**: a 03 or 05 prefix is handled as above. Printable text is shown with a caution. Binary is blind (danger).

## Balances and NFTs (TzKT)

- XTZ: `/v1/accounts/{addr}`. TzKT's `balance` is the full balance, so spendable XTZ = `balance − stakedBalance −
  unstakedBalance`. Staked XTZ shows up in staking positions.
- Tokens: `/v1/tokens/balances?account=…&balance.gt=0` (FA1.2 + FA2), with symbol, name and decimals from TZIP-21
  metadata. A token is an NFT if it has `isBooleanAmount`, or decimals 0 with `artifactUri`/`displayUri`. NFTs go
  to `getNfts`.
- Spam: no metadata; a protected symbol (XTZ, USDt, USDC, tzBTC, ETH, BTC, …) on a contract that isn't the
  issuer's own; 0/1 look-alikes; URLs or claim/airdrop text in the name or symbol.
- NFTs: `standard: "fa2"`. The collection is the contract (with the TzKT alias as name), plus the token id and
  name. `mediaUrl` comes from displayUri → artifactUri → thumbnailUri. ipfs:// goes through the gateway (option
  `ipfsGateway`, default ipfs.io), and only https/ipfs URLs are kept. It is untrusted, so render it only through
  the sandboxed proxy. Attributes come from TZIP-21 `{name, value}`.

## Staking (`module.staking`)

Delegation is liquid with no lockup. Since Paris (adaptive issuance), staking is done with pseudo-operations: a
transaction to yourself with entrypoint `stake`, `unstake` or `finalize_unstake` (octez staking docs):

- The account must be delegated first.
- The baker must accept external stake (`limit_of_staking_over_baking` > 0, TzKT `limitOfStakingOverBaking`).
- Unstaked XTZ becomes finalizable after `unstake_finalization_delay + 1` = 4 cycles (about 4 days).
- Changing delegate unstakes everything that's staked.

| function | does |
|---|---|
| `getPositions(ctx)` | `StakePosition[]` per baker. `staked` = TzKT `stakedBalance` (current delegate), `delegated` = spendable XTZ (optional extra field), `unstaking` = pending requests, `withdrawable` = finalizable requests, `withdrawableAt` = earliest pending `unlockTime` (from `/v1/staking/unstake_requests?staker=…&status.ne=finalized`). |
| `buildStake({ validator, amount })` | Adds a delegation if you aren't delegated to `validator`. If amount > 0 and the baker accepts staking, adds a `stake` op. If the baker refuses staking, it only delegates and says so in a note. If changing baker unstakes existing stake, a note says so. Refuses non-bakers, and amount 0 when already delegated there. |
| `buildUnstake({ validator, amount })` | `unstake` op. The validator must be your current baker. |
| `buildWithdraw({ validator })` | `finalize_unstake` op (amount 0). |

All of them return `DappRequest`s with origin `"clip-wallet"`, via `"injected"`, method `tezos_send`. Notes
(`params.notes`) are shown only for `origin === "clip-wallet"`, never from a dapp.

`buildTransfer({ asset, to, amount })` sends XTZ, or an FA2/FA1.2 `transfer` (standard looked up on TzKT). It
validates the address, the amount, and rejects transfers to yourself.

## Exports

`createTezosModule(options)`, `tezosModule`, `TEZOS_METHODS`, `TEZOS_SHADOWNET`, `TEZOS_MAINNET`, `TEZOS_NETWORKS`,
`TEZOS_CHAIN_IDS`, `xtzAsset`, `fromChainId`, `beaconNetworkType`, `fromBeaconNetwork`, `tokenAssetKey`,
`tokenRef`, `KNOWN_TOKENS`, `accountsResult`, `encodePublicKey`, `normalize`, `StakePosition`, plus the lower-level
helpers (`buildOperation`, `describeOperations`, `signPayload`, `unpack`, Micheline parsers, `plainTezosError`,
b58check helpers).

Options: `simulate` (default true), `ipfsGateway`, `protocol` (a `ProtocolsHash`), `reuseMs`, `now`.

## Known gaps

- There's no `network-matters` warning. Tezos addresses are the same on every network, and a wrong network only
  fails.
- The protocol for local forging is fixed (`PsUshuai9`). After a protocol upgrade, bump `@taquito/local-forging`
  (or pass `protocol`). The forge round trip check fails loudly instead of signing garbage.
- No preapply before injection. Simulation already covers it, and the node's injection checks the signature.
- Fee constants are the octez defaults, not read from each node's `/mempool/filter`.
- Baker names are TzKT aliases. If there's no indexer, short addresses are shown.
- No TZIP-17 permit decoding: packed non-string data is blind.

## Sources

- ChainAgnostic tezos CAIP-2: https://github.com/ChainAgnostic/namespaces/blob/main/tezos/caip2.md
- Teztnets (Shadownet, Ghostnet retired): https://teztnets.com, https://teztnets.com/teztnets.json
- WalletConnect / Reown Tezos RPC: https://docs.reown.com/advanced/multichain/rpc-reference/tezos-rpc
- Beacon types (`SigningType`, `NetworkType`, `PartialTezosOperation`, `TezosOperationType`): https://www.npmjs.com/package/@airgap/beacon-types (4.8.0), https://docs.walletbeacon.io
- Taquito signing (sign-in payload format): https://taquito.io/docs/25.0.0/signing
- Taquito local forging: https://www.npmjs.com/package/@taquito/local-forging (25.0.0)
- Octez RPC reference: https://octez.tezos.com/docs/active/rpc.html
- Octez staking (pseudo-operations, delays, delegate change): https://octez.tezos.com/docs/active/staking.html
- Octez key management (0x03 operation watermark): https://octez.tezos.com/docs/user/key-management.html
- Octez minimal fees / mempool filter: https://octez.tezos.com/docs/active/plugins.html, https://octez.tezos.com/docs/CHANGES.html
- TzKT API: https://api.tzkt.io (accounts, delegates, tokens, tokens/balances, staking/unstake_requests)
- TZIP-7 (FA1.2), TZIP-12 (FA2), TZIP-21 (metadata): https://gitlab.com/tezos/tzip
- Circle USDC addresses (no Tezos L1): https://developers.circle.com/stablecoins/usdc-contract-addresses
- Temple derivation path: https://github.com/madfish-solutions/templewallet-extension/blob/development/src/lib/temple/helpers.ts
