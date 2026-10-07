# @clip-wallet/chains-tron

TRON `ChainModule` for Clip Wallet. It builds and decodes TRON transactions with hand-written protobuf (no TronWeb,
no protobuf runtime) and never touches keys. `prepare()` returns the 32-byte digest the vault signs (`txID` =
sha256(raw_data) for transactions, the TIP-104 keccak digest for messages). `finalize()` checks the vault's signature
with `secp256k1.verify` and recovers the account key with the recovery id before anything leaves the wallet, then
returns r ‖ s ‖ v (v = 27 + recovery, as TronWeb) and broadcasts when the method asks.

Runtime dependencies: `@noble/curves`, `@noble/hashes`, `@scure/base`. TronWeb is a devDependency (tests cross-check
against it).

## Networks

| NetworkId (CAIP-2, Reown form) | chain id (`eth_chainId`) | endpoints (`rpcUrls`, keyless) | explorer |
|---|---|---|---|
| `tron:0xcd8690dc` Nile testnet (default) | 0xcd8690dc | https://nile.trongrid.io, https://api.nileex.io | https://nile.tronscan.org |
| `tron:0x94a9059e` Shasta testnet | 0x94a9059e | https://api.shasta.trongrid.io | https://shasta.tronscan.org |
| `tron:0x2b6653dc` mainnet | 0x2b6653dc | https://api.trongrid.io, https://api.tronstack.io, https://tron-rpc.publicnode.com | https://tronscan.org |

- Ids are WalletConnect / Reown's `tron:` + the hex chain id (the last 4 bytes of the genesis block id). The
  ChainAgnostic `tron` namespace (Draft) writes the same number in decimal (`tron:728126428`); `fromChainId` /
  `netOf` accept both, the bare chain id and the genesis block id.
- Every endpoint was checked with `POST /wallet/getnowblock` and `/wallet/getblockbynum {"num":0}` (genesis ids in
  `TRON_NETS`). The next endpoint is tried when one is down or rate-limited; none answering is `tron/offline`.
- Only TronGrid and api.nileex.io answer `/wallet/estimateenergy`; elsewhere the module uses `energy_used` (+
  `energy_penalty`) from `/wallet/triggerconstantcontract`.

Assets:

- TRX is `trx` (6 decimals, amounts in sun).
- Tether USDT is `usdt` on mainnet (`TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`). The Nile faucet's USDT test token
  (`TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf`) is `trc20:TXYZ…`, never merged with real USDT. Shasta has none.
- USDC isn't listed: Circle stopped issuing USDC on TRON. USDD isn't listed: two contracts (old and 2.0) are live.
- Other TRC-20 tokens are `trc20:<address>`, TRC-10 tokens `trc10:<id>`; a token named like USDT/USDC/USDD/TUSD/TRX/WTRX
  that isn't the canonical contract is marked `spam`.

## Accounts and addresses

- `derivationPath(i)` = `m/44'/195'/0'/0/i` (TronLink, TronWeb.fromMnemonic), secp256k1.
- Address = base58check(0x41 ‖ keccak256(uncompressed key)[12..]). The tests reproduce TronWeb for the public
  "abandon … about" phrase (`TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH`, `TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK`).
