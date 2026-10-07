# @clip-wallet/chains-cosmos

Cosmos SDK `ChainModule` for Clip Wallet: Osmosis, dYdX, ZIGChain, Provenance, THORChain and Initia. It builds,
decodes and simulates transactions and never touches keys. `prepare()` returns the 32-byte digest a Cosmos
signature covers; `finalize()` checks the vault's signature with `secp256k1.verify` before anything leaves the
wallet, then returns it to the app or broadcasts.

Everything is hand-written on `@noble/hashes`, `@noble/curves` (verification and public-key maths only) and
`@scure/base`: protobuf (`src/proto.ts`), Amino JSON (`src/amino.ts`) and the REST client (`src/rest.ts`). No cosmjs
in the shipped module; the tests compare every encoding byte for byte with `cosmjs-types` and `@cosmjs/amino`.

## One package, four families

Each ecosystem's wallets derive at the chain's own SLIP-44 coin type, so each is its own vault key family and its
own module instance. `createCosmosModule({ family })` answers only that family's networks.

| family | path (vault `derivationPath`) | key | networks |
|---|---|---|---|
| `cosmos` | `m/44'/118'/0'/0/i` | secp256k1 | Osmosis, dYdX, ZIGChain |
| `provenance` | `m/44'/505'/0'/0/i` | secp256k1 | Provenance |
| `thorchain` | `m/44'/931'/0'/0/i` | secp256k1 | THORChain |
| `initia` | `m/44'/60'/0'/0/i` | ethsecp256k1 | Initia L1 |

```ts
import { createCosmosModule } from "@clip-wallet/chains-cosmos";
import { COSMOS_NETWORKS, networksOfFamily } from "@clip-wallet/chains-cosmos/networks"; // no module code
const osmosis = createCosmosModule({ family: "cosmos" }); // also cosmosModule, provenanceModule, thorchainModule, initiaModule
```

Options: `simulate` (default true: dapp sign docs are simulated in `decode`), `gasAdjustment` (1.4),
`pollAttempts` (10) and `pollIntervalMs` (1500) for confirming a broadcast.

## Networks

Network ids are CAIP-2 in the `cosmos` namespace, `cosmos:<chain-id>`. `rpcUrls` are REST (LCD) endpoints, tried in
order (unreachable, 429 and plain 5xx answers move to the next).

| id | name | prefix | native | REST endpoints |
|---|---|---|---|---|
| `cosmos:osmo-test-5` | Osmosis Testnet | `osmo` | OSMO (`uosmo`, 6) | lcd.osmotest5.osmosis.zone, lcd.testnet.osmosis.zone |
| `cosmos:osmosis-1` | Osmosis | `osmo` | OSMO | lcd.osmosis.zone, osmosis-rest.publicnode.com, osmosis-api.polkachu.com |
| `cosmos:dydx-testnet-4` | dYdX Testnet | `dydx` | DV4TNT (`adv4tnt`, 18) | dydx-testnet-api.polkachu.com, test-dydx-rest.kingnodes.com |
| `cosmos:dydx-mainnet-1` | dYdX | `dydx` | DYDX (`adydx`, 18) | dydx-rest.publicnode.com, dydx-api.polkachu.com |
| `cosmos:zig-test-2` | ZIGChain Testnet | `zig` | ZIG (`azig`, 18) | zigchain-testnet-api.polkachu.com, public-zigchain-testnet-lcd.numia.xyz, testnet-api.zigchain.com |
| `cosmos:zigchain-1` | ZIGChain | `zig` | ZIG (`azig`, 18) | public-zigchain-lcd.numia.xyz, zigchain-api.polkachu.com |
| `cosmos:pio-testnet-1` | Provenance Testnet | `tp` | HASH (`nhash`, 9) | api.test.provenance.io |
| `cosmos:pio-mainnet-1` | Provenance | `pb` | HASH (`nhash`, 9) | provenance-api.polkachu.com, provenance.api.pocket.network |
| `cosmos:thorchain-1` | THORChain | `thor` | RUNE (`rune`, 8) | gateway.liquify.com/chain/thorchain_api, thorchain.ibs.team/api |
| `cosmos:initiation-2` | Initia Testnet | `init` | INIT (`uinit`, 6) | rest.testnet.initia.xyz |
| `cosmos:interwoven-1` | Initia | `init` | INIT (`uinit`, 6) | rest.initia.xyz, initia-api.polkachu.com |