- `isAddress` accepts `T…` with a valid checksum only (dapps' hex `41…` is accepted inside transactions and params).
- The same address works on every TRON network (no `receiveAddress`).
- An account must exist on chain before it can send (`tron/not-open`). If its owner permission (or the active
  permission a transaction names) doesn't give this key the threshold, signing is refused (`tron/not-controlled`).
  That's what happened to the public test account on Nile: someone moved its owner permission to another key.

## Methods (`TRON_METHODS`)

| method | params | result |
|---|---|---|
| `tron_signTransaction` (Reown) | `{ address, transaction }`: a TronWeb transaction (`raw_data_hex`, optional `txID`, `raw_data`, `visible`), flat or the legacy nested `{ transaction: { … } }` | the transaction with `txID` and `signature: [r‖s‖v hex]` |
| `tron_signMessage` (Reown) | `{ address, message, encoding?: "hex" }` | `{ signature: "0x" + r‖s‖v }` (TronWeb signMessageV2) |
| `tron_signAndSendTransaction` (Clip) | as `tron_signTransaction` | `{ txID, result: true, transaction }` after broadcast |

Checks on every transaction: only the hex is trusted.

- `txID`, when given, must equal sha256(raw_data_hex) (`tron/txid-mismatch`).
- `raw_data` JSON, when given, must say what the hex says: block reference, expiration, timestamp, fee limit, memo,
  contract type, type_url, Permission_id and every value field Clip explains (`tron/json-mismatch`). The tests check
  this agrees with TronWeb's own `txCheck`.
- The reference block (ref_block_bytes / ref_block_hash) must be a block of this network (`tron/network-mismatch`):
  a Nile transaction is never signed as a mainnet one.
- The contract's owner_address must be this account (`tron/not-a-signer`); expired transactions are refused
  (`tron/expired`); the request's `address` must be this account (`tron/wrong-account`).

## decode()

Fee = the most TRX the transaction can burn with what the account has right now ("Network fee at most"):

- Bandwidth: the signed size (raw + 67 signature bytes + 64 result bytes) is free if staked or the daily free
  bandwidth covers all of it, else bytes × `getTransactionFee` (1000 sun).
- A TRX or TRC-10 transfer to an address that isn't on chain yet opens it: `getCreateNewAccountFeeInSystemContract`
  (1 TRX) + `getCreateAccountFee` (0.1 TRX) unless staked bandwidth covers it. Shown as an info `new-recipient`
  warning ("Sending to it also costs 1.1 TRX to open it").
- A memo costs `getMemoFee` (1 TRX).
- Contract calls: estimated energy (`estimateenergy`, else `triggerconstantcontract`) minus the account's available
  energy, × `getEnergyFee` (100 sun), at most the fee limit. A simulation that reverts is a danger `simulation-failed`
  ("expected to fail … Reason: …") and the fee shown is the whole fee limit.

| contract | title | notes |
|---|---|---|
| TransferContract | "Send 1.5 TRX to TSeJ…NQZK" | balance change; refused to yourself; TRX to a smart contract is refused (`tron/contract-recipient`) |
| TransferAssetContract (TRC-10) | "Send 5 ABC to …" | token name and precision from /wallet/getassetissuebyid; look-alikes marked spam |
| TriggerSmartContract `transfer` | "Send 1 USDT to …" | symbol/decimals from the known list or symbol()/decimals()/name() |
| TriggerSmartContract `transferFrom` | "Move 1 USDT from … to …" | |
| TriggerSmartContract `approve` | "Allow … to spend 5 USDT" / "…spend unlimited USDT" / "Stop … from spending your USDT" | danger `unlimited-approval` at ≥ 2^255 |
| TriggerSmartContract, other calldata | "Use 0x12345678 on contract …" | contract + 4-byte selector, `blind: true` |
| FreezeBalanceV2 / UnfreezeBalanceV2 | "Stake 10 TRX for energy" / "Unstake 1 TRX" | unstaking period from `getUnfreezeDelayDays` |
| WithdrawExpireUnfreeze / CancelAllUnfreezeV2 | "Withdraw unstaked TRX" / "Cancel your pending unstaking…" | |
| DelegateResource / UnDelegateResource | "Lend the energy of 5 TRX you've staked to …" / "Take back…" | lock period in hours |
| VoteWitness | "Vote for 2 Super Representatives" | each vote; info: replaces earlier votes |
| WithdrawBalance | "Claim your voting rewards" | |
| AccountPermissionUpdate | "Change who controls your TRON account" | danger `account-takeover`, owner/active keys and thresholds |
| other contract types | "Approve a transaction" (+ the type) | `blind: true` |
| bytes that don't parse, extra fields Clip doesn't explain, more than one contract | "Approve an unreadable request from …" | `blind: true` |

Messages: TIP-104 / TronWeb `signMessageV2`, keccak256("\x19TRON Signed Message:\n" ‖ byte length ‖ message).
The legacy `signMessage` (fixed "32" length) isn't offered.

## Builders

`buildTransfer({ asset, to, amount })` → `tron_signAndSendTransaction`:

- TRX → TransferContract; TRC-20 (`asset.address`) → TriggerSmartContract `transfer(address,uint256)` with
  fee_limit = estimated energy × energy fee × 1.3, rounded up to 0.1 TRX (capped at `getMaxFeeLimit`).
- Reference block = the latest block; expiration = its time + 10 minutes (`expirationMs`).
- Refused: own address, a bad address, zero, an account that isn't open, not enough TRX for amount + worst-case fee,
  not enough of the token, a simulation that reverts.
- After broadcasting (`/wallet/broadcasthex`), `/wallet/gettransactioninfobyid` is polled (10 × 3 s); a contract
  that ran out of energy or reverted is `tron/failed`. Node errors become plain words (`plainTronError`).

`staking(ctx)` returns staked TRX (Stake 2.0, including delegated), unstaking and withdrawable amounts, and energy and
bandwidth use, from the same calls as balances. `getBalances` returns TRX and USDT only.

## Dapps

1Mask's TRON provider (`packages/1mask/src/inpage/tron.ts`) implements TIP-1193 + TIP-1102 + TIP-3326 on
`window.clipwallet.tron`, announced with TIP-6963 under the wallet's own identity, and maps TronWeb's
`trx.sign` / `trx.signMessageV2` onto the two Reown methods above.

## Tests

`test/tron.test.ts`, no network:

- Unsigned transactions captured from Nile with curl (`test/fixtures.ts`), cross-checked with TronWeb's
  `txCheck`, `txJsonToPb` / `txPbToRawDataHex`, `ecRecover`, `hashMessage` and `Trx.verifyMessageV2`.
- Signatures precomputed offline with the vault from the public "abandon … about" vector (`test/signatures.ts`).

## Sources

- java-tron protobuf: https://github.com/tronprotocol/java-tron/tree/develop/protocol/src/main/protos/core
- Full-node HTTP API: https://developers.tron.network/reference/full-node-api-overview
- Resource model (bandwidth, energy, account creation): https://developers.tron.network/docs/resource-model
- TIP-104 (data signing), TIP-191, TIP-1193, TIP-1102, TIP-3326, TIP-6963: https://github.com/tronprotocol/tips
- TronWeb message signing: https://github.com/tronprotocol/tronweb/blob/master/src/utils/message.ts
- WalletConnect TRON methods and chain ids: https://github.com/reown-com/reown-docs/blob/main/advanced/multichain/rpc-reference/tron-rpc.mdx
- ChainAgnostic tron namespace (Draft): https://github.com/ChainAgnostic/namespaces/blob/main/tron/caip2.md
- Nile faucet and USDT test token: https://nileex.io/join/getJoinPage