Sources: github.com/cosmos/chain-registry (`<chain>/chain.json`, `testnets/<chain>testnet/chain.json`) and, for
Initia, github.com/initia-labs/initia-registry. Every endpoint answered `GET /cosmos/base/tendermint/v1beta1/node_info`
with the right `network` when checked (Oct 2026) and allows any origin, which matters because the extension background
has no host permission for them. thorchain.ibs.team sends its CORS header twice, which browsers refuse, so it's only
a last resort; `api.provenance.io` sends none and isn't used. None needs a key. Only one public REST endpoint was
found for `pio-testnet-1` and `initiation-2` (`rest-skip.testnet.initia.xyz` needs a key; thornode.ninerealms.com
no longer resolves).

- **THORChain is mainnet only.** Its stagenet (`thorchain-stagenet-2`, `sthor` prefix) runs on real funds and
  THORChain has no public testnet.
- **Provenance testnet keys.** Clip derives Provenance at coin 505 on both networks (`pb…` / `tp…` are the same key).
  chain-registry and Keplr list `pio-testnet-1` with slip44 1, so a Keplr testnet account is a different key.
- **Initia testnet keys.** Clip derives Initia at coin 60 (ethsecp256k1) on both networks, as initia-registry
  says. Keplr's `initiation-2` config uses coin 118, so a Keplr testnet account is a different key.

Assets: the native coin (keys `osmo`, `dydx`, `zig`, `hash`, `rune`, `init`) and Circle USDC where it's canonical:
Noble USDC on Osmosis (`ibc/498A0751…` from noble-1; on osmo-test-5 `ibc/DE6792CF…` from Noble's testnet grand-1)
and on dYdX (`ibc/8E27BA2D…` on both dYdX networks, channel-0; also dYdX's collateral and second fee asset, so it's
listed even at 0). Denom traces checked with `/ibc/apps/transfer/v1/denom_traces/{hash}`. Other IBC and factory denoms are hidden from balances: anyone can register bank metadata
for a factory denom, including the name "USDC". In approvals an unknown denom is shown as its raw denom with no
decimals, never scaled by a guess.

## Addresses

- secp256k1: `bech32(prefix, RIPEMD-160(SHA-256(compressed key)))` (cosmjs `pubkeyToAddress`).
- Initia: `bech32("init", keccak256(uncompressed key)[12..])`, the EVM address's bytes.
- The vault's `Account.address` is the mainnet-style spelling (`cosmos1…`, `pb1…`, `thor1…`, `init1…`).
  `receiveAddress(ctx)` and `addressFromPublicKey(key, network)` give the network's own prefix (`osmo1…`, `dydx1…`,
  `zig1…`, `tp1…`).
- `isAddress` checks the bech32 checksum, one of the family's prefixes and a 20-byte (account) or 32-byte
  (contract, module, Initia object) payload. `networksForAddress` goes by prefix.

## Methods

| method | params | result |
|---|---|---|
| `cosmos_signDirect` | `{ signerAddress, signDoc: { bodyBytes, authInfoBytes (base64), chainId, accountNumber (string) } }` | `{ signed: signDoc, signature: StdSignature }` |
| `cosmos_signAmino` | `{ signerAddress, signDoc: StdSignDoc }` | `{ signed, signature }` |
| `cosmos_signArbitrary` | `{ signer, data (base64) }` | `StdSignature` (ADR-36) |
| `cosmos_signAndBroadcast` | `{ signDoc }`, wallet-built only (`origin: WALLET_ORIGIN`) | `{ txhash, status: "success" \| "pending", height? }` |
| `read("cosmos_sendTx")` | `{ tx (base64 TxRaw), mode: "sync" \| "async" \| "block" }` | `{ txhash }` (no approval, as Keplr `sendTx`) |
| `read("cosmos_verifyArbitrary")` | `{ signer, data, signature }` | `boolean` (no approval) |

`cosmos_signDirect` and `cosmos_signAmino` are the WalletConnect Cosmos RPC methods
(https://docs.reown.com/advanced/multichain/rpc-reference/cosmos-rpc). `StdSignature` is
`{ pub_key: { type: "tendermint/PubKeySecp256k1", value }, signature }` (base64 r‖s), on Initia too, as Keplr returns it.

What gets signed (`prepare`):

- **Direct:** the `SignDoc` protobuf (`body_bytes`, `auth_info_bytes`, `chain_id`, `account_number`).
- **Amino:** the canonical Amino JSON (sorted keys, `<`, `>`, `&` escaped), as cosmjs `serializeSignDoc`.
- **ADR-36:** Keplr's `makeADR36AminoSignDoc` (chain_id "", account 0, sequence 0, fee 0, one `sign/MsgSignData`).
  An ADR-36 doc arriving through `cosmos_signAmino` is treated as a message signature.
- **Digest:** SHA-256 of those bytes; Initia (ethsecp256k1): Keccak-256, as `initia/crypto/ethsecp256k1` verifies and
  Keplr signs on `eth-key-sign` chains.

Refused in plain words before anything is signed: a sign doc or request for another network (`cosmos/network-mismatch`),
a `signerAddress`/`signer` that isn't this account on that chain (`cosmos/wrong-account`), a transaction whose signer
keys or messages don't include this account (`cosmos/not-a-signer`), `cosmos_signAndBroadcast` from a site.

## decode()

| message | title | notes |
|---|---|---|
| bank `MsgSend` (THORChain `types.MsgSend`) | "Send 1.5 OSMO to osmo1jrkm…4pqs" (or "Receive …", "{from} sends …") | balance changes for this account |
| IBC `MsgTransfer` | "Send 1 OSMO to noble1…" | "Through: IBC channel …", caution `network-matters` |
| staking `MsgDelegate` / `MsgUndelegate` / `MsgBeginRedelegate` (and Initia `mstaking`) | "Stake 2 OSMO with …", "Unstake …", "Move … of stake from … to …" | unbonding explained |
| distribution `MsgWithdrawDelegatorReward` | "Claim staking rewards from …" | |
| CosmWasm `MsgExecuteContract` | "Use swap on contract osmo1…" | contract, the JSON message, funds as balance changes, caution `unknown-call` |
| authz `MsgGrant` / feegrant `MsgGrantAllowance` | "Let osmo1… act for your account", "Let … pay network fees with your OSMO" | **danger `account-takeover`** |
| authz `MsgRevoke` / feegrant `MsgRevokeAllowance` | "Stop … from …" | |
| anything else (or unreadable bytes, extension options, tips) | "Approve a transaction for {host}" | `blind: true`, danger `blind-signing` |
| ADR-36 | "Sign a message for {host}" | text, or hex with a caution when it isn't text |

Every request shows the memo, "Valid until" (timeout height), the network fee and, for dapp signatures, "Sent by
{host} (it gets the signed transaction)". A fee paid by a granter or another payer is said. Direct sign docs are
simulated (`/cosmos/tx/v1beta1/simulate` with an empty signature): success sets `simulated`, an insufficient-funds
failure is a danger warning, anything else a caution.

## Sending

`buildTransfer({ asset, to, amount })` → `cosmos_signAndBroadcast`:

1. The account from `/cosmos/auth/v1beta1/account_info/{addr}` (SDK ≥ 0.47), falling back to `/accounts/{addr}`
   with BaseAccount fields found inside any wrapper (vesting, EthAccount). Not found → "Your account isn't on
   {network} yet. Receive some {symbol} first." Module accounts are refused.
2. Balances from `/cosmos/bank/v1beta1/balances/{addr}`.
3. `MsgSend` (THORChain: `/types.MsgSend` with raw 20-byte addresses), a
   SIGN_MODE_DIRECT signer info with this key's type URL (`/cosmos.crypto.secp256k1.PubKey`, Initia
   `/initia.crypto.v1beta1.ethsecp256k1.PubKey`) and the on-chain sequence.
4. Gas: simulate, × 1.4 (THORChain: at least 6 000 000, as xchainjs; THORNode doesn't charge gas).
5. Fee: gas limit × gas price of the first fee token the account can pay (chain-registry prices; dYdX falls back to
   USDC, the asset its own clients default to).
   - Osmosis: the x/txfees EIP-1559 base fee (`/osmosis/txfees/v1beta1/cur_eip_base_fee`) × 1.65, the
     `defaultBaseFeeMultiplier` of osmosis-frontend `packages/tx/src/gas.ts`.
   - Initia: x/dynamicfee's current price (`/initia/tx/v1/gas_prices/uinit`) × 1.05.
   - Provenance: x/flatfees charges per message type, not per gas. `POST /provenance/tx/v1/calculate_flat_fee`
     (`{ tx_bytes, gas_adjustment }`) gives `total_fees` and `estimated_gas`, used as they are
     (provenance `x/flatfees/spec/01_concepts.md`; a plain simulate would report the fee as `gas_used`).
   - THORChain: no fee coins; the chain takes its fixed native fee (`native_tx_fee_rune` from `/thorchain/network`,
     0.02 RUNE today) from the balance, and it's checked before sending. Bank `MsgSend` is accepted today only
     because mimir `BANKSENDENABLED=1` (x/thorchain/ante.go), so Clip sends `/types.MsgSend` as xchainjs does.
6. Broadcast `BROADCAST_MODE_SYNC` to `/cosmos/tx/v1beta1/txs`, then poll `/cosmos/tx/v1beta1/txs/{hash}`.
   SDK error codes become plain words (`plainCosmosError`).

## Balances

`getBalances`: the native coin (0 when the account doesn't exist yet) and the curated USDC. `getNfts` returns `[]`.

## Dapp connectivity

1Mask exposes a Keplr-compatible provider at `window.clipwallet.cosmos` (never `window.keplr`):
`packages/1mask/src/inpage/cosmos.ts`, `background/cosmos.ts`, `shared/cosmos.ts`. It implements `enable`, `disable`,
`getKey`, `signDirect`, `signAmino`, `signArbitrary`, `verifyArbitrary`, `sendTx`, `getOfflineSigner`,
`getOfflineSignerOnlyAmino`, `getOfflineSignerAuto`, `getChainInfosWithoutEndpoints`, `getChainInfoWithoutEndpoints`
and `experimentalSuggestChain` (refuses chains Clip doesn't ship), checked against `@keplr-wallet/types` 0.13.41
`src/wallet/keplr.ts` and `@keplr-wallet/provider` 0.13.41 `src/cosmjs.ts` (the GitHub repository is no longer public;
the npm packages ship the source), and https://docs.keplr.app/api/guide/.

## Testnet faucets

| network | faucet | gate |
|---|---|---|
| osmo-test-5 | https://faucet.testnet.osmosis.zone | address form + Cloudflare Turnstile captcha, no login |
| dydx-testnet-4 | `POST https://faucet.v4testnet.dydx.exchange/faucet/native-token { address }` (v4-clients `faucet_client.py`) | no captcha in the API; `/faucet/tokens` funds a trading subaccount, not the bank balance |
| zig-test-2 | https://faucet.zigchain.com | behind a Cloudflare challenge; docs say once per day per address |
| initiation-2 | https://app.testnet.initia.xyz/faucet | address form + Turnstile, no login |
| pio-testnet-1 | none: the explorer faucet (explorer.test.provenance.io/faucet) reached end of life | |
| thorchain-1 | none (mainnet only) | |

## Known gaps

- No Ledger, multisig or fee-grant-aware sending. Dapp fees are signed as given (Keplr's `preferNoSetFee` fee editing
  isn't offered).
- Initia `mstaking`/distribution messages are explained; other Initia Move messages (`/initia.move.v1.MsgExecute`)
  are blind.
- THORChain `MsgDeposit` (swaps, memos) is blind.
- `ethereumHexAddress` in `getKey` is lower-case hex (a valid EIP-55 spelling); Keplr checksums it.

## Tests

`test/proto.test.ts` (encodings against cosmjs-types / @cosmjs/amino) and `test/cosmos.test.ts` (addresses,
balances, decode/prepare/finalize, transfers, refusals) use no network: REST answers are fixtures shaped like the
live nodes. Signatures in `test/signatures.ts` were computed offline with the vault's signing code from the public
"abandon … about" account; only public keys, addresses and signatures are in the repo.
